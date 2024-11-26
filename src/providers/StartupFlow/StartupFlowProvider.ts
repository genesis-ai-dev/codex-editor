import { waitForExtensionActivation } from "../../utils/vscode";
import { MessagesToStartupFlowProvider, MessagesFromStartupFlowProvider } from "../../../types";
import * as vscode from "vscode";

interface FrontierAPI {
    authProvider: any;
    getAuthStatus: () => { 
        isAuthenticated: boolean; 
        gitlabInfo?: any;
    };
    onAuthStatusChanged: (callback: (status: { 
        isAuthenticated: boolean; 
        gitlabInfo?: any 
    }) => void) => vscode.Disposable;
    login: (username: string, password: string) => Promise<boolean>;
    register: (username: string, email: string, password: string) => Promise<boolean>;
    logout: () => Promise<void>;
}

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
    private disposables: vscode.Disposable[] = [];
    private frontierApi?: FrontierAPI;
    private webviewPanel?: vscode.WebviewPanel;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.initializeFrontierApi();
    }

    private async initializeFrontierApi() {
        try {
            const extension = await waitForExtensionActivation('frontier-rnd.frontier-authentication');
            debugLog('Extension status:', extension?.isActive);
            
            if (extension?.isActive) {
                this.frontierApi = extension.exports;
                
                // Get initial auth status
                const initialStatus = this.frontierApi?.getAuthStatus();
                this.updateAuthState({
                    isAuthExtensionInstalled: true,
                    isAuthenticated: initialStatus?.isAuthenticated,
                    isLoading: false,
                    gitlabInfo: initialStatus?.gitlabInfo
                });

                // Subscribe to auth status changes
                const disposable = this.frontierApi?.onAuthStatusChanged((status) => {
                    this.updateAuthState({
                        isAuthExtensionInstalled: true,
                        isAuthenticated: status?.isAuthenticated,
                        isLoading: false,
                        gitlabInfo: status.gitlabInfo
                    });
                });
                disposable && this.disposables.push(disposable);
            } else {
                this.updateAuthState({
                    isAuthExtensionInstalled: false,
                    isAuthenticated: false,
                    isLoading: false
                });
            }
        } catch (error) {
            console.error('Error initializing Frontier API:', error);
            this.updateAuthState({
                isAuthExtensionInstalled: false,
                isAuthenticated: false,
                isLoading: false,
                error: 'Failed to initialize Frontier API'
            });
        }
    }

    private async updateAuthState(authState: any) {
        if (this.webviewPanel) {
            await this.webviewPanel.webview.postMessage({
                command: "updateAuthState",
                success: true,
                authState: {
                    isAuthExtensionInstalled: authState.isAuthExtensionInstalled,
                    isAuthenticated: authState.isAuthenticated,
                    isLoading: false,
                    error: authState.error,
                    gitlabInfo: authState.gitlabInfo
                }
            });
        }
    }

    private notifyWebviews(message: MessagesFromStartupFlowProvider) {
        // Implement if needed to broadcast to all webviews
    }

    dispose() {
        debugLog("Disposing StartupFlowProvider");
        this.disposables.forEach(d => d.dispose());
    }

    private async handleAuthenticationMessage(
        webviewPanel: vscode.WebviewPanel,
        message: MessagesToStartupFlowProvider
    ) {
        debugLog("Handling authentication message", message.command);

        if (!this.frontierApi) {
            debugLog("Auth extension not installed");
            webviewPanel.webview.postMessage({
                command: "updateAuthState",
                authState: {
                    isAuthExtensionInstalled: false,
                    isAuthenticated: false,
                    isLoading: false,
                },
            } as MessagesFromStartupFlowProvider);
            return;
        }

        switch (message.command) {
            case "auth.status": {
                debugLog("Getting auth status");
                try {
                    const status = this.frontierApi.getAuthStatus();
                    debugLog("Got auth status", status);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: status.isAuthenticated,
                            isLoading: false,
                            gitlabInfo: status.gitlabInfo
                        },
                    } as MessagesFromStartupFlowProvider);
                } catch (error) {
                    debugLog("Error getting auth status", error);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            error: error instanceof Error ? error.message : "Failed to get auth status",
                        },
                    } as MessagesFromStartupFlowProvider);
                }
                break;
            }
            case "auth.login": {
                debugLog("Attempting login");
                try {
                    const success = await this.frontierApi.login(message.username, message.password);
                    debugLog("Login attempt result:", success);
                    if (success) {
                        const status = this.frontierApi.getAuthStatus();
                        webviewPanel.webview.postMessage({
                            command: "updateAuthState",
                            authState: {
                                isAuthExtensionInstalled: true,
                                isAuthenticated: true,
                                isLoading: false,
                                gitlabInfo: status.gitlabInfo
                            },
                        } as MessagesFromStartupFlowProvider);
                    } else {
                        throw new Error("Login failed");
                    }
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
                    } as MessagesFromStartupFlowProvider);
                }
                break;
            }
            case "auth.signup": {
                debugLog("Attempting registration");
                try {
                    await this.frontierApi.register(message.username, message.email, message.password);
                    debugLog("Registration successful");
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: true,
                            isLoading: false,
                        },
                    } as MessagesFromStartupFlowProvider);
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
                    } as MessagesFromStartupFlowProvider);
                }
                break;
            }
            case "auth.logout": {
                debugLog("Attempting logout");
                try {
                    await this.frontierApi.logout();
                    debugLog("Logout successful");
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                        },
                    } as MessagesFromStartupFlowProvider);
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
                    } as MessagesFromStartupFlowProvider);
                }
                break;
            }
        }
    }

    private async handleWorkspaceMessage(
        webviewPanel: vscode.WebviewPanel,
        message: MessagesToStartupFlowProvider
    ) {
        debugLog("Handling workspace message", message.command);
        const workspaceFolders = vscode.workspace.workspaceFolders;

        switch (message.command) {
            case "workspace.status": {
                debugLog("Getting workspace status");
                const isOpen = !!workspaceFolders?.length;
                webviewPanel.webview.postMessage({
                    command: "workspace.statusResponse",
                    isOpen,
                    path: workspaceFolders?.[0]?.uri.fsPath
                } as MessagesFromStartupFlowProvider);

                // If workspace is open, also check for metadata
                if (isOpen) {
                    try {
                        const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'metadata.json');
                        await vscode.workspace.fs.stat(metadataUri);
                        webviewPanel.webview.postMessage({
                            command: "metadata.check",
                            exists: true
                        } as MessagesFromStartupFlowProvider);
                    } catch {
                        webviewPanel.webview.postMessage({
                            command: "metadata.check",
                            exists: false
                        } as MessagesFromStartupFlowProvider);
                    }
                }
                break;
            }
            case "workspace.open": {
                debugLog("Opening workspace");
                const result = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    title: "Select Project Folder"
                });
                if (result && result[0]) {
                    await vscode.commands.executeCommand("vscode.openFolder", result[0]);
                }
                break;
            }
            case "workspace.create": {
                debugLog("Creating new workspace");
                const result = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    title: "Select Parent Folder"
                });
                if (result && result[0]) {
                    const folderName = await vscode.window.showInputBox({
                        prompt: "Enter project name",
                        validateInput: text => {
                            return text && text.length > 0 ? null : "Project name is required";
                        }
                    });
                    if (folderName) {
                        const projectPath = vscode.Uri.joinPath(result[0], folderName);
                        await vscode.workspace.fs.createDirectory(projectPath);
                        await vscode.commands.executeCommand("vscode.openFolder", projectPath);
                    }
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
        this.webviewPanel = webviewPanel;
        debugLog("Resolving custom text editor");

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };

        // Set initial HTML content
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Handle messages from webview
        const messageListener = webviewPanel.webview.onDidReceiveMessage(async (message: MessagesToStartupFlowProvider) => {
            switch (message.command) {
                case "auth.status":
                case "auth.login":
                case "auth.signup":
                case "auth.logout":
                    debugLog("Handling authentication message", message.command);
                    await this.handleAuthenticationMessage(webviewPanel, message);
                    break;
                case "workspace.status":
                case "workspace.open":
                case "workspace.create":
                    debugLog("Handling workspace message", message.command);
                    await this.handleWorkspaceMessage(webviewPanel, message);
                    break;
            }
        });

        // Add disposables
        this.disposables.push(
            messageListener,
            webviewPanel.onDidDispose(() => {
                debugLog("Webview panel disposed");
                messageListener.dispose();
            })
        );
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
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet" />

                <title>Startup Flow</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
