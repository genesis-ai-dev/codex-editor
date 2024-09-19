import { LanguageMetadata, LanguageProjectStatus } from "codex-types";
import * as vscode from "vscode";
import { CodexCell } from "../../utils/codexNotebookUtils";
import { vrefData } from "../../utils/verseRefUtils/verseData";
import { getProjectMetadata } from "../../utils";

export class Node extends vscode.TreeItem {
    public children?: Node[]; // Modified line

    constructor(
        public readonly label: string,
        public readonly type: "grouping" | "document" | "section" | "cell",
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
            const notebooks = await this.getNotebooksByGrouping(notebooksUri);
            return Promise.resolve(notebooks);
        }
    }

    private async getNotebooksByGrouping(dirUri: vscode.Uri): Promise<Node[]> {
        try {
            const files = await vscode.workspace.fs.readDirectory(dirUri);
            const notebooks = files
                .filter(([file, type]) => type === vscode.FileType.File && file.endsWith(".codex"))
                .map(([file]) => new Node(
                    file.slice(0, -6), // Remove .codex extension
                    "document",
                    vscode.TreeItemCollapsibleState.Collapsed
                ));

            // Define the canonical order and groupings
            const canonicalOrder = Object.keys(vrefData);
            const groupings = {
                "Old Testament": canonicalOrder.slice(0, 39),
                "New Testament": canonicalOrder.slice(39)
            };

            // Sort notebooks based on canonical order
            notebooks.sort((a, b) => canonicalOrder.indexOf(a.label) - canonicalOrder.indexOf(b.label));

            // Group notebooks
            const groupedNotebooks = this.groupNotebooks(notebooks, groupings);

            return groupedNotebooks;
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading directory: ${dirUri.fsPath}`);
            return [];
        }
    }

    private groupNotebooks(notebooks: Node[], groupings: Record<string, string[]>): Node[] {
        const result: Node[] = [];

        for (const [groupName, books] of Object.entries(groupings)) {
            const groupNotebooks = notebooks.filter(notebook => books.includes(notebook.label));
            if (groupNotebooks.length > 0) {
                const groupNode = new Node(groupName, "grouping", vscode.TreeItemCollapsibleState.Expanded);
                groupNode.children = groupNotebooks;
                result.push(groupNode);
            }
        }

        // Add any notebooks that don't belong to a group
        const ungroupedNotebooks = notebooks.filter(notebook =>
            !Object.values(groupings).flat().includes(notebook.label)
        );
        result.push(...ungroupedNotebooks);

        return result;
    }

    private async getChaptersInNotebook(notebookUri: vscode.Uri): Promise<Node[]> {
        const notebookDocument = await vscode.workspace.openNotebookDocument(notebookUri);
        const cells = notebookDocument.getCells();
        return cells.map((cell: vscode.NotebookCell, index: number) => {
            const cellId = cell.metadata?.id;
            if (cellId) {
                const sectionNumber = cellId.split(' ')[1].split(':')[0];
                if (sectionNumber) {
                    return new Node(
                        `Section ${sectionNumber}`,
                        "section",
                        vscode.TreeItemCollapsibleState.None,
                        {
                            command: "scripture-explorer-activity-bar.openSection",
                            title: "",
                            arguments: [notebookUri.fsPath, index],
                        },
                    );
                }
            }
            return undefined;
        }).filter((node): node is Node => node !== undefined);
    }
}
