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

export class CodexNotebookProvider implements vscode.TreeDataProvider<Node> {
    private _onDidChangeTreeData: vscode.EventEmitter<Node | undefined | void> =
        new vscode.EventEmitter<Node | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<Node | undefined | void> =
        this._onDidChangeTreeData.event;

    private notebookMetadata: Map<string, { navigation: NavigationCell[], corpusMarker?: string }> = new Map();

    constructor(private workspaceRoot: string | undefined) {
        this.initializeNotebookMetadata();
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
                const notebookContent = await vscode.workspace.fs.readFile(notebookUri);
                const notebookJson = JSON.parse(notebookContent.toString());
                const metadata = notebookJson?.metadata as NotebookMetadata;

                this.notebookMetadata.set(notebookUri.fsPath, {
                    navigation: metadata?.navigation || [],
                    corpusMarker: metadata?.data?.corpusMarker
                });
            }
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
        console.time('getNotebooksByCorpus');
        try {
            const corpora: Record<string, Node> = {};
            const ungroupedNotebooks: Node[] = [];

            for (const [notebookPath, metadata] of this.notebookMetadata) {
                const fileName = vscode.Uri.parse(notebookPath).path.split('/').pop() || '';
                const notebookUri = vscode.Uri.file(notebookPath);
                const notebookNode = new Node(
                    fileName.slice(0, -6),
                    "document",
                    vscode.TreeItemCollapsibleState.Collapsed
                );

                // Create the child nodes from navigation data
                if (metadata.navigation) {
                    notebookNode.children = this.createNodesFromNavigation(metadata.navigation, notebookUri);
                }

                if (metadata.corpusMarker) {
                    // Add notebook to the corpus
                    if (!corpora[metadata.corpusMarker]) {
                        // Create a new corpus node
                        const corpusNode = new Node(
                            metadata.corpusMarker,
                            "corpus",
                            vscode.TreeItemCollapsibleState.Expanded
                        );
                        corpusNode.children = [];
                        corpora[metadata.corpusMarker] = corpusNode;
                    }
                    corpora[metadata.corpusMarker].children?.push(notebookNode);
                } else {
                    // Ungrouped notebook
                    ungroupedNotebooks.push(notebookNode);
                }
            }

            const result: Node[] = [];

            // Add corpus nodes
            for (const corpusNode of Object.values(corpora)) {
                result.push(corpusNode);
            }

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
}
