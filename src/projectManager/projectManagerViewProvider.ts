import * as vscode from "vscode";
import {
    ProjectManagerMessageFromWebview,
    ProjectManagerMessageToWebview,
    ProjectManagerState,
    ProjectOverview,
} from "../../types";
import {
    getProjectOverview,
    initializeProjectMetadataAndGit,
    findAllCodexProjects,
    checkIfMetadataAndGitIsInitialized,
    stageAndCommitAllAndSync,
} from "./utils/projectUtils";

import {
    createNewWorkspaceAndProject,
    openProject,
    createNewProject,
} from "../utils/projectCreationUtils/projectCreationUtils";
import { FrontierAPI } from "webviews/codex-webviews/src/StartupFLow/types";
import { waitForExtensionActivation } from "../utils/vscode";
import git from "isomorphic-git";
import { getAuthApi } from "../extension";
import { getNotebookMetadataManager } from "../../src/utils/notebookMetadataManager";
import { SyncManager } from "./syncManager";

class ProjectManagerStore {
    // Initial state for the project manager
    private preflightState: ProjectManagerState = {
        projectOverview: null,
        webviewReady: false,
        watchedFolders: [],
        projects: null,
        isScanning: false,
        canInitializeProject: false,
        workspaceIsOpen: false,
        repoHasRemote: false,
        isInitializing: false,
    };

    private initialized = false;
    private isRefreshing = false;
    private _onDidChangeState = new vscode.EventEmitter<void>();
    public readonly onDidChangeState = this._onDidChangeState.event;
    private metadataManager = getNotebookMetadataManager();
    private disposables: vscode.Disposable[] = [];
    private _view?: vscode.WebviewView;

    // Array to store state change listeners
    private listeners: ((state: ProjectManagerState) => void)[] = [];

    // Get current state
    getState() {
        return this.preflightState;
    }

    // Update state and notify listeners
    setState(newState: Partial<ProjectManagerState>) {
        this.preflightState = {
            ...this.preflightState,
            ...newState,
        };
        this.notifyListeners();
    }

    // Set the webview reference
    setView(view: vscode.WebviewView) {
        this._view = view;
    }

    // Subscribe to state changes
    subscribe(listener: (state: ProjectManagerState) => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    // Notify all listeners of state changes
    private notifyListeners() {
        this.listeners.forEach((listener) => listener(this.preflightState));
        this._onDidChangeState.fire();
    }

    // Initialize the store
    async initialize() {
        if (this.initialized) return;

        try {
            // Initialize metadata manager
            await this.metadataManager.initialize();

            // Register commands
            this.disposables.push(
                vscode.commands.registerCommand(
                    "codex-project-manager.refreshProjects",
                    async () => {
                        await this.refreshState();
                    }
                ),
                vscode.commands.registerCommand(
                    "codex-project-manager.addWatchFolder",
                    async () => {
                        const folderUri = await vscode.window.showOpenDialog({
                            canSelectFolders: true,
                            canSelectFiles: false,
                            canSelectMany: false,
                            openLabel: "Select Folder to Watch",
                        });

                        if (folderUri && folderUri[0]) {
                            const config =
                                vscode.workspace.getConfiguration("codex-project-manager");
                            const watchedFolders = config.get<string[]>("watchedFolders") || [];
                            const newPath = folderUri[0].fsPath;

                            if (!watchedFolders.includes(newPath)) {
                                const updatedFolders = [...watchedFolders, newPath];
                                await config.update(
                                    "watchedFolders",
                                    updatedFolders,
                                    vscode.ConfigurationTarget.Global
                                );

                                // Update state and scan for new projects
                                this.setState({
                                    watchedFolders: updatedFolders,
                                    isScanning: true,
                                });

                                const projects = await findAllCodexProjects();
                                this.setState({
                                    projects,
                                    isScanning: false,
                                });
                            }
                        }
                    }
                ),
                vscode.commands.registerCommand(
                    "codex-project-manager.removeWatchFolder",
                    async (args) => {
                        if (args?.path) {
                            const config =
                                vscode.workspace.getConfiguration("codex-project-manager");
                            const watchedFolders = config.get<string[]>("watchedFolders") || [];
                            const updatedFolders = watchedFolders.filter((f) => f !== args.path);
                            await config.update(
                                "watchedFolders",
                                updatedFolders,
                                vscode.ConfigurationTarget.Global
                            );

                            // Update state and rescan projects
                            this.setState({
                                watchedFolders: updatedFolders,
                                isScanning: true,
                            });

                            const projects = await findAllCodexProjects();
                            this.setState({
                                projects,
                                isScanning: false,
                            });
                        }
                    }
                )
            );

            // Listen for metadata changes
            this.disposables.push(
                this.metadataManager.onDidChangeMetadata(async () => {
                    await this.refreshState();
                })
            );

            // Set up file watchers
            if (vscode.workspace.workspaceFolders?.[0]) {
                const rootUri = vscode.workspace.workspaceFolders[0].uri;

                // Watch for metadata.json changes
                const metadataWatcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(rootUri, "**/metadata.json")
                );

                // Watch for .codex file changes
                const codexWatcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(rootUri, "**/*.codex")
                );

                this.disposables.push(
                    metadataWatcher,
                    codexWatcher,
                    metadataWatcher.onDidChange(() => this.refreshState()),
                    metadataWatcher.onDidCreate(() => this.refreshState()),
                    metadataWatcher.onDidDelete(() => this.refreshState()),
                    codexWatcher.onDidChange(() => this.refreshState()),
                    codexWatcher.onDidCreate(() => this.refreshState()),
                    codexWatcher.onDidDelete(() => this.refreshState())
                );
            }

            // Load watched folders from configuration
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            let watchedFolders = config.get<string[]>("watchedFolders") || [];

            // Add workspace folder and its parent if they exist
            if (vscode.workspace.workspaceFolders?.[0]) {
                const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const parentPath = vscode.Uri.joinPath(
                    vscode.workspace.workspaceFolders[0].uri,
                    ".."
                ).fsPath;

                const pathsToAdd = [workspacePath, parentPath].filter(
                    (path) => !watchedFolders.includes(path)
                );

                if (pathsToAdd.length > 0) {
                    watchedFolders = [...pathsToAdd, ...watchedFolders];
                    await config.update(
                        "watchedFolders",
                        watchedFolders,
                        vscode.ConfigurationTarget.Global
                    );
                }
            }

            // Set initial state before refresh
            this.setState({
                webviewReady: true,
                isScanning: true,
                watchedFolders,
                workspaceIsOpen: Boolean(vscode.workspace.workspaceFolders?.length),
            });

            // Initial state refresh
            await this.refreshState();
            this.initialized = true;
        } catch (error) {
            console.error("Failed to initialize store:", error);
            this.setState({ isScanning: false });
            throw error;
        }
    }

    // Refresh the store's state
    async refreshState() {
        if (this.isRefreshing) return;

        try {
            this.isRefreshing = true;
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const hasWorkspace = workspaceFolders && workspaceFolders.length > 0;
            const hasMetadata = hasWorkspace ? await checkIfMetadataAndGitIsInitialized() : false;

            const canInitializeProject = hasWorkspace && !hasMetadata;
            const workspaceIsOpen = hasWorkspace;

            const [projects, overview, hasRemote] = await Promise.all([
                findAllCodexProjects(),
                hasMetadata ? getProjectOverview() : null,
                this.checkRepoHasRemote(),
            ]);

            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const primarySourceText = config.get("primarySourceText");
            const watchedFolders = config.get<string[]>("watchedFolders") || [];

            this.setState({
                projects,
                watchedFolders,
                projectOverview: overview
                    ? {
                          ...overview,
                          primarySourceText: primarySourceText as vscode.Uri,
                      }
                    : null,
                isScanning: false,
                canInitializeProject,
                workspaceIsOpen,
                repoHasRemote: hasRemote,
                isInitializing: false,
            });
        } catch (error) {
            console.error("Error refreshing state:", error);
            this.setState({ isScanning: false });
        } finally {
            this.isRefreshing = false;
        }
    }

    // Check if repository has a remote using vscode.workspace.fs
    async checkRepoHasRemote(): Promise<boolean> {
        try {
            // Get current workspace path
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (!workspacePath) {
                return false;
            }

            // Create a web-compatible fs implementation using vscode.workspace.fs
            const customFs = {
                promises: {
                    readFile: async (path: string) => {
                        const uri = vscode.Uri.file(path);
                        const data = await vscode.workspace.fs.readFile(uri);
                        return data;
                    },
                    writeFile: async (path: string, data: Uint8Array) => {
                        const uri = vscode.Uri.file(path);
                        await vscode.workspace.fs.writeFile(uri, data);
                    },
                    unlink: async (path: string) => {
                        const uri = vscode.Uri.file(path);
                        await vscode.workspace.fs.delete(uri);
                    },
                    readdir: async (path: string) => {
                        const uri = vscode.Uri.file(path);
                        const entries = await vscode.workspace.fs.readDirectory(uri);
                        return entries.map(([name]) => name);
                    },
                    mkdir: async (path: string) => {
                        const uri = vscode.Uri.file(path);
                        await vscode.workspace.fs.createDirectory(uri);
                    },
                    rmdir: async (path: string) => {
                        const uri = vscode.Uri.file(path);
                        await vscode.workspace.fs.delete(uri);
                    },
                    stat: async (path: string) => {
                        const uri = vscode.Uri.file(path);
                        const stat = await vscode.workspace.fs.stat(uri);
                        return {
                            isFile: () => stat.type === vscode.FileType.File,
                            isDirectory: () => stat.type === vscode.FileType.Directory,
                        };
                    },
                    lstat: async (path: string) => {
                        const uri = vscode.Uri.file(path);
                        const stat = await vscode.workspace.fs.stat(uri);
                        return {
                            isFile: () => stat.type === vscode.FileType.File,
                            isDirectory: () => stat.type === vscode.FileType.Directory,
                        };
                    }
                }
            };

            // List all remotes using isomorphic-git with our custom fs
            const remotes = await git.listRemotes({
                fs: customFs,
                dir: workspacePath.fsPath,
            });

            // Send publish status message to webview
            if (this._view) {
                this._view.webview.postMessage({
                    command: "publishStatus",
                    data: {
                        repoHasRemote: remotes.length > 0,
                    },
                } as ProjectManagerMessageToWebview);
            }

            return remotes.length > 0;
        } catch (error) {
            console.error("Error checking repo remotes:", error);
            return false;
        }
    }

    // Clean up resources
    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }

    // Add the resolveWebviewView method for WebviewViewProvider
    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken) {
        // Use the existing loadWebviewHtml function
        loadWebviewHtml(webviewView, vscode.Uri.file(__dirname));
        this.setView(webviewView);
    }
}

// Helper function to open files
export async function simpleOpen(uri: string, context: vscode.ExtensionContext) {
    try {
        const parsedUri = vscode.Uri.parse(uri);
        if (parsedUri.toString().endsWith(".codex") || parsedUri.toString().endsWith(".source")) {
            vscode.commands.executeCommand("vscode.openWith", parsedUri, "codex.cellEditor");
        } else {
            const document = await vscode.workspace.openTextDocument(parsedUri);
            await vscode.window.showTextDocument(document);
        }
    } catch (error) {
        console.error(`Failed to open file: ${uri}`, error);
    }
}

// Load and configure the webview HTML
const loadWebviewHtml = (webviewView: vscode.WebviewView, extensionUri: vscode.Uri) => {
    webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [extensionUri],
    };

    const styleResetUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "reset.css")
    );
    const styleVSCodeUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "vscode.css")
    );

    const scriptUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "ProjectManagerView",
            "index.js"
        )
    );
    const codiconsUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css")
    );

    // Generate a nonce for CSP
    function getNonce() {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
    const nonce = getNonce();

    const html = /*html*/ `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none';
            img-src ${webviewView.webview.cspSource} https: data:;
            style-src ${webviewView.webview.cspSource} 'unsafe-inline';
            script-src 'nonce-${nonce}';
            font-src ${webviewView.webview.cspSource};
            connect-src ${webviewView.webview.cspSource} https:;">
        <link href="${styleResetUri}" rel="stylesheet">
        <link href="${styleVSCodeUri}" rel="stylesheet">
        <link href="${codiconsUri}" rel="stylesheet" />
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            const apiBaseUrl = ${JSON.stringify(
                process.env.API_BASE_URL || "http://localhost:3002"
            )}
        </script>
    </head>
    <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;

    webviewView.webview.html = html;
};

// Rest of the code remains unchanged...

export function registerProjectManagerViewWebviewProvider(context: vscode.ExtensionContext) {
    // ProjectManagerStore must implement vscode.WebviewViewProvider
    const provider = new ProjectManagerStore();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "codex-project-manager-view",
            provider
        )
    );
}
