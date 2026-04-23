/**
 * SQLite Native Binary Manager
 *
 * Downloads the platform-specific SQLite native addon (.node binary) on first startup.
 * Modeled after ffmpegManager.ts — detects the current platform/arch, downloads from
 * TryGhost/node-sqlite3 GitHub releases, and caches in extension global storage.
 *
 * The binary only needs to be downloaded once; subsequent startups reuse the cached file.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
    computeFileHash,
    writeHashMarker,
    readHashMarker,
    verifyIntegrity,
} from "./binaryIntegrityUtils";

/**
 * ============================================================================
 * VERSION CONSTANT — read carefully before changing
 * ============================================================================
 * This version string is used in TWO places:
 *   1. The download URL (what we fetch from GitHub releases)
 *   2. The storage folder name (where we save it on disk):
 *      `{globalStorage}/sqlite3-native/{SQLITE3_VERSION}/node_sqlite3.node`
 *
 * To upgrade SQLite:
 *   1. Change the value below to the new TryGhost/node-sqlite3 release tag
 *      (without the leading "v" — e.g. "5.1.8" not "v5.1.8")
 *   2. Verify the release exists at:
 *      https://github.com/TryGhost/node-sqlite3/releases/tag/v{NEW_VERSION}
 *   3. Verify prebuilt binaries are published for all supported platforms
 *      (darwin-arm64, darwin-x64, linux-arm64, linux-x64, linuxmusl-*, win32-*)
 *   4. On next extension startup, users will download the new version into
 *      a new subfolder: globalStorage/sqlite3-native/{NEW_VERSION}/
 *   5. The old version folder is LEFT IN PLACE as a harmless orphan; only the
 *      version matching the current constant is ever read at runtime.
 *      Users can manually clean up old folders via the "Delete Binary" button.
 * ============================================================================
 */
const SQLITE3_VERSION = "5.1.7";

/** N-API version for the prebuilt binary (v6 is supported by all modern Node/Electron) */
const NAPI_VERSION = 6;

/** Base URL for prebuilt binary downloads */
const RELEASES_BASE_URL = `https://github.com/TryGhost/node-sqlite3/releases/download/v${SQLITE3_VERSION}`;

/** Subdirectory name inside extension global storage for the SQLite binary */
const SQLITE_STORAGE_DIR = "sqlite3-native";

/** The expected filename inside the tarball: build/Release/node_sqlite3.node */
const BINARY_NAME = "node_sqlite3.node";

/** Minimum expected binary size in bytes — real binaries are ~2 MB; anything below this is corrupt/truncated */
const MIN_BINARY_SIZE_BYTES = 500_000;

/** Maximum HTTP-level download attempts inside `withRetry` (per GET). */
const MAX_DOWNLOAD_ATTEMPTS = 3;

/**
 * Maximum full-flow retry attempts (download + extract + verify). Matches
 * git/dugite's `MAX_FULL_RETRIES` so all three tools have consistent
 * retry behavior visible to the user.
 */
const MAX_FULL_RETRIES = 2;

/** Cached binary path (set after first successful resolution) */
let cachedBinaryPath: string | null = null;

/** In-flight download promise — prevents concurrent download races */
let downloadInProgress: Promise<string | null> | null = null;

/**
 * Determine the platform key used in the prebuilt binary filename.
 *
 * TryGhost builds for:
 *   darwin-arm64, darwin-x64, linux-arm64, linux-x64,
 *   linuxmusl-arm64, linuxmusl-x64, win32-ia32, win32-x64
 */
function getPlatformKey(): string | null {
    const platform = process.platform; // 'darwin', 'linux', 'win32'
    const arch = process.arch; // 'arm64', 'x64', 'ia32'

    if (platform === "darwin") {
        if (arch === "arm64" || arch === "x64") {
            return `darwin-${arch}`;
        }
    } else if (platform === "linux") {
        // Detect musl (Alpine Linux) vs glibc
        const isMusl = detectMusl();
        const prefix = isMusl ? "linuxmusl" : "linux";
        if (arch === "arm64" || arch === "x64") {
            return `${prefix}-${arch}`;
        }
    } else if (platform === "win32") {
        if (arch === "x64" || arch === "ia32") {
            return `win32-${arch}`;
        }
    }

    return null;
}

/**
 * Returns true when the current OS/arch has a prebuilt SQLite native
 * addon published in the TryGhost `node-sqlite3` release we pin to.
 * Callers use this to decide whether to offer a "Download and install"
 * button at all — on unsupported platforms, downloading is impossible
 * and the UI should surface that fact instead of showing a no-op action.
 */
export function isSqliteNativelySupported(): boolean {
    return getPlatformKey() !== null;
}

/**
 * Detect if we're running on a musl-based system (e.g., Alpine Linux).
 */
function detectMusl(): boolean {
    try {
        // Check for Alpine's /etc/alpine-release
        if (fs.existsSync("/etc/alpine-release")) {
            return true;
        }
        // Check if ldd reports musl
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const lddOutput = require("child_process")
            .execSync("ldd --version 2>&1 || true", { encoding: "utf8" });
        return lddOutput.toLowerCase().includes("musl");
    } catch {
        return false;
    }
}

/**
 * Get the download URL for the current platform's prebuilt binary.
 */
function getBinaryDownloadUrl(platformKey: string): string {
    const filename = `sqlite3-v${SQLITE3_VERSION}-napi-v${NAPI_VERSION}-${platformKey}.tar.gz`;
    return `${RELEASES_BASE_URL}/${filename}`;
}

/**
 * Get the directory holding the SQLite binary for the current version.
 * This is the single source of truth for the versioned storage folder.
 */
function getVersionedStorageDir(context: vscode.ExtensionContext): string {
    return path.join(
        context.globalStorageUri.fsPath,
        SQLITE_STORAGE_DIR,
        SQLITE3_VERSION
    );
}

/**
 * Get the parent directory that contains all version subfolders.
 * Used by the migration routine and by callers that need to detect
 * legacy (unversioned) installs.
 */
function getParentStorageDir(context: vscode.ExtensionContext): string {
    return path.join(context.globalStorageUri.fsPath, SQLITE_STORAGE_DIR);
}

/**
 * Get the expected binary file path in extension global storage.
 */
function getBinaryStoragePath(context: vscode.ExtensionContext): string {
    return path.join(getVersionedStorageDir(context), BINARY_NAME);
}

/**
 * Get the path to the version marker file next to the binary.
 */
function getVersionFilePath(context: vscode.ExtensionContext): string {
    return path.join(getVersionedStorageDir(context), "version.txt");
}

/**
 * Check whether a cached binary matches the expected version and is not corrupted.
 * Returns true when the binary should be re-downloaded.
 */
function shouldRedownload(binaryPath: string, versionFilePath: string): boolean {
    // Version mismatch → re-download
    try {
        const storedVersion = fs.readFileSync(versionFilePath, "utf8").trim();
        if (storedVersion !== SQLITE3_VERSION) {
            console.log(
                `[SQLite] Version mismatch (cached: ${storedVersion}, expected: ${SQLITE3_VERSION}) — will re-download`
            );
            return true;
        }
    } catch {
        console.log("[SQLite] version.txt missing or unreadable — will re-download");
        return true;
    }

    // Size check → corruption guard
    try {
        const stat = fs.statSync(binaryPath);
        if (stat.size < MIN_BINARY_SIZE_BYTES) {
            console.log(
                `[SQLite] Binary too small (${stat.size} bytes) — likely corrupt, will re-download`
            );
            return true;
        }
    } catch {
        return true;
    }

    return false;
}

/**
 * Async integrity check: recomputes SHA-256 of the binary and compares to the
 * stored marker. Returns true when re-download is needed.  Falls back to
 * `false` (allow use) when no marker file exists yet (pre-integrity installs).
 */
async function shouldRedownloadAsync(binaryPath: string, storageDir: string): Promise<boolean> {
    const ok = await verifyIntegrity(binaryPath, storageDir);
    if (!ok && readHashMarker(storageDir) !== null) {
        console.log("[SQLite] SHA-256 mismatch — binary may be corrupt, will re-download");
        return true;
    }
    return false;
}

/**
 * Write the version marker after a successful download.
 */
function writeVersionFile(versionFilePath: string): void {
    fs.writeFileSync(versionFilePath, SQLITE3_VERSION, "utf8");
}

/** Maximum number of HTTP redirects to follow before giving up */
const MAX_REDIRECTS = 10;

/**
 * Resolve a potentially relative redirect URL against the original request URL.
 */
function resolveRedirectUrl(from: string, location: string): string {
    try {
        // URL constructor handles both absolute and relative URLs when given a base
        return new URL(location, from).href;
    } catch {
        return location;
    }
}

/**
 * Download a file from a URL, following redirects. Returns the data as a Buffer.
 *
 * @param url        - Absolute URL to fetch
 * @param redirects  - Internal counter to prevent infinite redirect loops
 */
function downloadFile(url: string, redirects = 0): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        if (redirects > MAX_REDIRECTS) {
            reject(new Error(`Too many redirects (>${MAX_REDIRECTS}) — possible redirect loop`));
            return;
        }

        const protocol = url.startsWith("https") ? require("https") : require("http");

        protocol.get(url, { headers: { "User-Agent": "codex-editor" } }, (response: any) => {
            // Follow redirects (301, 302, 307, 308)
            if ([301, 302, 307, 308].includes(response.statusCode)) {
                // Drain the redirect response body to free the socket
                response.resume();

                const location = response.headers.location;
                if (!location) {
                    reject(new Error("Redirect without location header"));
                    return;
                }
                const redirectUrl = resolveRedirectUrl(url, location);
                downloadFile(redirectUrl, redirects + 1).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Download failed: HTTP ${response.statusCode}`));
                return;
            }

            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => resolve(Buffer.concat(chunks)));
            response.on("error", reject);
        }).on("error", reject);
    });
}

/**
 * Retry a function up to `MAX_DOWNLOAD_ATTEMPTS` times with exponential backoff
 * (1 s, 2 s, 4 s, …). Rethrows the last error on exhaustion.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < MAX_DOWNLOAD_ATTEMPTS) {
                const delayMs = Math.pow(2, attempt - 1) * 1000; // 1 s, 2 s, 4 s
                console.warn(
                    `[SQLite] ${label} attempt ${attempt}/${MAX_DOWNLOAD_ATTEMPTS} failed: ${lastError.message} — retrying in ${delayMs}ms…`
                );
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }
    }
    throw lastError;
}

/**
 * Migrate a legacy flat-layout install into the new versioned folder.
 *
 * Before this change, binaries lived at:
 *   `{globalStorage}/sqlite3-native/node_sqlite3.node`
 * Now they live at:
 *   `{globalStorage}/sqlite3-native/{SQLITE3_VERSION}/node_sqlite3.node`
 *
 * This function runs on every startup but only performs work when a legacy
 * binary is detected. It always tries to preserve the existing binary by
 * moving it into a correctly-named version subfolder, so no re-download is
 * needed when the user's existing install matches the current version.
 *
 * Behavior:
 *   - `version.txt` matches current `SQLITE3_VERSION` → move into versioned
 *     folder (reused as-is, no re-download).
 *   - `version.txt` says a different version → move into that version's
 *     folder (preserved but inactive; current version downloaded fresh).
 *   - `version.txt` is missing/unreadable → delete orphan files (can't
 *     verify they're trustworthy).
 *   - Any IO error → silently fall through; the normal download path will
 *     re-fetch into the correct versioned folder.
 */
function migrateUnversionedSqlite(context: vscode.ExtensionContext): void {
    try {
        const parentDir = getParentStorageDir(context);
        const legacyBinary = path.join(parentDir, BINARY_NAME);
        const legacyVersionFile = path.join(parentDir, "version.txt");
        const legacyHashFile = path.join(parentDir, "sha256.txt");

        if (!fs.existsSync(legacyBinary)) {
            return;
        }

        let foundVersion: string | null = null;
        try {
            foundVersion = fs.readFileSync(legacyVersionFile, "utf8").trim();
            if (!foundVersion) {
                foundVersion = null;
            }
        } catch {
            foundVersion = null;
        }

        if (!foundVersion) {
            console.warn(
                "[SQLite] Legacy unversioned binary found but version.txt is missing/unreadable — removing orphan files"
            );
            try { fs.unlinkSync(legacyBinary); } catch { /* best-effort */ }
            try { fs.unlinkSync(legacyHashFile); } catch { /* may not exist */ }
            return;
        }

        const targetDir = path.join(parentDir, foundVersion);
        if (fs.existsSync(targetDir)) {
            console.log(
                `[SQLite] Versioned folder ${foundVersion} already exists — skipping migration, cleaning up legacy files`
            );
            try { fs.unlinkSync(legacyBinary); } catch { /* best-effort */ }
            try { fs.unlinkSync(legacyVersionFile); } catch { /* best-effort */ }
            try { fs.unlinkSync(legacyHashFile); } catch { /* may not exist */ }
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });
        fs.renameSync(legacyBinary, path.join(targetDir, BINARY_NAME));
        try {
            fs.renameSync(legacyVersionFile, path.join(targetDir, "version.txt"));
        } catch { /* version.txt move is best-effort; we can regenerate it */ }
        try {
            fs.renameSync(legacyHashFile, path.join(targetDir, "sha256.txt"));
        } catch { /* sha256.txt move is best-effort; verifyIntegrity will return false if missing */ }

        if (foundVersion === SQLITE3_VERSION) {
            console.log(
                `[SQLite] Migrated legacy binary (v${foundVersion}) into versioned folder — no re-download needed`
            );
        } else {
            console.log(
                `[SQLite] Migrated legacy binary (v${foundVersion}) into its own versioned folder; current version v${SQLITE3_VERSION} will be downloaded on demand`
            );
        }
    } catch (error) {
        // Any failure here is non-fatal: the normal download logic will run
        // next and produce a correct versioned install from scratch.
        console.warn(
            "[SQLite] Migration of legacy binary failed — falling through to normal download logic:",
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Download and extract the SQLite native binary to extension storage.
 */
async function downloadBinary(
    context: vscode.ExtensionContext,
    platformKey: string
): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tar = require("tar");
    const downloadUrl = getBinaryDownloadUrl(platformKey);
    const storageDir = getVersionedStorageDir(context);
    const binaryPath = path.join(storageDir, BINARY_NAME);
    const versionFilePath = getVersionFilePath(context);
    const tmpFile = path.join(os.tmpdir(), `sqlite3-native-${Date.now()}.tar.gz`);

    console.log(`[SQLite] Downloading native binary from: ${downloadUrl}`);

    try {
        // Download the tarball with retry + backoff
        const data = await withRetry(() => downloadFile(downloadUrl), "Download");

        // Write to temp file
        fs.writeFileSync(tmpFile, data);

        // Ensure storage directory exists
        fs.mkdirSync(storageDir, { recursive: true });

        // Extract: the tarball contains build/Release/node_sqlite3.node
        // We extract with strip=2 to get just the .node file in storageDir
        await tar.x({
            file: tmpFile,
            cwd: storageDir,
            strip: 2, // strip "build/Release/" to put node_sqlite3.node directly in storageDir
        });

        // Verify the binary was extracted
        if (!fs.existsSync(binaryPath)) {
            throw new Error(
                `Binary extraction failed: ${BINARY_NAME} not found at ${binaryPath}`
            );
        }

        // Verify extracted binary is not corrupt (size sanity check)
        const stat = fs.statSync(binaryPath);
        if (stat.size < MIN_BINARY_SIZE_BYTES) {
            // Remove the corrupt file so next startup retries from scratch
            try { fs.unlinkSync(binaryPath); } catch { /* best-effort */ }
            throw new Error(
                `Downloaded binary appears corrupt (${stat.size} bytes, expected ≥ ${MIN_BINARY_SIZE_BYTES})`
            );
        }

        // Write version marker so future startups know which version is cached
        writeVersionFile(versionFilePath);

        // Write SHA-256 marker for startup integrity re-verification
        const hash = await computeFileHash(binaryPath);
        writeHashMarker(storageDir, hash);
        console.log(`[SQLite] SHA-256 of installed binary: ${hash}`);

        console.log(`[SQLite] Native binary v${SQLITE3_VERSION} installed at: ${binaryPath}`);
        return binaryPath;
    } finally {
        // Always clean up the temp file, even on failure
        try { fs.unlinkSync(tmpFile); } catch { /* file may not exist if download failed */ }
    }
}

/**
 * Options for `ensureSqliteNativeBinary`.
 */
export interface EnsureSqliteOptions {
    /**
     * When true, suppress the standalone progress notification that normally
     * appears at the bottom of the window during a download. The caller is
     * expected to provide its own progress UI (for example, the "Downloading…"
     * button state in the Tools Status panel). The startup path keeps the
     * default (false) because nothing else indicates sqlite progress during
     * activation.
     */
    suppressProgress?: boolean;
}

/**
 * Ensure the SQLite native binary is available, downloading it if necessary.
 * This should be called on extension startup BEFORE any database operations.
 *
 * By default shows a progress notification ("Setting up search…") if a
 * download is needed. Callers that already surface a progress UI can pass
 * `{ suppressProgress: true }` to opt out.
 *
 * Returns the path to the .node binary file.
 */
export async function ensureSqliteNativeBinary(
    context: vscode.ExtensionContext,
    options: EnsureSqliteOptions = {}
): Promise<string | null> {
    const { getSqliteToolMode } = await import("./toolPreferences");
    if (getSqliteToolMode() === "force-builtin") {
        console.log("[SQLite] force-builtin mode — skipping native binary download");
        return null;
    }

    // Opportunistically migrate legacy flat-layout installs into versioned folders.
    // This is cheap (single existsSync check in the common case) and idempotent.
    migrateUnversionedSqlite(context);

    const binaryPath = getBinaryStoragePath(context);
    const versionFilePath = getVersionFilePath(context);
    const storageDir = getVersionedStorageDir(context);

    // Fast path: in-memory cache still valid (same process, already verified)
    if (cachedBinaryPath && cachedBinaryPath === binaryPath && fs.existsSync(cachedBinaryPath)) {
        return cachedBinaryPath;
    }

    // Check if binary already exists in storage AND matches expected version/integrity
    if (fs.existsSync(binaryPath) && !shouldRedownload(binaryPath, versionFilePath)) {
        if (await shouldRedownloadAsync(binaryPath, storageDir)) {
            console.warn("[SQLite] Integrity check failed — deleting cached binary for re-download");
            try { fs.unlinkSync(binaryPath); } catch { /* best-effort */ }
        } else {
            cachedBinaryPath = binaryPath;
            console.log(`[SQLite] Using cached native binary v${SQLITE3_VERSION}: ${binaryPath}`);
            return binaryPath;
        }
    }

    // Unsupported platforms: no native asset exists for this OS/arch, so skip
    // the download entirely. The fts5-sql-bundle fallback is used permanently.
    const platformKey = getPlatformKey();
    if (!platformKey) {
        console.warn(`[SQLite] Platform ${process.platform}-${process.arch} not supported — falling back to fts5-sql-bundle`);
        return null;
    }

    // Fast-fail when offline. Any HTTP response (even 4xx/5xx) means the
    // network is reachable — only a network-level failure (DNS, timeout,
    // connection refused) means we're truly offline. Checking resp.ok would
    // incorrectly treat rate-limit (403/429) responses as "offline".
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        await fetch("https://github.com", {
            method: "HEAD",
            signal: controller.signal,
        });
        clearTimeout(timeout);
    } catch {
        console.warn("[SQLite] Offline — native binary unavailable, falling back to fts5-sql-bundle");
        return null;
    }

    if (downloadInProgress) {
        console.log("[SQLite] Download already in progress — waiting for it to finish");
        return downloadInProgress;
    }

    // Shared body of the download operation. Reused whether or not we wrap
    // the work in a progress notification, so error handling and retry-count
    // bookkeeping stay identical across both paths.
    //
    // Runs a full-flow retry loop with exponential backoff (2s) mirroring
    // git/dugite's behavior, so a transient failure during download, extract,
    // or verification can recover without user intervention. Each retry
    // surfaces its state through the optional progress reporter.
    const runDownload = async (
        progress?: vscode.Progress<{ message?: string }>
    ): Promise<string | null> => {
        let lastError: Error | undefined;
        for (let attempt = 1; attempt <= MAX_FULL_RETRIES; attempt++) {
            try {
                const prefix = attempt > 1 ? `Retry ${attempt}/${MAX_FULL_RETRIES} — ` : "";
                progress?.report({ message: `${prefix}Downloading...` });
                const downloadedPath = await downloadBinary(context, platformKey);
                progress?.report({ message: "Search is ready!" });
                return downloadedPath;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.warn(
                    `[SQLite] Full attempt ${attempt}/${MAX_FULL_RETRIES} failed: ${lastError.message}`,
                );
                if (attempt < MAX_FULL_RETRIES) {
                    const delay = 2000 * Math.pow(2, attempt - 1); // 2s, 4s
                    progress?.report({
                        message: `Attempt ${attempt} failed — retrying in ${(delay / 1000).toFixed(0)}s...`,
                    });
                    await new Promise((r) => setTimeout(r, delay));
                }
            }
        }
        console.warn(
            `[SQLite] All ${MAX_FULL_RETRIES} download attempts failed: ${lastError?.message ?? "unknown"}`,
        );
        return null;
    };

    if (options.suppressProgress) {
        // Caller owns the progress UI; skip the standalone notification.
        downloadInProgress = runDownload();
    } else {
        downloadInProgress = Promise.resolve(
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Downloading AI Learning and Search Tools",
                    cancellable: false,
                },
                async (progress) => runDownload(progress)
            )
        );
    }

    try {
        const result = await downloadInProgress;
        if (result) {
            cachedBinaryPath = result;
        }
        return result;
    } finally {
        downloadInProgress = null;
    }
}

/**
 * Get the cached binary path without triggering a download.
 * Returns null if the binary hasn't been downloaded yet.
 */
export function getSqliteBinaryPath(): string | null {
    return cachedBinaryPath;
}

/**
 * Reset the cached binary path (useful for testing).
 */
export function resetSqliteBinaryCache(): void {
    cachedBinaryPath = null;
}
