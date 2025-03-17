import * as vscode from "vscode";
import * as path from "path";
import { CodexContentSerializer } from "../../serializer";

// Basic item types for the tree
export type CodexTreeItemType = "corpus" | "codexDocument" | "dictionary";

interface CodexMetadata {
    id: string;
    originalName: string;
    sourceFsPath?: string;
    codexFsPath?: string;
    navigation: any[];
    sourceCreatedAt?: string;
    codexLastModified?: string;
    gitStatus?: string;
    corpusMarker?: string;
    progress?: number;
}

export interface NextGenCodexItem {
    uri: vscode.Uri;
    label: string;
    type: CodexTreeItemType;
    children?: NextGenCodexItem[];
    corpusMarker?: string;
    progress?: number;
}

export class NextGenCodexTreeViewProvider implements vscode.TreeDataProvider<NextGenCodexItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NextGenCodexItem | undefined>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private codexItems: NextGenCodexItem[] = [];
    private dictionaryItems: NextGenCodexItem[] = [];
    private disposables: vscode.Disposable[] = [];
    private isBuilding = false;
    private serializer = new CodexContentSerializer();

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

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: "Loading Codex Files",
                cancellable: false,
            },
            async (progress) => {
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
                    const dictPattern = new vscode.RelativePattern(
                        rootUri.fsPath,
                        "files/**/*.dictionary"
                    );

                    progress.report({ message: "Finding files...", increment: 20 });
                    const [codexUris, dictUris] = await Promise.all([
                        vscode.workspace.findFiles(codexPattern),
                        vscode.workspace.findFiles(dictPattern),
                    ]);

                    // Process codex files with metadata
                    progress.report({ message: "Reading codex metadata...", increment: 30 });
                    const codexItemsWithMetadata = await Promise.all(
                        codexUris.map(async (uri, index) => {
                            progress.report({
                                message: `Reading ${path.basename(uri.fsPath, ".codex")}...`,
                                increment: 30 / codexUris.length,
                            });
                            return this.makeCodexItemWithMetadata(uri);
                        })
                    );

                    // Group by corpus
                    progress.report({ message: "Organizing by corpus...", increment: 20 });
                    const groupedItems = this.groupByCorpus(codexItemsWithMetadata);
                    this.codexItems = groupedItems;

                    // Process dictionary items
                    progress.report({ message: "Processing dictionaries...", increment: 20 });
                    this.dictionaryItems = dictUris.map((uri) => this.makeDictionaryItem(uri));

                    progress.report({ message: "Done!", increment: 10 });
                    this._onDidChangeTreeData.fire(undefined);
                } catch (error) {
                    console.error("Error building tree data:", error);
                    vscode.window.showErrorMessage(`Error loading codex files: ${error}`);
                } finally {
                    this.isBuilding = false;
                }
            }
        );
    }

    private async makeCodexItemWithMetadata(uri: vscode.Uri): Promise<NextGenCodexItem> {
        try {
            const content = await vscode.workspace.fs.readFile(uri);
            const notebookData = await this.serializer.deserializeNotebook(
                content,
                new vscode.CancellationTokenSource().token
            );

            const metadata = notebookData.metadata as CodexMetadata;
            const fileName = path.basename(uri.fsPath, ".codex");

            // Calculate progress based on cells with values
            const totalCells = notebookData.cells.length;
            const cellsWithValues = notebookData.cells.filter(
                (cell) => cell.value && cell.value.trim().length > 0
            ).length;
            const progress = totalCells > 0 ? (cellsWithValues / totalCells) * 100 : 0;

            return {
                uri,
                label: `${fileName} Codex`,
                type: "codexDocument",
                corpusMarker: metadata?.corpusMarker,
                progress: progress,
            };
        } catch (error) {
            console.warn(`Failed to read metadata for ${uri.fsPath}:`, error);
            return this.makeCodexItem(uri);
        }
    }

    private groupByCorpus(items: NextGenCodexItem[]): NextGenCodexItem[] {
        const corpusGroups = new Map<string, NextGenCodexItem[]>();
        const ungroupedItems: NextGenCodexItem[] = [];

        // Sort items into corpus groups or ungrouped
        items.forEach((item) => {
            if (item.corpusMarker) {
                const group = corpusGroups.get(item.corpusMarker) || [];
                group.push(item);
                corpusGroups.set(item.corpusMarker, group);
            } else {
                ungroupedItems.push(item);
            }
        });

        // Create corpus group nodes
        const groupedItems: NextGenCodexItem[] = [];
        corpusGroups.forEach((items, corpusMarker) => {
            // Calculate average progress for the corpus
            const totalProgress = items.reduce((sum, item) => sum + (item.progress || 0), 0);
            const averageProgress = items.length > 0 ? totalProgress / items.length : 0;

            groupedItems.push({
                uri: items[0].uri, // Use first item's URI for the group
                label: corpusMarker,
                type: "corpus",
                children: items.sort((a, b) => a.label.localeCompare(b.label)),
                progress: averageProgress,
            });
        });

        // Sort corpus groups and add ungrouped items
        return [...groupedItems.sort((a, b) => a.label.localeCompare(b.label)), ...ungroupedItems];
    }

    // Utility to build one item node
    private makeCodexItem(uri: vscode.Uri): NextGenCodexItem {
        const fileName = path.basename(uri.fsPath, ".codex");
        return {
            uri,
            label: `${fileName} Codex`,
            type: "codexDocument",
        };
    }

    private makeDictionaryItem(uri: vscode.Uri): NextGenCodexItem {
        const fileName = path.basename(uri.fsPath, ".dictionary");
        return {
            uri,
            label: `${fileName} Dictionary`,
            type: "dictionary",
        };
    }

    public getTreeItem(element: NextGenCodexItem): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(
            element.label,
            element.type === "corpus"
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );

        // Add progress to the description
        if (element.progress !== undefined) {
            treeItem.description = `${Math.round(element.progress)}% complete`;
        }

        if (element.type === "codexDocument") {
            treeItem.command = {
                command: "vscode.openWith",
                title: "Open Codex",
                arguments: [element.uri, "codex.cellEditor"],
            };
            treeItem.iconPath = new vscode.ThemeIcon("book");

            // Add tooltip with progress information
            treeItem.tooltip = `${element.label}\n${Math.round(element.progress || 0)}% complete`;
        } else if (element.type === "dictionary") {
            treeItem.command = {
                command: "vscode.open",
                title: "Open Dictionary",
                arguments: [element.uri],
            };
            treeItem.iconPath = new vscode.ThemeIcon("book");
        } else if (element.type === "corpus") {
            treeItem.iconPath = new vscode.ThemeIcon("library");
            // Add tooltip with progress information for corpus
            if (element.progress !== undefined) {
                treeItem.tooltip = `${element.label}\nAverage Progress: ${Math.round(element.progress)}%`;
            }
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
        await vscode.commands.executeCommand("vscode.openWith", uri, "codex.cellEditor");
    } catch (error) {
        console.warn("Failed to open as notebook, falling back to text editor:", error);
        // Fallback to regular text editor
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
    }
}
