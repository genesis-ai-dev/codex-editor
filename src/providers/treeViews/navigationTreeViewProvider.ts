import { getWorkSpaceUri } from "./../../utils/index";
import * as vscode from "vscode";
import { NotebookMetadata, NavigationCell } from "../../utils/codexNotebookUtils";
import { vrefData } from "../../utils/verseRefUtils/verseData";
import * as path from "path";
import { debounce } from "lodash";

export class Node extends vscode.TreeItem {
    public children?: Node[];

    constructor(
        public readonly label: string,
        public readonly type: "corpus" | "document" | "section" | "cell",
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly notebookUri?: vscode.Uri,
        public readonly cellId?: string,
        public readonly sourceFile?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = type;

        if (type === "document" || type === "section" || type === "cell") {
            this.command = {
                command: "translation-navigation.openSection",
                title: "Open Section",
                arguments: [notebookUri?.fsPath, cellId],
            };
        }

        if (type === "document") {
            this.iconPath = new vscode.ThemeIcon("book");
        }
    }
}

export class CodexNotebookTreeViewProvider
    implements vscode.TreeDataProvider<Node>, vscode.Disposable
{
    private _onDidChangeTreeData: vscode.EventEmitter<Node | undefined | void> =
        new vscode.EventEmitter<Node | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<Node | undefined | void> =
        this._onDidChangeTreeData.event;

    private notebookMetadata: Map<
        string,
        { headings: Heading[]; corpusMarker?: string; sourceFile?: string }
    > = new Map();

    private fileWatcher: vscode.FileSystemWatcher | undefined;

    private debounceTimer: NodeJS.Timeout | null = null;
    private pendingChanges: Map<string, number> = new Map();
    private lastRefreshTime: number = 0;
    private refreshDebounceTime: number = 1000; // 5 seconds

    private debouncedRefresh = debounce(() => {
        const now = Date.now();
        if (now - this.lastRefreshTime < this.refreshDebounceTime) {
            console.log("Skipping refresh due to debounce");
            return;
        }
        this.lastRefreshTime = now;
        this.refresh();
    }, 1000);

    private fileWatcherSuspended: boolean = false;

    constructor(private workspaceRoot: string | undefined) {
        this.initializeNotebookMetadata();

        if (this.workspaceRoot) {
            const pattern = new vscode.RelativePattern(
                vscode.Uri.file(this.workspaceRoot),
                "files/target/**/*.codex"
            );

            this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

            this.fileWatcher.onDidCreate((uri) => this.onFileChanged(uri));
            this.fileWatcher.onDidChange((uri) => this.onFileChanged(uri));
            this.fileWatcher.onDidDelete((uri) => this.onFileChanged(uri));

            console.log("File watcher initialized");
        }

        vscode.commands.registerCommand("translation-navigation.suspendFileWatcher", () => {
            this.suspendFileWatcher();
        });

        vscode.commands.registerCommand("translation-navigation.resumeFileWatcher", () => {
            this.resumeFileWatcher();
        });
    }

    private async initializeNotebookMetadata(): Promise<void> {
        if (!this.workspaceRoot) {
            return;
        }

        const notebooksUri = vscode.Uri.joinPath(
            vscode.Uri.file(this.workspaceRoot),
            "files",
            "target"
        );
        const files = await vscode.workspace.fs.readDirectory(notebooksUri);

        for (const [file, type] of files) {
            if (type === vscode.FileType.File && file.endsWith(".codex")) {
                const notebookUri = vscode.Uri.joinPath(notebooksUri, file);
                try {
                    const notebookContent = await vscode.workspace.fs.readFile(notebookUri);
                    let notebookJson;
                    try {
                        notebookJson = JSON.parse(notebookContent.toString());
                    } catch (parseError) {
                        console.error(`Error parsing JSON for file ${file}:`, parseError);
                        console.log("Content causing the error:", notebookContent.toString());
                        continue;
                    }
                    const metadata = notebookJson?.metadata as NotebookMetadata;

                    this.notebookMetadata.set(notebookUri.fsPath, {
                        headings: this.extractHeadingsFromNotebook(notebookJson),
                        corpusMarker: metadata?.data?.corpusMarker,
                    });
                } catch (error) {
                    console.error(
                        `Error processing file in initializeNotebookMetadata ${file}:`,
                        error
                    );
                }
            }
        }
    }

    private onFileChanged(uri: vscode.Uri): void {
        if (this.fileWatcherSuspended) {
            console.log("File watcher suspended, ignoring change:", uri.fsPath);
            return;
        }

        const fsPath = uri.fsPath;
        const now = Date.now();
        const lastChangeTime = this.pendingChanges.get(fsPath) || 0;

        if (now - lastChangeTime < 1000) {
            // Ignore changes within 1 second
            console.log("Ignoring rapid change:", fsPath);
            return;
        }

        console.log("File changed:", fsPath);
        this.pendingChanges.set(fsPath, now);

        this.debouncedRefresh();
    }

    private async fileExists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    private async updateNotebookMetadata(uri: vscode.Uri): Promise<void> {
        try {
            const notebookContent = await vscode.workspace.fs.readFile(uri);
            console.log("Updating notebook metadata:", uri.fsPath);
            const notebookJson = JSON.parse(notebookContent.toString());
            const metadata = notebookJson?.metadata as NotebookMetadata;

            const sourceFile =
                metadata?.sourceFile || (await this.findCorrespondingSourceFile(uri));

            // Update the notebook's metadata with the found source file
            if (sourceFile) {
                metadata.sourceFile = sourceFile;
                notebookJson.metadata = metadata;
                await vscode.workspace.fs.writeFile(
                    uri,
                    Buffer.from(JSON.stringify(notebookJson, null, 2))
                );
            }

            // Extract headings from notebook content
            const headings = this.extractHeadingsFromNotebook(notebookJson);

            this.notebookMetadata.set(uri.fsPath, {
                headings: headings,
                corpusMarker: metadata?.data?.corpusMarker,
                sourceFile: sourceFile,
            });
        } catch (error) {
            console.error(`Error processing file in updateNotebookMetadata ${uri.fsPath}:`, error);
        }
    }

    private extractHeadingsFromNotebook(notebookJson: any): Heading[] {
        const headings: Heading[] = [];

        for (const cell of notebookJson.cells) {
            let content = "";

            if (cell.kind === vscode.NotebookCellKind.Markup) {
                content = cell.value;
            } else if (cell.kind === vscode.NotebookCellKind.Code) {
                content = cell.value;
            }

            const regex = /<h([1-6])>(.*?)<\/h\1>/g;
            let match;
            while ((match = regex.exec(content)) !== null) {
                const level = parseInt(match[1]);
                const text = match[2];

                headings.push({
                    level: level,
                    text: text,
                    cellId: cell.metadata?.id,
                });
            }
        }

        return headings;
    }

    private async findCorrespondingSourceFile(codexUri: vscode.Uri): Promise<string | undefined> {
        const codexFileName = path.basename(codexUri.fsPath, ".codex");

        // Check the config for primarySourceText
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const primarySourceText = config.get<string>("primarySourceText");

        if (primarySourceText) {
            return path.basename(primarySourceText);
        }

        const workSpaceUri = getWorkSpaceUri();

        if (!workSpaceUri) {
            console.error("No workspace found. Cannot find source file for " + codexFileName);
            return undefined;
        }

        // If not found in config, look for a matching .source file
        const sourceTextsFolderUri = vscode.Uri.joinPath(workSpaceUri, ".project", "sourceTexts");
        try {
            const files = await vscode.workspace.fs.readDirectory(sourceTextsFolderUri);
            const matchingSourceFile = files.find(
                ([name, type]) =>
                    type === vscode.FileType.File &&
                    name.endsWith(".source") &&
                    name.split("/").pop() === codexFileName
            );

            return matchingSourceFile ? matchingSourceFile[0] : undefined;
        } catch (error) {
            console.error(`Error reading source texts directory: ${error}`);
            return undefined;
        }
    }

    refresh(): void {
        console.log("Refreshing tree view");
        this.processPendingChanges().then(() => {
            console.log("Tree view refresh completed");
            this._onDidChangeTreeData.fire();
        });
    }

    private async processPendingChanges(): Promise<void> {
        console.log("Processing pending changes");
        const now = Date.now();
        for (const [path, timestamp] of this.pendingChanges.entries()) {
            if (now - timestamp > 1000) {
                // Only process changes older than 1 second
                const uri = vscode.Uri.file(path);
                if (await this.fileExists(uri)) {
                    console.log("Updating metadata for:", path);
                    await this.updateNotebookMetadata(uri);
                } else {
                    console.log("Deleting metadata for:", path);
                    this.notebookMetadata.delete(path);
                }
                this.pendingChanges.delete(path);
            }
        }
    }

    getTreeItem(element: Node): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: Node): Promise<Node[] | undefined> {
        if (!this.workspaceRoot) {
            return Promise.resolve([]);
        }

        if (element) {
            return Promise.resolve(element.children);
        } else {
            const notebooks = await this.getNotebooksByCorpus();
            return Promise.resolve(notebooks);
        }
    }

    private async getNotebooksByCorpus(): Promise<Node[]> {
        try {
            const corpora: Record<string, Node> = {
                "Old Testament": new Node(
                    "Old Testament",
                    "corpus",
                    vscode.TreeItemCollapsibleState.Expanded
                ),
                "New Testament": new Node(
                    "New Testament",
                    "corpus",
                    vscode.TreeItemCollapsibleState.Expanded
                ),
            };
            corpora["Old Testament"].children = [];
            corpora["New Testament"].children = [];
            const ungroupedNotebooks: Node[] = [];

            for (const [notebookPath, metadata] of this.notebookMetadata) {
                const fileName = vscode.Uri.parse(notebookPath).path.split("/").pop() || "";
                const fileNameWithoutExtension = fileName.slice(0, -6); // Remove .codex
                const notebookUri = vscode.Uri.file(notebookPath);
                const notebookNode = new Node(
                    fileNameWithoutExtension,
                    "document",
                    vscode.TreeItemCollapsibleState.Collapsed,
                    notebookUri,
                    undefined,
                    `${fileNameWithoutExtension}.source`
                );

                if (metadata.headings) {
                    notebookNode.children = this.createNodesFromHeadings(
                        metadata.headings,
                        notebookUri,
                        metadata.sourceFile
                    );
                }

                const bookData = vrefData[fileNameWithoutExtension];
                if (bookData) {
                    const testament =
                        bookData.testament === "OT" ? "Old Testament" : "New Testament";
                    corpora[testament].children?.push(notebookNode);
                } else if (metadata.corpusMarker) {
                    // Add notebook to the corpus if it's not in vrefData but has a corpusMarker
                    if (!corpora[metadata.corpusMarker]) {
                        corpora[metadata.corpusMarker] = new Node(
                            metadata.corpusMarker,
                            "corpus",
                            vscode.TreeItemCollapsibleState.Expanded
                        );
                        corpora[metadata.corpusMarker].children = [];
                    }
                    corpora[metadata.corpusMarker].children?.push(notebookNode);
                } else {
                    // Ungrouped notebook
                    ungroupedNotebooks.push(notebookNode);
                }
            }

            // Sort books within each testament
            for (const testament of ["Old Testament", "New Testament"]) {
                corpora[testament].children?.sort((a, b) => {
                    const aOrd = Number(vrefData[a.label]?.ord) || Infinity;
                    const bOrd = Number(vrefData[b.label]?.ord) || Infinity;
                    return aOrd - bOrd;
                });
            }

            const result: Node[] = Object.values(corpora);

            // Add ungrouped notebooks
            result.push(...ungroupedNotebooks);

            return result;
        } catch (error) {
            vscode.window.showErrorMessage(`Error processing notebooks: ${error}`);
            return [];
        }
    }

    private createNodesFromHeadings(
        headings: Heading[],
        notebookUri: vscode.Uri,
        sourceFile?: string
    ): Node[] {
        const nodes: Node[] = [];

        headings.forEach((heading) => {
            const node = new Node(
                heading.text,
                "section",
                vscode.TreeItemCollapsibleState.None,
                notebookUri,
                heading.cellId,
                sourceFile
            );
            nodes.push(node);
        });

        return nodes;
    }

    public suspendFileWatcher(): void {
        this.fileWatcherSuspended = true;
    }

    public resumeFileWatcher(): void {
        this.fileWatcherSuspended = false;
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}

// Define the 'Heading' type.
type Heading = {
    level: number;
    text: string;
    cellId: string;
};
