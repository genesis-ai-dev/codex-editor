import vscode from "vscode";
import { CodexCellEditorProvider } from "./providers/codexCellEditorProvider/codexCellEditorProvider";
import { CustomWebviewProvider } from "./providers/parallelPassagesWebview/customParallelPassagesWebviewProvider";
import { GlobalContentType, GlobalMessage } from "../types";
import { getNonce } from "./providers/dictionaryTable/utilities/getNonce";
import { initializeStateStore } from "./stateStore";

// Common file operations utility
export class FileOperationsHelper {
    public static async ensureFileExists(filePath: vscode.Uri, defaultContent: string = "[]"): Promise<void> {
        try {
            await vscode.workspace.fs.stat(filePath);
        } catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
                await vscode.workspace.fs.writeFile(filePath, new TextEncoder().encode(defaultContent));
            } else {
                throw error;
            }
        }
    }

    public static async readJsonFile<T>(filePath: vscode.Uri, defaultValue: T): Promise<T> {
        try {
            const fileContentUint8Array = await vscode.workspace.fs.readFile(filePath);
            const fileContent = new TextDecoder().decode(fileContentUint8Array);
            return JSON.parse(fileContent);
        } catch (error) {
            console.error("Error reading JSON file:", error);
            return defaultValue;
        }
    }

    public static async writeJsonFile<T>(filePath: vscode.Uri, data: T): Promise<void> {
        const jsonString = JSON.stringify(data, null, 4);
        await vscode.workspace.fs.writeFile(filePath, new TextEncoder().encode(jsonString));
    }

    public static getWorkspaceFilePath(relativePath: string): vscode.Uri | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        return vscode.Uri.joinPath(workspaceFolders[0].uri, relativePath);
    }
}

// Common state store operations utility
export class StateStoreHelper {
    public static async setupCellIdListener(
        webviewView: vscode.WebviewView,
        messageCommand: string,
        messageTransformer?: (cellId: any, sourceCellContent?: any) => any
    ): Promise<vscode.Disposable> {
        const { storeListener } = await initializeStateStore();
        
        const disposeFunction = storeListener("cellId", async (value) => {
            if (value) {
                let messageData: any = { cellId: value.cellId, uri: value.uri };
                
                if (messageTransformer) {
                    // Get source verse content if needed
                    const sourceCellContent = await vscode.commands.executeCommand(
                        "translators-copilot.getSourceCellByCellIdFromAllSourceCells",
                        value.cellId
                    );
                    messageData = messageTransformer(value, sourceCellContent);
                } else {
                    messageData = { cellId: value.cellId, uri: value.uri };
                }

                webviewView.webview.postMessage({
                    command: messageCommand,
                    data: messageData,
                });
            }
        });

        return new vscode.Disposable(disposeFunction);
    }

    public static async setupSourceCellMapListener(
        webviewView: vscode.WebviewView,
        messageCommand: string
    ): Promise<vscode.Disposable> {
        const { storeListener } = await initializeStateStore();
        
        const disposeFunction = storeListener("sourceCellMap", (value) => {
            if (value) {
                webviewView.webview.postMessage({
                    command: messageCommand,
                    sourceCellMap: value,
                });
            }
        });

        return new vscode.Disposable(disposeFunction);
    }
}

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

    // Generic helper for registering webview providers with common patterns
    public static registerWebviewProvider<T extends BaseWebviewProvider>(
        context: vscode.ExtensionContext,
        providerId: string,
        providerClass: new (context: vscode.ExtensionContext) => T,
        additionalCommands?: { commandId: string; handler: (provider: T) => any }[]
    ): vscode.Disposable {
        const provider = new providerClass(context);
        
        const disposables = [
            vscode.window.registerWebviewViewProvider(providerId, provider),
            GlobalProvider.getInstance().registerProvider(providerId, provider as any),
        ];

        // Register additional commands if provided
        if (additionalCommands) {
            additionalCommands.forEach(({ commandId, handler }) => {
                disposables.push(
                    vscode.commands.registerCommand(commandId, () => handler(provider))
                );
            });
        }

        // Create composite disposable
        const compositeDisposable = vscode.Disposable.from(...disposables);
        context.subscriptions.push(compositeDisposable);
        
        return compositeDisposable;
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
