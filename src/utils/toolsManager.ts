import * as vscode from "vscode";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { isNativeSqliteReady } from "./nativeSqlite";
import type { FrontierAPI } from "../../webviews/codex-webviews/src/StartupFlow/types";

const execFile = promisify(execFileCb);

export interface ToolCheckResult {
    git: boolean;
    sqlite: boolean;
    ffmpeg: boolean | null;
    ffprobe: boolean | null;
}

const REQUIRED_TOOLS_FFMPEG_KEY = "requiredTools.ffmpeg";
const REQUIRED_TOOLS_FFPROBE_KEY = "requiredTools.ffprobe";

/**
 * Run a fresh availability check for all required tools.
 * Git and SQLite are always checked. FFmpeg/FFprobe are only checked
 * when the user has previously triggered an audio operation.
 */
export async function checkTools(
    context: vscode.ExtensionContext,
    frontierApi: FrontierAPI | undefined
): Promise<ToolCheckResult> {
    let git = false;
    try {
        git = frontierApi?.isGitBinaryAvailable?.() ?? false;
    } catch (e) {
        console.error("[toolsManager] git check threw:", e);
    }

    let sqlite = false;
    try {
        sqlite = isNativeSqliteReady();
    } catch (e) {
        console.error("[toolsManager] sqlite check threw:", e);
    }

    let ffmpeg: boolean | null = null;
    if (isAudioToolRequired(context, "ffmpeg")) {
        try {
            ffmpeg = await verifyBinaryAvailable("ffmpeg", context);
        } catch (e) {
            console.error("[toolsManager] ffmpeg check threw:", e);
            ffmpeg = false;
        }
    }

    let ffprobe: boolean | null = null;
    if (isAudioToolRequired(context, "ffprobe")) {
        try {
            ffprobe = await verifyBinaryAvailable("ffprobe", context);
        } catch (e) {
            console.error("[toolsManager] ffprobe check threw:", e);
            ffprobe = false;
        }
    }

    return { git, sqlite, ffmpeg, ffprobe };
}

/**
 * Returns the list of tools that are required but currently unavailable.
 * Git and SQLite are always considered required. FFmpeg/FFprobe are only
 * included when their value is `false` (required but missing), not `null`
 * (not required).
 */
export function getUnavailableTools(result: ToolCheckResult): string[] {
    const unavailable: string[] = [];
    if (!result.git) {
        unavailable.push("git");
    }
    if (!result.sqlite) {
        unavailable.push("sqlite");
    }
    if (result.ffmpeg === false) {
        unavailable.push("ffmpeg");
    }
    if (result.ffprobe === false) {
        unavailable.push("ffprobe");
    }
    return unavailable;
}

/**
 * Permanently mark an audio tool as required. Once set, it stays set forever.
 * On subsequent startups the tool will be checked and downloaded if missing.
 */
export async function markAudioToolRequired(
    context: vscode.ExtensionContext,
    tool: "ffmpeg" | "ffprobe"
): Promise<void> {
    const key = tool === "ffmpeg" ? REQUIRED_TOOLS_FFMPEG_KEY : REQUIRED_TOOLS_FFPROBE_KEY;
    await context.globalState.update(key, true);
}

/**
 * Check whether an audio tool has been marked as required by a previous
 * audio operation.
 */
export function isAudioToolRequired(
    context: vscode.ExtensionContext,
    tool: "ffmpeg" | "ffprobe"
): boolean {
    const key = tool === "ffmpeg" ? REQUIRED_TOOLS_FFMPEG_KEY : REQUIRED_TOOLS_FFPROBE_KEY;
    return context.globalState.get<boolean>(key) ?? false;
}

/**
 * Verify that a binary is available and executable.
 *
 * Resolution order:
 *  1. System binary (via `which` / `where`)
 *  2. Downloaded binary in extension globalStorage
 *
 * Each candidate is confirmed by running `<binary> -version` with a timeout.
 */
async function verifyBinaryAvailable(
    tool: "ffmpeg" | "ffprobe",
    context: vscode.ExtensionContext
): Promise<boolean> {
    const systemPath = await getSystemBinaryPath(tool);
    if (systemPath && (await canExecute(systemPath))) {
        return true;
    }

    const downloadedPath = getDownloadedBinaryPath(tool, context);
    if (downloadedPath && fs.existsSync(downloadedPath) && (await canExecute(downloadedPath))) {
        return true;
    }

    return false;
}

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

function getDownloadedBinaryPath(
    tool: "ffmpeg" | "ffprobe",
    context: vscode.ExtensionContext
): string | null {
    const storagePath = context.globalStorageUri.fsPath;
    const binaryName = process.platform === "win32" ? `${tool}.exe` : tool;
    const binaryPath = path.join(storagePath, tool, binaryName);
    return binaryPath;
}

async function canExecute(binaryPath: string): Promise<boolean> {
    try {
        await execFile(binaryPath, ["-version"], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}
