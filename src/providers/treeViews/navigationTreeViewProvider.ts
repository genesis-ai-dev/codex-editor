import * as vscode from "vscode";
import { debounce } from "lodash";
import { getWorkSpaceUri } from "../../utils/index";
import { vrefData } from "../../utils/verseRefUtils/verseData";
import { basename, dirname } from "path";
import { CustomNotebookMetadata } from "../../../types";
import { NotebookMetadataManager } from "../../utils/notebookMetadataManager";
import * as path from "path";

export interface CodexNode {
    resource: vscode.Uri;
    type: "corpus" | "document" | "section" | "cell";
    label: string;
    cellId?: string;
    sourceFileUri?: vscode.Uri;
}

export class CodexModel {
    private notebookMetadataManager: NotebookMetadataManager;

    constructor(private workspaceRoot: string | undefined) {
        this.notebookMetadataManager = NotebookMetadataManager.getInstance();
    }

    public async getRoots(): Promise<CodexNode[]> {
        if (!this.workspaceRoot) {
            return [];
        }
        return this.getNotebooksByCorpus();
    }

    public async getChildren(node: CodexNode): Promise<CodexNode[]> {
        if (node.type === "corpus") {
            return this.getNotebooksForCorpus(node.label);
        } else if (node.type === "document") {
            return this.getSectionsForNotebook(node.resource);
        }
        return [];
    }

    private async getNotebooksByCorpus(): Promise<CodexNode[]> {
        const corpora: Record<string, CodexNode> = {};
        const ungroupedNotebooks: CodexNode[] = [];

        for (const metadata of this.notebookMetadataManager.getAllMetadata()) {
            if (!metadata.codexFsPath) continue;

            const fileName = basename(metadata.codexFsPath);
            const fileNameWithoutExtension = fileName.slice(0, -6);
            const notebookUri = vscode.Uri.file(metadata.codexFsPath);

            const bookData = vrefData[fileNameWithoutExtension];
            if (bookData) {
                const testament = bookData.testament === "OT" ? "Old Testament" : "New Testament";
                if (!corpora[testament]) {
                    corpora[testament] = {
                        resource: vscode.Uri.parse(`codex-corpus:${testament}`),
                        type: "corpus",
                        label: testament,
                    };
                }
            } else if (metadata.corpusMarker) {
                if (!corpora[metadata.corpusMarker]) {
                    corpora[metadata.corpusMarker] = {
                        resource: vscode.Uri.parse(`codex-corpus:${metadata.corpusMarker}`),
                        type: "corpus",
                        label: metadata.corpusMarker,
                    };
                }
            } else {
                ungroupedNotebooks.push({
                    resource: notebookUri,
                    type: "document",
                    label: fileNameWithoutExtension,
                    sourceFileUri: metadata.sourceFsPath
                        ? vscode.Uri.file(metadata.sourceFsPath)
                        : undefined,
                });
            }
        }

        return [...Object.values(corpora), ...ungroupedNotebooks];
    }

    private async getNotebooksForCorpus(corpus: string): Promise<CodexNode[]> {
        const notebooks: CodexNode[] = [];

        for (const metadata of this.notebookMetadataManager.getAllMetadata()) {
            if (!metadata.codexFsPath) continue;

            const fileName = basename(metadata.codexFsPath);
            const fileNameWithoutExtension = fileName.slice(0, -6);
            const notebookUri = vscode.Uri.file(metadata.codexFsPath);

            const bookData = vrefData[fileNameWithoutExtension];
            const testament = bookData?.testament === "OT" ? "Old Testament" : "New Testament";

            if (testament === corpus || metadata.corpusMarker === corpus) {
                notebooks.push({
                    resource: notebookUri,
                    type: "document",
                    label: fileNameWithoutExtension,
                    sourceFileUri: metadata.sourceFsPath
                        ? vscode.Uri.file(metadata.sourceFsPath)
                        : undefined,
                });
            }
        }

        return notebooks.sort((a, b) => {
            const aOrd = Number(vrefData[a.label]?.ord) || Infinity;
            const bOrd = Number(vrefData[b.label]?.ord) || Infinity;
            return aOrd - bOrd;
        });
    }

    private async getSectionsForNotebook(notebookUri: vscode.Uri): Promise<CodexNode[]> {
        try {
            const notebookContentUint8Array = await vscode.workspace.fs.readFile(notebookUri);
            const notebookContent = new TextDecoder().decode(notebookContentUint8Array);
            const notebookJson = JSON.parse(notebookContent);
            const metadata = notebookJson?.metadata as CustomNotebookMetadata;

            const headings = this.extractHeadingsFromNotebook(notebookJson);

            return headings.map((heading) => ({
                resource: vscode.Uri.parse(`${notebookUri.toString()}#${heading.cellId}`),
                type: "section",
                label: heading.text,
                cellId: heading.cellId,
                sourceFileUri: metadata.sourceFsPath
                    ? vscode.Uri.file(metadata.sourceFsPath)
                    : undefined,
            }));
        } catch (error) {
            console.error(`Error getting sections for notebook ${notebookUri.fsPath}:`, error);
            return [];
        }
    }

    private extractHeadingsFromNotebook(notebookJson: any): any[] {
        const headings: any[] = [];

        if (!Array.isArray(notebookJson.cells)) return headings;

        notebookJson.cells.forEach((cell: any) => {
            const content = cell.value;
            const regex = /<h([1-6])>(.*?)<\/h\1>/g;
            let match;

            while ((match = regex.exec(content)) !== null) {
                headings.push({
                    level: parseInt(match[1], 10),
                    text: match[2],
                    cellId: cell.metadata?.id || "",
                });
            }
        });

        return headings;
    }
}

// export class CodexTreeDataProvider implements vscode.TreeDataProvider<CodexNode> {
//     private _onDidChangeTreeData: vscode.EventEmitter<CodexNode | undefined | null | void> =
//         new vscode.EventEmitter<CodexNode | undefined | null | void>();
//     readonly onDidChangeTreeData: vscode.Event<CodexNode | undefined | null | void> =
//         this._onDidChangeTreeData.event;

//     readonly workspaceRoot: vscode.Uri | undefined;

//     constructor(private readonly model: CodexModel) {
//         this.workspaceRoot = getWorkSpaceUri();
//     }

//     public refresh(): void {
//         this._onDidChangeTreeData.fire();
//     }

//     public getTreeItem(element: CodexNode): vscode.TreeItem {
//         if (this.workspaceRoot) {
//             return {
//                 resourceUri: element.resource,
//                 label: element.label,
//                 collapsibleState:
//                     element.type !== "cell"
//                         ? vscode.TreeItemCollapsibleState.Collapsed
//                         : vscode.TreeItemCollapsibleState.None,
//                 contextValue: element.type,
//                 command:
//                     element.type === "document" || element.type === "section"
//                         ? {
//                               command: "codexNotebookTreeView.openSection",
//                               title: "Open Section",
//                               arguments: [
//                                   element.sourceFile
//                                       ? vscode.Uri.file(
//                                             path.join(
//                                                 this.workspaceRoot.fsPath,
//                                                 element.resource.fsPath
//                                             )
//                                         )
//                                       : element.resource,
//                                   element.cellId,
//                               ],
//                           }
//                         : undefined,
//                 iconPath: element.type === "document" ? new vscode.ThemeIcon("book") : undefined,
//             };
//         }
//         return {
//             label: element.label,
//         };
//     }

//     public getChildren(element?: CodexNode): Thenable<CodexNode[]> {
//         if (element) {
//             return this.model.getChildren(element);
//         } else {
//             return this.model.getRoots();
//         }
//     }

//     public getParent(element: CodexNode): vscode.ProviderResult<CodexNode> {
//         const parentPath = dirname(element.resource.path);
//         if (parentPath === "/") {
//             return undefined;
//         }
//         return {
//             resource: element.resource.with({ path: parentPath }),
//             type: "corpus",
//             label: basename(parentPath),
//         };
//     }
// }

export class CodexNotebookTreeViewProvider
    implements vscode.TreeDataProvider<CodexNode>, vscode.Disposable
{
    private _onDidChangeTreeData: vscode.EventEmitter<CodexNode | undefined | null | void> =
        new vscode.EventEmitter<CodexNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CodexNode | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private codexViewer: vscode.TreeView<CodexNode>;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private debouncedRefresh: () => void;
    private model: CodexModel;

    constructor(
        private workspaceRoot: string | undefined,
        context: vscode.ExtensionContext
    ) {
        this.model = new CodexModel(workspaceRoot);

        this.codexViewer = vscode.window.createTreeView("codexNotebookTreeView", {
            treeDataProvider: this,
            showCollapseAll: true,
        });

        this.debouncedRefresh = debounce(() => this.refresh(), 1000, { maxWait: 5000 });

        if (this.workspaceRoot) {
            const pattern = new vscode.RelativePattern(
                this.workspaceRoot,
                "**/files/target/**/*.codex"
            );

            this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

            this.fileWatcher.onDidCreate((uri) => this.onFileChanged(uri));
            this.fileWatcher.onDidChange((uri) => this.onFileChanged(uri));
            this.fileWatcher.onDidDelete((uri) => this.onFileDeleted(uri));

            console.log("File watcher initialized");
        }
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    public getTreeItem(element: CodexNode): vscode.TreeItem {
        return {
            resourceUri: element.resource,
            label: element.label,
            collapsibleState:
                element.type !== "cell"
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
            contextValue: element.type,
            command:
                element.type === "document" || element.type === "section"
                    ? {
                          command: "codexNotebookTreeView.openSection",
                          title: "Open Section",
                          arguments: [element.resource, element.cellId],
                      }
                    : undefined,
            iconPath: element.type === "document" ? new vscode.ThemeIcon("book") : undefined,
        };
    }

    public getChildren(element?: CodexNode): Thenable<CodexNode[]> {
        if (element) {
            return this.model.getChildren(element);
        } else {
            return this.model.getRoots();
        }
    }

    public getParent(element: CodexNode): vscode.ProviderResult<CodexNode> {
        const parentPath = dirname(element.resource.path);
        if (parentPath === "/") {
            return undefined;
        }
        return {
            resource: element.resource.with({ path: parentPath }),
            type: "corpus",
            label: basename(parentPath),
        };
    }

    private onFileChanged(uri: vscode.Uri): void {
        this.debouncedRefresh();
    }

    private onFileDeleted(uri: vscode.Uri): void {
        this.debouncedRefresh();
    }

    private openResource(resource: vscode.Uri, cellId?: string): void {
        vscode.commands.executeCommand("vscode.open", resource, {
            selection: cellId ? [0, 0, 0, 0] : undefined,
        });
    }

    public dispose(): void {
        this.fileWatcher?.dispose();
        this.codexViewer.dispose();
    }
}
