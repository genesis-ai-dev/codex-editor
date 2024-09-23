import { LanguageMetadata, LanguageProjectStatus } from "codex-types";
import * as vscode from "vscode";
import { CodexCell, NotebookMetadata, NavigationCell } from "../../utils/codexNotebookUtils";
import { vrefData } from "../../utils/verseRefUtils/verseData";
import { getProjectMetadata } from "../../utils";

export class Node extends vscode.TreeItem {
    public children?: Node[];

    constructor(
        public readonly label: string,
        public readonly type: "corpus" | "document" | "section" | "cell",
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly cellId?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = type;
    }
}

export class CodexNotebookTreeViewProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<Node | undefined | void> =
        new vscode.EventEmitter<Node | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<Node | undefined | void> =
        this._onDidChangeTreeData.event;

    private notebookMetadata: Map<string, { navigation: NavigationCell[], corpusMarker?: string }> = new Map();

    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor(private workspaceRoot: string | undefined) {
        this.initializeNotebookMetadata();

        if (this.workspaceRoot) {
            const pattern = new vscode.RelativePattern(
                vscode.Uri.file(this.workspaceRoot),
                'files/target/**/*.codex'
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

        const notebooksUri = vscode.Uri.joinPath(vscode.Uri.file(this.workspaceRoot), "files", "target");
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
                        console.log('Content causing the error:', notebookContent.toString());
                        continue;
                    }
                    const metadata = notebookJson?.metadata as NotebookMetadata;

                    this.notebookMetadata.set(notebookUri.fsPath, {
                        navigation: metadata?.navigation || [],
                        corpusMarker: metadata?.data?.corpusMarker
                    });
                } catch (error) {
                    console.error(`Error processing file ${file}:`, error);
                }
            }
        }
    }

    private onFileChanged(uri: vscode.Uri): void {
        // Re-initialize metadata and refresh the tree view
        this.initializeNotebookMetadata().then(() => this.refresh());
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
        console.time('getNotebooksByCorpus');
        try {
            const corpora: Record<string, Node> = {
                "Old Testament": new Node("Old Testament", "corpus", vscode.TreeItemCollapsibleState.Expanded),
                "New Testament": new Node("New Testament", "corpus", vscode.TreeItemCollapsibleState.Expanded)
            };
            corpora["Old Testament"].children = [];
            corpora["New Testament"].children = [];
            const ungroupedNotebooks: Node[] = [];

            for (const [notebookPath, metadata] of this.notebookMetadata) {
                const fileName = vscode.Uri.parse(notebookPath).path.split('/').pop() || '';
                const fileNameWithoutExtension = fileName.slice(0, -6);
                const notebookUri = vscode.Uri.file(notebookPath);
                const notebookNode = new Node(
                    fileNameWithoutExtension,
                    "document",
                    vscode.TreeItemCollapsibleState.Collapsed
                );

                // Create the child nodes from navigation data
                if (metadata.navigation) {
                    notebookNode.children = this.createNodesFromNavigation(metadata.navigation, notebookUri);
                }

                const bookData = vrefData[fileNameWithoutExtension];
                if (bookData) {
                    const testament = bookData.testament === "OT" ? "Old Testament" : "New Testament";
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
        } finally {
            console.timeEnd('getNotebooksByCorpus');
        }
    }

    private createNodesFromNavigation(navigationCells: NavigationCell[], notebookUri: vscode.Uri): Node[] {
        return navigationCells.map(navCell => {
            const node = new Node(
                navCell.label,
                navCell.children.length > 0 ? "section" : "cell",
                navCell.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                navCell.cellId
                    ? {
                        command: "translation-navigation.openSection",
                        title: "$(arrow-right)",
                        arguments: [notebookUri.fsPath, navCell.cellId],
                    }
                    : undefined,
                navCell.cellId
            );

            if (navCell.children.length > 0) {
                node.children = this.createNodesFromNavigation(navCell.children, notebookUri);
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
