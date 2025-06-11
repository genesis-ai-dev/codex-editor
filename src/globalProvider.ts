import vscode from "vscode";
import { CodexCellEditorProvider } from "./providers/codexCellEditorProvider/codexCellEditorProvider";
import { CustomWebviewProvider } from "./providers/parallelPassagesWebview/customParallelPassagesWebviewProvider";
import { GlobalContentType, GlobalMessage } from "../types";
import { getNonce } from "./providers/dictionaryTable/utilities/getNonce";
import { initializeStateStore } from "./stateStore";



// Base class for all webview providers to extend
export abstract class BaseWebviewProvider implements vscode.WebviewViewProvider {
    protected _view?: vscode.WebviewView;
    protected _context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    // Abstract methods that child classes must implement
    protected abstract getWebviewId(): string;
    protected abstract getScriptPath(): string[];
    protected abstract handleMessage(message: any): Promise<void>;
    
    // Optional method for additional HTML content
    protected getAdditionalHtml(): string {
        return '';
    }

    // Common webview resolution
    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri],
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView);

        // Set up message handling with common handlers
        webviewView.webview.onDidReceiveMessage(async (message: any) => {
            // Handle global messages first
            if ("destination" in message) {
                GlobalProvider.getInstance().handleMessage(message);
                console.log("Using global provider and exiting");
                return;
            }

            // Handle common commands
            if (await this.handleCommonMessage(message)) {
                return;
            }

            // Pass to child class for specific handling
            await this.handleMessage(message);
        });

        // Call child class initialization if needed
        this.onWebviewResolved(webviewView);
    }

    // Optional hook for child classes
    protected onWebviewResolved(webviewView: vscode.WebviewView): void {
        // Child classes can override this for additional initialization
    }

    // Common message handlers
    protected async handleCommonMessage(message: any): Promise<boolean> {
        switch (message.command) {
            case "navigateToMainMenu":
                await vscode.commands.executeCommand("codex-editor.navigateToMainMenu");
                return true;
            case "focusView":
                try {
                    await vscode.commands.executeCommand(`${message.viewId}.focus`);
                } catch (error) {
                    console.error("Error focusing view:", error);
                    vscode.window.showErrorMessage(`Error focusing view: ${error}`);
                }
                return true;
            case "webviewReady":
                // Hook for child classes to handle webview ready state
                this.onWebviewReady();
                return true;
            default:
                return false;
        }
    }

    // Optional hook for when webview is ready
    protected onWebviewReady(): void {
        // Child classes can override this
    }

    // Common HTML generation
    protected getHtmlForWebview(webviewView: vscode.WebviewView): string {
        const styleResetUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, "src", "assets", "reset.css")
        );
        const styleVSCodeUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, "src", "assets", "vscode.css")
        );
        const codiconsUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(
                this._context.extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css"
            )
        );

        const scriptUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(
                this._context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                ...this.getScriptPath()
            )
        );

        const nonce = getNonce();

        return /*html*/ `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${
                webviewView.webview.cspSource
            }; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleResetUri}" rel="stylesheet">
            <link href="${styleVSCodeUri}" rel="stylesheet">
            <link href="${codiconsUri}" rel="stylesheet">
            <script nonce="${nonce}">
                const apiBaseUrl = ${JSON.stringify("http://localhost:3002")}
            </script>
            ${this.getAdditionalHtml()}
        </head>
        <body>
            <div id="root"></div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }

    // Common post message method
    public postMessage(message: any): void {
        if (this._view) {
            this._view.webview.postMessage(message);
        } else {
            console.error(`WebviewView ${this.getWebviewId()} is not initialized`);
        }
    }

    // Common receive message method (for GlobalProvider compatibility)
    public async receiveMessage(message: any): Promise<void> {
        console.log(`${this.getWebviewId()} Provider received:`, message);
        if (!this._view) {
            console.warn(`WebviewView ${this.getWebviewId()} is not initialized`);
            return;
        }
        await this.handleMessage(message);
    }
}

export class GlobalProvider {
    private static instance: GlobalProvider;
    private providers: Map<string, CodexCellEditorProvider | CustomWebviewProvider>;

    private constructor() {
        this.providers = new Map();
    }

    public static getInstance(): GlobalProvider {
        if (!GlobalProvider.instance) {
            GlobalProvider.instance = new GlobalProvider();
        }
        return GlobalProvider.instance;
    }



    public registerProvider(
        key: string,
        provider: CodexCellEditorProvider | CustomWebviewProvider
    ): vscode.Disposable {
        console.log("registering provider: ", { key, provider });
        this.providers.set(key, provider);

        // Return a disposable that removes the provider from the map
        return new vscode.Disposable(() => {
            this.providers.delete(key);
        });
    }

    public handleMessage(message: any) {
        if ("destination" in message) {
            console.log("routing message: ", { message });
            const destination = message.destination;
            if (destination === "webview") {
                this.postMessageToAllWebviews(message);
            } else if (destination === "provider") {
                this.postMessageToAllProviders(message);
            }
        }
    }
    public postMessageToAllProviders(message: any) {
        this.providers.forEach((provider, key) => {
            provider.receiveMessage(message);
        });
    }
    public postMessageToAllWebviews({
        command,
        content,
    }: {
        command: string;
        content: GlobalContentType;
    }): void {
        // Implement logic to post message to all webviews
        // This is a placeholder implementation
        const message: GlobalMessage = {
            command,
            destination: "all",
            content,
        };
        console.log("Posting message to all webviews:", message);
        this.providers.forEach((provider, key) => {
            provider.postMessage(message);
        });
    }
    public async openWebview(key: string): Promise<void> {
        // This is only really relevant to panels
        try {
            // Check if the command exists before executing it
            const allCommands = await vscode.commands.getCommands();
            const focusCommand = `${key}.focus`;
            if (allCommands.includes(focusCommand)) {
                await vscode.commands.executeCommand(focusCommand);
            } else {
                console.warn(`Command '${focusCommand}' not found. Skipping focus.`);
            }
        } catch (error) {
            console.error(`Error opening webview: ${error}`);
        }
    }

    public async openAndPostMessageToWebview({
        key,
        command,
        destination,
        content,
    }: {
        key: string;
        command: string;
        destination: "webview" | "provider" | "all";
        content: GlobalContentType;
    }): Promise<void> {
        const message: GlobalMessage = {
            command,
            destination,
            content,
        };
        await this.openWebview(key);

        // Check for it to be open
        if (this.providers.has(key)) {
            this.providers.get(key)?.postMessage(message);
            console.log(
                `post: Message posted to webview with key: ${key} and message: ${JSON.stringify(message)}`
            );
        } else {
            throw new Error(`Webview with key '${key}' not found.`);
        }
    }
}
