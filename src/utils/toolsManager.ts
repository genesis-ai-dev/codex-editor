import * as vscode from "vscode";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import { isNativeSqliteReady } from "./nativeSqlite";
import { isDatabaseReady } from "./sqliteDatabaseFactory";
import { getAudioToolMode, getGitToolMode, getSqliteToolMode } from "./toolPreferences";
import { getFfmpegBinaryPath, isFfmpegNativelySupported } from "./ffmpegManager";
import { isSqliteNativelySupported } from "./sqliteNativeBinaryManager";
import type { FrontierAPI } from "../../webviews/codex-webviews/src/StartupFlow/types";

const execFile = promisify(execFileCb);

export interface ToolCheckResult {
    git: boolean;
    /** True only when the native dugite binary is available (false when using isomorphic-git fallback). */
    nativeGitAvailable: boolean;
    /** True when any SQLite backend (native or fts5 WASM fallback) is operational. */
    sqlite: boolean;
    /** True only when the native node_sqlite3 binary is loaded. */
    nativeSqliteAvailable: boolean;
    ffmpeg: boolean;
    /**
     * Per-tool flag set to true when the CURRENT OS/arch has no prebuilt
     * native asset available. On these platforms the "Download and install"
     * action is a guaranteed no-op, so the UI should render "Not available
     * on this platform" instead of a download button.
     */
    platformUnsupported: {
        git: boolean;
        sqlite: boolean;
        ffmpeg: boolean;
    };
}

const REQUIRED_TOOLS_FFMPEG_KEY = "requiredTools.ffmpeg";

/**
 * Run a fresh availability check for all required tools.
 */
export async function checkTools(
    context: vscode.ExtensionContext,
    frontierApi: FrontierAPI | undefined,
): Promise<ToolCheckResult> {
    let git = false;
    let nativeGitAvailable = false;
    try {
        git = frontierApi?.isGitAvailable?.() ?? frontierApi?.isGitBinaryAvailable?.() ?? false;
        nativeGitAvailable = frontierApi?.isGitBinaryAvailable?.() ?? false;
    } catch (e) {
        console.error("[toolsManager] git check threw:", e);
    }

    let sqlite = false;
    let nativeSqliteAvailable = false;
    try {
        nativeSqliteAvailable = isNativeSqliteReady();
        sqlite = isDatabaseReady();
    } catch (e) {
        console.error("[toolsManager] sqlite check threw:", e);
    }

    let ffmpeg = false;
    try {
        ffmpeg = await verifyBinaryAvailable("ffmpeg", context);
    } catch (e) {
        console.error("[toolsManager] ffmpeg check threw:", e);
    }

    // Per-tool "unsupported on this platform" flags.  Treat a missing
    // Frontier API method as "supported" (optimistic default) so older
    // auth extensions keep working; the download path itself still
    // no-ops safely on unsupported platforms.
    const platformUnsupported = {
        git: frontierApi?.isGitBinaryNativelySupported?.() === false,
        sqlite: !isSqliteNativelySupported(),
        ffmpeg: !isFfmpegNativelySupported(),
    };

    return {
        git,
        nativeGitAvailable,
        sqlite,
        nativeSqliteAvailable,
        ffmpeg,
        platformUnsupported,
    };
}

/**
 * Returns the list of tools that are currently unavailable.
 */
export function getUnavailableTools(result: ToolCheckResult): string[] {
    const isBuiltinMode = (mode: string) => mode === "builtin" || mode === "force-builtin";
    const unavailable: string[] = [];
    if (!result.git && !isBuiltinMode(getGitToolMode())) {
        unavailable.push("git");
    }
    if (!result.sqlite && !isBuiltinMode(getSqliteToolMode())) {
        unavailable.push("sqlite");
    }
    if (!result.ffmpeg && !isBuiltinMode(getAudioToolMode())) {
        unavailable.push("ffmpeg");
    }
    return unavailable;
}

/**
 * Permanently mark FFmpeg as required. Once set, it stays set forever.
 * On subsequent startups the tool will be checked and downloaded if missing.
 */
export async function markAudioToolRequired(
    context: vscode.ExtensionContext,
): Promise<void> {
    await context.globalState.update(REQUIRED_TOOLS_FFMPEG_KEY, true);
}

/**
 * Check whether FFmpeg has been marked as required by a previous
 * audio operation.
 */
export function isAudioToolRequired(
    context: vscode.ExtensionContext,
): boolean {
    return context.globalState.get<boolean>(REQUIRED_TOOLS_FFMPEG_KEY) ?? false;
}

/**
 * Verify that the extension-owned FFmpeg binary is present and executable.
 * Only checks the downloaded binary in extension globalStorage — never
 * falls back to system-installed binaries on the PATH.
 *
 * The path is resolved via `getFfmpegBinaryPath` in ffmpegManager, which is
 * the single source of truth for the versioned binary location.
 */
async function verifyBinaryAvailable(
    tool: "ffmpeg",
    context: vscode.ExtensionContext,
): Promise<boolean> {
    const downloadedPath = getFfmpegBinaryPath(context);
    if (downloadedPath && fs.existsSync(downloadedPath) && (await canExecute(downloadedPath))) {
        return true;
    }

    return false;
}

async function canExecute(binaryPath: string): Promise<boolean> {
    try {
        await execFile(binaryPath, ["-version"], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}
