import * as vscode from "vscode";
import { getWebviewHtml } from "../../utils/webviewTemplate";
import { safePostMessageToPanel } from "../../utils/webviewUtils";
import type { ToolCheckResult } from "../../utils/toolsManager";
import { getAudioToolMode } from "../../utils/toolPreferences";
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
    private _downloadInProgress = false;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this._extensionUri = context.extensionUri;
    }

    public dispose(): void {
        this._panel?.dispose();
        this._disposables.forEach((d) => d.dispose());
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

        this._createPanel("Codex — Missing Tools", result, "warnings");
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

        this._createPanel("Codex — Tools Status", result, "status");
        this._setupStatusMessageHandler();
    }

    private _createPanel(
        title: string,
        result: ToolCheckResult,
        mode: "warnings" | "status",
    ): void {
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

        this._panel.webview.html = this._getHtmlForWebview(result, mode);
        this._panel.reveal(vscode.ViewColumn.One, false);

        this._panel.onDidDispose(
            () => {
                this._panel = undefined;
                this._resolveUserAction?.("blocked");
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
                        case "openDownloadPage":
                            vscode.env.openExternal(
                                vscode.Uri.parse("https://codexeditor.app")
                            );
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
        this._notifyMainMenuToolsChanged();
    }

    private async _handleDownloadTool(tool: "sqlite" | "git" | "ffmpeg"): Promise<void> {
        if (this._downloadInProgress) {
            return;
        }
        this._downloadInProgress = true;

        let success = false;
        try {
            switch (tool) {
                case "sqlite": {
                    const { ensureSqliteNativeBinary } = await import("../../utils/sqliteNativeBinaryManager");
                    const { initNativeSqlite } = await import("../../utils/nativeSqlite");
                    const binaryPath = await ensureSqliteNativeBinary(this._context);
                    initNativeSqlite(binaryPath);
                    success = true;
                    break;
                }
                case "git": {
                    const { getAuthApi } = await import("../../extension");
                    const { resetGitBinaryPath } = await import("../../utils/dugiteGit");
                    const frontierApi = getAuthApi();
                    if (frontierApi?.retryGitBinaryDownload) {
                        resetGitBinaryPath();
                        success = await frontierApi.retryGitBinaryDownload();
                    }
                    break;
                }
                case "ffmpeg": {
                    const { downloadFFmpeg } = await import("../../utils/ffmpegManager");
                    const result = await downloadFFmpeg(this._context);
                    success = result !== null;
                    break;
                }
            }
        } catch (error) {
            console.error(`[MissingToolsWarning] Failed to download ${tool}:`, error);
            success = false;
        } finally {
            this._downloadInProgress = false;
        }

        const { checkTools } = await import("../../utils/toolsManager");
        const { getAuthApi } = await import("../../extension");
        const updated = await checkTools(this._context, getAuthApi());

        const message: MessagesToMissingToolsWarning = {
            command: "toolDownloadResult",
            tool,
            success,
            git: updated.git,
            sqlite: updated.sqlite,
            ffmpeg: updated.ffmpeg,
            audioToolMode: getAudioToolMode(),
        };
        safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
        this._notifyMainMenuToolsChanged();
    }

    private async _notifyMainMenuToolsChanged(): Promise<void> {
        try {
            const { GlobalProvider } = await import("../../globalProvider");
            const provider = GlobalProvider.getInstance().getProvider("codex-editor.mainMenu") as
                | { sendToolsStatusSummary?: () => void }
                | undefined;
            provider?.sendToolsStatusSummary?.();
        } catch {
            // MainMenu may not be available yet; silently ignore
        }
    }

    private _sendWarnings(
        result: ToolCheckResult,
        command: "showWarnings" | "updateWarnings" = "showWarnings"
    ): void {
        const message: MessagesToMissingToolsWarning = {
            command,
            git: result.git,
            sqlite: result.sqlite,
            ffmpeg: result.ffmpeg,
        };
        safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
    }

    private _sendStatus(result: ToolCheckResult): void {
        const message: MessagesToMissingToolsWarning = {
            command: "showToolsStatus",
            git: result.git,
            sqlite: result.sqlite,
            ffmpeg: result.ffmpeg,
            audioToolMode: getAudioToolMode(),
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
    ): string {
        const webview = this._panel!.webview;

        const initialData: Record<string, unknown> = {
            git: result.git,
            sqlite: result.sqlite,
            ffmpeg: result.ffmpeg,
            mode,
        };

        if (mode === "status") {
            initialData.audioToolMode = getAudioToolMode();
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
