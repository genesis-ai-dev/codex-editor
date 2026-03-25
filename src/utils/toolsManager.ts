import * as vscode from "vscode";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { isNativeSqliteReady } from "./nativeSqlite";
import { isDatabaseReady } from "./sqliteDatabaseFactory";
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

    return { git, nativeGitAvailable, sqlite, nativeSqliteAvailable, ffmpeg };
}

/**
 * Returns the list of tools that are currently unavailable.
 */
export function getUnavailableTools(result: ToolCheckResult): string[] {
    const unavailable: string[] = [];
    if (!result.git) {
        unavailable.push("git");
    }
    if (!result.sqlite) {
        unavailable.push("sqlite");
    }
    if (!result.ffmpeg) {
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
 * Verify that a binary is available and executable.
 *
 * Resolution order:
 *  1. System binary (via `which` / `where`)
 *  2. Downloaded binary in extension globalStorage
 *
 * Each candidate is confirmed by running `<binary> -version` with a timeout.
 */
async function verifyBinaryAvailable(
    tool: "ffmpeg",
    context: vscode.ExtensionContext,
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
    tool: "ffmpeg",
    context: vscode.ExtensionContext,
): string | null {
    const storagePath = context.globalStorageUri.fsPath;
    const binaryName = process.platform === "win32" ? `${tool}.exe` : tool;
    return path.join(storagePath, tool, binaryName);
}

async function canExecute(binaryPath: string): Promise<boolean> {
    try {
        await execFile(binaryPath, ["-version"], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}
