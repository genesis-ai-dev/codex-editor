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

function getBinaryPath(context: vscode.ExtensionContext): string {
    const storagePath = context.globalStorageUri.fsPath;
    const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    return path.join(storagePath, "ffmpeg", binaryName);
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
 * Ensure the extension-owned FFmpeg binary is present.
 * Downloads it if not already cached in extension global storage.
 * Returns the binary path on success, null on failure.
 */
export async function downloadFFmpeg(
    context: vscode.ExtensionContext,
): Promise<string | null> {
    return downloadFFmpegBinary(context);
}


async function canExecute(binaryPath: string): Promise<boolean> {
    try {
        await execFile(binaryPath, ["-version"], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

async function downloadFFmpegBinary(
    context: vscode.ExtensionContext,
): Promise<string | null> {
    const { getAudioToolMode } = await import("./toolPreferences");
    if (getAudioToolMode() === "force-builtin") {
        console.log("[ffmpegManager] force-builtin mode — skipping native binary download");
        return null;
    }

    const binaryPath = getBinaryPath(context);
    const destDir = path.join(context.globalStorageUri.fsPath, "ffmpeg");

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

    const version = getPlatformVersion();
    if (!version) {
        console.warn(
            `[ffmpegManager] Platform ${process.platform}-${process.arch} not supported for ffmpeg`,
        );
        return null;
    }

    const effectiveKey = getEffectivePlatformKey();
    const packageName = `@ffmpeg-installer/${effectiveKey}`;

    try {
        await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    } catch {
        // may already exist
    }

    try {
        await downloadAndExtractPackage(packageName, version, destDir);
        if (process.platform !== "win32" && fs.existsSync(binaryPath)) {
            fs.chmodSync(binaryPath, 0o755);
        }
        if (fs.existsSync(binaryPath)) {
            const hash = await computeFileHash(binaryPath);
            writeHashMarker(destDir, hash);
            console.log(`[ffmpegManager] SHA-256 of installed binary: ${hash}`);
            await resetRetryCount(context, "ffmpeg");
            console.log(`[ffmpegManager] Successfully downloaded ffmpeg: ${binaryPath}`);
            return binaryPath;
        }
        return null;
    } catch (error) {
        await incrementRetryCount(context, "ffmpeg");
        console.error(
            `[ffmpegManager] Failed to download ffmpeg:`,
            error instanceof Error ? error.message : String(error),
        );
        return null;
    }
}

/**
 * Download FFmpeg with a progress notification.
 */
async function downloadWithProgress(
    context: vscode.ExtensionContext,
): Promise<string | null> {
    const binaryPath = getBinaryPath(context);
    if (fs.existsSync(binaryPath) && (await canExecute(binaryPath))) {
        await resetRetryCount(context, "ffmpeg");
        return binaryPath;
    }

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Downloading audio processing tools...",
            cancellable: false,
        },
        async (progress) => {
            progress.report({ message: "This only happens once" });
            try {
                progress.report({ message: "Downloading FFmpeg..." });
                return await downloadFFmpegBinary(context);
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
