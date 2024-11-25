import { StartupFlowPostMessages, StartupFlowResponseMessages } from "../../../types";
import * as vscode from "vscode";

function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

const DEBUG_MODE = true; // Set to true to enable debug logging

function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[StartupFlowProvider]", ...args);
    }
}

export class StartupFlowProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = "startupFlowProvider";

    constructor(private readonly context: vscode.ExtensionContext) {}

    private async handleAuthenticationMessage(
        webviewPanel: vscode.WebviewPanel,
        message: StartupFlowPostMessages
    ) {
        debugLog("Handling authentication message", message.command);
        const extension = await vscode.extensions
            .getExtension("frontier-rnd.frontier-authentication")
            ?.activate();

        if (!extension) {
            debugLog("Authentication extension not found");
            webviewPanel.webview.postMessage({
                command: "updateAuthState",
                authState: {
                    isAuthExtensionInstalled: false,
                    isAuthenticated: false,
                    isLoading: false,
                },
            } as StartupFlowResponseMessages);
            return;
        }

        switch (message.command) {
            case "auth.status": {
                debugLog("Getting auth status");
                try {
                    const status = await extension.getAuthStatus();
                    debugLog("Got auth status", status);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: status.isAuthenticated,
                            isLoading: false,
                        },
                    } as StartupFlowResponseMessages);
                } catch (error) {
                    debugLog("Error getting auth status", error);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : "Failed to get auth status",
                        },
                    } as StartupFlowResponseMessages);
                }
                break;
            }
            case "auth.login": {
                debugLog("Attempting login");
                try {
                    await extension.login(message.username, message.password);
                    debugLog("Login successful");
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: true,
                            isLoading: false,
                        },
                    } as StartupFlowResponseMessages);
                } catch (error) {
                    debugLog("Login failed", error);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            error: error instanceof Error ? error.message : "Login failed",
                        },
                    } as StartupFlowResponseMessages);
                }
                break;
            }
            case "auth.signup": {
                debugLog("Attempting registration");
                try {
                    await extension.register(message.username, message.email, message.password);
                    debugLog("Registration successful");
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: true,
                            isLoading: false,
                        },
                    } as StartupFlowResponseMessages);
                } catch (error) {
                    debugLog("Registration failed", error);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            error: error instanceof Error ? error.message : "Registration failed",
                        },
                    } as StartupFlowResponseMessages);
                }
                break;
            }
            case "auth.logout": {
                debugLog("Attempting logout");
                try {
                    await extension.logout();
                    debugLog("Logout successful");
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                        },
                    } as StartupFlowResponseMessages);
                } catch (error) {
                    debugLog("Logout failed", error);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: true,
                            isLoading: false,
                            error: error instanceof Error ? error.message : "Logout failed",
                        },
                    } as StartupFlowResponseMessages);
                }
                break;
            }
        }
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Configure webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };

        // Set initial HTML content
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(async (message: StartupFlowPostMessages) => {
            switch (message.command) {
                case "auth.status":
                case "auth.login":
                case "auth.signup":
                case "auth.logout":
                    debugLog("Handling authentication message", message.command);
                    await this.handleAuthenticationMessage(webviewPanel, message);
                    break;
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        // Get URIs for styles and scripts
        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "reset.css")
        );
        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "vscode.css")
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "StartupFlow",
                "index.js"
            )
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css"
            )
        );

        const nonce = getNonce();

        return /*html*/ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet" nonce="${nonce}" />

                <title>Startup Flow</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
