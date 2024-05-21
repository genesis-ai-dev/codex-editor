import * as vscode from "vscode";
import * as path from "path";

export class Node extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: "folder" | "file",
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
    ) {
        super(label, collapsibleState);
        this.contextValue = type;
        this.resourceUri = vscode.Uri.file(label);
    }
}

export class ResourceProvider implements vscode.TreeDataProvider<Node> {
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

    getChildren(element?: Node): Thenable<Node[]> {
        if (!this.workspaceRoot) {
            // vscode.window.showInformationMessage(
            //     "No resources in empty workspace",
            // );
            return Promise.resolve([]);
        }

        if (element) {
            if (element.type === "folder") {
                if (element.resourceUri) {
                    console.log("element.resourceUri:", element.resourceUri);
                    console.log(
                        "element.resourceUri.fsPath:",
                        element.resourceUri.fsPath,
                    );
                    const resourcePath = path.join(
                        this.workspaceRoot,
                        ".project",
                        "resources",
                        element.resourceUri.fsPath,
                    );
                    return this.getFilesInDirectory(resourcePath);
                }
            }
        } else {
            const resourcePath = path.join(this.workspaceRoot, ".project", "resources");
            return this.getFilesInDirectory(resourcePath);
        }
        return Promise.resolve([]);
    }

    private async getFilesInDirectory(dirPath: string): Promise<Node[]> {
        const entries = await vscode.workspace.fs.readDirectory(
            vscode.Uri.file(dirPath),
        );

        return entries.map(([name, type]) => {
            const resourceUri = vscode.Uri.file(path.join(dirPath, name));
            const collapsibleState =
                type === vscode.FileType.Directory
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None;
            const itemType =
                type === vscode.FileType.Directory ? "folder" : "file";

            let command;
            if (itemType === "file") {
                command = {
                    command: "codex-notebook-extension.openFile",
                    title: "Open File",
                    arguments: [resourceUri],
                };
            }

            return new Node(name, itemType, collapsibleState, command);
        });
    }
}
