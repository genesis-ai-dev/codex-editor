import * as vscode from "vscode";
import { getWorkSpaceFolder, jumpToCellInNotebook } from "../utils";
import { ProjectOverview } from "../../types";
import {
    getProjectOverview,
    initializeProjectMetadata,
    findAllCodexProjects,
    checkIfMetadataIsInitialized,
} from "./utils/projectUtils";
import { SourceUploadProvider } from "../providers/SourceUpload/SourceUploadProvider";
import path from "path";
import * as semver from "semver";

// State management
interface ProjectManagerState {
    projectOverview: ProjectOverview | null;
    webviewReady: boolean;
    watchedFolders: string[];
    projects: Array<{
        name: string;
        path: string;
        lastOpened?: Date;
        lastModified: Date;
        version: string;
        hasVersionMismatch?: boolean;
        isOutdated?: boolean;
    }> | null;
    isScanning: boolean;
}

class ProjectManagerStore {
    private state: ProjectManagerState = {
        projectOverview: null,
        webviewReady: false,
        watchedFolders: [],
        projects: null,
        isScanning: false,
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
                const hasMetadata = await checkIfMetadataIsInitialized();
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
    private async handleMessage(message: any) {
        switch (message.command) {
            case "openProject":
                await vscode.commands.executeCommand(
                    "codex-project-manager.openProject",
                    message.data
                );
                break;
            case "refreshProjects":
                await vscode.commands.executeCommand("codex-project-manager.refreshProjects");
                break;
            case "addWatchFolder":
                await vscode.commands.executeCommand("codex-project-manager.addWatchFolder");
                break;
            case "removeWatchFolder":
                await vscode.commands.executeCommand("codex-project-manager.removeWatchFolder", {
                    path: message.data.path,
                });
                break;
            case "requestProjectOverview":
                await this.updateProjectOverview();
                break;
            // Add these missing cases
            case "createNewWorkspaceAndProject":
                await this.createNewWorkspaceAndProject();
                break;
            case "openProjectSettings":
            case "renameProject":
            case "changeUserName":
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
                await this.createNewProject();
                break;
            case "exportProjectAsPlaintext":
                await vscode.commands.executeCommand("codex-editor-extension.exportCodexContent");
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
            default:
                console.error(`Unknown command: ${message.command}`);
        }
    }

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

        webviewView.webview.onDidReceiveMessage(async (message) => {
            try {
                await this.handleMessage(message);
            } catch (error) {
                console.error("Error handling message:", error);
                webviewView.webview.postMessage({
                    command: "error",
                    message: `Failed to handle action: ${(error as Error).message}`,
                });
            }
        });

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

    private async createNewProject() {
        try {
            // Initialize project metadata
            await initializeProjectMetadata({});

            // Create necessary project files
            await vscode.commands.executeCommand("codex-project-manager.initializeNewProject");

            // Force an update of the project overview
            await this.updateProjectOverview();
        } catch (error) {
            console.error("Error creating new project:", error);
            throw error;
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

    private async createNewWorkspaceAndProject() {
        // First show an info message with instructions
        const choice = await vscode.window.showInformationMessage(
            "Would you like to create a new folder for your project?",
            { modal: true },
            "Create New Folder",
            "Select Existing Empty Folder"
        );

        if (!choice) {
            return;
        }

        if (choice === "Create New Folder") {
            // Show folder picker for parent directory
            const parentFolderUri = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: "Choose Location for New Project Folder",
            });

            if (!parentFolderUri || !parentFolderUri[0]) {
                return;
            }

            // Check if parent folder is inside a project
            const isNestedProject = await this.checkForParentProjects(parentFolderUri[0]);
            if (isNestedProject) {
                await vscode.window.showErrorMessage(
                    "Cannot create a project inside another Codex project. Please choose a different location.",
                    { modal: true }
                );
                return;
            }

            // Prompt for new folder name
            const folderName = await vscode.window.showInputBox({
                prompt: "Enter name for new project folder",
                validateInput: (value) => {
                    if (!value) return "Folder name cannot be empty";
                    if (value.match(/[<>:"/\\|?*]/))
                        return "Folder name contains invalid characters";
                    return null;
                },
            });

            if (!folderName) {
                return;
            }

            // Create the new folder
            const newFolderUri = vscode.Uri.joinPath(parentFolderUri[0], folderName);
            try {
                await vscode.workspace.fs.createDirectory(newFolderUri);
                await vscode.commands.executeCommand("vscode.openFolder", newFolderUri);

                // Wait for workspace to open
                await new Promise((resolve) => setTimeout(resolve, 1000));

                // Initialize the project
                await this.createNewProject();

                // After project is created, force an update of the project overview
                await this.updateProjectOverview();

                // Switch view mode to overview
                this._view?.webview.postMessage({
                    command: "sendProjectOverview",
                    data: await getProjectOverview(),
                });
            } catch (error) {
                console.error("Error creating new project folder:", error);
                await vscode.window.showErrorMessage(
                    "Failed to create new project folder. Please try again.",
                    { modal: true }
                );
            }
        } else {
            // Use existing folder picker logic
            const folderUri = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: "Choose Empty Folder for New Project",
            });

            if (folderUri && folderUri[0]) {
                try {
                    // Check if the selected folder is empty
                    const entries = await vscode.workspace.fs.readDirectory(folderUri[0]);
                    if (entries.length > 0) {
                        await vscode.window.showErrorMessage(
                            "The selected folder must be empty. Please create a new empty folder for your project.",
                            { modal: true }
                        );
                        return;
                    }

                    // Check if the selected folder or any parent folder is a Codex project
                    const isNestedProject = await this.checkForParentProjects(folderUri[0]);
                    if (isNestedProject) {
                        await vscode.window.showErrorMessage(
                            "Cannot create a project inside another Codex project. Please choose a different location.",
                            { modal: true }
                        );
                        return;
                    }

                    await vscode.commands.executeCommand("vscode.openFolder", folderUri[0]);
                    // Wait for workspace to open
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    await this.createNewProject();
                } catch (error) {
                    console.error("Error creating new project:", error);
                    await vscode.window.showErrorMessage(
                        "Failed to create new project. Please try again.",
                        { modal: true }
                    );
                }
            }
        }
    }

    private async checkForParentProjects(folderUri: vscode.Uri): Promise<boolean> {
        let currentPath = folderUri.fsPath;
        const rootPath = path.parse(currentPath).root;

        while (currentPath !== rootPath) {
            try {
                const metadataPath = vscode.Uri.file(path.join(currentPath, "metadata.json"));
                await vscode.workspace.fs.stat(metadataPath);
                // If we find a metadata.json file, this may be a Codex project, but we also need to check
                // the metadata.json file json contents, specifically the meta.generator.softwareName field
                // to see if it is "Codex Editor"
                const metadata = await vscode.workspace.fs.readFile(metadataPath);
                const metadataJson = JSON.parse(Buffer.from(metadata).toString("utf-8"));
                if (metadataJson.meta.generator.softwareName === "Codex Editor") {
                    return true;
                }
            } catch {
                // No metadata.json found at this level, move up one directory
                currentPath = path.dirname(currentPath);
            }
        }
        return false;
    }

    private async openProject(projectPath: string) {
        try {
            const uri = vscode.Uri.file(projectPath);
            const currentVersion =
                vscode.extensions.getExtension("project-accelerate.codex-editor-extension")
                    ?.packageJSON.version || "0.0.0";

            // Verify this is still a valid Codex project
            const metadataPath = vscode.Uri.joinPath(uri, "metadata.json");
            try {
                const metadata = await vscode.workspace.fs.readFile(metadataPath);
                const metadataJson = JSON.parse(Buffer.from(metadata).toString("utf-8"));
                const projectVersion = metadataJson.meta?.generator?.softwareVersion || "0.0.0";

                // Check version compatibility
                if (semver.major(projectVersion) !== semver.major(currentVersion)) {
                    const proceed = await vscode.window.showWarningMessage(
                        `This project was created with Codex Editor v${projectVersion}, which may be incompatible with the current version (v${currentVersion}). Opening it may cause issues.`,
                        { modal: true },
                        "Open Anyway",
                        "Cancel"
                    );
                    if (proceed !== "Open Anyway") {
                        return;
                    }
                } else if (semver.lt(projectVersion, currentVersion)) {
                    await vscode.window.showInformationMessage(
                        `This project was created with an older version of Codex Editor (v${projectVersion}). It will be automatically upgraded to v${currentVersion}.`
                    );
                }

                // Update last opened time
                const config = vscode.workspace.getConfiguration("codex-project-manager");
                const projectHistory = config.get<Record<string, string>>("projectHistory") || {};
                projectHistory[projectPath] = new Date().toISOString();
                await config.update(
                    "projectHistory",
                    projectHistory,
                    vscode.ConfigurationTarget.Global
                );

                await vscode.commands.executeCommand("vscode.openFolder", uri);
            } catch (error) {
                await vscode.window.showErrorMessage(
                    "This folder is no longer a valid Codex project. It may have been moved or deleted.",
                    { modal: true }
                );
                return;
            }
        } catch (error) {
            console.error("Error opening project:", error);
            await vscode.window.showErrorMessage(
                "Failed to open project. The folder may no longer exist.",
                { modal: true }
            );
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
            // Always check initialization status first
            const hasMetadata = vscode.workspace.workspaceFolders
                ? await checkIfMetadataIsInitialized()
                : false;

            const [projects, overview] = await Promise.all([
                findAllCodexProjects(),
                hasMetadata ? getProjectOverview() : null,
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
            }, 1000); // Poll every 1 second
        }
    }

    private stopPolling() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
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
