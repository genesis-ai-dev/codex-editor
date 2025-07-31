import * as vscode from "vscode";
import { getProjectOverview, findAllCodexProjects, checkIfMetadataAndGitIsInitialized } from "../../projectManager/utils/projectUtils";
import { getAuthApi } from "../../extension";
import { openSystemMessageEditor } from "../../copilotSettings/copilotSettings";
import { openProjectExportView } from "../../projectManager/projectExportView";
import { BaseWebviewProvider } from "../../globalProvider";
import { safePostMessageToView } from "../../utils/webviewUtils";
import {
    ProjectManagerMessageFromWebview,
    ProjectManagerMessageToWebview,
    ProjectManagerState,
    MenuSection,
    MenuButton,
    MainMenuMessages
} from "../../../types";
import { createNewWorkspaceAndProject, openProject, createNewProject } from "../../utils/projectCreationUtils/projectCreationUtils";
import { FrontierAPI } from "webviews/codex-webviews/src/StartupFlow/types";
import git from "isomorphic-git";
import * as fs from "fs";
import { getNotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { SyncManager } from "../../projectManager/syncManager";
import { manualUpdateCheck } from "../../utils/updateChecker";
import { CommentsMigrator } from "../../utils/commentsMigrationUtils";

const DEBUG_MODE = false; // Set to true to enable debug logging

function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[MainMenuProvider]", ...args);
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
        isSyncInProgress: false,
        syncStage: "",
        isPublishingInProgress: false,
        publishingStage: "",
        updateState: null,
        updateVersion: null,
        isCheckingForUpdates: false,
        appVersion: null,
    };

    private initialized = false;
    private isRefreshing = false;
    private _onDidChangeState = new vscode.EventEmitter<void>();
    public readonly onDidChangeState = this._onDidChangeState.event;
    private metadataManager = getNotebookMetadataManager();
    private disposables: vscode.Disposable[] = [];
    private _view?: vscode.WebviewView;

    private listeners: ((state: ProjectManagerState) => void)[] = [];

    // Helper methods to reduce duplication
    private getConfig<T>(key: string, defaultValue?: T): T {
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        return config.get<T>(key, defaultValue as T);
    }

    private async updateConfig<T>(key: string, value: T, target = vscode.ConfigurationTarget.Global) {
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update(key, value, target);
    }

    private handleError(error: Error, operation: string) {
        console.error(`Error during ${operation}:`, error);
        this.setState({ isScanning: false });
        if (this._view) {
            safePostMessageToView(this._view, {
                command: "error",
                message: `Failed to ${operation}: ${error.message}`
            }, "MainMenu");
        }
    }

    private async refreshProjects() {
        this.setState({ isScanning: true });
        try {
            const projects = await findAllCodexProjects();
            this.setState({ projects, isScanning: false });
        } catch (error) {
            this.handleError(error as Error, "refresh projects");
        }
    }

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
                            const newPath = folderUri[0].fsPath;
                            const watchedFolders = this.getConfig<string[]>("watchedFolders", []);

                            if (!watchedFolders.includes(newPath)) {
                                const updatedFolders = [...watchedFolders, newPath];
                                await this.updateConfig("watchedFolders", updatedFolders);

                                // Update state and scan for new projects
                                await this.refreshProjects();
                            }
                        }
                    }
                ),
                vscode.commands.registerCommand(
                    "codex-project-manager.removeWatchFolder",
                    async (args) => {
                        if (args?.path) {
                            const watchedFolders = this.getConfig<string[]>("watchedFolders", []);
                            const updatedFolders = watchedFolders.filter((f) => f !== args.path);
                            await this.updateConfig("watchedFolders", updatedFolders);

                            // Update state and rescan projects
                            await this.refreshProjects();
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

            const primarySourceText = this.getConfig("primarySourceText");
            const watchedFolders = this.getConfig<string[]>("watchedFolders", []);

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
            this.handleError(error as Error, "refresh state");
        } finally {
            this.isRefreshing = false;
        }
    }

    async checkRepoHasRemote(): Promise<boolean> {
        try {
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspacePath) {
                return false;
            }

            const remotes = await git.listRemotes({
                fs,
                dir: workspacePath,
            });

            // Send publish status message
            if (this._view) {
                safePostMessageToView(this._view, {
                    command: "publishStatus",
                    data: {
                        repoHasRemote: remotes.length > 0,
                    },
                } as ProjectManagerMessageToWebview, "MainMenu");
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

export class MainMenuProvider extends BaseWebviewProvider {
    public static readonly viewType = "codex-editor.mainMenu";
    private disposables: vscode.Disposable[] = [];
    private frontierApi?: any;
    private store: ProjectManagerStore;
    private metadataWatcher?: vscode.FileSystemWatcher;

    constructor(context: vscode.ExtensionContext) {
        super(context);
        this.store = new ProjectManagerStore();
        this.initializeFrontierApi();
        this.setupWorkspaceWatchers();
        this.setupSyncStatusListener();

        // Subscribe to state changes to update webview
        this.store.subscribe((state) => {
            if (this._view) {
                safePostMessageToView(this._view, {
                    command: "stateUpdate",
                    data: state,
                }, "MainMenu");
            }
        });
    }

    protected getWebviewId(): string {
        return "mainMenu-sidebar";
    }

    protected getScriptPath(): string[] {
        return ["MainMenu", "index.js"];
    }

    private async initializeFrontierApi() {
        try {
            this.frontierApi = getAuthApi();
        } catch (error) {
            console.error("Error initializing Frontier API:", error);
        }
    }

    private setupWorkspaceWatchers() {
        // Watch for workspace folder changes
        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(async () => {
                this.store.refreshState();

                // Trigger migration when workspace changes
                if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                    try {
                        const migrationOccurred = await CommentsMigrator.migrateProjectComments(vscode.workspace.workspaceFolders[0].uri);
                        if (migrationOccurred) {
                            console.log("[MainMenu] Comments migration completed after workspace change");
                        }
                    } catch (error) {
                        console.error("[MainMenu] Error during workspace change migration:", error);
                    }
                }
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

    private setupSyncStatusListener() {
        // Register listener for sync status updates from SyncManager
        const syncManager = SyncManager.getInstance();
        const syncStatusListener = (isSyncInProgress: boolean, syncStage: string) => {
            this.sendSyncStatusUpdate(isSyncInProgress, syncStage);
        };

        syncManager.addSyncStatusListener(syncStatusListener);

        // Store the listener reference for cleanup
        this.disposables.push({
            dispose: () => {
                syncManager.removeSyncStatusListener(syncStatusListener);
            }
        });
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

    protected onWebviewResolved(webviewView: vscode.WebviewView): void {
        this.store.setView(webviewView);
        this.store.initialize();
        this.sendProjectStateToWebview();

        // Check update state on initialization
        this.updateCurrentState();

        // Get app version
        this.updateAppVersion();
    }

    protected onWebviewReady(): void {
        this.sendProjectStateToWebview();
    }

    private async executeCommandAndNotify(commandName: string) {
        await vscode.commands.executeCommand(`codex-project-manager.${commandName}`);
        await this.store.refreshState();
        safePostMessageToView(this._view, { command: "actionCompleted" }, "MainMenu");
    }

    protected async handleMessage(message: any): Promise<void> {
        // Handle main menu messages
        switch (message.command) {
            case "executeCommand":
                try {
                    await this.executeCommand(message.commandName);
                } catch (error) {
                    console.error("Error executing command:", error);
                    vscode.window.showErrorMessage(`Error executing command: ${error}`);
                }
                break;
            case "focusView":
                try {
                    await vscode.commands.executeCommand(`${message.viewId}.focus`);
                } catch (error) {
                    console.error("Error focusing view:", message.viewId, error);
                }
                break;
            case "openExternal":
                try {
                    if (message.url) {
                        await vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                } catch (error) {
                    console.error("Error opening external URL:", error);
                    vscode.window.showErrorMessage(`Failed to open URL: ${error}`);
                }
                break;
        }

        // Handle project manager messages
        await this.handleProjectManagerMessage(message);
    }

    private async handleProjectManagerMessage(message: ProjectManagerMessageFromWebview) {
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
                await this.executeCommandAndNotify(message.command);
                break;
            case "selectCategory":
                // For backward compatibility, redirect to setValidationCount
                await this.executeCommandAndNotify("setValidationCount");
                break;
            case "openEditAnalysis":
                await vscode.commands.executeCommand("codex-editor-extension.analyzeEdits");
                break;
            case "publishProject":
                await this.publishProject();
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
            case "syncProject": {
                console.log("Syncing project");
                const syncManager = SyncManager.getInstance();
                // Don't manually set sync status - let SyncManager handle it through listeners
                await syncManager.executeSync("Syncing project");
                break;
            }
            case "getSyncSettings": {
                const config = vscode.workspace.getConfiguration("codex-project-manager");
                const autoSyncEnabled = config.get<boolean>("autoSyncEnabled", true);
                let syncDelayMinutes = config.get<number>("syncDelayMinutes", 5);

                // Ensure minimum sync delay is 5 minutes
                if (syncDelayMinutes < 5) {
                    syncDelayMinutes = 5;
                    // Update the configuration to persist the corrected value
                    await config.update(
                        "syncDelayMinutes",
                        syncDelayMinutes,
                        vscode.ConfigurationTarget.Workspace
                    );
                }

                if (this._view) {
                    safePostMessageToView(this._view, {
                        command: "syncSettingsUpdate",
                        data: {
                            autoSyncEnabled,
                            syncDelayMinutes,
                        },
                    } as ProjectManagerMessageToWebview, "MainMenu");
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
                // Don't manually set sync status - let SyncManager handle it through listeners
                await syncManager.executeSync("Manual sync triggered from main menu");
                break;
            }
            case "openBookNameEditor":
                await vscode.commands.executeCommand("codex-editor.openBookNameEditor");
                await this.store.refreshState();
                safePostMessageToView(this._view, { command: "actionCompleted" }, "MainMenu");
                break;
            case "openCellLabelImporter":
                await vscode.commands.executeCommand("codex-editor.openCellLabelImporter");
                await this.store.refreshState();
                safePostMessageToView(this._view, { command: "actionCompleted" }, "MainMenu");
                break;
            case "getProjectProgress": {
                // Fetch and send progress data to the webview
                try {
                    // Check if frontier API is available for progress data
                    if (!this.frontierApi) {
                        await this.initializeFrontierApi();
                    }

                    if (this.frontierApi) {
                        const progressData = await vscode.commands.executeCommand(
                            "frontier.getAggregatedProgress"
                        );

                        if (progressData && this._view) {
                            safePostMessageToView(this._view, {
                                command: "progressData",
                                data: progressData,
                            } as ProjectManagerMessageToWebview, "MainMenu");
                        }
                    } else {
                        console.log("Frontier API not available for progress data");
                    }
                } catch (error) {
                    console.error("Error fetching project progress:", error);
                }
                break;
            }
            case "checkForUpdates": {
                await this.handleUpdateCheck();
                break;
            }
            case "downloadUpdate": {
                await this.handleDownloadUpdate();
                break;
            }
            case "installUpdate": {
                await this.handleInstallUpdate();
                break;
            }
            case "openExternal": {
                try {
                    if (message.url) {
                        await vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                } catch (error) {
                    console.error("Error opening external URL:", error);
                    vscode.window.showErrorMessage(`Failed to open URL: ${error}`);
                }
                break;
            }
            case "showProgressDashboard": {
                // Open the progress dashboard
                try {
                    await vscode.commands.executeCommand("frontier.showProgressDashboard");
                } catch (error) {
                    console.error("Error opening progress dashboard:", error);
                    vscode.window.showErrorMessage("Failed to open progress dashboard");
                }
                break;
            }
            default:
                console.log(`Unhandled command: ${message.command}`);
        }
    }

    private async executeCommand(commandName: string): Promise<void> {
        switch (commandName) {
            case "openAISettings":
                await openSystemMessageEditor();
                break;
            case "openExportView":
                await openProjectExportView(this._context);
                break;
            case "publishProject":
                await this.publishProject();
                break;
            case "closeProject":
                await this.closeProject();
                break;
            case "openCellLabelImporter":
                await vscode.commands.executeCommand("codex-editor.openCellLabelImporter");
                break;
            case "openBookNameEditor":
                await vscode.commands.executeCommand("codex-editor.openBookNameEditor");
                break;
            default:
                throw new Error(`Unknown command: ${commandName}`);
        }
    }

    private async publishProject(): Promise<void> {
        // Set publishing in progress
        this.sendPublishStatusUpdate(true, "Preparing to publish...");

        try {
            const projectOverview = await getProjectOverview();
            const projectName = projectOverview?.projectName || "";
            const projectId = projectOverview?.projectId || "";

            if (!projectName) {
                this.sendPublishStatusUpdate(false, "");
                vscode.window.showErrorMessage("No project name found");
                return;
            }

            this.sendPublishStatusUpdate(true, "Validating project data...");

            const sanitizedName = `${projectName}-${projectId}`
                .toLowerCase()
                .replace(/[^a-z0-9._-]/g, "-")
                .replace(/^-+|-+$/g, "")
                .replace(/\.git$/i, "");

            this.sendPublishStatusUpdate(true, "Publishing to cloud...");

            await this.frontierApi?.publishWorkspace({
                name: sanitizedName,
                visibility: "private",
            });

            this.sendPublishStatusUpdate(true, "Finalizing...");

            // Refresh state after publishing to update UI
            await this.store.refreshState();

            this.sendPublishStatusUpdate(false, "");
            vscode.window.showInformationMessage("Project published successfully!");
        } catch (error) {
            this.sendPublishStatusUpdate(false, "");
            console.error("Error publishing project:", error);
            vscode.window.showErrorMessage(`Failed to publish project: ${(error as Error).message}`);
        }
    }

    private async closeProject(): Promise<void> {
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
    }

    private sendProjectStateToWebview(): void {
        if (this._view) {
            const state = this.store.getState();
            safePostMessageToView(this._view, {
                command: "stateUpdate",
                data: state,
            } as ProjectManagerMessageToWebview, "MainMenu");
        }
    }

    private sendSyncStatusUpdate(isSyncInProgress: boolean, syncStage: string = ""): void {
        // Update the store state
        this.store.setState({
            isSyncInProgress,
            syncStage,
        });

        // Send update to webview
        if (this._view) {
            safePostMessageToView(this._view, {
                command: "syncStatusUpdate",
                data: {
                    isSyncInProgress,
                    syncStage,
                },
            } as ProjectManagerMessageToWebview, "MainMenu");
        }
    }

    private sendPublishStatusUpdate(isPublishingInProgress: boolean, publishingStage: string = ""): void {
        // Update the store state
        this.store.setState({
            isPublishingInProgress,
            publishingStage,
        });

        // Send update to webview
        if (this._view) {
            safePostMessageToView(this._view, {
                command: "publishStatusUpdate",
                data: {
                    isPublishingInProgress,
                    publishingStage,
                },
            } as ProjectManagerMessageToWebview, "MainMenu");
        }
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
                safePostMessageToView(this._view, {
                    command: "stateUpdate",
                    data: state,
                } as ProjectManagerMessageToWebview, "MainMenu");
            }
        } catch (error) {
            console.error("Error updating project overview:", error);
            this.store.setState({ isInitializing: false, isScanning: false });
            if (this._view) {
                safePostMessageToView(this._view, {
                    command: "error",
                    message: "Failed to load project overview. Please try again.",
                }, "MainMenu");
            }
        }
    }

    private async updateWebviewState() {
        if (this._view) {
            const state = this.store.getState();
            safePostMessageToView(this._view, {
                command: "stateUpdate",
                data: state,
            } as ProjectManagerMessageToWebview, "MainMenu");
        }
    }

    private async handleUpdateCheck(): Promise<void> {
        try {
            this.store.setState({ isCheckingForUpdates: true });
            await this.updateCurrentState();

            // If no update was found after checking, run manual check
            const currentState = this.store.getState();
            if (!currentState.updateState || currentState.updateState === 'idle') {
                await manualUpdateCheck(this._context);
            }
        } catch (error) {
            console.error("Error checking for updates:", error);
            vscode.window.showErrorMessage(`Update check failed: ${(error as Error).message}`);
        } finally {
            this.store.setState({ isCheckingForUpdates: false });
        }
    }

    private async handleDownloadUpdate(): Promise<void> {
        try {
            await vscode.commands.executeCommand('update.downloadUpdate');
            await this.updateCurrentState();
        } catch (error) {
            console.error("Error downloading update:", error);
            vscode.window.showErrorMessage(`Download failed: ${(error as Error).message}`);
        }
    }

    private async handleInstallUpdate(): Promise<void> {
        try {
            const currentState = this.store.getState();
            if (currentState.updateState === 'ready') {
                await vscode.commands.executeCommand('update.restartToUpdate');
            } else if (currentState.updateState === 'downloaded') {
                await vscode.commands.executeCommand('update.installUpdate');
            }
        } catch (error) {
            console.error("Error installing update:", error);
            vscode.window.showErrorMessage(`Install failed: ${(error as Error).message}`);
        }
    }

    private async updateCurrentState(): Promise<void> {
        try {
            const updateState = await vscode.commands.executeCommand('_update.state') as any;

            if (updateState) {
                let mappedState: ProjectManagerState['updateState'] = null;
                let version: string | null = null;

                switch (updateState.type) {
                    case 'ready':
                    case 'downloaded':
                    case 'available for download':
                    case 'downloading':
                    case 'updating':
                    case 'checking for updates':
                    case 'idle':
                    case 'disabled':
                        mappedState = updateState.type;
                        version = updateState.update?.version || null;
                        break;
                    default:
                        mappedState = 'idle';
                }

                this.store.setState({
                    updateState: mappedState,
                    updateVersion: version,
                });

                // Send update state to webview
                if (this._view) {
                    safePostMessageToView(this._view, {
                        command: "updateStateChanged",
                        data: {
                            updateState: mappedState,
                            updateVersion: version,
                            isCheckingForUpdates: false,
                        },
                    } as ProjectManagerMessageToWebview, "MainMenu");
                }
            }
        } catch (error) {
            console.error("Error updating current state:", error);
        }
    }

    private updateAppVersion(): void {
        try {
            // Get the current extension
            const extension = vscode.extensions.getExtension('project-accelerate.codex-editor-extension');
            const appVersion = extension?.packageJSON?.version || null;

            this.store.setState({
                appVersion,
            });
        } catch (error) {
            console.error("Error getting app version:", error);
        }
    }

    public dispose(): void {
        this.store.dispose();
        this.metadataWatcher?.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}


