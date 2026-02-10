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

/** Version of the TryGhost sqlite3 prebuilt binary we download */
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

/** Maximum download attempts before giving up */
const MAX_DOWNLOAD_ATTEMPTS = 3;

/** Cached binary path (set after first successful resolution) */
let cachedBinaryPath: string | null = null;

/** In-flight download promise — prevents concurrent download races */
let downloadInProgress: Promise<string> | null = null;

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
 * Get the expected binary file path in extension global storage.
 */
function getBinaryStoragePath(context: vscode.ExtensionContext): string {
    return path.join(
        context.globalStorageUri.fsPath,
        SQLITE_STORAGE_DIR,
        BINARY_NAME
    );
}

/**
 * Get the path to the version marker file next to the binary.
 */
function getVersionFilePath(context: vscode.ExtensionContext): string {
    return path.join(
        context.globalStorageUri.fsPath,
        SQLITE_STORAGE_DIR,
        "version.txt"
    );
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
        // version.txt missing or unreadable → treat as outdated
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
 * Download and extract the SQLite native binary to extension storage.
 */
async function downloadBinary(
    context: vscode.ExtensionContext,
    platformKey: string
): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tar = require("tar");
    const downloadUrl = getBinaryDownloadUrl(platformKey);
    const storageDir = path.join(context.globalStorageUri.fsPath, SQLITE_STORAGE_DIR);
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

        console.log(`[SQLite] Native binary v${SQLITE3_VERSION} installed at: ${binaryPath}`);
        return binaryPath;
    } finally {
        // Always clean up the temp file, even on failure
        try { fs.unlinkSync(tmpFile); } catch { /* file may not exist if download failed */ }
    }
}

/**
 * Ensure the SQLite native binary is available, downloading it if necessary.
 * This should be called on extension startup BEFORE any database operations.
 *
 * Shows a blocking progress dialog if download is needed.
 * Returns the path to the .node binary file.
 */
export async function ensureSqliteNativeBinary(
    context: vscode.ExtensionContext
): Promise<string> {
    const binaryPath = getBinaryStoragePath(context);
    const versionFilePath = getVersionFilePath(context);

    // Fast path: in-memory cache still valid (same process, already verified)
    if (cachedBinaryPath && cachedBinaryPath === binaryPath && fs.existsSync(cachedBinaryPath)) {
        return cachedBinaryPath;
    }

    // Check if binary already exists in storage AND matches expected version/integrity
    if (fs.existsSync(binaryPath) && !shouldRedownload(binaryPath, versionFilePath)) {
        cachedBinaryPath = binaryPath;
        console.log(`[SQLite] Using cached native binary v${SQLITE3_VERSION}: ${binaryPath}`);
        return binaryPath;
    }

    // Determine platform
    const platformKey = getPlatformKey();
    if (!platformKey) {
        throw new Error(
            `SQLite native binary not available for this platform: ` +
            `${process.platform}-${process.arch}. ` +
            `Supported: darwin-arm64, darwin-x64, linux-arm64, linux-x64, ` +
            `linuxmusl-arm64, linuxmusl-x64, win32-ia32, win32-x64`
        );
    }

    // If another call is already downloading, piggyback on that promise
    // to avoid concurrent extractions into the same directory
    if (downloadInProgress) {
        console.log("[SQLite] Download already in progress — waiting for it to finish");
        return downloadInProgress;
    }

    // Download with blocking progress dialog.
    // Wrap in Promise.resolve() because vscode.window.withProgress returns Thenable, not Promise.
    downloadInProgress = Promise.resolve(
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Setting up Codex Editor",
                cancellable: false,
            },
            async (progress) => {
                progress.report({
                    message: "Downloading search engine components... (one-time setup)",
                });

                try {
                    const downloadedPath = await downloadBinary(context, platformKey);
                    progress.report({ message: "Search engine ready!" });
                    return downloadedPath;
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(
                        `Failed to download SQLite native binary: ${msg}. ` +
                        `Database features (dictionary, search index) will be unavailable.`
                    );
                    throw error;
                }
            }
        )
    );

    try {
        const result = await downloadInProgress;
        cachedBinaryPath = result;
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
