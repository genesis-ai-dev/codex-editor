import * as vscode from "vscode";
import type { FrontierAPI } from "../../webviews/codex-webviews/src/StartupFlow/types";
import {
    getAudioToolMode,
    getGitToolMode,
    getSqliteToolMode,
    setAudioToolMode,
    setGitToolMode,
    setNativeGitAvailable,
    setSqliteToolMode,
} from "./toolPreferences";
import { checkTools, type OptimizedToolKey, type ToolCheckResult } from "./toolsManager";

export interface OptimizedToolsResult {
    status: ToolCheckResult;
    enabled: OptimizedToolKey[];
    failed: Array<{ tool: OptimizedToolKey; reason: string }>;
}

/**
 * Install and activate optimized tools for the requested tool set.
 * Existing native binaries are reused; missing binaries are downloaded.
 */
export async function enableOptimizedTools(
    context: vscode.ExtensionContext,
    frontierApi: FrontierAPI | undefined,
    tools: OptimizedToolKey[],
): Promise<OptimizedToolsResult> {
    const enabled: OptimizedToolKey[] = [];
    const failed: Array<{ tool: OptimizedToolKey; reason: string }> = [];

    for (const tool of tools) {
        try {
            const result = await enableOptimizedTool(context, frontierApi, tool);
            if (result) {
                enabled.push(tool);
            } else {
                failed.push({ tool, reason: "The optimized tool could not be installed or started." });
            }
        } catch (error) {
            failed.push({
                tool,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const status = await checkTools(context, frontierApi);
    const verifiedEnabled = enabled.filter((tool) => isOptimizedToolActive(status, tool));
    for (const tool of enabled) {
        if (!verifiedEnabled.includes(tool)) {
            failed.push({ tool, reason: "The optimized tool was installed but is not active." });
        }
    }

    return {
        status,
        enabled: verifiedEnabled,
        failed,
    };
}

function isOptimizedToolActive(status: ToolCheckResult, tool: OptimizedToolKey): boolean {
    switch (tool) {
        case "sqlite":
            return status.nativeSqliteAvailable && getSqliteToolMode() !== "builtin";
        case "git":
            return status.nativeGitAvailable && getGitToolMode() !== "builtin";
        case "ffmpeg":
            return status.ffmpeg && getAudioToolMode() !== "builtin";
    }
}

async function enableOptimizedTool(
    context: vscode.ExtensionContext,
    frontierApi: FrontierAPI | undefined,
    tool: OptimizedToolKey,
): Promise<boolean> {
    switch (tool) {
        case "sqlite":
            return enableOptimizedSqlite(context);
        case "git":
            return enableOptimizedGit(frontierApi);
        case "ffmpeg":
            return enableOptimizedAudio(context);
    }
}

async function enableOptimizedSqlite(context: vscode.ExtensionContext): Promise<boolean> {
    const { ensureSqliteNativeBinary } = await import("./sqliteNativeBinaryManager");
    const { initNativeSqlite } = await import("./nativeSqlite");
    const { getSQLiteIndexManager } = await import(
        "../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager"
    );

    const binaryPath = await ensureSqliteNativeBinary(context);
    if (!binaryPath) {
        return false;
    }

    initNativeSqlite(binaryPath);
    if (getSqliteToolMode() === "builtin") {
        await setSqliteToolMode("auto");
    }

    const manager = getSQLiteIndexManager();
    if (manager && !manager.isClosed) {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Switching to optimized Search tools…",
                cancellable: false,
            },
            async () => {
                await manager.reopenWithCurrentBackend();
            },
        );
    }

    return true;
}

async function enableOptimizedGit(frontierApi: FrontierAPI | undefined): Promise<boolean> {
    if (!frontierApi?.retryGitBinaryDownload) {
        return false;
    }

    const { resetGitBinaryPath } = await import("./dugiteGit");
    resetGitBinaryPath();
    const success = await frontierApi.retryGitBinaryDownload();
    if (!success) {
        return false;
    }

    setNativeGitAvailable(true);
    if (getGitToolMode() === "builtin") {
        await setGitToolMode("auto");
    }
    return true;
}

async function enableOptimizedAudio(context: vscode.ExtensionContext): Promise<boolean> {
    const { downloadFFmpeg } = await import("./ffmpegManager");
    const binaryPath = await downloadFFmpeg(context, { showProgress: true });
    if (!binaryPath) {
        return false;
    }

    if (getAudioToolMode() === "builtin") {
        await setAudioToolMode("auto");
    }
    return true;
}
