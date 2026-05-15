import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getWebviewHtml } from "../../utils/webviewTemplate";
import { safePostMessageToPanel } from "../../utils/webviewUtils";
import type { ToolCheckResult } from "../../utils/toolsManager";
import { getAudioToolMode, getGitToolMode, getSqliteToolMode } from "../../utils/toolPreferences";
import type {
    MessagesToMissingToolsWarning,
    MessagesFromMissingToolsWarning,
} from "../../../types";

export class MissingToolsWarningProvider {
    public static readonly viewType = "codex-missing-tools-warning";

    private _panel?: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];
    private _resolveUserAction?: (action: "continue" | "blocked") => void;
    private _retryInProgress = false;
    private _downloadsInProgress = new Set<"sqlite" | "git" | "ffmpeg">();
    private _sqliteSwitchInProgress = false;
    private _advancedStage: 0 | 1 | 2 = 0;
    private readonly _onDispose?: () => void;

    constructor(context: vscode.ExtensionContext, onDispose?: () => void) {
        this._context = context;
        this._extensionUri = context.extensionUri;
        this._onDispose = onDispose;
    }

    public dispose(): void {
        this._panel?.dispose();
        this._disposables.forEach((d) => d.dispose());
        this._onDispose?.();
    }

    /**
     * Show the warning modal and wait for the user to either continue or
     * remain blocked (if sqlite is missing there is no continue button).
     *
     * Returns "continue" when the user clicks "Continue with limitations"
     * or "blocked" when the panel is closed without continuing.
     */
    public async show(
        result: ToolCheckResult,
        retryCallback: () => Promise<ToolCheckResult>
    ): Promise<"continue" | "blocked"> {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
            this._sendWarnings(result);
            return this._waitForUserAction();
        }

        await this._createPanel("Codex — Missing Tools", result, "warnings");
        this._setupMessageHandler(retryCallback);

        return this._waitForUserAction();
    }

    /**
     * Open a read-only "Tools Status" view showing all tools and their
     * current availability. Called from the project settings menu.
     */
    public async showToolsStatus(): Promise<void> {
        const { checkTools } = await import("../../utils/toolsManager");
        const { getAuthApi } = await import("../../extension");
        const result = await checkTools(this._context, getAuthApi());

        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
            this._sendStatus(result);
            return;
        }

        await this._createPanel("Codex — Tools Status", result, "status");
        this._setupStatusMessageHandler();
        this._subscribeSyncStatus();
    }

    private async _getOperationFlags(): Promise<{ syncInProgress: boolean; audioProcessingInProgress: boolean; }> {
        try {
            const { SyncManager } = await import("../../projectManager/syncManager");
            const status = SyncManager.getInstance().getSyncStatus();
            return {
                syncInProgress: status.isSyncInProgress,
                audioProcessingInProgress: status.isAudioProcessingInProgress,
            };
        } catch {
            return { syncInProgress: false, audioProcessingInProgress: false };
        }
    }

    private async _subscribeSyncStatus(): Promise<void> {
        try {
            const { SyncManager } = await import("../../projectManager/syncManager");
            const manager = SyncManager.getInstance();
            const syncDisposable = manager.addSyncStatusListener(() => {
                this._sendOperationStatus();
            });
            const audioDisposable = manager.addAudioProcessingListener(() => {
                this._sendOperationStatus();
            });
            this._disposables.push(syncDisposable, audioDisposable);
        } catch {
            // SyncManager may not be available
        }
    }

    private async _sendOperationStatus(): Promise<void> {
        const flags = await this._getOperationFlags();
        const message: MessagesToMissingToolsWarning = {
            command: "operationStatusChanged",
            ...flags,
        };
        safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
    }

    private async _createPanel(
        title: string,
        result: ToolCheckResult,
        mode: "warnings" | "status",
    ): Promise<void> {
        this._panel = vscode.window.createWebviewPanel(
            MissingToolsWarningProvider.viewType,
            title,
            { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
                retainContextWhenHidden: true,
            }
        );

        this._panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        const flags = mode === "status" ? await this._getOperationFlags() : { syncInProgress: false, audioProcessingInProgress: false };
        this._panel.webview.html = this._getHtmlForWebview(result, mode, flags);
        this._panel.reveal(vscode.ViewColumn.One, false);

        this._panel.onDidDispose(
            () => {
                this._panel = undefined;
                this._advancedStage = 0;
                this._resolveUserAction?.("blocked");
                this._onDispose?.();
            },
            null,
            this._disposables
        );
    }

    private _setupMessageHandler(
        retryCallback: () => Promise<ToolCheckResult>,
    ): void {
        this._panel!.webview.onDidReceiveMessage(
            async (message: MessagesFromMissingToolsWarning) => {
                try {
                    switch (message.command) {
                        case "retry": {
                            if (this._retryInProgress) {
                                break;
                            }
                            this._retryInProgress = true;
                            try {
                                const updated = await retryCallback();
                                this._sendWarnings(updated, "updateWarnings");

                                const { getUnavailableTools } = await import("../../utils/toolsManager");
                                if (getUnavailableTools(updated).length === 0) {
                                    this._resolveUserAction?.("continue");
                                    this._panel?.dispose();
                                }
                            } finally {
                                this._retryInProgress = false;
                            }
                            break;
                        }
                        case "continue":
                            this._resolveUserAction?.("continue");
                            this._panel?.dispose();
                            break;
                        case "close":
                            this._panel?.dispose();
                            break;
                        case "downloadTool":
                            await this._handleDownloadTool(message.tool);
                            break;
                        case "openDownloadPage":
                            vscode.env.openExternal(
                                vscode.Uri.parse("https://codexeditor.app")
                            );
                            break;
                    }
                } catch (error) {
                    console.error("[MissingToolsWarning] Error handling message:", error);
                    this._retryInProgress = false;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Two-stage advanced tool settings:
     *  Stage 0 → 1: reveal "Delete Binary" buttons
     *  Stage 1 → 2: reveal "Force Fallback Only" buttons
     * Called by the "Advanced Tool Settings" command.
     */
    public enableReinstallMode(): void {
        if (!this._panel) {
            return;
        }
        if (this._advancedStage === 0) {
            this._advancedStage = 1;
            safePostMessageToPanel(this._panel, { command: "showDeleteButtons" } as MessagesToMissingToolsWarning, "MissingToolsWarning");
        } else if (this._advancedStage === 1) {
            this._advancedStage = 2;
            safePostMessageToPanel(this._panel, { command: "showForceBuiltinButtons" } as MessagesToMissingToolsWarning, "MissingToolsWarning");
        }
    }

    private _setupStatusMessageHandler(): void {
        this._panel!.webview.onDidReceiveMessage(
            async (message: MessagesFromMissingToolsWarning) => {
                try {
                    switch (message.command) {
                        case "close":
                            this._panel?.dispose();
                            break;
                        case "downloadTool":
                            await this._handleDownloadTool(message.tool);
                            break;
                        case "toggleAudioMode":
                            await this._handleToggleAudioMode();
                            break;
                        case "toggleGitMode":
                            await this._handleToggleGitMode();
                            break;
                        case "toggleSqliteMode":
                            await this._handleToggleSqliteMode();
                            break;
                        case "openDownloadPage":
                            vscode.env.openExternal(
                                vscode.Uri.parse("https://codexeditor.app")
                            );
                            break;
                        case "deleteTool":
                            await this._handleDeleteTool(message.tool);
                            break;
                        case "forceBuiltinTool":
                            await this._handleForceBuiltin(message.tool);
                            break;
                        case "reloadWindow":
                            await vscode.commands.executeCommand("workbench.action.reloadWindow");
                            break;
                    }
                } catch (error) {
                    console.error("[MissingToolsWarning] Error handling status message:", error);
                }
            },
            null,
            this._disposables
        );
    }

    private async _handleToggleAudioMode(): Promise<void> {
        const { setAudioToolMode } = await import("../../utils/toolPreferences");
        const current = getAudioToolMode();
        const next = current === "auto" ? "builtin" : "auto";
        await setAudioToolMode(next);

        const { checkTools } = await import("../../utils/toolsManager");
        const { getAuthApi } = await import("../../extension");
        const result = await checkTools(this._context, getAuthApi());

        const message: MessagesToMissingToolsWarning = {
            command: "audioModeChanged",
            audioToolMode: next,
            ffmpeg: result.ffmpeg,
        };
        safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
    }

    private async _handleToggleGitMode(): Promise<void> {
        const { setGitToolMode } = await import("../../utils/toolPreferences");
        const current = getGitToolMode();
        const next = current === "auto" ? "builtin" : "auto";
        await setGitToolMode(next);

        const { checkTools } = await import("../../utils/toolsManager");
        const { getAuthApi } = await import("../../extension");
        const result = await checkTools(this._context, getAuthApi());

        const message: MessagesToMissingToolsWarning = {
            command: "gitModeChanged",
            gitToolMode: next,
            git: result.git,
            nativeGitAvailable: result.nativeGitAvailable,
        };
        safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
    }

    private async _handleToggleSqliteMode(): Promise<void> {
        if (this._sqliteSwitchInProgress) {
            return;
        }
        this._sqliteSwitchInProgress = true;

        try {
            await this._doToggleSqliteMode();
        } finally {
            this._sqliteSwitchInProgress = false;
        }
    }

    private async _doToggleSqliteMode(): Promise<void> {
        const { setSqliteToolMode } = await import("../../utils/toolPreferences");
        const current = getSqliteToolMode();
        const next = current === "auto" ? "builtin" : "auto";

        // If switching to the WASM fallback, ensure it's initialized
        if (next === "builtin") {
            const { isFts5SqliteReady, initFts5Sqlite } = await import("../../utils/fts5Sqlite");
            if (!isFts5SqliteReady()) {
                await initFts5Sqlite(this._context);
            }
        }

        await setSqliteToolMode(next);

        const backendLabel = next === "builtin" ? "Fallback AI Learning and Search Tools" : "Native AI Learning and Search Tools";

        // Live-switch the database connection.  reopenWithCurrentBackend()
        // acquires the transaction lock internally, so any in-flight writes
        // complete before the switch happens.
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Switching to ${backendLabel}\u2026`,
                cancellable: false,
            },
            async () => {
                const { getSQLiteIndexManager } = await import(
                    "../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager"
                );
                const manager = getSQLiteIndexManager();
                if (manager && !manager.isClosed) {
                    await manager.reopenWithCurrentBackend();
                }
            },
        );

        const { checkTools } = await import("../../utils/toolsManager");
        const { getAuthApi } = await import("../../extension");
        const result = await checkTools(this._context, getAuthApi());

        const message: MessagesToMissingToolsWarning = {
            command: "sqliteModeChanged",
            sqliteToolMode: next,
            sqlite: result.sqlite,
            nativeSqliteAvailable: result.nativeSqliteAvailable,
        };
        safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
    }

    private async _handleDownloadTool(tool: "sqlite" | "git" | "ffmpeg"): Promise<void> {
        if (this._downloadsInProgress.has(tool)) {
            return;
        }
        this._downloadsInProgress.add(tool);

        let success = false;
        try {
            switch (tool) {
                case "sqlite": {
                    const { ensureSqliteNativeBinary } = await import("../../utils/sqliteNativeBinaryManager");
                    const { initNativeSqlite } = await import("../../utils/nativeSqlite");
                    const { isUsingNativeBackend } = await import("../../utils/sqliteDatabaseFactory");

                    // Snapshot which backend is active BEFORE any state
                    // changes so we can tell whether a real switch happens.
                    // Without this, a user who is already on native and
                    // clicks "Download and Install" again would pay the cost
                    // of a full database close/reopen for no benefit.
                    const wasUsingNative = isUsingNativeBackend();

                    // Let `ensureSqliteNativeBinary` show its own progress
                    // notification ("Downloading AI Learning and Search
                    // Tools…"). The card button also animates a spinner — the
                    // two give the user consistent feedback matching how git
                    // and ffmpeg behave.
                    const binaryPath = await ensureSqliteNativeBinary(this._context);
                    if (binaryPath) {
                        // Idempotent — becomes a no-op if the binding was
                        // already loaded in this process.
                        initNativeSqlite(binaryPath);

                        // If the user had opted into the fallback ("builtin"),
                        // flip back to "auto" so the newly-installed native
                        // backend is actually used. Force-builtin (admin lock)
                        // is preserved.
                        if (getSqliteToolMode() === "builtin") {
                            const { setSqliteToolMode } = await import("../../utils/toolPreferences");
                            await setSqliteToolMode("auto");
                        }

                        // Compute the target backend after all mutations. If
                        // it matches the previous active backend, there is
                        // literally nothing to switch — skip the reopen AND
                        // the progress notification.
                        const willUseNative = isUsingNativeBackend();

                        if (wasUsingNative !== willUseNative) {
                            await vscode.window.withProgress(
                                {
                                    location: vscode.ProgressLocation.Notification,
                                    title: "Switching to Native AI Learning and Search Tools\u2026",
                                    cancellable: false,
                                },
                                async () => {
                                    const { getSQLiteIndexManager } = await import(
                                        "../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager"
                                    );
                                    const manager = getSQLiteIndexManager();
                                    if (manager && !manager.isClosed) {
                                        await manager.reopenWithCurrentBackend();
                                    }
                                },
                            );
                        } else {
                            console.log(
                                "[MissingToolsWarning] Native SQLite binary ready but active backend is unchanged — skipping reopen",
                            );
                        }

                        success = true;
                    }
                    break;
                }
                case "git": {
                    const { getAuthApi } = await import("../../extension");
                    const { resetGitBinaryPath } = await import("../../utils/dugiteGit");
                    const { setNativeGitAvailable } = await import("../../utils/toolPreferences");
                    const frontierApi = getAuthApi();
                    if (frontierApi?.retryGitBinaryDownload) {
                        resetGitBinaryPath();
                        success = await frontierApi.retryGitBinaryDownload();
                        if (success) {
                            setNativeGitAvailable(true);
                            // Flip "builtin" preference back to "auto" so the
                            // native git binary is actually used. Force-builtin
                            // (admin lock) is preserved.
                            if (getGitToolMode() === "builtin") {
                                const { setGitToolMode } = await import("../../utils/toolPreferences");
                                await setGitToolMode("auto");
                            }
                        }
                    }
                    break;
                }
                case "ffmpeg": {
                    const { downloadFFmpeg } = await import("../../utils/ffmpegManager");
                    // Show the standalone progress notification so the user
                    // gets consistent feedback across all three tools.
                    const result = await downloadFFmpeg(this._context, { showProgress: true });
                    success = result !== null;
                    if (success && getAudioToolMode() === "builtin") {
                        // Flip "builtin" preference back to "auto" so the
                        // newly-installed ffmpeg binary is actually used.
                        // Force-builtin (admin lock) is preserved.
                        const { setAudioToolMode } = await import("../../utils/toolPreferences");
                        await setAudioToolMode("auto");
                    }
                    break;
                }
            }
        } catch (error) {
            console.error(`[MissingToolsWarning] Failed to download ${tool}:`, error);
            success = false;
        } finally {
            this._downloadsInProgress.delete(tool);
        }

        const { checkTools } = await import("../../utils/toolsManager");
        const { getAuthApi } = await import("../../extension");
        const updated = await checkTools(this._context, getAuthApi());

        const message: MessagesToMissingToolsWarning = {
            command: "toolDownloadResult",
            tool,
            success,
            git: updated.git,
            nativeGitAvailable: updated.nativeGitAvailable,
            sqlite: updated.sqlite,
            nativeSqliteAvailable: updated.nativeSqliteAvailable,
            ffmpeg: updated.ffmpeg,
            audioToolMode: getAudioToolMode(),
            gitToolMode: getGitToolMode(),
            sqliteToolMode: getSqliteToolMode(),
            platformUnsupported: updated.platformUnsupported,
        };
        safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
    }


    private async _handleDeleteTool(tool: "sqlite" | "git" | "ffmpeg"): Promise<void> {
        const storageBase = this._context.globalStorageUri.fsPath;

        try {
            switch (tool) {
                case "sqlite": {
                    const dir = path.join(storageBase, "sqlite3-native");
                    await fs.promises.rm(dir, { recursive: true, force: true });
                    const { resetSqliteBinaryCache } = await import("../../utils/sqliteNativeBinaryManager");
                    resetSqliteBinaryCache();
                    break;
                }
                case "ffmpeg": {
                    const dir = path.join(storageBase, "ffmpeg");
                    await fs.promises.rm(dir, { recursive: true, force: true });
                    const { resetBinaryCache } = await import("../../utils/ffmpegManager");
                    resetBinaryCache();
                    break;
                }
                case "git": {
                    const { getAuthApi } = await import("../../extension");
                    const frontierApi = getAuthApi();
                    if (frontierApi?.deleteGitBinary) {
                        await frontierApi.deleteGitBinary();
                    } else {
                        const gitDir = path.join(storageBase, "..", "frontier-rnd.frontier-authentication", "git");
                        await fs.promises.rm(gitDir, { recursive: true, force: true });
                    }
                    break;
                }
            }

            safePostMessageToPanel(
                this._panel,
                { command: "toolDeleted", tool } as MessagesToMissingToolsWarning,
                "MissingToolsWarning",
            );
        } catch (error) {
            console.error(`[MissingToolsWarning] Failed to delete ${tool} binary:`, error);
            vscode.window.showErrorMessage(
                `Failed to delete ${tool} binary: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async _handleForceBuiltin(tool: "sqlite" | "git" | "ffmpeg"): Promise<void> {
        try {
            switch (tool) {
                case "sqlite": {
                    if (this._sqliteSwitchInProgress) {
                        return;
                    }
                    this._sqliteSwitchInProgress = true;
                    try {
                        const { setSqliteToolMode } = await import("../../utils/toolPreferences");
                        const { isFts5SqliteReady, initFts5Sqlite } = await import("../../utils/fts5Sqlite");
                        if (!isFts5SqliteReady()) {
                            await initFts5Sqlite(this._context);
                        }
                        await setSqliteToolMode("force-builtin");

                        await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: "Switching to Fallback AI Learning and Search Engine\u2026",
                                cancellable: false,
                            },
                            async () => {
                                const { getSQLiteIndexManager } = await import(
                                    "../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager"
                                );
                                const manager = getSQLiteIndexManager();
                                if (manager && !manager.isClosed) {
                                    await manager.reopenWithCurrentBackend();
                                }
                            },
                        );

                        const { checkTools } = await import("../../utils/toolsManager");
                        const { getAuthApi } = await import("../../extension");
                        const result = await checkTools(this._context, getAuthApi());
                        const message: MessagesToMissingToolsWarning = {
                            command: "sqliteModeChanged",
                            sqliteToolMode: "force-builtin",
                            sqlite: result.sqlite,
                            nativeSqliteAvailable: result.nativeSqliteAvailable,
                        };
                        safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
                    } finally {
                        this._sqliteSwitchInProgress = false;
                    }
                    break;
                }
                case "git": {
                    const { setGitToolMode } = await import("../../utils/toolPreferences");
                    await setGitToolMode("force-builtin");

                    const { checkTools } = await import("../../utils/toolsManager");
                    const { getAuthApi } = await import("../../extension");
                    const result = await checkTools(this._context, getAuthApi());
                    const message: MessagesToMissingToolsWarning = {
                        command: "gitModeChanged",
                        gitToolMode: "force-builtin",
                        git: result.git,
                        nativeGitAvailable: result.nativeGitAvailable,
                    };
                    safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
                    break;
                }
                case "ffmpeg": {
                    const { setAudioToolMode } = await import("../../utils/toolPreferences");
                    await setAudioToolMode("force-builtin");

                    const { checkTools } = await import("../../utils/toolsManager");
                    const { getAuthApi } = await import("../../extension");
                    const result = await checkTools(this._context, getAuthApi());
                    const message: MessagesToMissingToolsWarning = {
                        command: "audioModeChanged",
                        audioToolMode: "force-builtin",
                        ffmpeg: result.ffmpeg,
                    };
                    safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
                    break;
                }
            }
        } catch (error) {
            console.error(`[MissingToolsWarning] Failed to force-builtin for ${tool}:`, error);
        }
    }

    private _sendWarnings(
        result: ToolCheckResult,
        command: "showWarnings" | "updateWarnings" = "showWarnings"
    ): void {
        const message: MessagesToMissingToolsWarning = {
            command,
            git: result.git,
            nativeGitAvailable: result.nativeGitAvailable,
            sqlite: result.sqlite,
            nativeSqliteAvailable: result.nativeSqliteAvailable,
            ffmpeg: result.ffmpeg,
            platformUnsupported: result.platformUnsupported,
        };
        safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
    }

    private async _sendStatus(result: ToolCheckResult): Promise<void> {
        const flags = await this._getOperationFlags();
        const message: MessagesToMissingToolsWarning = {
            command: "showToolsStatus",
            git: result.git,
            nativeGitAvailable: result.nativeGitAvailable,
            sqlite: result.sqlite,
            nativeSqliteAvailable: result.nativeSqliteAvailable,
            ffmpeg: result.ffmpeg,
            audioToolMode: getAudioToolMode(),
            gitToolMode: getGitToolMode(),
            sqliteToolMode: getSqliteToolMode(),
            platformUnsupported: result.platformUnsupported,
            ...flags,
        };
        safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
    }

    private _waitForUserAction(): Promise<"continue" | "blocked"> {
        return new Promise((resolve) => {
            this._resolveUserAction = resolve;
        });
    }

    private _getHtmlForWebview(
        result: ToolCheckResult,
        mode: "warnings" | "status" = "warnings",
        flags: { syncInProgress: boolean; audioProcessingInProgress: boolean; } = { syncInProgress: false, audioProcessingInProgress: false },
    ): string {
        const webview = this._panel!.webview;

        const initialData: Record<string, unknown> = {
            git: result.git,
            nativeGitAvailable: result.nativeGitAvailable,
            sqlite: result.sqlite,
            nativeSqliteAvailable: result.nativeSqliteAvailable,
            ffmpeg: result.ffmpeg,
            platformUnsupported: result.platformUnsupported,
            mode,
        };

        if (mode === "status") {
            initialData.audioToolMode = getAudioToolMode();
            initialData.gitToolMode = getGitToolMode();
            initialData.sqliteToolMode = getSqliteToolMode();
            initialData.syncInProgress = flags.syncInProgress;
            initialData.audioProcessingInProgress = flags.audioProcessingInProgress;
        }

        return getWebviewHtml(
            webview,
            { extensionUri: this._extensionUri } as vscode.ExtensionContext,
            {
                title: mode === "status" ? "Codex — Tools Status" : "Codex — Missing Tools",
                scriptPath: ["MissingToolsWarning", "index.js"],
                initialData,
                inlineStyles: `
                    body { margin: 0; padding: 0; min-height: 100vh; width: 100vw; overflow-y: auto; background-color: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
                    #root { min-height: 100%; width: 100%; }
                `,
            }
        );
    }
}
