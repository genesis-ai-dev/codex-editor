import { getWorkSpaceUri } from "./../../utils/index";
import * as vscode from "vscode";
import { NotebookMetadata, NavigationCell } from "../../utils/codexNotebookUtils";
import { vrefData } from "../../utils/verseRefUtils/verseData";
import * as path from "path";

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
        { navigation: NavigationCell[]; corpusMarker?: string; sourceFile?: string }
    > = new Map();

    private fileWatcher: vscode.FileSystemWatcher | undefined;

    private debounceTimer: NodeJS.Timeout | null = null;
    private pendingChanges: Set<string> = new Set();

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
        }
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
                        navigation: metadata?.navigation || [],
                        corpusMarker: metadata?.data?.corpusMarker,
                    });
                } catch (error) {
                    console.error(`Error processing file ${file}:`, error);
                }
            }
        }
    }

    private onFileChanged(uri: vscode.Uri): void {
        const fsPath = uri.fsPath;
        this.pendingChanges.add(fsPath);

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(async () => {
            for (const path of this.pendingChanges) {
                const uri = vscode.Uri.file(path);
                if (await this.fileExists(uri)) {
                    await this.updateNotebookMetadata(uri);
                } else {
                    this.notebookMetadata.delete(path);
                }
            }
            this.pendingChanges.clear();
            this.refresh();
        }, 300); // 300ms debounce time
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

            this.notebookMetadata.set(uri.fsPath, {
                navigation: metadata?.navigation || [],
                corpusMarker: metadata?.data?.corpusMarker,
                sourceFile: sourceFile,
            });
        } catch (error) {
            console.error(`Error processing file ${uri.fsPath}:`, error);
        }
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
                    name.slice(0, -7) === codexFileName
            );

            return matchingSourceFile ? matchingSourceFile[0] : undefined;
        } catch (error) {
            console.error(`Error reading source texts directory: ${error}`);
            return undefined;
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
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

                // Create the child nodes from navigation data
                if (metadata.navigation) {
                    notebookNode.children = this.createNodesFromNavigation(
                        metadata.navigation,
                        notebookUri,
                        `${fileNameWithoutExtension}.source`
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

    private createNodesFromNavigation(
        navigationCells: NavigationCell[],
        notebookUri: vscode.Uri,
        sourceFile?: string
    ): Node[] {
        return navigationCells.map((navCell) => {
            const node = new Node(
                navCell.label,
                navCell.children.length > 0 ? "section" : "cell",
                navCell.children.length > 0
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
                notebookUri,
                navCell.cellId,
                sourceFile
            );

            if (navCell.children.length > 0) {
                node.children = this.createNodesFromNavigation(
                    navCell.children,
                    notebookUri,
                    sourceFile
                );
            }

            return node;
        });
    }

    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}
