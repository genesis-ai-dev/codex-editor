/**
 * FFmpeg manager that prefers system binaries and only downloads as fallback.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";

const execFile = promisify(execFileCb);

interface BinaryInfo {
    path: string;
    source: "system" | "downloaded" | "bundled";
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

async function getSystemBinaryPath(command: string): Promise<string | null> {
    try {
        const checkCmd = process.platform === "win32" ? "where" : "which";
        const { stdout } = await execFile(checkCmd, [command], { timeout: 5000 });
        const firstLine = stdout.trim().split(/\r?\n/)[0]?.trim();
        return firstLine || null;
    } catch {
        return null;
    }
}

async function isCommandAvailable(command: string): Promise<boolean> {
    try {
        const checkCmd = process.platform === "win32" ? "where" : "which";
        await execFile(checkCmd, [command], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

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
 * Download only FFmpeg. Checks system install first, then downloads if needed.
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
    const systemPath = await getSystemBinaryPath("ffmpeg");
    if (systemPath && (await canExecute(systemPath))) {
        console.log(`[ffmpegManager] System ffmpeg verified: ${systemPath}`);
        return systemPath;
    } else if (systemPath) {
        console.warn(`[ffmpegManager] System ffmpeg found at ${systemPath} but failed execution check`);
    }

    const binaryPath = getBinaryPath(context);
    if (fs.existsSync(binaryPath) && (await canExecute(binaryPath))) {
        console.log(`[ffmpegManager] Downloaded ffmpeg verified: ${binaryPath}`);
        return binaryPath;
    } else if (fs.existsSync(binaryPath)) {
        console.warn(`[ffmpegManager] Downloaded ffmpeg exists at ${binaryPath} but failed execution check — re-downloading`);
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
    const destDir = path.join(context.globalStorageUri.fsPath, "ffmpeg");

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
        console.log(`[ffmpegManager] Successfully downloaded ffmpeg: ${binaryPath}`);
        return fs.existsSync(binaryPath) ? binaryPath : null;
    } catch (error) {
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
    if (fs.existsSync(binaryPath)) {
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
                vscode.window.showErrorMessage(
                    `Failed to download audio processing tools: ${error instanceof Error ? error.message : String(error)}`,
                );
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
 * Resolution order: system → downloaded → bundled.
 */
export async function getFFmpegPath(
    context?: vscode.ExtensionContext
): Promise<string> {
    if (ffmpegInfo) {
        return ffmpegInfo.path;
    }

    const systemPath = await getSystemBinaryPath("ffmpeg");
    if (systemPath) {
        ffmpegInfo = { path: systemPath, source: "system" };
        console.log(`[audioProcessor] Using system FFmpeg: ${systemPath}`);
        return systemPath;
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

    throw new Error(
        "FFmpeg not found. Audio features are unavailable. " +
            "Download the Codex application from codexeditor.app for full audio support."
    );
}

/**
 * Check if FFmpeg is available on the system PATH.
 */
export async function checkAudioToolsAvailable(): Promise<boolean> {
    try {
        return await isCommandAvailable("ffmpeg");
    } catch {
        return false;
    }
}

/**
 * Reset cached binary information (useful for testing).
 */
export function resetBinaryCache(): void {
    ffmpegInfo = null;
}
