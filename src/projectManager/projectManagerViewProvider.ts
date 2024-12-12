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

const DEBUG_MODE = false; // Set to true to enable debug logging

function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[ProjectManagerViewProvider]", ...args);
    }
}

class ProjectManagerStore {
    private state: ProjectManagerState = {
        projectOverview: null,
        webviewReady: false,
        watchedFolders: [],
        projects: null,
        isScanning: false,
        canInitializeProject: false,
        workspaceIsOpen: false,
        repoHasRemote: false,
    };

    private initialized = false;

    private listeners: ((state: ProjectManagerState) => void)[] = [];

    getState() {
        return this.state;
    }

    setState(newState: Partial<ProjectManagerState>) {
        this.state = {
            ...this.state,
            ...newState,
        };
        this.notifyListeners();
    }

    subscribe(listener: (state: ProjectManagerState) => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    private notifyListeners() {
        this.listeners.forEach((listener) => listener(this.state));
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Load watched folders first
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            let watchedFolders = config.get<string[]>("watchedFolders") || [];

            // Add workspace folder and its parent if they exist and aren't already watched
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

            // Initial scan for projects
            this.setState({ isScanning: true });
            const projects = await findAllCodexProjects();

            // Update state with everything we've gathered
            this.setState({
                watchedFolders,
                projects,
                isScanning: false,
            });

            // Load project overview if we're in a workspace
            if (vscode.workspace.workspaceFolders) {
                const hasMetadata = await checkIfMetadataAndGitIsInitialized();
                if (hasMetadata) {
                    const overview = await getProjectOverview();
                    const primarySourceText = config.get("primarySourceText");

                    this.setState({
                        projectOverview: overview
                            ? {
                                  ...overview,
                                  primarySourceText: primarySourceText as vscode.Uri,
                              }
                            : null,
                    });
                }
            }

            this.initialized = true;
        } catch (error) {
            console.error("Failed to initialize store:", error);
            this.setState({ isScanning: false });
            throw error;
        }
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
    private refreshInterval: ReturnType<typeof setInterval> | null = null;
    private frontierApi?: FrontierAPI;
    private async initializeFrontierApi() {
        try {
            this.frontierApi = getAuthApi();
        } catch (error) {
            console.error("Error initializing Frontier API:", error);
        }
    }

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

        // Register commands when provider is created
        this.registerCommands();
        this.initializeFrontierApi();
    }

    private registerCommands() {
        // Register all webview-related commands
        this._context.subscriptions.push(
            vscode.commands.registerCommand("codex-project-manager.openProject", async (args) => {
                try {
                    if (!args?.path) {
                        throw new Error("No project path provided");
                    }

                    // Open the folder in a new window
                    await vscode.commands.executeCommand(
                        "vscode.openFolder",
                        vscode.Uri.file(args.path),
                        { forceNewWindow: true }
                    );

                    // Update project history
                    const config = vscode.workspace.getConfiguration("codex-project-manager");
                    const projectHistory =
                        config.get<Record<string, string>>("projectHistory") || {};
                    projectHistory[args.path] = new Date().toISOString();

                    await config.update(
                        "projectHistory",
                        projectHistory,
                        vscode.ConfigurationTarget.Global
                    );

                    await this.refreshState();
                } catch (error) {
                    console.error("Error opening project:", error);
                    vscode.window.showErrorMessage(
                        `Failed to open project: ${(error as Error).message}`
                    );
                }
            }),

            // Add other commands as needed
            vscode.commands.registerCommand("codex-project-manager.refreshProjects", () => {
                return this.refreshProjects();
            }),

            vscode.commands.registerCommand("codex-project-manager.addWatchFolder", () => {
                return this.addWatchFolder();
            }),

            vscode.commands.registerCommand("codex-project-manager.removeWatchFolder", (args) => {
                if (args?.path) {
                    return this.removeWatchFolder(args.path);
                }
            })
        );
    }

    // Update the message handler to use the registered commands
    private async handleMessage(message: ProjectManagerMessageFromWebview) {}

    async resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        loadWebviewHtml(webviewView, this._context.extensionUri);

        // Initialize store first
        await this.store.initialize();

        // Set up message handling
        const messageHandler = async (message: any) => {
            if (message.command === "webviewReady") {
                this.store.setState({ webviewReady: true });

                // Send initial state immediately after webview is ready
                const state = this.store.getState();
                webviewView.webview.postMessage({
                    type: "stateUpdate",
                    state: state,
                });
            }
        };

        webviewView.webview.onDidReceiveMessage(
            async (message: ProjectManagerMessageFromWebview) => {
                console.log("message", { message }, JSON.stringify({ message }, null, 4));
                try {
                    switch (message.command) {
                        case "openProject":
                            await openProject(message.data.path);
                            break;
                        case "refreshProjects":
                            await vscode.commands.executeCommand(
                                "codex-project-manager.refreshProjects"
                            );
                            break;
                        case "addWatchFolder":
                            await vscode.commands.executeCommand(
                                "codex-project-manager.addWatchFolder"
                            );
                            break;
                        case "removeWatchFolder":
                            await vscode.commands.executeCommand(
                                "codex-project-manager.removeWatchFolder",
                                {
                                    path: message.data.path,
                                }
                            );
                            break;
                        case "requestProjectOverview":
                            await this.updateProjectOverview();
                            break;
                        case "createNewWorkspaceAndProject":
                            await createNewWorkspaceAndProject();
                            break;
                        case "openProjectSettings":
                        case "renameProject":
                        case "editAbbreviation":
                        case "changeSourceLanguage":
                        case "changeTargetLanguage":
                        case "selectCategory":
                        case "downloadSourceText":
                        case "openAISettings":
                        case "openSourceUpload":
                            await this.handleProjectChange(message.command);
                            // FIXME: sometimes this refreshes before the command is finished. Need to return values on all of them
                            // Send a response back to the webview
                            this._view?.webview.postMessage({ command: "actionCompleted" });
                            break;
                        case "initializeProject":
                            console.log("initializeProject");
                            await createNewProject();
                            break;
                        case "exportProjectAsPlaintext":
                            await vscode.commands.executeCommand(
                                "codex-editor-extension.exportCodexContent"
                            );
                            break;
                        case "openBible":
                            // vscode.window.showInformationMessage(
                            //     `Opening source text: ${JSON.stringify(message)}`
                            // );
                            simpleOpen(message.data.path, this._context);
                            break;
                        case "webviewReady":
                            break;
                        case "selectprimarySourceText":
                            await this.setprimarySourceText(message.data);
                            break;
                        case "refreshState":
                            await this.updateWebviewState();
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
                                    await vscode.commands.executeCommand(
                                        "workbench.action.closeWindow"
                                    );
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
                        case "publishProject":
                            await this.frontierApi?.publishWorkspace({
                                name: "test",
                                // description: "test",
                                // language: "en",
                                // targetLanguage: "es",
                                visibility: "private",
                            });
                            break;
                        default:
                            console.error(`Unknown command: ${message.command}`, { message });
                    }
                } catch (error) {
                    console.error("Error handling message:", error);
                    webviewView.webview.postMessage({
                        command: "error",
                        message: `Failed to handle action: ${(error as Error).message}`,
                    });
                }
            }
        );

        webviewView.webview.onDidReceiveMessage(messageHandler);

        // Start polling when webview becomes visible
        this.startPolling();

        // Stop polling when webview is disposed
        webviewView.onDidDispose(() => {
            this.stopPolling();
        });
    }

    private async updateProjectOverview() {
        try {
            const newProjectOverview = await getProjectOverview();
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const primarySourceText = config.get("primarySourceText");

            this.store.setState({
                projectOverview: newProjectOverview
                    ? {
                          ...newProjectOverview,
                          primarySourceText: primarySourceText as vscode.Uri,
                      }
                    : null,
            });

            // Explicitly send state update
            if (this._view) {
                const state = this.store.getState();
                this._view.webview.postMessage({
                    type: "stateUpdate",
                    state: state,
                });
            }
        } catch (error) {
            console.error("Error updating project overview:", error);
            this._view?.webview.postMessage({
                command: "error",
                message: "Failed to load project overview. Please try again.",
            });
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

    private async addWatchFolder() {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: "Select Folder to Watch",
        });

        if (folderUri && folderUri[0]) {
            const config = vscode.workspace.getConfiguration("codex-project-manager");
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
                this.store.setState({
                    watchedFolders: updatedFolders,
                    isScanning: true,
                });

                const projects = await findAllCodexProjects();
                this.store.setState({
                    projects,
                    isScanning: false,
                });
            }
        }
    }

    private async removeWatchFolder(path: string) {
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const watchedFolders = config.get<string[]>("watchedFolders") || [];
        const updatedFolders = watchedFolders.filter((f) => f !== path);
        await config.update("watchedFolders", updatedFolders, vscode.ConfigurationTarget.Global);

        // Update state and rescan projects
        this.store.setState({
            watchedFolders: updatedFolders,
            isScanning: true,
        });

        const projects = await findAllCodexProjects();
        this.store.setState({
            projects,
            isScanning: false,
        });
    }

    private async refreshProjects() {
        this.store.setState({ isScanning: true });
        const projects = await findAllCodexProjects();
        this.store.setState({
            projects,
            isScanning: false,
        });
    }

    private async refreshState() {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const hasWorkspace = workspaceFolders && workspaceFolders.length > 0;
            const hasMetadata = hasWorkspace ? await checkIfMetadataAndGitIsInitialized() : false;

            // Can initialize if we have a workspace but no metadata
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

            this.store.setState({
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
            });
        } catch (error) {
            console.error("Error refreshing state:", error);
            this.store.setState({ isScanning: false });
        }
    }

    // Update command handlers to refresh state after changes
    private async handleProjectChange(command: string) {
        try {
            await vscode.commands.executeCommand(`codex-project-manager.${command}`);
            await this.refreshState();
        } catch (error) {
            console.error(`Error handling ${command}:`, error);
            throw error;
        }
    }

    private startPolling() {
        if (!this.refreshInterval) {
            // Initial refresh
            this.refreshState();

            this.refreshInterval = setInterval(async () => {
                if (this._view?.visible) {
                    await this.refreshState();
                }
            }, 10000); // Poll every 10 seconds
        }
    }

    private stopPolling() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
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

    private async checkRepoHasRemote(): Promise<boolean> {
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

            // Update store with remote status
            this.store.setState({
                repoHasRemote: remotes.length > 0,
            });

            return remotes.length > 0;
        } catch (error) {
            console.error("Error checking repo remotes:", error);
            return false;
        }
    }
}

export function registerProjectManagerViewWebviewProvider(context: vscode.ExtensionContext) {
    const provider = new CustomWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("project-manager-sidebar", provider)
    );

    // Show the sidebar when loading - which includes the button to create a new project
    vscode.commands.executeCommand("project-manager-sidebar.focus");
}
