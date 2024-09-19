import { LanguageMetadata, LanguageProjectStatus } from "codex-types";
import * as vscode from "vscode";
import * as path from "path";
import { CodexCell } from "../../utils/codexNotebookUtils";
import { vrefData } from "../../utils/verseRefUtils/verseData";
import { getProjectMetadata } from "../../utils";

export class Node extends vscode.TreeItem {
    public children?: Node[]; // Modified line

    constructor(
        public readonly label: string,
        public readonly type: "grouping" | "notebook" | "chapter",
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

    constructor(private workspaceRoot: string | undefined) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: Node): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: Node): Promise<Node[] | undefined> {
        if (!this.workspaceRoot) {
            // vscode.window.showInformationMessage(
            //     "No notebooks in empty workspace",
            // );
            return Promise.resolve([]);
        }

        if (element) {
            if (element.type === "notebook") {
                // Read the chapters from the .codex file
                const notebookPath = path.join(
                    this.workspaceRoot,
                    "files",
                    "target",
                    `${element.label}.codex`,
                );
                const chapters = this.getChaptersInNotebook(notebookPath);
                return Promise.resolve(chapters);
            } else if (element.type === "grouping") {
                return Promise.resolve(element.children);
            } else {
                // Handle the case when element.type is not 'notebook'
                return Promise.resolve([]);
            }
        } else {
            // Read the .codex files from the files/{targetLanguage} directory
            const notebooksPath = path.join(
                this.workspaceRoot,
                "files",
                "target",
            );
            const notebooks =
                this.getNotebooksByTestamentInDirectory(notebooksPath);
            return Promise.resolve(notebooks);
        }
    }

    private async getNotebooksByTestamentInDirectory(
        dirPath: string,
    ): Promise<Node[]> {
        try {
            const files = await vscode.workspace.fs.readDirectory(
                vscode.Uri.file(dirPath),
            );
            let notebooks = files
                .filter(
                    ([file, type]) =>
                        type === vscode.FileType.File &&
                        path.extname(file) === ".codex",
                )
                .map(
                    ([file]) =>
                        new Node(
                            path.basename(file, ".codex"),
                            "notebook",
                            vscode.TreeItemCollapsibleState.Collapsed,
                        ),
                );

            // Define the canonical order based on the keys of vrefData
            const canonicalOrder = Object.keys(vrefData);

            // Sort the notebooks array based on the canonical order
            notebooks = notebooks.sort((a, b) => {
                const indexA = canonicalOrder.indexOf(a.label);
                const indexB = canonicalOrder.indexOf(b.label);
                return indexA - indexB;
            });

            const OTNotebooks = notebooks.slice(0, 39); // Genesis to Malachi
            const NTNotebooks = notebooks.slice(39); // Matthew to Revelation

            const OTNode = new Node(
                "Old Testament",
                "grouping",
                vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
            );
            const NTNode = new Node(
                "New Testament",
                "grouping",
                vscode.TreeItemCollapsibleState.Expanded,
                undefined,
            );

            OTNode.children = OTNotebooks;
            NTNode.children = NTNotebooks;

            if (OTNotebooks.length === 0 && NTNotebooks.length === 0) {
                return [];
            }

            return [OTNode, NTNode];
        } catch (error) {
            vscode.window.showErrorMessage(
                `Error reading directory: ${dirPath}`,
            );
            return [];
        }
    }

    private async getChaptersInNotebook(notebookPath: string): Promise<Node[]> {
        const notebookContentBuffer = await vscode.workspace.fs.readFile(
            vscode.Uri.file(notebookPath),
        );
        const notebookContent = notebookContentBuffer.toString(); // Convert the buffer to a string
        const notebookJson = JSON.parse(notebookContent); // Parse the JSON content
        const cells = notebookJson.cells; // Access the cells array

        // FIXME: this needs to update the verse ref in global state so that the chunk editor provider can pass the new verse ref to the webview and display the associated chapter
        // Now you can process each cell as needed
        // return cells.map((cell: CodexCell, index: number) => {
        //     // Assuming you want to create a Node for each cell
        //     if (cell.metadata?.type === CellContent.CHAPTER_HEADING) {
        //         return new Node(
        //             `Chapter ${cell.metadata.data.chapter}`,
        //             "chapter",
        //             vscode.TreeItemCollapsibleState.None,
        //             {
        //                 command: "scripture-explorer-activity-bar.openChapter",
        //                 title: "",
        //                 arguments: [notebookPath, index],
        //             },
        //         );
        //     }
        // });
    }
}
