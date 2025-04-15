import * as vscode from "vscode";
import * as path from "path";
import { CodexContentSerializer } from "../../serializer";

interface CodexMetadata {
    id: string;
    originalName: string;
    sourceFsPath?: string;
    codexFsPath?: string;
    navigation: any[];
    sourceCreatedAt?: string;
    codexLastModified?: string;
    gitStatus?: string;
    corpusMarker?: string;
    progress?: number;
}

export interface CodexItem {
    uri: vscode.Uri;
    label: string;
    type: "corpus" | "codexDocument" | "dictionary";
    children?: CodexItem[];
    corpusMarker?: string;
    progress?: number;
}

export class NavigationWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "codex-editor.navigation";
    private _view?: vscode.WebviewView;
    private codexItems: CodexItem[] = [];
    private dictionaryItems: CodexItem[] = [];
    private disposables: vscode.Disposable[] = [];
    private isBuilding = false;
    private serializer = new CodexContentSerializer();

    constructor(private readonly context: vscode.ExtensionContext) {
        this.buildInitialData();
        this.registerWatchers();
    }

    public async resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };

        // Set up the HTML content
        webviewView.webview.html = await this.getHtmlForWebview(webviewView);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case "openFile":
                    try {
                        // Now message.uri is already a string path, no need to convert from Uri object
                        // Handle both Windows and Unix paths
                        const normalizedPath = message.uri.replace(/\\/g, "/");
                        const uri = vscode.Uri.file(normalizedPath);

                        if (message.type === "codexDocument") {
                            await vscode.commands.executeCommand(
                                "vscode.openWith",
                                uri,
                                "codex.cellEditor"
                            );
                        } else {
                            const doc = await vscode.workspace.openTextDocument(uri);
                            await vscode.window.showTextDocument(doc);
                        }
                    } catch (error) {
                        console.error("Error opening file:", error, "Path:", message.uri);
                        vscode.window.showErrorMessage(`Error opening file: ${error}`);
                    }
                    break;
                case "refresh":
                    await this.buildInitialData();
                    break;
                case "webviewReady":
                    await this.buildInitialData();
                    break;
            }
        });

        // Initial data load
        if (this.codexItems.length === 0 && this.dictionaryItems.length === 0) {
            await this.buildInitialData();
        } else {
            this.sendItemsToWebview();
        }
    }

    private async getHtmlForWebview(webviewView: vscode.WebviewView): Promise<string> {
        const styleResetUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "reset.css")
        );
        const styleVSCodeUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "vscode.css")
        );
        const scriptUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "NavigationView",
                "index.js"
            )
        );
        const codiconsUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css"
            )
        );

        const nonce = this.getNonce();

        return /* html */ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none';
                    img-src ${webviewView.webview.cspSource} https: data:;
                    style-src ${webviewView.webview.cspSource} 'unsafe-inline';
                    script-src 'nonce-${nonce}';
                    font-src ${webviewView.webview.cspSource};">
                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                </script>
                <style>
                    .progress-container {
                        margin: 6px 0;
                    }
                    
                    .progress-label {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 4px;
                        font-size: 12px;
                        color: var(--vscode-foreground);
                        opacity: 0.8;
                    }
                    
                    .progress-bar {
                        height: 4px;
                        border-radius: 2px;
                        background-color: var(--vscode-progressBar-background);
                        position: relative;
                        overflow: hidden;
                        transition: all 0.3s ease;
                    }
                    
                    .progress-fill {
                        height: 100%;
                        border-radius: 2px;
                        background: linear-gradient(90deg, 
                            var(--vscode-progressBar-background) 0%, 
                            var(--vscode-charts-green) 100%);
                        transition: width 0.5s ease-out;
                    }
                    
                    .progress-complete .progress-fill {
                        background: var(--vscode-charts-green);
                    }
                    
                    .tree-item {
                        padding: 6px 0;
                        cursor: pointer;
                        transition: background-color 0.2s;
                    }
                    
                    .tree-item:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }
                    
                    .tree-item-content {
                        display: flex;
                        align-items: center;
                        padding: 0 8px;
                    }
                    
                    .item-icon {
                        margin-right: 6px;
                        color: var(--vscode-foreground);
                        opacity: 0.7;
                    }
                    
                    .folder-icon {
                        color: var(--vscode-charts-yellow);
                    }
                    
                    .file-icon {
                        color: var(--vscode-charts-blue);
                    }
                    
                    .dictionary-icon {
                        color: var(--vscode-charts-purple);
                    }
                    
                    .search-container {
                        padding: 8px;
                        position: sticky;
                        top: 0;
                        background: var(--vscode-sideBar-background);
                        z-index: 10;
                        display: flex;
                        align-items: center;
                    }
                    
                    .search-input {
                        flex: 1;
                        height: 24px;
                        border-radius: 4px;
                        background: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border, transparent);
                        color: var(--vscode-input-foreground);
                        padding: 0 8px;
                        outline: none;
                    }
                    
                    .search-input:focus {
                        border-color: var(--vscode-focusBorder);
                    }
                    
                    .refresh-button {
                        margin-left: 8px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        width: 24px;
                        height: 24px;
                        border-radius: 4px;
                        background: transparent;
                        border: none;
                        color: var(--vscode-foreground);
                        cursor: pointer;
                    }
                    
                    .refresh-button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    
                    .header {
                        font-size: 13px;
                        font-weight: 600;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        padding: 8px;
                        color: var(--vscode-foreground);
                        opacity: 0.6;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    
                    .complete-check {
                        margin-left: auto;
                        color: var(--vscode-charts-green);
                    }
                </style>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    private async buildInitialData(): Promise<void> {
        if (this.isBuilding) {
            return;
        }

        this.isBuilding = true;

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders?.length) {
                this.codexItems = [];
                this.dictionaryItems = [];
                return;
            }

            const rootUri = workspaceFolders[0].uri;
            const codexPattern = new vscode.RelativePattern(
                rootUri.fsPath,
                "files/target/**/*.codex"
            );
            const dictPattern = new vscode.RelativePattern(rootUri.fsPath, "files/**/*.dictionary");

            const [codexUris, dictUris] = await Promise.all([
                vscode.workspace.findFiles(codexPattern),
                vscode.workspace.findFiles(dictPattern),
            ]);

            // Process codex files with metadata
            const codexItemsWithMetadata = await Promise.all(
                codexUris.map(async (uri) => this.makeCodexItemWithMetadata(uri))
            );

            // Group by corpus
            const groupedItems = this.groupByCorpus(codexItemsWithMetadata);
            this.codexItems = groupedItems;

            // Process dictionary items
            this.dictionaryItems = dictUris.map((uri) => this.makeDictionaryItem(uri));

            this.sendItemsToWebview();
        } catch (error) {
            console.error("Error building data:", error);
            vscode.window.showErrorMessage(`Error loading codex files: ${error}`);
        } finally {
            this.isBuilding = false;
        }
    }

    private async makeCodexItemWithMetadata(uri: vscode.Uri): Promise<CodexItem> {
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const notebookData = await this.serializer.deserializeNotebook(
                content,
                new vscode.CancellationTokenSource().token
            );

            const metadata = notebookData.metadata as CodexMetadata;
            const fileName = path.basename(uri.fsPath, ".codex");

            // Calculate progress based on cells with values
            const totalCells = notebookData.cells.length;
            const cellsWithValues = notebookData.cells.filter(
                (cell) => cell.value && cell.value.trim().length > 0
            ).length;
            const progress = totalCells > 0 ? (cellsWithValues / totalCells) * 100 : 0;

            return {
                uri,
                label: this.formatLabel(fileName),
                type: "codexDocument",
                corpusMarker: metadata?.corpusMarker,
                progress: progress,
            };
        } catch (error) {
            console.warn(`Failed to read metadata for ${uri.fsPath}:`, error);
            return this.makeCodexItem(uri);
        }
    }

    private groupByCorpus(items: CodexItem[]): CodexItem[] {
        const corpusGroups = new Map<string, CodexItem[]>();
        const ungroupedItems: CodexItem[] = [];

        items.forEach((item) => {
            if (item.corpusMarker) {
                const group = corpusGroups.get(item.corpusMarker) || [];
                group.push(item);
                corpusGroups.set(item.corpusMarker, group);
            } else {
                ungroupedItems.push(item);
            }
        });

        const groupedItems: CodexItem[] = [];
        corpusGroups.forEach((items, corpusMarker) => {
            const totalProgress = items.reduce((sum, item) => sum + (item.progress || 0), 0);
            const averageProgress = items.length > 0 ? totalProgress / items.length : 0;

            groupedItems.push({
                uri: items[0].uri,
                label: this.formatLabel(corpusMarker),
                type: "corpus",
                children: items.sort((a, b) => a.label.localeCompare(b.label)),
                progress: averageProgress,
            });
        });

        return [...groupedItems.sort((a, b) => a.label.localeCompare(b.label)), ...ungroupedItems];
    }

    private makeCodexItem(uri: vscode.Uri): CodexItem {
        const fileName = path.basename(uri.fsPath, ".codex");
        return {
            uri,
            label: this.formatLabel(fileName),
            type: "codexDocument",
        };
    }

    private makeDictionaryItem(uri: vscode.Uri): CodexItem {
        const fileName = path.basename(uri.fsPath, ".dictionary");
        return {
            uri,
            label: "Dictionary",
            type: "dictionary",
        };
    }

    private registerWatchers(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            return;
        }

        const rootUri = workspaceFolders[0].uri;
        const codexWatcherPattern = new vscode.RelativePattern(
            rootUri.fsPath,
            "files/target/**/*.codex"
        );
        const dictWatcherPattern = new vscode.RelativePattern(
            rootUri.fsPath,
            "files/**/*.dictionary"
        );

        const codexWatcher = vscode.workspace.createFileSystemWatcher(codexWatcherPattern);
        const dictWatcher = vscode.workspace.createFileSystemWatcher(dictWatcherPattern);

        this.disposables.push(
            codexWatcher,
            dictWatcher,
            codexWatcher.onDidCreate(() => this.buildInitialData()),
            codexWatcher.onDidChange(() => this.buildInitialData()),
            codexWatcher.onDidDelete(() => this.buildInitialData()),
            dictWatcher.onDidCreate(() => this.buildInitialData()),
            dictWatcher.onDidChange(() => this.buildInitialData()),
            dictWatcher.onDidDelete(() => this.buildInitialData())
        );
    }

    private sendItemsToWebview(): void {
        if (this._view) {
            // Convert Uri objects to path strings to prevent [object Object] issues
            const serializedCodexItems = this.codexItems.map((item) => this.serializeItem(item));
            const serializedDictItems = this.dictionaryItems.map((item) =>
                this.serializeItem(item)
            );

            this._view.webview.postMessage({
                command: "updateItems",
                codexItems: serializedCodexItems,
                dictionaryItems: serializedDictItems,
            });
        }
    }

    // Helper method to convert Uri objects to path strings
    private serializeItem(item: CodexItem): any {
        return {
            ...item,
            uri: item.uri.fsPath,
            children: item.children
                ? item.children.map((child) => this.serializeItem(child))
                : undefined,
        };
    }

    private getNonce(): string {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    // Helper method to format labels in a user-friendly way
    private formatLabel(fileName: string): string {
        // Remove technical suffixes
        let cleanName = fileName.replace(/_Codex$/, "");

        // Replace underscores with spaces
        cleanName = cleanName.replace(/_/g, " ");

        // Handle common replacements
        if (cleanName === "NT") return "New Testament";
        if (cleanName === "OT") return "Old Testament";

        // Split on camelCase and capitalize first letter of each word
        cleanName = cleanName.replace(/([A-Z])/g, " $1").trim();

        // Remove redundant spaces
        cleanName = cleanName.replace(/\s+/g, " ");

        // Capitalize first letter if not already
        return cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
    }

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
}
