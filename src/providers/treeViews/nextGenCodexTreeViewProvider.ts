import * as vscode from "vscode";
import * as path from "path";
import { CodexContentSerializer } from "../../serializer";
import bibleData from "../../../webviews/codex-webviews/src/assets/bible-books-lookup.json";

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

interface BibleBookInfo {
    name: string;
    abbr: string;
    ord: string;
    testament: string;
    osisId: string;
}

export interface NextGenCodexItem {
    uri: vscode.Uri;
    label: string;
    type: CodexTreeItemType;
    children?: NextGenCodexItem[];
    corpusMarker?: string;
    progress?: number;
    sortOrder?: string;
}

export class NextGenCodexTreeViewProvider implements vscode.TreeDataProvider<NextGenCodexItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<NextGenCodexItem | undefined>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private codexItems: NextGenCodexItem[] = [];
    private dictionaryItems: NextGenCodexItem[] = [];
    private disposables: vscode.Disposable[] = [];
    private isBuilding = false;
    private serializer = new CodexContentSerializer();
    private bibleBookMap: Map<string, BibleBookInfo> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        this.initBibleBookMap();
        this.buildInitialData();
        this.registerWatchers();
    }

    private initBibleBookMap(): void {
        (bibleData as any[]).forEach((book) => {
            this.bibleBookMap.set(book.abbr, {
                name: book.name,
                abbr: book.abbr,
                ord: book.ord,
                testament: book.testament,
                osisId: book.osisId,
            });
        });
    }

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

                    progress.report({ message: "Organizing by corpus...", increment: 20 });
                    const groupedItems = this.groupByCorpus(codexItemsWithMetadata);
                    this.codexItems = groupedItems;

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

            const totalCells = notebookData.cells.length;
            const cellsWithValues = notebookData.cells.filter(
                (cell) => cell.value && cell.value.trim().length > 0
            ).length;
            const progress = totalCells > 0 ? (cellsWithValues / totalCells) * 100 : 0;

            const isBibleBook = this.bibleBookMap.has(fileName);
            let label = fileName;
            let sortOrder: string | undefined;

            if (isBibleBook) {
                const bookInfo = this.bibleBookMap.get(fileName);
                if (bookInfo) {
                    label = bookInfo.name;
                    sortOrder = bookInfo.ord;
                }
            } else {
                label = `${fileName} Codex`;
            }

            return {
                uri,
                label,
                type: "codexDocument",
                corpusMarker: metadata?.corpusMarker,
                progress: progress,
                sortOrder,
            };
        } catch (error) {
            console.warn(`Failed to read metadata for ${uri.fsPath}:`, error);
            return this.makeCodexItem(uri);
        }
    }

    private groupByCorpus(items: NextGenCodexItem[]): NextGenCodexItem[] {
        const corpusGroups = new Map<string, NextGenCodexItem[]>();
        const ungroupedItems: NextGenCodexItem[] = [];

        items.forEach((item) => {
            if (item.corpusMarker) {
                let corpusMarker = item.corpusMarker;
                if (corpusMarker === "Old Testament") corpusMarker = "OT";
                if (corpusMarker === "New Testament") corpusMarker = "NT";

                const group = corpusGroups.get(corpusMarker) || [];
                group.push(item);
                corpusGroups.set(corpusMarker, group);
            } else {
                ungroupedItems.push(item);
            }
        });

        const groupedItems: NextGenCodexItem[] = [];
        corpusGroups.forEach((items, corpusMarker) => {
            const totalProgress = items.reduce((sum, item) => sum + (item.progress || 0), 0);
            const averageProgress = items.length > 0 ? totalProgress / items.length : 0;

            let sortedItems: NextGenCodexItem[];

            if (corpusMarker === "OT" || corpusMarker === "NT") {
                sortedItems = items.sort((a, b) => {
                    if (a.sortOrder && b.sortOrder) {
                        return a.sortOrder.localeCompare(b.sortOrder);
                    }
                    return a.label.localeCompare(b.label);
                });
            } else {
                sortedItems = items.sort((a, b) => a.label.localeCompare(b.label));
            }

            let corpusDisplayName = corpusMarker;
            if (corpusMarker === "OT") corpusDisplayName = "Old Testament";
            if (corpusMarker === "NT") corpusDisplayName = "New Testament";

            groupedItems.push({
                uri: items[0].uri,
                label: corpusDisplayName,
                type: "corpus",
                children: sortedItems,
                progress: averageProgress,
            });
        });

        return [
            ...groupedItems.sort((a, b) => {
                if (a.label === "Old Testament") return -1;
                if (b.label === "Old Testament") return 1;
                if (a.label === "New Testament") return -1;
                if (b.label === "New Testament") return 1;

                return a.label.localeCompare(b.label);
            }),
            ...ungroupedItems,
        ];
    }

    private makeCodexItem(uri: vscode.Uri): NextGenCodexItem {
        const fileName = path.basename(uri.fsPath, ".codex");

        if (this.bibleBookMap.has(fileName)) {
            const bookInfo = this.bibleBookMap.get(fileName);
            if (bookInfo) {
                return {
                    uri,
                    label: bookInfo.name,
                    type: "codexDocument",
                    sortOrder: bookInfo.ord,
                };
            }
        }

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
            if (element.progress !== undefined) {
                treeItem.tooltip = `${element.label}\nAverage Progress: ${Math.round(element.progress)}%`;
            }
        }

        return treeItem;
    }

    public getChildren(element?: NextGenCodexItem): Thenable<NextGenCodexItem[]> {
        if (element) {
            if (element.children) {
                return Promise.resolve(element.children);
            }
            return Promise.resolve([]);
        }

        const topLevel = [...this.codexItems, ...this.dictionaryItems];
        return Promise.resolve(topLevel);
    }

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

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
}

export async function openCodexFile(uri: vscode.Uri) {
    try {
        await vscode.commands.executeCommand("vscode.openWith", uri, "codex.cellEditor");
    } catch (error) {
        console.warn("Failed to open as notebook, falling back to text editor:", error);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
    }
}
