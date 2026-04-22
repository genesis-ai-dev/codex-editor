/**
 * FFmpeg manager — always downloads and uses an extension-owned binary.
 * Never falls back to system-installed FFmpeg on the PATH.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import {
    computeFileHash,
    writeHashMarker,
    readHashMarker,
    verifyIntegrity,
    hasExceededRetries,
    incrementRetryCount,
    resetRetryCount,
} from "./binaryIntegrityUtils";

const execFile = promisify(execFileCb);

interface BinaryInfo {
    path: string;
    source: "downloaded" | "bundled";
    version?: string;
}

let ffmpegInfo: BinaryInfo | null = null;

/** Subdirectory name inside extension global storage for the FFmpeg binary */
const FFMPEG_STORAGE_DIR = "ffmpeg";

/**
 * ============================================================================
 * VERSION CONSTANTS — read carefully before changing
 * ============================================================================
 * Each platform has its own FFmpeg version string. These are used in TWO
 * places:
 *   1. The download URL (npm tarball from @ffmpeg-installer/{platform})
 *   2. The storage folder name (where we save it on disk):
 *      `{globalStorage}/ffmpeg/{version}/ffmpeg` (or `ffmpeg.exe` on Windows)
 *
 * To upgrade FFmpeg for a platform:
 *   1. Change the version string for that platform below.
 *   2. Verify the tarball exists at:
 *      https://registry.npmjs.org/@ffmpeg-installer/{platform}/-/{platform}-{NEW_VERSION}.tgz
 *   3. On next extension startup, users on that platform will download the
 *      new version into a new subfolder:
 *      globalStorage/ffmpeg/{NEW_VERSION}/
 *   4. The old version folder is LEFT IN PLACE as a harmless orphan; only the
 *      version matching the current constant is ever read at runtime.
 *      Users can manually clean up old folders via the "Delete Binary" button.
 * ============================================================================
 */
const PLATFORM_MAP: Record<string, string> = {
    "win32-x64": "4.1.0",
    "darwin-arm64": "4.1.5",
    "darwin-x64": "4.1.0",
    "linux-x64": "4.1.0",
    "linux-arm64": "4.1.4",
    "linux-arm": "4.1.3",
};

const PLATFORM_FALLBACK: Record<string, string> = {
    "win32-arm64": "win32-x64",
};

/** OS-appropriate executable filename for FFmpeg. */
function getFfmpegExecutableName(): string {
    return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

/**
 * Get the parent directory that contains all version subfolders.
 * Used by the migration routine and by tooling that needs to detect legacy
 * (unversioned) installs.
 */
function getParentStorageDir(context: vscode.ExtensionContext): string {
    return path.join(context.globalStorageUri.fsPath, FFMPEG_STORAGE_DIR);
}

/**
 * Get the versioned directory holding the FFmpeg binary for the current
 * platform's pinned version, or null when this platform has no version.
 */
function getVersionedStorageDir(context: vscode.ExtensionContext): string | null {
    const version = getPlatformVersion();
    if (!version) {
        return null;
    }
    return path.join(getParentStorageDir(context), version);
}

/**
 * Get the absolute path to the FFmpeg binary for the current platform.
 * Returns null when the platform has no pinned version in PLATFORM_MAP.
 * This is the single source of truth for the binary's location.
 */
export function getFfmpegBinaryPath(context: vscode.ExtensionContext): string | null {
    const versionedDir = getVersionedStorageDir(context);
    if (!versionedDir) {
        return null;
    }
    return path.join(versionedDir, getFfmpegExecutableName());
}

function getEffectivePlatformKey(): string {
    const native = `${process.platform}-${process.arch}`;
    if (PLATFORM_MAP[native]) {
        return native;
    }
    return PLATFORM_FALLBACK[native] ?? native;
}

function getPlatformVersion(): string | null {
    return PLATFORM_MAP[getEffectivePlatformKey()] ?? null;
}

/**
 * Options for `downloadFFmpeg`.
 */
export interface DownloadFFmpegOptions {
    /**
     * When true, wraps the download in a VS Code progress notification
     * ("Downloading Audio Tools…"). The Tools Status panel passes this so
     * users who click "Download and Install" get the same feedback they get
     * for the other tools. Startup omits the flag because the splash screen
     * already indicates progress.
     */
    showProgress?: boolean;
}

/**
 * Ensure the extension-owned FFmpeg binary is present.
 * Downloads it if not already cached in extension global storage.
 * Returns the binary path on success, null on failure.
 */
export async function downloadFFmpeg(
    context: vscode.ExtensionContext,
    options: DownloadFFmpegOptions = {},
): Promise<string | null> {
    return options.showProgress
        ? downloadWithProgress(context)
        : downloadFFmpegBinary(context);
}


async function canExecute(binaryPath: string): Promise<boolean> {
    try {
        await execFile(binaryPath, ["-version"], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

/** Matches a pure semver-ish directory name like `4.1.5`. */
const VERSION_DIR_PATTERN = /^\d+(\.\d+)+$/;

/**
 * Migrate a legacy flat-layout FFmpeg install into a versioned subfolder.
 *
 * Before this change, binaries lived at:
 *   `{globalStorage}/ffmpeg/ffmpeg` (or `ffmpeg.exe`)
 * Now they live at:
 *   `{globalStorage}/ffmpeg/{PLATFORM_MAP_version}/ffmpeg`
 *
 * Version identifier note: the `@ffmpeg-installer/*` npm package version
 * (what `PLATFORM_MAP` holds) is NOT the same as the FFmpeg binary's
 * internal version reported by `ffmpeg -version`. For example,
 * `@ffmpeg-installer/darwin-arm64@4.1.5` contains a binary that reports
 * `ffmpeg version 4.4`. The download code pins to the npm package version,
 * and the storage folder name must match so existence checks succeed.
 * A legacy flat binary was always obtained from the `PLATFORM_MAP` URL, so
 * the correct destination for migration is `ffmpeg/{currentPlatformVersion}/`.
 *
 * Behavior:
 *   - Current platform has a pinned version AND legacy binary executes →
 *     move into `ffmpeg/{currentVersion}/` (reused as-is, no re-download).
 *   - Legacy binary fails to execute, OR platform has no pinned version →
 *     delete the orphan files; normal download path will handle it.
 *   - Target versioned folder already exists (migration already ran, or
 *     current version was freshly downloaded alongside the legacy file) →
 *     clean up the legacy files, keep the existing versioned folder.
 *   - Any IO error → silently fall through; the normal download path will
 *     re-fetch into the correct versioned folder.
 */
async function migrateUnversionedFfmpeg(context: vscode.ExtensionContext): Promise<void> {
    try {
        const parentDir = getParentStorageDir(context);
        const legacyBinary = path.join(parentDir, getFfmpegExecutableName());

        if (!fs.existsSync(legacyBinary)) {
            return;
        }

        const currentVersion = getPlatformVersion();
        if (!currentVersion) {
            console.warn(
                "[ffmpegManager] Legacy unversioned binary found but no pinned version for this platform — removing orphan files"
            );
            await cleanupLegacyFiles(parentDir);
            return;
        }

        if (!(await canExecute(legacyBinary))) {
            console.warn(
                "[ffmpegManager] Legacy unversioned binary is not executable — removing orphan files"
            );
            await cleanupLegacyFiles(parentDir);
            return;
        }

        const targetDir = path.join(parentDir, currentVersion);
        if (fs.existsSync(targetDir)) {
            console.log(
                `[ffmpegManager] Versioned folder ${currentVersion} already exists — cleaning up legacy files`
            );
            await cleanupLegacyFiles(parentDir);
            return;
        }

        fs.mkdirSync(targetDir, { recursive: true });

        const entries = fs.readdirSync(parentDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && VERSION_DIR_PATTERN.test(entry.name)) {
                continue;
            }
            const src = path.join(parentDir, entry.name);
            const dst = path.join(targetDir, entry.name);
            try {
                fs.renameSync(src, dst);
            } catch (err) {
                console.warn(
                    `[ffmpegManager] Could not move ${entry.name} during migration:`,
                    err instanceof Error ? err.message : String(err)
                );
            }
        }

        console.log(
            `[ffmpegManager] Migrated legacy binary into versioned folder v${currentVersion} — no re-download needed`
        );
    } catch (error) {
        console.warn(
            "[ffmpegManager] Migration of legacy binary failed — falling through to normal download logic:",
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Remove leftover legacy files (binary + sha256 marker) directly inside the
 * parent ffmpeg dir, without touching any version subdirectories.
 */
async function cleanupLegacyFiles(parentDir: string): Promise<void> {
    try {
        const entries = fs.readdirSync(parentDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && VERSION_DIR_PATTERN.test(entry.name)) {
                continue;
            }
            try {
                fs.unlinkSync(path.join(parentDir, entry.name));
            } catch { /* best-effort */ }
        }
    } catch { /* best-effort */ }
}

/**
 * Maximum full-flow retry attempts (download + extract + verify) for the
 * FFmpeg install. Matches git/dugite's `MAX_FULL_RETRIES = 3` so all three
 * tools have consistent retry behavior visible to the user.
 */
const MAX_FULL_RETRIES = 3;

async function downloadFFmpegBinary(
    context: vscode.ExtensionContext,
    progress?: vscode.Progress<{ message?: string }>,
): Promise<string | null> {
    const { getAudioToolMode } = await import("./toolPreferences");
    if (getAudioToolMode() === "force-builtin") {
        console.log("[ffmpegManager] force-builtin mode — skipping native binary download");
        return null;
    }

    const version = getPlatformVersion();
    if (!version) {
        console.warn(
            `[ffmpegManager] Platform ${process.platform}-${process.arch} not supported for ffmpeg`,
        );
        return null;
    }

    // Opportunistically migrate legacy flat-layout installs into versioned folders.
    // Cheap in the common case (single existsSync) and idempotent.
    await migrateUnversionedFfmpeg(context);

    const binaryPath = getFfmpegBinaryPath(context);
    if (!binaryPath) {
        return null;
    }
    const destDir = path.dirname(binaryPath);

    if (fs.existsSync(binaryPath)) {
        const integrityOk = await verifyIntegrity(binaryPath, destDir);
        const hasMarker = readHashMarker(destDir) !== null;

        if (hasMarker && !integrityOk) {
            console.warn(`[ffmpegManager] SHA-256 mismatch — binary may be corrupt, re-downloading`);
        } else if (await canExecute(binaryPath)) {
            console.log(`[ffmpegManager] Downloaded ffmpeg verified: ${binaryPath}`);
            await resetRetryCount(context, "ffmpeg");
            return binaryPath;
        } else {
            console.warn(`[ffmpegManager] Downloaded ffmpeg exists at ${binaryPath} but failed execution check — re-downloading`);
        }
    }

    if (hasExceededRetries(context, "ffmpeg")) {
        console.warn("[ffmpegManager] Retry limit reached — audio features will use fallback");
        return null;
    }

    const effectiveKey = getEffectivePlatformKey();
    const packageName = `@ffmpeg-installer/${effectiveKey}`;

    try {
        await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    } catch {
        // may already exist
    }

    // Full-flow retry loop with exponential backoff (2s/4s), mirroring the
    // git/dugite manager so transient failures surface consistent retry
    // messages and recover automatically. The persistent retry counter is
    // bumped only once after ALL attempts are exhausted.
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_FULL_RETRIES; attempt++) {
        try {
            const prefix = attempt > 1 ? `Retry ${attempt}/${MAX_FULL_RETRIES} — ` : "";
            progress?.report({ message: `${prefix}Downloading...` });
            await downloadAndExtractPackage(packageName, version, destDir);
            if (process.platform !== "win32" && fs.existsSync(binaryPath)) {
                fs.chmodSync(binaryPath, 0o755);
            }
            if (!fs.existsSync(binaryPath)) {
                throw new Error("Binary missing after extract");
            }
            progress?.report({ message: `${prefix}Installing...` });
            const hash = await computeFileHash(binaryPath);
            writeHashMarker(destDir, hash);
            console.log(`[ffmpegManager] SHA-256 of installed binary: ${hash}`);
            await resetRetryCount(context, "ffmpeg");
            console.log(`[ffmpegManager] Successfully downloaded ffmpeg: ${binaryPath}`);
            return binaryPath;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.warn(
                `[ffmpegManager] Full attempt ${attempt}/${MAX_FULL_RETRIES} failed: ${lastError.message}`,
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
    await incrementRetryCount(context, "ffmpeg");
    console.error(
        `[ffmpegManager] All ${MAX_FULL_RETRIES} download attempts failed: ${lastError?.message ?? "unknown"}`,
    );
    return null;
}

/**
 * Download FFmpeg with a progress notification.
 */
async function downloadWithProgress(
    context: vscode.ExtensionContext,
): Promise<string | null> {
    const binaryPath = getFfmpegBinaryPath(context);
    if (binaryPath && fs.existsSync(binaryPath) && (await canExecute(binaryPath))) {
        await resetRetryCount(context, "ffmpeg");
        return binaryPath;
    }

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Downloading Audio Tools",
            cancellable: false,
        },
        async (progress) => {
            try {
                // Forward the progress reporter so the retry loop inside
                // `downloadFFmpegBinary` surfaces attempt/backoff messages
                // (matching how git/dugite reports its retries).
                return await downloadFFmpegBinary(context, progress);
            } catch (error) {
                console.warn(`[ffmpegManager] Download failed: ${error instanceof Error ? error.message : String(error)}`);
                return null;
            }
        },
    );
}

const DOWNLOAD_TIMEOUT_MS = 60_000;

async function downloadAndExtractPackage(
    packageName: string,
    version: string,
    destDir: string
): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const https = require("https");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tar = require("tar");

    const tarballUrl = `https://registry.npmjs.org/${packageName}/-/${packageName.split("/")[1]}-${version}.tgz`;
    const tmpFile = path.join(
        os.tmpdir(),
        `${packageName.replace("/", "-")}-${Date.now()}.tgz`
    );

    const cleanupTmp = () => {
        try { if (fs.existsSync(tmpFile)) { fs.unlinkSync(tmpFile); } } catch { /* best effort */ }
    };

    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (err: Error) => {
            if (settled) { return; }
            settled = true;
            cleanupTmp();
            reject(err);
        };
        const succeed = () => {
            if (settled) { return; }
            settled = true;
            cleanupTmp();
            resolve();
        };

        const timer = setTimeout(() => {
            fail(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`));
        }, DOWNLOAD_TIMEOUT_MS);

        const extractToDir = async () => {
            try {
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                }
                await tar.x({ file: tmpFile, cwd: destDir, strip: 1 });
                clearTimeout(timer);
                succeed();
            } catch (err) {
                clearTimeout(timer);
                fail(err instanceof Error ? err : new Error(String(err)));
            }
        };

        const pipeToFile = (source: NodeJS.ReadableStream) => {
            const fileStream = fs.createWriteStream(tmpFile);
            fileStream.on("error", (err: Error) => { clearTimeout(timer); fail(err); });
            source.pipe(fileStream);
            fileStream.on("finish", () => { fileStream.close(); extractToDir(); });
        };

        const req = https
            .get(tarballUrl, (response: any) => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    const redirectReq = https
                        .get(response.headers.location, (redirectResponse: any) => {
                            pipeToFile(redirectResponse);
                        })
                        .on("error", (err: Error) => { clearTimeout(timer); fail(err); });
                    redirectReq.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
                        redirectReq.destroy();
                        fail(new Error("Redirect request timed out"));
                    });
                } else if (response.statusCode === 200) {
                    pipeToFile(response);
                } else {
                    clearTimeout(timer);
                    fail(new Error(`Failed to download: HTTP ${response.statusCode}`));
                }
            })
            .on("error", (err: Error) => { clearTimeout(timer); fail(err); });

        req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
            req.destroy();
            fail(new Error("Initial request timed out"));
        });
    });
}

/**
 * Initialize and get FFmpeg binary path.
 * Resolution order: extension-owned downloaded binary → bundled.
 */
export async function getFFmpegPath(
    context?: vscode.ExtensionContext
): Promise<string | null> {
    if (ffmpegInfo) {
        return ffmpegInfo.path;
    }

    if (context) {
        const downloaded = await downloadWithProgress(context);
        if (downloaded) {
            ffmpegInfo = { path: downloaded, source: "downloaded" };
            console.log(`[ffmpegManager] Downloaded FFmpeg: ${downloaded}`);
            return downloaded;
        }
    }

    try {
        const req = eval("require") as any;
        const ffmpegInstaller = req("@ffmpeg-installer/ffmpeg");
        if (ffmpegInstaller.path) {
            ffmpegInfo = { path: ffmpegInstaller.path, source: "bundled" };
            console.log(
                `[audioProcessor] Using bundled FFmpeg: ${ffmpegInstaller.path}`
            );
            return ffmpegInstaller.path;
        }
    } catch {
        // No bundled version available
    }

    console.warn("[ffmpegManager] FFmpeg unavailable — audio features will be limited");
    return null;
}

/**
 * Check if the extension-owned FFmpeg binary has been resolved and cached.
 * Returns true when `getFFmpegPath` (or `downloadFFmpeg`) has already
 * successfully located the binary during this session.
 */
export function checkAudioToolsAvailable(): boolean {
    return ffmpegInfo !== null;
}

/**
 * Reset cached binary information (useful for testing).
 */
export function resetBinaryCache(): void {
    ffmpegInfo = null;
}
