import { LanguageMetadata, LanguageProjectStatus } from "codex-types";
import * as vscode from "vscode";
import { CodexCell } from "../../utils/codexNotebookUtils";
import { vrefData } from "../../utils/verseRefUtils/verseData";
import { getProjectMetadata } from "../../utils";

export class Node extends vscode.TreeItem {
    public children?: Node[]; // Modified line

    constructor(
        public readonly label: string,
        public readonly type: "corpus" | "document" | "section" | "cell",
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
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

    constructor(private workspaceRoot: string | undefined) { }

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
            if (element.type === "document") {
                const notebookUri = vscode.Uri.joinPath(vscode.Uri.file(this.workspaceRoot), "files", "target", `${element.label}.codex`);
                const chapters = await this.getChaptersInNotebook(notebookUri);
                return Promise.resolve(chapters);
            } else if (element.type === "section") {
                return Promise.resolve(element.children);
            } else {
                return Promise.resolve(element.children);
            }
        } else {
            const notebooksUri = vscode.Uri.joinPath(vscode.Uri.file(this.workspaceRoot), "files", "target");
            const notebooks = await this.getNotebooksByCorpus(notebooksUri);
            return Promise.resolve(notebooks);
        }
    }


    private async getNotebooksByCorpus(dirUri: vscode.Uri): Promise<Node[]> {
        try {
            const files = await vscode.workspace.fs.readDirectory(dirUri);
            const notebooks: Node[] = [];
            const corpora: Record<string, Node[]> = {};

            for (const [file, type] of files) {
                if (type === vscode.FileType.File && file.endsWith(".codex")) {
                    const notebookUri = vscode.Uri.joinPath(dirUri, file);
                    const notebookDocument = await vscode.workspace.openNotebookDocument(notebookUri);
                    const corpusMarker = notebookDocument.metadata?.data?.corpusMarker as string;

                    const notebookNode = new Node(
                        file.slice(0, -6), // Remove .codex extension
                        "document",
                        vscode.TreeItemCollapsibleState.Collapsed
                    );

                    notebooks.push(notebookNode);

                    if (corpusMarker) {
                        if (!corpora[corpusMarker]) {
                            corpora[corpusMarker] = [];
                        }
                        corpora[corpusMarker].push(notebookNode);
                    }
                }
            }

            console.log("Detected corpora:", Object.keys(corpora));

            // Group notebooks
            const groupedNotebooks = this.groupNotebooks(notebooks, corpora);

            return groupedNotebooks;
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading directory: ${dirUri.fsPath}`);
            return [];
        }
    }

    private groupNotebooks(notebooks: Node[], corpora: Record<string, Node[]>): Node[] {
        const result: Node[] = [];

        // Create corpus nodes
        for (const [corpusName, corpusNotebooks] of Object.entries(corpora)) {
            const corpusNode = new Node(corpusName, "corpus", vscode.TreeItemCollapsibleState.Expanded);
            corpusNode.children = corpusNotebooks;
            result.push(corpusNode);
        }

        // Add any notebooks that don't belong to a corpus
        const ungroupedNotebooks = notebooks.filter(notebook =>
            !Object.values(corpora).flat().some(corpusNotebook => corpusNotebook.label === notebook.label)
        );
        result.push(...ungroupedNotebooks);

        return result;
    }

    private async getChaptersInNotebook(notebookUri: vscode.Uri): Promise<Node[]> {
        const notebookDocument = await vscode.workspace.openNotebookDocument(notebookUri);
        const cells = notebookDocument.getCells();
        return cells.map((cell: vscode.NotebookCell, index: number) => {
            const cellSectionMarker = cell.metadata?.data?.sectionMarker;
            if (cellSectionMarker) {
                const sectionNumber = cellSectionMarker;
                if (sectionNumber) {
                    return new Node(
                        `${sectionNumber}`,
                        "section",
                        vscode.TreeItemCollapsibleState.None,
                        {
                            command: "translation-navigation.openSection",
                            title: "$(arrow-right)",
                            arguments: [notebookUri.fsPath, cellSectionMarker],
                        },
                    );
                }
            }
            return undefined;
        }).filter((node): node is Node => node !== undefined);
    }
}
