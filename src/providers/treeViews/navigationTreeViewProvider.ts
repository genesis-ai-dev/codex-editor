import * as vscode from "vscode";
import { debounce } from "lodash";
import { getWorkSpaceUri } from "../../utils/index";
import { vrefData } from "../../utils/verseRefUtils/verseData";
import { basename, dirname } from "path";
import { CustomNotebookMetadata } from "../../../types";
import { NotebookMetadataManager, getNotebookMetadataManager } from "../../utils/notebookMetadataManager";
import * as path from "path";

export interface CodexNode {
    resource: vscode.Uri;
    type: "corpus" | "document" | "section" | "cell" | "dictionary";
    label: string;
    cellId?: string;
    sourceFileUri?: vscode.Uri;
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[NavigationTreeViewProvider] ${message}`, ...args);
    }
}

export class CodexModel {
    public readonly notebookMetadataManager: NotebookMetadataManager;
    private cachedMetadata: Map<string, CustomNotebookMetadata> = new Map();
    private isRefreshing = false;
    private lastMetadataLoad = 0;
    private readonly METADATA_REFRESH_INTERVAL = 1000; // 1 second

    constructor(private workspaceRoot: string | undefined, private context: vscode.ExtensionContext) {
        this.notebookMetadataManager = getNotebookMetadataManager();
        debug("Initializing with workspace root:", workspaceRoot);
        this.notebookMetadataManager.initialize();
    }

    private async ensureMetadataLoaded(): Promise<void> {
        const now = Date.now();
        if (
            this.cachedMetadata.size === 0 ||
            now - this.lastMetadataLoad > this.METADATA_REFRESH_INTERVAL
        ) {
            debug("Loading metadata (cache empty or stale)");
            await this.notebookMetadataManager.loadMetadata();
            const metadata = this.notebookMetadataManager.getAllMetadata();
            this.cachedMetadata.clear();
            metadata.forEach((m) => this.cachedMetadata.set(m.id, m));
            this.lastMetadataLoad = now;
            debug("Loaded and cached metadata count:", metadata.length);
        }
    }

    public async getRoots(): Promise<CodexNode[]> {
        if (!this.workspaceRoot) {
            return [];
        }
        return this.getNotebooksByCorpus();
    }

    public async getChildren(node: CodexNode): Promise<CodexNode[]> {
        debug("Getting children for:", node.type, node.label);

        if (this.isRefreshing) {
            debug("Already refreshing, using cached data");
            return this.getChildrenFromCache(node);
        }

        try {
            this.isRefreshing = true;
            await this.ensureMetadataLoaded();
            return this.getChildrenFromCache(node);
        } finally {
            this.isRefreshing = false;
        }
    }

    private getChildrenFromCache(node: CodexNode): Promise<CodexNode[]> {
        if (node.type === "corpus") {
            return this.getNotebooksForCorpus(node.label);
        } else if (node.type === "document") {
            return this.getSectionsForNotebook(node.resource);
        }
        return Promise.resolve([]);
    }

    private async getNotebooksByCorpus(): Promise<CodexNode[]> {
        debug("Getting notebooks by corpus");
        if (this.isRefreshing) {
            debug("Already refreshing, using cached data");
            return this.processMetadataIntoCorpora();
        }

        try {
            this.isRefreshing = true;
            await this.ensureMetadataLoaded();

            const dictionaryFiles = await this.findDictionaryFiles();

            const regularCorpora = this.processMetadataIntoCorpora();
            return [...regularCorpora, ...dictionaryFiles];
        } finally {
            this.isRefreshing = false;
        }
    }

    private async findDictionaryFiles(): Promise<CodexNode[]> {
        if (!this.workspaceRoot) {
            return [];
        }

        try {
            const pattern = new vscode.RelativePattern(
                this.workspaceRoot,
                "**/files/**/*.dictionary"
            );

            const dictionaryFiles = await vscode.workspace.findFiles(pattern);

            return dictionaryFiles.map((uri) => ({
                resource: uri,
                type: "dictionary",
                label: path.basename(uri.fsPath, ".dictionary" + "dictionary"),
            }));
        } catch (error) {
            console.error("Error finding dictionary files:", error);
            return [];
        }
    }

    private processMetadataIntoCorpora(): CodexNode[] {
        const corpora: Record<string, CodexNode> = {};
        const ungroupedNotebooks: CodexNode[] = [];

        for (const metadata of this.cachedMetadata.values()) {
            if (!metadata.codexFsPath || metadata.codexFsPath.includes(".codex-temp")) {
                debug("Skipping metadata:", metadata.id);
                continue;
            }

            debug("Processing metadata for corpus:", metadata.id);
            const notebookUri = vscode.Uri.file(metadata.codexFsPath);
            const sourceUri = metadata.sourceFsPath
                ? vscode.Uri.file(metadata.sourceFsPath)
                : undefined;

            const fileName = path.basename(metadata.codexFsPath);
            const fileNameWithoutExtension = fileName.slice(0, -6); // Remove .codex

            const bookData = vrefData[fileNameWithoutExtension];
            if (bookData) {
                const testament = bookData.testament === "OT" ? "Old Testament" : "New Testament";
                if (!corpora[testament]) {
                    corpora[testament] = {
                        resource: vscode.Uri.parse(`codex-corpus:${testament}`),
                        type: "corpus",
                        label: testament,
                    };
                }
            } else {
                debug("Adding to ungrouped notebooks:", fileNameWithoutExtension);
                ungroupedNotebooks.push({
                    resource: notebookUri,
                    type: "document",
                    label: fileNameWithoutExtension,
                    sourceFileUri: sourceUri,
                });
            }
        }

        const result = [...Object.values(corpora), ...ungroupedNotebooks];
        debug("Processed metadata into corpora, total nodes:", result.length);
        return result;
    }

    private async getNotebooksForCorpus(corpus: string): Promise<CodexNode[]> {
        debug("Getting notebooks for corpus:", corpus);
        const notebooks: CodexNode[] = [];

        // Use cached metadata instead of reloading
        for (const metadata of this.cachedMetadata.values()) {
            if (!metadata.codexFsPath) {
                debug("Skipping metadata without codexFsPath:", metadata.id);
                continue;
            }

            // Skip temp files
            if (metadata.codexFsPath.includes(".codex-temp")) {
                debug("Skipping temp file:", metadata.codexFsPath);
                continue;
            }

            const notebookUri = vscode.Uri.file(metadata.codexFsPath);
            const sourceUri = metadata.sourceFsPath
                ? vscode.Uri.file(metadata.sourceFsPath)
                : undefined;

            const fileName = path.basename(metadata.codexFsPath);
            const fileNameWithoutExtension = fileName.slice(0, -6);

            const bookData = vrefData[fileNameWithoutExtension];
            const testament = bookData?.testament === "OT" ? "Old Testament" : "New Testament";

            if (testament === corpus) {
                notebooks.push({
                    resource: notebookUri,
                    type: "document",
                    label: fileNameWithoutExtension,
                    sourceFileUri: sourceUri,
                });
            }
        }

        return notebooks.sort((a, b) => {
            const aOrd = Number(vrefData[a.label]?.ord) || Infinity;
            const bOrd = Number(vrefData[b.label]?.ord) || Infinity;
            return aOrd - bOrd;
        });
    }

    private async getSectionsForNotebook(notebookUri: vscode.Uri): Promise<CodexNode[]> {
        debug("Getting sections for notebook:", notebookUri.fsPath);
        try {
            const metadata = await this.notebookMetadataManager.getMetadataByUri(notebookUri);
            if (!metadata) {
                console.warn("CodexModel: No metadata found for notebook:", notebookUri.fsPath);
                return [];
            }

            debug("Found metadata for notebook:", metadata.id);
            // Use the correct file path from metadata
            const actualUri = vscode.Uri.file(metadata.codexFsPath!);
            const notebookContentUint8Array = await vscode.workspace.fs.readFile(actualUri);
            const notebookContent = new TextDecoder().decode(notebookContentUint8Array);
            const notebookJson = JSON.parse(notebookContent);

            const headings = this.extractHeadingsFromNotebook(notebookJson);

            return headings.map((heading) => ({
                resource: vscode.Uri.parse(`${actualUri.toString()}#${heading.cellId}`),
                type: "section",
                label: heading.text,
                cellId: heading.cellId,
                sourceFileUri: metadata.sourceFsPath
                    ? vscode.Uri.file(metadata.sourceFsPath)
                    : undefined,
            }));
        } catch (error) {
            console.error("CodexModel: Error getting sections:", error);
            return [];
        }
    }

    private extractHeadingsFromNotebook(notebookJson: any): any[] {
        const headings: any[] = [];

        if (!Array.isArray(notebookJson.cells)) return headings;

        notebookJson.cells.forEach((cell: any) => {
            const content = cell.value;
            const regex = /<h([1-6])>(.*?)<\/h\1>/g;
            let match;

            while ((match = regex.exec(content)) !== null) {
                headings.push({
                    level: parseInt(match[1], 10),
                    text: match[2],
                    cellId: cell.metadata?.id || "",
                });
            }
        });

        return headings;
    }

    // Add method to invalidate cache
    public invalidateCache(): void {
        this.cachedMetadata.clear();
    }

    // Update the metadata change handler to be more conservative
    public async handleMetadataChange(): Promise<void> {
        debug("Handling metadata change");
        if (this.isRefreshing) {
            debug("Already refreshing, skipping metadata change");
            return;
        }

        this.cachedMetadata.clear();
        this.lastMetadataLoad = 0; // Force reload on next access
    }
}

export class CodexNotebookTreeViewProvider
    implements vscode.TreeDataProvider<CodexNode>, vscode.Disposable
{
    private disposables: vscode.Disposable[] = [];
    public readonly model: CodexModel;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private _onDidChangeTreeData: vscode.EventEmitter<CodexNode | undefined | null | void> =
        new vscode.EventEmitter<CodexNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CodexNode | undefined | null | void> =
        this._onDidChangeTreeData.event;
    private refreshCount = 0;
    private lastRefreshTime = Date.now();

    constructor(
        private workspaceRoot: string | undefined,
        context: vscode.ExtensionContext
    ) {
        console.log("TreeView: Initializing provider");
        this.model = new CodexModel(workspaceRoot, context);

        // Debounce the refresh to prevent rapid updates
        const debouncedRefresh = debounce(() => this.refresh(), 500);

        // Listen to metadata changes
        this.disposables.push(
            this.model.notebookMetadataManager.onDidChangeMetadata(async () => {
                console.log("TreeView: Metadata changed, handling change");
                await this.model.handleMetadataChange();
                debouncedRefresh();
            })
        );

        if (this.workspaceRoot) {
            const pattern = new vscode.RelativePattern(
                this.workspaceRoot,
                "**/files/target/**/*.codex"
            );

            this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
            console.log("TreeView: File watcher initialized with pattern:", pattern.pattern);

            this.disposables.push(
                this.fileWatcher,
                this.fileWatcher.onDidCreate((uri) => {
                    console.log("TreeView: File created:", uri.fsPath);
                    this.onFileChanged(uri, "create");
                }),
                this.fileWatcher.onDidChange((uri) => {
                    console.log("TreeView: File changed:", uri.fsPath);
                    this.onFileChanged(uri, "change");
                }),
                this.fileWatcher.onDidDelete((uri) => {
                    console.log("TreeView: File deleted:", uri.fsPath);
                    this.onFileChanged(uri, "delete");
                })
            );
        }
    }

    public refresh(): void {
        const now = Date.now();
        const timeSinceLastRefresh = now - this.lastRefreshTime;
        this.refreshCount++;
        console.log(
            `TreeView: Refresh triggered #${this.refreshCount} (${timeSinceLastRefresh}ms since last refresh)`
        );

        if (timeSinceLastRefresh < 100) {
            console.warn("TreeView: Rapid refreshes detected, possible refresh loop");
        }

        this.lastRefreshTime = now;
        this._onDidChangeTreeData.fire();
    }

    public getTreeItem(element: CodexNode): vscode.TreeItem {
        console.log("TreeView: Getting tree item for:", element.label);
        const treeItem = new vscode.TreeItem(
            element.label,
            element.type === "cell" || element.type === "dictionary"
                ? vscode.TreeItemCollapsibleState.None
                : vscode.TreeItemCollapsibleState.Collapsed
        );

        if (element.type === "document" || element.type === "section") {
            const resourceUri =
                element.resource.scheme === "file"
                    ? element.resource
                    : vscode.Uri.file(element.resource.path);

            console.log(
                "TreeView: Setting command for:",
                element.label,
                "with URI:",
                resourceUri.fsPath
            );
            treeItem.command = {
                command: "codexNotebookTreeView.openSection",
                title: "Open Section",
                arguments: [resourceUri, element.cellId],
            };

            // Add context value for document items to enable the source file button
            if (element.type === "document") {
                treeItem.contextValue = "document";
                treeItem.iconPath = new vscode.ThemeIcon("book");

                // Add source file URI to the tree item for the command to use
                if (element.sourceFileUri) {
                    treeItem.resourceUri = element.sourceFileUri;
                }
            }
        } else if (element.type === "dictionary") {
            treeItem.iconPath = new vscode.ThemeIcon("book");
            treeItem.command = {
                command: "vscode.open",
                title: "Open Dictionary",
                arguments: [element.resource],
            };
        }

        return treeItem;
    }

    public async getChildren(element?: CodexNode): Promise<CodexNode[]> {
        console.log("TreeView: Getting children for:", element?.label || "root");
        if (element) {
            return this.model.getChildren(element);
        } else {
            return this.model.getRoots();
        }
    }

    public getParent(element: CodexNode): vscode.ProviderResult<CodexNode> {
        const parentPath = dirname(element.resource.path);
        if (parentPath === "/") {
            return undefined;
        }
        return {
            resource: element.resource.with({ path: parentPath }),
            type: "corpus",
            label: basename(parentPath),
        };
    }

    private async onFileChanged(
        uri: vscode.Uri,
        type: "create" | "change" | "delete"
    ): Promise<void> {
        console.log(`TreeView: Handling ${type} event for:`, uri.fsPath);
        try {
            await this.model.notebookMetadataManager.handleFileSystemEvent(uri, type);
            console.log("TreeView: File system event handled successfully");
        } catch (error) {
            console.error("TreeView: Error handling file system event:", error);
        }
    }

    public dispose(): void {
        console.log("TreeView: Disposing provider");
        this.disposables.forEach((d) => d.dispose());
    }

    // Add this public method
    public async openSection(resource: vscode.Uri, cellId?: string): Promise<void> {
        try {
            const metadata = await this.model.notebookMetadataManager.getMetadataByUri(resource);
            if (!metadata?.codexFsPath) {
                throw new Error(`No metadata found for ${resource.fsPath}`);
            }

            const actualUri = vscode.Uri.file(metadata.codexFsPath);
            await vscode.commands.executeCommand("vscode.openWith", actualUri, "codex.cellEditor");

            if (cellId) {
                await vscode.commands.executeCommand("codex.scrollToCell", cellId);
            }
        } catch (error) {
            console.error("Error opening notebook:", error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Failed to open notebook: ${error.message}`);
            } else {
                vscode.window.showErrorMessage("Failed to open notebook: Unknown error");
            }
        }
    }
}
