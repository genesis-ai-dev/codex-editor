/** Extension-owned FFmpeg only; every resolved binary has a pinned build identity. */
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { resolveFfmpegBuilds } from "./ffmpegBuilds";
import { ensureFfmpegBuild, ffmpegBuildPath, matchesFfmpegBuild } from "./ffmpegStorage";
import { validateFfmpegBuild } from "./ffmpegValidation";

interface VerifiedBinary {
    path: string;
    fingerprint: string;
}

let verifiedBinary: VerifiedBinary | null = null;
let storageRoot: string | undefined;
let cacheGeneration = 0;

function fingerprint(file: string): string | undefined {
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile()) { return undefined; }
        return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.mode}`;
    } catch { return undefined; }
}

function cachedPath(expected?: string): string | null {
    if (!verifiedBinary || (expected && verifiedBinary.path !== expected)) { return null; }
    if (fingerprint(verifiedBinary.path) !== verifiedBinary.fingerprint) {
        verifiedBinary = null;
        return null;
    }
    return verifiedBinary.path;
}

export function getFfmpegBinaryPath(context: vscode.ExtensionContext): string | null {
    const builds = resolveFfmpegBuilds();
    return builds ? ffmpegBuildPath(path.join(context.globalStorageUri.fsPath, "ffmpeg"), builds.current) : null;
}

/** Includes the Windows ARM64 -> x64 compatibility fallback. */
export function isFfmpegNativelySupported(): boolean {
    return resolveFfmpegBuilds() !== undefined;
}

export function isFfmpegNativeAssetSupported(): boolean {
    return resolveFfmpegBuilds()?.current.platform === `${process.platform}-${process.arch}`;
}

export interface DownloadFFmpegOptions {
    showProgress?: boolean;
}

/** Read-only Tools Status check: never download or execute an unknown binary. */
export async function verifyFfmpegAvailable(context: vscode.ExtensionContext): Promise<boolean> {
    const builds = resolveFfmpegBuilds();
    const binary = getFfmpegBinaryPath(context);
    if (!builds || !binary) { return false; }
    if (cachedPath(binary)) { return true; }
    const generation = cacheGeneration;
    try {
        const before = fingerprint(binary);
        if (!before || !await matchesFfmpegBuild(binary, builds.current)) { return false; }
        await validateFfmpegBuild(binary, builds.current);
        if (generation !== cacheGeneration || fingerprint(binary) !== before) { return false; }
        verifiedBinary = { path: binary, fingerprint: before };
        storageRoot = path.join(context.globalStorageUri.fsPath, "ffmpeg");
        return true;
    } catch { return false; }
}

export async function downloadFFmpeg(context: vscode.ExtensionContext, options: DownloadFFmpegOptions = {}): Promise<string | null> {
    storageRoot = path.join(context.globalStorageUri.fsPath, "ffmpeg");
    return resolveBinary(storageRoot, options.showProgress ?? false);
}

async function resolveBinary(root: string, showProgress: boolean): Promise<string | null> {
    const { getAudioToolMode } = await import("./toolPreferences");
    if (getAudioToolMode() === "force-builtin") { return null; }
    const builds = resolveFfmpegBuilds();
    if (!builds) { return null; }
    const cached = cachedPath(ffmpegBuildPath(root, builds.current));
    if (cached) { return cached; }
    const generation = cacheGeneration;
    try {
        const install = (progress?: vscode.Progress<{ message?: string }>) => ensureFfmpegBuild(root, builds, {
            report: message => progress?.report({ message }),
        });
        const binary = showProgress
            ? await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification, title: "Preparing Audio Tools", cancellable: false,
            }, progress => install(progress))
            : await install();
        // A tools reset or preference change during installation must not
        // repopulate the cache with an obsolete result.
        if (generation !== cacheGeneration || getAudioToolMode() === "force-builtin") { return null; }
        const stamp = fingerprint(binary);
        if (!stamp) { return null; }
        verifiedBinary = { path: binary, fingerprint: stamp };
        return binary;
    } catch (error) {
        verifiedBinary = null;
        console.warn("[ffmpegManager] Verified FFmpeg unavailable:", error);
        return null;
    }
}

export async function getFFmpegPath(context?: vscode.ExtensionContext): Promise<string | null> {
    if (context) { return downloadFFmpeg(context, { showProgress: true }); }
    // Startup remembers globalStorage for callers that do not carry a context.
    // Do not fall back to an unverified bundled/system executable.
    return storageRoot ? resolveBinary(storageRoot, true) : null;
}

export function checkAudioToolsAvailable(): boolean {
    return cachedPath() !== null;
}

export function resetBinaryCache(): void {
    cacheGeneration++;
    verifiedBinary = null;
}
