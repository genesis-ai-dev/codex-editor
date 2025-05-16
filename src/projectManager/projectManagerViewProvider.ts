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
import * as fs from "fs";
import { getAuthApi } from "../extension";
import { getNotebookMetadataManager } from "../../src/utils/notebookMetadataManager";
import { SyncManager } from "./syncManager";

const DEBUG_MODE = false; // Set to true to enable debug logging

function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[ProjectManagerViewProvider]", ...args);
    }
}

class ProjectManagerStore {
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

    private listeners: ((state: ProjectManagerState) => void)[] = [];

    getState() {
        return this.preflightState;
    }

    setState(newState: Partial<ProjectManagerState>) {
        this.preflightState = {
            ...this.preflightState,
            ...newState,
        };
        this.notifyListeners();
    }

    setView(view: vscode.WebviewView) {
        this._view = view;
    }

    subscribe(listener: (state: ProjectManagerState) => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    private notifyListeners() {
        this.listeners.forEach((listener) => listener(this.preflightState));
        this._onDidChangeState.fire();
    }

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

            // Load watched folders
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

    async checkRepoHasRemote(): Promise<boolean> {
        try {
            // Get current workspace path
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspacePath) {
                return false;
            }

            // List all remotes
            const remotes = await git.listRemotes({
                fs,
                dir: workspacePath,
            });

            // Send publish status message
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

    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
}

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

export class CustomWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _context: vscode.ExtensionContext;
    private store: ProjectManagerStore;
    private disposables: vscode.Disposable[] = [];
    private frontierApi?: FrontierAPI;
    private metadataWatcher?: vscode.FileSystemWatcher;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this.store = new ProjectManagerStore();

        // Subscribe to state changes to update webview
        this.store.subscribe((state) => {
            if (this._view) {
                this._view.webview.postMessage({
                    command: "stateUpdate",
                    data: state,
                });
            }
        });

        // Register commands and initialize API
        this.registerCommands();
        this.initializeFrontierApi();
        this.setupWorkspaceWatchers();
    }

    private setupWorkspaceWatchers() {
        // Watch for workspace folder changes
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.store.refreshState();
            })
        );

        // Watch for configuration changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration("codex-project-manager")) {
                    this.store.refreshState();
                }
            })
        );

        // Set up metadata watcher if in a workspace
        this.setupMetadataWatcher();
    }

    private async setupMetadataWatcher() {
        if (this.metadataWatcher) {
            this.metadataWatcher.dispose();
        }

        if (vscode.workspace.workspaceFolders?.[0]) {
            const workspaceFolder = vscode.workspace.workspaceFolders[0];

            // Do an initial check for metadata.json
            const metadataPath = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");
            try {
                await vscode.workspace.fs.stat(metadataPath);
                // If we get here, the file exists - refresh state
                await this.store.refreshState();
            } catch {
                // File doesn't exist yet, that's okay
            }

            // Set up the watcher
            this.metadataWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(workspaceFolder, "**/metadata.json")
            );

            this.metadataWatcher.onDidChange(() => this.store.refreshState());
            this.metadataWatcher.onDidCreate(() => this.store.refreshState());
            this.metadataWatcher.onDidDelete(() => this.store.refreshState());

            this.disposables.push(this.metadataWatcher);
        }
    }

    private registerCommands() {
        // No commands to register here - all commands are now registered in the store
    }

    // Update the message handler to use the store's methods
    private async handleMessage(message: ProjectManagerMessageFromWebview) {
        switch (message.command) {
            case "refreshState":
                await this.store.refreshState();
                break;
            case "webviewReady":
                await this.updateProjectOverview();
                await this.updateWebviewState();
                break;
            case "openProject":
                if (message.data?.path) {
                    await openProject(message.data.path);
                    await this.store.refreshState();
                }
                break;
            case "createNewWorkspaceAndProject":
                await createNewWorkspaceAndProject();
                break;
            case "openProjectSettings":
            case "renameProject":
            case "editAbbreviation":
            case "changeSourceLanguage":
            case "changeTargetLanguage":
            case "setValidationCount":
            case "downloadSourceText":
            case "openAISettings":
            case "openSourceUpload":
            case "toggleSpellcheck":
            case "openExportView":
            case "openLicenseSettings":
                await vscode.commands.executeCommand(`codex-project-manager.${message.command}`);
                await this.store.refreshState();
                // Send a response back to the webview
                this._view?.webview.postMessage({ command: "actionCompleted" });
                break;
            case "selectCategory":
                // For backward compatibility, redirect to setValidationCount
                await vscode.commands.executeCommand("codex-project-manager.setValidationCount");
                await this.store.refreshState();
                // Send a response back to the webview
                this._view?.webview.postMessage({ command: "actionCompleted" });
                break;
            case "openEditAnalysis":
                await vscode.commands.executeCommand("codex-editor-extension.analyzeEdits");
                break;
            case "initializeProject":
                console.log("initializeProject");
                this.store.setState({ isInitializing: true });
                try {
                    await createNewProject();

                    // Wait for metadata to be initialized
                    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri;
                    if (workspacePath) {
                        const metadataPath = vscode.Uri.joinPath(workspacePath, "metadata.json");

                        // Wait for the metadata file to exist
                        let attempts = 0;
                        while (attempts < 10) {
                            try {
                                await vscode.workspace.fs.stat(metadataPath);
                                // If we get here, the file exists
                                break;
                            } catch {
                                await new Promise((resolve) => setTimeout(resolve, 100));
                                attempts++;
                            }
                        }

                        // Now that metadata exists, refresh state
                        await this.store.refreshState();
                        await this.updateProjectOverview();
                    }
                } catch (error) {
                    console.error("Error during project initialization:", error);
                    this.store.setState({ isInitializing: false });
                    throw error;
                }
                break;
            case "openBible":
                simpleOpen(message.data.path, this._context);
                break;
            case "selectprimarySourceText":
                await this.setprimarySourceText(message.data);
                break;
            case "closeProject":
                try {
                    const answer = await vscode.window.showWarningMessage(
                        "Are you sure you want to close this project?",
                        { modal: true },
                        "Yes",
                        "No"
                    );

                    if (answer === "Yes") {
                        await vscode.commands.executeCommand("workbench.action.closeFolder");
                    }
                } catch (error) {
                    console.error("Error closing project:", error);
                    vscode.window.showErrorMessage(
                        `Failed to close project: ${(error as Error).message}`
                    );
                }
                break;
            case "checkPublishStatus":
                try {
                    await this.checkRepoHasRemote();
                } catch (error) {
                    console.error("Error checking publish status:", error);
                    this.store.setState({ repoHasRemote: false });
                }
                break;
            case "publishProject": {
                const projectName = this.store.getState().projectOverview?.projectName || "";
                const projectId = this.store.getState().projectOverview?.projectId || "";

                if (!projectName) {
                    vscode.window.showErrorMessage("No project name found");
                    return;
                }

                const sanitizedName = `${projectName}-${projectId}`
                    .toLowerCase()
                    .replace(/[^a-z0-9._-]/g, "-")
                    .replace(/^-+|-+$/g, "")
                    .replace(/\.git$/i, "");

                await this.frontierApi?.publishWorkspace({
                    name: sanitizedName,
                    visibility: "private",
                });
                break;
            }
            case "syncProject": {
                console.log("Syncing project");
                const syncManager = SyncManager.getInstance();
                await syncManager.executeSync("Syncing project");
                break;
            }
            case "getSyncSettings": {
                const config = vscode.workspace.getConfiguration("codex-project-manager");
                const autoSyncEnabled = config.get<boolean>("autoSyncEnabled", true);
                const syncDelayMinutes = config.get<number>("syncDelayMinutes", 5);

                if (this._view) {
                    this._view.webview.postMessage({
                        command: "syncSettingsUpdate",
                        data: {
                            autoSyncEnabled,
                            syncDelayMinutes,
                        },
                    } as ProjectManagerMessageToWebview);
                }
                break;
            }
            case "updateSyncSettings": {
                const { autoSyncEnabled, syncDelayMinutes } = message.data;
                const config = vscode.workspace.getConfiguration("codex-project-manager");

                // Update configuration
                await config.update(
                    "autoSyncEnabled",
                    autoSyncEnabled,
                    vscode.ConfigurationTarget.Workspace
                );

                await config.update(
                    "syncDelayMinutes",
                    syncDelayMinutes,
                    vscode.ConfigurationTarget.Workspace
                );

                // Notify SyncManager about the changes
                const syncManager = SyncManager.getInstance();
                syncManager.updateFromConfiguration();

                break;
            }
            case "triggerSync": {
                const syncManager = SyncManager.getInstance();
                await syncManager.executeSync("Manual sync triggered from project view");
                break;
            }
            case "openBookNameEditor":
                await vscode.commands.executeCommand("codex-project-manager.openBookNameEditor");
                await this.store.refreshState();
                this._view?.webview.postMessage({ command: "actionCompleted" });
                break;
            case "openCellLabelImporter":
                await vscode.commands.executeCommand("codex-editor.openCellLabelImporter");
                break;
            case "navigateToMainMenu": {
                try {
                    await vscode.commands.executeCommand("codex-editor.navigateToMainMenu");
                } catch (error) {
                    console.error("Error navigating to main menu:", error);
                }
                break;
            }
            default:
                console.error(`Unknown command: ${message.command}`, { message });
        }
    }

    async resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        this.store.setView(webviewView);

        // Load HTML and initialize store immediately
        loadWebviewHtml(webviewView, this._context.extensionUri);
        await this.store.initialize();

        // Set initial state and mark webview as ready
        this.store.setState({ webviewReady: true });
        const initialState = this.store.getState();
        webviewView.webview.postMessage({
            command: "stateUpdate",
            data: initialState,
        } as ProjectManagerMessageToWebview);

        // Set up message handling
        webviewView.webview.onDidReceiveMessage(
            async (message: ProjectManagerMessageFromWebview) => {
                console.log("message", { message }, JSON.stringify({ message }, null, 4));
                try {
                    await this.handleMessage(message);
                } catch (error) {
                    console.error("Error handling message:", error);
                    webviewView.webview.postMessage({
                        command: "error",
                        message: `Failed to handle action: ${(error as Error).message}`,
                    });
                }
            }
        );

        // Clean up on dispose
        webviewView.onDidDispose(() => {
            this.disposables.forEach((d) => d.dispose());
        });
    }

    private async updateProjectOverview() {
        try {
            const newProjectOverview = await getProjectOverview();
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const primarySourceText = config.get("primarySourceText");

            // Update the store state with the new project overview
            this.store.setState({
                projectOverview: newProjectOverview
                    ? {
                          ...newProjectOverview,
                          primarySourceText: primarySourceText as vscode.Uri,
                      }
                    : null,
                isInitializing: false, // Make sure to reset initialization state
                isScanning: false,
            });

            // Explicitly send state update to the webview
            if (this._view) {
                const state = this.store.getState();
                this._view.webview.postMessage({
                    command: "stateUpdate",
                    data: state,
                } as ProjectManagerMessageToWebview);
            }
        } catch (error) {
            console.error("Error updating project overview:", error);
            this.store.setState({ isInitializing: false, isScanning: false });
            if (this._view) {
                this._view.webview.postMessage({
                    command: "error",
                    message: "Failed to load project overview. Please try again.",
                });
            }
        }
    }

    private async setprimarySourceText(biblePath: string) {
        try {
            await vscode.workspace
                .getConfiguration("codex-project-manager")
                .update("primarySourceText", biblePath, vscode.ConfigurationTarget.Workspace);
            // Force an update immediately after setting the primary source Bible
            await this.updateProjectOverview();
        } catch (error) {
            console.error("Error setting primary source Bible:", error);
            this._view?.webview.postMessage({
                command: "error",
                message: "Failed to set primary source Bible. Please try again.",
            });
        }
    }

    private async refreshProjects() {
        this.store.setState({ isScanning: true });
        const projects = await findAllCodexProjects();
        this.store.setState({
            projects,
            isScanning: false,
        });
    }

    private async updateWebviewState() {
        if (this._view) {
            const state = this.store.getState();
            this._view.webview.postMessage({
                command: "stateUpdate",
                data: state,
            } as ProjectManagerMessageToWebview);
        }
    }

    private async initializeFrontierApi() {
        try {
            this.frontierApi = getAuthApi();
        } catch (error) {
            console.error("Error initializing Frontier API:", error);
        }
    }

    private async checkRepoHasRemote(): Promise<boolean> {
        return this.store.checkRepoHasRemote();
    }
}

export function registerProjectManagerViewWebviewProvider(context: vscode.ExtensionContext) {
    const provider = new CustomWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("project-manager-sidebar", provider)
    );
}
