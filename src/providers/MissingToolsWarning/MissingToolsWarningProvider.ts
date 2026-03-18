import * as vscode from "vscode";
import { getWebviewHtml } from "../../utils/webviewTemplate";
import { safePostMessageToPanel } from "../../utils/webviewUtils";
import type { ToolCheckResult } from "../../utils/toolsManager";
import type {
    MessagesToMissingToolsWarning,
    MessagesFromMissingToolsWarning,
} from "../../../types";

export class MissingToolsWarningProvider {
    public static readonly viewType = "codex-missing-tools-warning";

    private _panel?: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _resolveUserAction?: (action: "continue" | "blocked") => void;
    private _retryInProgress = false;

    constructor(context: vscode.ExtensionContext) {
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

        this._panel = vscode.window.createWebviewPanel(
            MissingToolsWarningProvider.viewType,
            "Codex — Missing Tools",
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

        // Bake the tool status into the HTML so the React app can render
        // immediately without waiting for a postMessage round-trip.
        this._panel.webview.html = this._getHtmlForWebview(result);
        this._panel.reveal(vscode.ViewColumn.One, false);

        this._panel.onDidDispose(
            () => {
                this._panel = undefined;
                this._resolveUserAction?.("blocked");
            },
            null,
            this._disposables
        );

        this._panel.webview.onDidReceiveMessage(
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

        return this._waitForUserAction();
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
            ffprobe: result.ffprobe,
        };
        safePostMessageToPanel(this._panel, message, "MissingToolsWarning");
    }

    private _waitForUserAction(): Promise<"continue" | "blocked"> {
        return new Promise((resolve) => {
            this._resolveUserAction = resolve;
        });
    }

    private _getHtmlForWebview(result: ToolCheckResult): string {
        const webview = this._panel!.webview;

        return getWebviewHtml(
            webview,
            { extensionUri: this._extensionUri } as vscode.ExtensionContext,
            {
                title: "Codex — Missing Tools",
                scriptPath: ["MissingToolsWarning", "index.js"],
                initialData: {
                    git: result.git,
                    sqlite: result.sqlite,
                    ffmpeg: result.ffmpeg,
                    ffprobe: result.ffprobe,
                },
                inlineStyles: `
                    body { margin: 0; padding: 0; min-height: 100vh; width: 100vw; overflow-y: auto; background-color: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
                    #root { min-height: 100%; width: 100%; }
                `,
            }
        );
    }
}
