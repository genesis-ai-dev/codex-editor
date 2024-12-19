import * as vscode from "vscode";
import * as path from "path";

// Basic item types for the tree
export type CodexTreeItemType = "corpus" | "codexDocument" | "dictionary";

export interface NextGenCodexItem {
    uri: vscode.Uri;
    label: string;
    type: CodexTreeItemType;
    children?: NextGenCodexItem[];
}

export class NextGenCodexTreeViewProvider implements vscode.TreeDataProvider<NextGenCodexItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NextGenCodexItem | undefined>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private codexItems: NextGenCodexItem[] = [];
    private dictionaryItems: NextGenCodexItem[] = [];
    private disposables: vscode.Disposable[] = [];
    private isBuilding = false;

    constructor(private context: vscode.ExtensionContext) {
        this.buildInitialData();
        this.registerWatchers();
    }

    // Core scanning and grouping
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
            const codexUris = await vscode.workspace.findFiles(codexPattern);
            const dictUris = await vscode.workspace.findFiles(dictPattern);

            // Create arrays - add your own grouping logic if you want to group by OT/NT, etc.
            this.codexItems = codexUris.map((uri) => this.makeCodexItem(uri));
            this.dictionaryItems = dictUris.map((uri) => this.makeDictionaryItem(uri));

            // A simple way: keep them top-level. Or you can unify them in a single data tree if you prefer.
            this._onDidChangeTreeData.fire(undefined);
        } finally {
            this.isBuilding = false;
        }
    }

    // Utility to build one item node
    private makeCodexItem(uri: vscode.Uri): NextGenCodexItem {
        const fileName = path.basename(uri.fsPath);
        // Add your own logic to detect OT/NT or do corpus grouping here
        return {
            uri,
            label: fileName.replace(".codex", " Codex"),
            type: "codexDocument",
        };
    }

    private makeDictionaryItem(uri: vscode.Uri): NextGenCodexItem {
        const fileName = path.basename(uri.fsPath);
        return {
            uri,
            label: fileName.replace(".dictionary", " Dictionary"),
            type: "dictionary",
        };
    }

    public getTreeItem(element: NextGenCodexItem): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(
            element.label,
            element.type === "codexDocument" || element.type === "dictionary"
                ? vscode.TreeItemCollapsibleState.None
                : vscode.TreeItemCollapsibleState.Collapsed
        );

        // For simple documents, add a double-click handler
        if (element.type === "codexDocument") {
            treeItem.command = {
                command: "vscode.openWith",
                title: "Open Codex",
                arguments: [element.uri, "codex.cellEditor"],
            };
            treeItem.iconPath = new vscode.ThemeIcon("book");
        } else if (element.type === "dictionary") {
            treeItem.command = {
                command: "vscode.open",
                title: "Open Dictionary",
                arguments: [element.uri],
            };
            treeItem.iconPath = new vscode.ThemeIcon("book");
        }

        return treeItem;
    }

    public getChildren(element?: NextGenCodexItem): Thenable<NextGenCodexItem[]> {
        // If requesting children for a top-level item with sub-items, return them.
        if (element) {
            if (element.children) {
                return Promise.resolve(element.children);
            }
            return Promise.resolve([]);
        }

        // Combine top-level codex items and dictionary items if you want them in one big list
        // or you can create separate nodes for "Codex" vs. "Dictionary" groups.
        const topLevel = [...this.codexItems, ...this.dictionaryItems];
        return Promise.resolve(topLevel);
    }

    // Set up watchers for .codex and .dictionary
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
            codexWatcher.onDidCreate(() => this.refresh()),
            codexWatcher.onDidChange(() => this.refresh()),
            codexWatcher.onDidDelete(() => this.refresh()),
            dictWatcher.onDidCreate(() => this.refresh()),
            dictWatcher.onDidChange(() => this.refresh()),
            dictWatcher.onDidDelete(() => this.refresh())
        );
    }

    public refresh(): void {
        // Only rebuild if we're not already building
        if (!this.isBuilding) {
            this.buildInitialData()
                .then(() => {
                    this._onDidChangeTreeData.fire(undefined);
                })
                .catch((error) => {
                    console.error("Error refreshing tree view:", error);
                });
        }
    }

    // Dispose watchers
    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
}

// Example command to open a codex file with custom viewer or default
export async function openCodexFile(uri: vscode.Uri) {
    try {
        // Try to open as notebook first
        await vscode.commands.executeCommand("vscode.openWith", uri, "codex-type");
    } catch (error) {
        console.warn("Failed to open as notebook, falling back to text editor:", error);
        // Fallback to regular text editor
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
    }
}
