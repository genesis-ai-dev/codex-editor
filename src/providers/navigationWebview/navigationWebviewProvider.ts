import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { CodexContentSerializer } from "../../serializer";
import bibleData from "../../../webviews/codex-webviews/src/assets/bible-books-lookup.json";
import { BaseWebviewProvider } from "../../globalProvider";
import { getWebviewHtml } from "../../utils/webviewTemplate";
import { safePostMessageToView } from "../../utils/webviewUtils";

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

interface BibleBookInfo {
    name: string;
    abbr: string;
    ord: string;
    testament: string;
    osisId: string;
}

export interface CodexItem {
    uri: vscode.Uri;
    label: string;
    type: "corpus" | "codexDocument" | "dictionary";
    children?: CodexItem[];
    corpusMarker?: string;
    progress?: number;
    sortOrder?: string;
    isProjectDictionary?: boolean;
    wordCount?: number;
    isEnabled?: boolean;
}

export class NavigationWebviewProvider extends BaseWebviewProvider {
    public static readonly viewType = "codex-editor.navigation";
    private codexItems: CodexItem[] = [];
    private dictionaryItems: CodexItem[] = [];
    private disposables: vscode.Disposable[] = [];
    private isBuilding = false;
    private serializer = new CodexContentSerializer();
    private bibleBookMap: Map<string, BibleBookInfo> = new Map();

    constructor(context: vscode.ExtensionContext) {
        super(context);
        this.loadBibleBookMap();
        this.buildInitialData();
        this.registerWatchers();
    }

    protected getWebviewId(): string {
        return "navigation-sidebar";
    }

    protected getScriptPath(): string[] {
        return ["NavigationView", "index.js"];
    }

    private loadBibleBookMap(): void {
        console.log("Loading bible book map for Navigation...");
        let bookDataToUse: any[] = bibleData;
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                const localizedPath = path.join(workspaceRoot, "localized-books.json");
                if (fs.existsSync(localizedPath)) {
                    console.log("Navigation: Found localized-books.json, loading...");
                    const raw = fs.readFileSync(localizedPath, "utf8");
                    bookDataToUse = JSON.parse(raw);
                    console.log("Navigation: Localized books loaded successfully");
                } else {
                    console.log("Navigation: localized-books.json not found, using defaults.");
                }
            }
        } catch (err) {
            console.error("Navigation: Error loading localized-books.json:", err);
            bookDataToUse = bibleData;
        }

        this.bibleBookMap.clear();
        bookDataToUse.forEach((book) => {
            if (book.abbr) {
                this.bibleBookMap.set(book.abbr, {
                    name: book.name,
                    abbr: book.abbr,
                    ord: book.ord,
                    testament: book.testament,
                    osisId: book.osisId,
                });
            }
        });
        console.log(
            "Navigation: Bible book map created/updated with size:",
            this.bibleBookMap.size
        );
    }

    protected onWebviewResolved(webviewView: vscode.WebviewView): void {
        // Initial data load
        if (this.codexItems.length === 0 && this.dictionaryItems.length === 0) {
            this.loadBibleBookMap();
            this.buildInitialData();
        } else {
            this.sendItemsToWebview();
        }
    }

    protected onWebviewReady(): void {
        this.loadBibleBookMap();
        this.buildInitialData();
    }

    protected async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case "openFile":
                try {
                    // Now message.uri is already a string path, no need to convert from Uri object
                    // Handle both Windows and Unix paths
                    const normalizedPath = message.uri.replace(/\\/g, "/");
                    const uri = vscode.Uri.file(normalizedPath);

                    if (message.type === "codexDocument") {
                        // First, find and open the corresponding source file
                        try {
                            const workspaceFolderUri =
                                vscode.workspace.workspaceFolders?.[0].uri;
                            if (workspaceFolderUri) {
                                const baseFileName = path.basename(normalizedPath);
                                const sourceFileName = baseFileName.replace(
                                    ".codex",
                                    ".source"
                                );
                                const sourceUri = vscode.Uri.joinPath(
                                    workspaceFolderUri,
                                    ".project",
                                    "sourceTexts",
                                    sourceFileName
                                );

                                // Open the source file in the left-most group (ViewColumn.One)
                                await vscode.commands.executeCommand(
                                    "vscode.openWith",
                                    sourceUri,
                                    "codex.cellEditor",
                                    { viewColumn: vscode.ViewColumn.One }
                                );

                                // Open the codex file in the right-most group (ViewColumn.Two)
                                await vscode.commands.executeCommand(
                                    "vscode.openWith",
                                    uri,
                                    "codex.cellEditor",
                                    { viewColumn: vscode.ViewColumn.Two }
                                );
                            } else {
                                // Fallback if no workspace folder is found
                                await vscode.commands.executeCommand(
                                    "vscode.openWith",
                                    uri,
                                    "codex.cellEditor"
                                );
                            }
                        } catch (sourceError) {
                            console.warn("Could not open source file:", sourceError);
                            // If source file opening fails, just open the codex file in the right-most group
                            await vscode.commands.executeCommand(
                                "vscode.openWith",
                                uri,
                                "codex.cellEditor",
                                { viewColumn: vscode.ViewColumn.Two }
                            );
                        }
                    } else if (message.type === "dictionary") {
                        await vscode.commands.executeCommand(
                            "vscode.openWith",
                            uri,
                            "codex.dictionaryEditor"
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
                this.loadBibleBookMap();
                await this.buildInitialData();
                break;
            case "webviewReady":
                this.loadBibleBookMap();
                await this.buildInitialData();
                break;
            case "deleteFile":
                try {
                    const confirmed = await vscode.window.showWarningMessage(
                        `Are you sure you want to delete "${message.label}"? This will delete both the codex file and its corresponding source file.`,
                        { modal: true },
                        "Delete"
                    );

                    if (confirmed === "Delete") {
                        const deletedFiles: string[] = [];
                        const errors: string[] = [];

                        // Convert the path to a proper Uri for the codex file
                        const normalizedPath = message.uri.replace(/\\/g, "/");
                        const codexUri = vscode.Uri.file(normalizedPath);

                        // Delete the codex file
                        try {
                            await vscode.workspace.fs.delete(codexUri);
                            deletedFiles.push(`${message.label}.codex`);
                        } catch (error) {
                            console.error("Error deleting codex file:", error);
                            errors.push(`Failed to delete codex file: ${error}`);
                        }

                        // For codex documents, also delete the corresponding source file
                        if (message.type === "codexDocument") {
                            try {
                                const workspaceFolderUri = vscode.workspace.workspaceFolders?.[0].uri;
                                if (workspaceFolderUri) {
                                    const baseFileName = path.basename(normalizedPath);
                                    const sourceFileName = baseFileName.replace(".codex", ".source");
                                    const sourceUri = vscode.Uri.joinPath(
                                        workspaceFolderUri,
                                        ".project",
                                        "sourceTexts",
                                        sourceFileName
                                    );

                                    await vscode.workspace.fs.delete(sourceUri);
                                    deletedFiles.push(`${message.label}.source`);
                                }
                            } catch (error) {
                                console.error("Error deleting source file:", error);
                                errors.push(`Failed to delete source file: ${error}`);
                            }
                        }

                        // Show appropriate message based on results
                        if (deletedFiles.length > 0 && errors.length === 0) {
                            vscode.window.showInformationMessage(
                                `Successfully deleted: ${deletedFiles.join(", ")}`
                            );
                        } else if (deletedFiles.length > 0 && errors.length > 0) {
                            vscode.window.showWarningMessage(
                                `Partially deleted: ${deletedFiles.join(", ")}. Errors: ${errors.join("; ")}`
                            );
                        } else {
                            vscode.window.showErrorMessage(`Failed to delete "${message.label}": ${errors.join("; ")}`);
                        }

                        // Refresh the data to update the view
                        await this.buildInitialData();
                    }
                } catch (error) {
                    console.error("Error deleting file:", error);
                    vscode.window.showErrorMessage(`Failed to delete "${message.label}": ${error}`);
                }
                break;
            case "getBookNames": {
                this.loadBibleBookMap();
                if (this._view) {
                    safePostMessageToView(this._view, {
                        command: "setBibleBookMap",
                        data: Array.from(this.bibleBookMap.entries()),
                    });
                }
                break;
            }
            case "toggleDictionary": {
                try {
                    const config = vscode.workspace.getConfiguration("codex-project-manager");
                    const currentState = config.get<boolean>("spellcheckIsEnabled", true);
                    await config.update("spellcheckIsEnabled", !currentState, vscode.ConfigurationTarget.Workspace);

                    // Refresh dictionary items to update the enabled state
                    await this.buildInitialData();

                    vscode.window.showInformationMessage(
                        `Spellcheck ${!currentState ? 'enabled' : 'disabled'}`
                    );
                } catch (error) {
                    console.error("Error toggling dictionary:", error);
                    vscode.window.showErrorMessage(`Failed to toggle dictionary: ${error}`);
                }
                break;
            }
        }
    }

    protected getHtmlForWebview(webviewView: vscode.WebviewView): string {
        return getWebviewHtml(webviewView.webview, this._context, {
            scriptPath: this.getScriptPath(),
            csp: `default-src 'none'; img-src ${webviewView.webview.cspSource} https: data:; style-src ${webviewView.webview.cspSource} 'unsafe-inline'; script-src 'nonce-\${nonce}'; font-src ${webviewView.webview.cspSource};`,
            inlineStyles: `
                .progress-container { margin: 6px 0; }
                .progress-label { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 12px; color: var(--vscode-foreground); opacity: 0.8; }
                .progress-bar { height: 4px; border-radius: 2px; background-color: var(--vscode-progressBar-background); position: relative; overflow: hidden; transition: all 0.3s ease; }
                .progress-fill { height: 100%; border-radius: 2px; background: linear-gradient(90deg, var(--vscode-progressBar-background) 0%, var(--vscode-charts-green) 100%); transition: width 0.5s ease-out; }
                .progress-complete .progress-fill { background: var(--vscode-charts-green); }
                .tree-item { padding: 6px 0; cursor: pointer; transition: background-color 0.2s; }
                .tree-item:hover { background-color: var(--vscode-list-hoverBackground); }
                .tree-item-content { display: flex; align-items: center; padding: 0 8px; }
                .item-icon { margin-right: 6px; color: var(--vscode-foreground); opacity: 0.7; }
                .folder-icon { color: var(--vscode-charts-yellow); }
                .file-icon { color: var(--vscode-charts-blue); }
                .dictionary-icon { color: var(--vscode-charts-purple); }
                .search-container { padding: 8px; position: sticky; top: 0; background: var(--vscode-sideBar-background); z-index: 10; display: flex; align-items: center; }
                .search-input { flex: 1; height: 24px; border-radius: 4px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); padding: 0 8px; outline: none; }
                .search-input:focus { border-color: var(--vscode-focusBorder); }
                .refresh-button { margin-left: 8px; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; background: transparent; border: none; color: var(--vscode-foreground); cursor: pointer; }
                .refresh-button:hover { background: var(--vscode-button-hoverBackground); }
                .header { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px; color: var(--vscode-foreground); opacity: 0.6; border-bottom: 1px solid var(--vscode-panel-border); }
                .complete-check { margin-left: auto; color: var(--vscode-charts-green); }
            `
        });
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
            this.dictionaryItems = await Promise.all(
                dictUris.map((uri) => this.makeDictionaryItem(uri))
            );

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
            const fileNameAbbr = path.basename(uri.fsPath, ".codex");

            // Calculate progress based on cells with values
            const totalCells = notebookData.cells.length;
            const cellsWithValues = notebookData.cells.filter(
                (cell) =>
                    cell.value && cell.value.trim().length > 0 && cell.value !== "<span></span>"
            ).length;
            const progress = totalCells > 0 ? (cellsWithValues / totalCells) * 100 : 0;

            const bookInfo = this.bibleBookMap.get(fileNameAbbr);
            const label = fileNameAbbr;
            const sortOrder = bookInfo?.ord;
            const corpusMarker = bookInfo?.testament || metadata?.corpusMarker;

            return {
                uri,
                label,
                type: "codexDocument",
                corpusMarker: corpusMarker,
                progress: progress,
                sortOrder,
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
            let resolvedCorpusMarker = item.corpusMarker;
            if (!resolvedCorpusMarker) {
                const bookInfo = this.bibleBookMap.get(item.label);
                resolvedCorpusMarker = bookInfo?.testament;
            }
            if (resolvedCorpusMarker === "Old Testament") resolvedCorpusMarker = "OT";
            if (resolvedCorpusMarker === "New Testament") resolvedCorpusMarker = "NT";

            if (resolvedCorpusMarker) {
                const group = corpusGroups.get(resolvedCorpusMarker) || [];
                group.push(item);
                corpusGroups.set(resolvedCorpusMarker, group);
            } else {
                ungroupedItems.push(item);
            }
        });

        const groupedItems: CodexItem[] = [];
        corpusGroups.forEach((itemsInGroup, corpusMarker) => {
            const totalProgress = itemsInGroup.reduce((sum, item) => sum + (item.progress || 0), 0);
            const averageProgress =
                itemsInGroup.length > 0 ? totalProgress / itemsInGroup.length : 0;

            const sortedItems = itemsInGroup.sort((a, b) => {
                if (a.sortOrder && b.sortOrder) {
                    return a.sortOrder.localeCompare(b.sortOrder);
                }
                return a.label.localeCompare(b.label);
            });

            groupedItems.push({
                uri: itemsInGroup[0].uri,
                label: corpusMarker,
                type: "corpus",
                children: sortedItems,
                progress: averageProgress,
            });
        });

        return [
            ...groupedItems.sort((a, b) => {
                if (a.label === "OT") return -1;
                if (b.label === "OT") return 1;
                if (a.label === "NT") return -1;
                if (b.label === "NT") return 1;

                return a.label.localeCompare(b.label);
            }),
            ...ungroupedItems.sort((a, b) => a.label.localeCompare(b.label)),
        ];
    }

    private makeCodexItem(uri: vscode.Uri): CodexItem {
        const fileNameAbbr = path.basename(uri.fsPath, ".codex");
        const bookInfo = this.bibleBookMap.get(fileNameAbbr);

        return {
            uri,
            label: fileNameAbbr,
            type: "codexDocument",
            sortOrder: bookInfo?.ord,
            corpusMarker: bookInfo?.testament,
        };
    }

    private async getDictionaryWordCount(uri: vscode.Uri): Promise<number> {
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf8');

            // Parse the dictionary content and count entries
            // Assuming dictionary is in a structured format (JSON or line-separated)
            try {
                const jsonData = JSON.parse(text);
                if (Array.isArray(jsonData)) {
                    return jsonData.length;
                } else if (typeof jsonData === 'object') {
                    return Object.keys(jsonData).length;
                }
            } catch {
                // If not JSON, count lines (assuming one word per line)
                const lines = text.split('\n').filter(line => line.trim().length > 0);
                return lines.length;
            }

            return 0;
        } catch (error) {
            console.warn(`Failed to count words in dictionary ${uri.fsPath}:`, error);
            return 0;
        }
    }

    private async makeDictionaryItem(uri: vscode.Uri): Promise<CodexItem> {
        const fileName = path.basename(uri.fsPath, ".dictionary");
        const isProjectDictionary = fileName === "project";

        let wordCount = 0;
        let isEnabled = true;

        if (isProjectDictionary) {
            // Get word count from dictionary file
            wordCount = await this.getDictionaryWordCount(uri);

            // Get spellcheck enabled status from workspace configuration
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            isEnabled = config.get<boolean>("spellcheckIsEnabled", true);
        }

        return {
            uri,
            label: fileName,
            type: "dictionary",
            isProjectDictionary,
            wordCount,
            isEnabled,
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
            const serializedCodexItems = this.codexItems.map((item) => this.serializeItem(item));
            const serializedDictItems = this.dictionaryItems.map((item) =>
                this.serializeItem(item)
            );

            safePostMessageToView(this._view, {
                command: "updateItems",
                codexItems: serializedCodexItems,
                dictionaryItems: serializedDictItems,
            });

            if (this.bibleBookMap) {
                safePostMessageToView(this._view, {
                    command: "setBibleBookMap",
                    data: Array.from(this.bibleBookMap.entries()),
                });
            }
        }
    }

    private serializeItem(item: CodexItem): any {
        return {
            ...item,
            uri: item.uri.fsPath,
            children: item.children
                ? item.children.map((child) => this.serializeItem(child))
                : undefined,
        };
    }

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
}


