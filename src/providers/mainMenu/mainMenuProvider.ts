import * as vscode from "vscode";
import { getProjectOverview, findAllCodexProjects, checkIfMetadataAndGitIsInitialized } from "../../projectManager/utils/projectUtils";
import { getAuthApi } from "../../extension";
import { openSystemMessageEditor } from "../../copilotSettings/copilotSettings";
import { openProjectExportView } from "../../projectManager/projectExportView";
import { BaseWebviewProvider } from "../../globalProvider";
import { safePostMessageToView } from "../../utils/webviewUtils";
import { MetadataManager } from "../../utils/metadataManager";
import { EditMapUtils, addProjectMetadataEdit } from "../../utils/editMapUtils";
import {
    ProjectManagerMessageFromWebview,
    ProjectManagerMessageToWebview,
    ProjectManagerState,
} from "../../../types";
import { createNewWorkspaceAndProject, openProject, createNewProject } from "../../utils/projectCreationUtils/projectCreationUtils";
import git from "isomorphic-git";
// Note: avoid top-level http(s) imports to keep test bundling simple
import * as fs from "fs";
import { getNotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { SyncManager } from "../../projectManager/syncManager";
import { manualUpdateCheck } from "../../utils/updateChecker";
import { CommentsMigrator } from "../../utils/commentsMigrationUtils";
import * as path from "path";
import { PublishProjectView } from "../publishProjectView/PublishProjectView";
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
                        await CommentsMigrator.migrateProjectComments(vscode.workspace.workspaceFolders[0].uri);
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
            case "refreshFontSizes":
                // Refresh the main menu state to reflect any font size changes
                console.log("MainMenu: Refreshing state due to font size changes");
                await this.store.refreshState();
                this.sendProjectStateToWebview();
                break;
            case "applyTextDisplaySettings":
                try {
                    await this.handleApplyTextDisplaySettings(message.data);
                } catch (error) {
                    console.error("Error applying text display settings:", error);
                    vscode.window.showErrorMessage(`Failed to apply text display settings: ${error}`);
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
            case "changeProjectName":
                await this.handleChangeProjectName(message.projectName);
                break;
            case "openProjectSettings":
            case "renameProject":
            case "editAbbreviation":
            case "changeSourceLanguage":
            case "changeTargetLanguage":
            case "setValidationCount":
            case "setValidationCountAudio":
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
            case "setGlobalFontSize":
                await this.handleSetGlobalFontSize();
                break;
            case "setGlobalTextDirection":
                await this.handleSetGlobalTextDirection();
                break;
            case "setGlobalLineNumbers":
                await this.handleSetGlobalLineNumbers();
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
                await syncManager.executeSync("Syncing project", true, undefined, true);
                break;
            }
            case "getAsrSettings": {
                const config = vscode.workspace.getConfiguration("codex-editor-extension");
                let endpoint = config.get<string>("asrEndpoint", "wss://ryderwishart--asr-websocket-transcription-fastapi-asgi.modal.run/ws/transcribe");
                let authToken: string | undefined;

                // Try to get authenticated endpoint from FrontierAPI
                try {
                    const frontierApi = getAuthApi();
                    if (frontierApi) {
                        const authStatus = frontierApi.getAuthStatus();
                        if (authStatus.isAuthenticated) {
                            const asrEndpoint = await frontierApi.getAsrEndpoint();
                            // Validate endpoint URL before using it
                            if (asrEndpoint && asrEndpoint.trim()) {
                                try {
                                    new URL(asrEndpoint);
                                    endpoint = asrEndpoint;
                                } catch (urlError) {
                                    console.warn("Invalid ASR endpoint URL from auth API:", asrEndpoint, urlError);
                                    // Fall back to default endpoint
                                }
                            }
                            // Get auth token for authenticated requests
                            try {
                                authToken = await frontierApi.authProvider.getToken();
                                if (!authToken) {
                                    console.warn("ASR endpoint requires authentication but token retrieval returned empty value");
                                }
                            } catch (tokenError) {
                                console.warn("Could not get auth token for ASR endpoint:", tokenError);
                            }
                        }
                    }
                } catch (error) {
                    console.debug("Could not get ASR endpoint from auth API:", error);
                }

                // Final validation: ensure endpoint is a valid URL
                try {
                    new URL(endpoint);
                } catch (urlError) {
                    console.error("Invalid ASR endpoint configuration:", endpoint, urlError);
                    endpoint = "wss://ryderwishart--asr-websocket-transcription-fastapi-asgi.modal.run/ws/transcribe";
                }

                // Warn if using authenticated endpoint without token
                const isAuthenticatedEndpoint = endpoint.includes('api.frontierrnd.com') || endpoint.includes('frontier');
                if (isAuthenticatedEndpoint && !authToken) {
                    console.warn(`ASR endpoint appears to require authentication but no token was retrieved. Endpoint: ${endpoint}`);
                }

                const settings = {
                    endpoint,
                    provider: config.get<string>("asrProvider", "mms"),
                    model: config.get<string>("asrModel", "facebook/mms-1b-all"),
                    language: config.get<string>("asrLanguage", "eng"),
                    phonetic: config.get<boolean>("asrPhonetic", false),
                    authToken,
                };
                if (this._view) {
                    safePostMessageToView(this._view, { command: "asrSettings", data: settings }, "MainMenu");
                }
                break;
            }
            case "saveAsrSettings": {
                const config = vscode.workspace.getConfiguration("codex-editor-extension");
                const target = vscode.ConfigurationTarget.Workspace;
                await config.update("asrEndpoint", (message as any).data?.endpoint, target);
                await config.update("asrProvider", (message as any).data?.provider, target);
                await config.update("asrModel", (message as any).data?.model, target);
                await config.update("asrLanguage", (message as any).data?.language, target);
                await config.update("asrPhonetic", !!(message as any).data?.phonetic, target);
                if (this._view) {
                    safePostMessageToView(this._view, { command: "asrSettingsSaved" }, "MainMenu");
                }
                break;
            }
            case "fetchAsrModels": {
                const endpoint: string | undefined = (message as any).data?.endpoint;
                if (!endpoint) {
                    if (this._view) {
                        safePostMessageToView(this._view, { command: "asrModels", data: [] }, "MainMenu");
                    }
                    break;
                }
                try {
                    // Normalize endpoint: convert ws/wss to http/https and target /models
                    let baseUrl: URL;
                    try {
                        baseUrl = new URL(endpoint);
                    } catch (err) {
                        throw new Error(`Invalid ASR endpoint: ${endpoint}`);
                    }
                    if (baseUrl.protocol === 'wss:') baseUrl.protocol = 'https:';
                    if (baseUrl.protocol === 'ws:') baseUrl.protocol = 'http:';
                    // Force path to /models
                    baseUrl.pathname = '/models';
                    baseUrl.search = '';
                    const urlStr = baseUrl.toString();

                    // Prefer global fetch (available in recent VS Code/Node); fallback to http(s)
                    let res: string;
                    if (typeof (globalThis as any).fetch === 'function') {
                        const r = await (globalThis as any).fetch(urlStr);
                        res = await r.text();
                    } else {
                        // Lazy-require to avoid bundler resolving node: scheme
                        const lib = urlStr.startsWith('https') ? require('https') : require('http');
                        res = await new Promise<string>((resolve, reject) => {
                            lib.get(urlStr, (resp: any) => {
                                let data = '';
                                resp.on('data', (chunk: any) => (data += chunk));
                                resp.on('end', () => resolve(data));
                            }).on('error', (err: any) => reject(err));
                        });
                    }
                    let models: any[] = [];
                    try {
                        const parsed = JSON.parse(res);
                        models = Array.isArray(parsed) ? parsed : parsed?.models || [];
                    } catch {
                        models = [];
                    }
                    if (this._view) {
                        safePostMessageToView(this._view, { command: "asrModels", data: models }, "MainMenu");
                    }
                } catch (e) {
                    console.error("Failed to fetch ASR models:", e);
                    if (this._view) {
                        safePostMessageToView(this._view, { command: "asrModels", data: [] }, "MainMenu");
                    }
                }
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
                await syncManager.executeSync("Manual sync triggered from main menu", true, undefined, true);
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
            case "setGlobalFontSize":
                await this.handleSetGlobalFontSize();
                break;
            case "setGlobalTextDirection":
                await this.handleSetGlobalTextDirection();
                break;
            default:
                throw new Error(`Unknown command: ${commandName}`);
        }
    }

    private async publishProject(): Promise<void> {
        try {
            PublishProjectView.createOrShow(this._context);
        } catch (error) {
            console.error("Error opening publish project view:", error);
            vscode.window.showErrorMessage(`Failed to open publish view: ${(error as Error).message}`);
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

    public async handleSetGlobalFontSize() {
        try {
            // Step 1: Choose file scope
            const fileScope = await vscode.window.showQuickPick(
                [
                    { label: "Source files only", value: "source" },
                    { label: "Target files only", value: "target" },
                    { label: "Both source and target files", value: "both" }
                ],
                {
                    placeHolder: "Choose which files to update",
                    title: "Global Font Size - File Scope"
                }
            );

            if (!fileScope) {
                return; // User cancelled
            }

            // Step 2: Choose update behavior
            const updateBehavior = await vscode.window.showQuickPick(
                [
                    { label: "Update all files (including those with existing font sizes)", value: "all" },
                    { label: "Skip files that already have font sizes set", value: "skip" }
                ],
                {
                    placeHolder: "Choose update behavior",
                    title: "Global Font Size - Update Behavior"
                }
            );

            if (!updateBehavior) {
                return; // User cancelled
            }

            // Step 3: Choose font size
            const fontSizeOption = await vscode.window.showQuickPick(
                [
                    { label: "8px", value: 8 },
                    { label: "9px", value: 9 },
                    { label: "10px", value: 10 },
                    { label: "11px", value: 11 },
                    { label: "12px", value: 12 },
                    { label: "14px (Default)", value: 14 },
                    { label: "18px", value: 18 },
                    { label: "24px", value: 24 }
                ],
                {
                    placeHolder: "Select font size",
                    title: "Choose Font Size"
                }
            );

            if (!fontSizeOption) {
                return; // User cancelled
            }

            const fontSize = fontSizeOption.value;

            // Step 4: Confirm the action
            const confirmMessage = `This will set font size to ${fontSize}px for ${fileScope.label.toLowerCase()} ${updateBehavior.label.toLowerCase()}. Continue?`;
            const confirmed = await vscode.window.showWarningMessage(
                confirmMessage,
                { modal: true },
                "Yes, Continue"
            );

            if (!confirmed) {
                return; // User cancelled
            }

            // Step 5: Execute the update
            await this.updateGlobalFontSize(fontSize, fileScope.value, updateBehavior.value);

        } catch (error) {
            console.error("Error setting global font size:", error);
            vscode.window.showErrorMessage("Failed to set global font size");
        }
    }

    public async handleSetGlobalTextDirection() {
        try {
            // Step 1: Choose file scope
            const fileScope = await vscode.window.showQuickPick(
                [
                    { label: "Source files only", value: "source" },
                    { label: "Target files only", value: "target" },
                    { label: "Both source and target files", value: "both" }
                ],
                {
                    placeHolder: "Choose which files to update",
                    title: "Global Text Direction - File Scope"
                }
            );

            if (!fileScope) {
                return; // User cancelled
            }

            // Step 2: Choose update behavior
            const updateBehavior = await vscode.window.showQuickPick(
                [
                    { label: "Update all files (including those with existing text direction)", value: "all" },
                    { label: "Skip files that already have text direction set", value: "skip" }
                ],
                {
                    placeHolder: "Choose update behavior",
                    title: "Global Text Direction - Update Behavior"
                }
            );

            if (!updateBehavior) {
                return; // User cancelled
            }

            // Step 3: Choose text direction
            const textDirectionOption = await vscode.window.showQuickPick(
                [
                    { label: "LTR (Left-to-Right)", value: "ltr" },
                    { label: "RTL (Right-to-Left)", value: "rtl" }
                ],
                {
                    placeHolder: "Select text direction",
                    title: "Choose Text Direction"
                }
            );

            if (!textDirectionOption) {
                return; // User cancelled
            }

            const textDirection = textDirectionOption.value as "ltr" | "rtl";

            // Step 4: Confirm the action
            const confirmMessage = `This will set text direction to ${textDirectionOption.label} for ${fileScope.label.toLowerCase()} ${updateBehavior.label.toLowerCase()}. Continue?`;
            const confirmed = await vscode.window.showWarningMessage(
                confirmMessage,
                { modal: true },
                "Yes, Continue"
            );

            if (!confirmed) {
                return; // User cancelled
            }

            // Step 5: Execute the update
            await this.updateGlobalTextDirection(textDirection, fileScope.value, updateBehavior.value);

        } catch (error) {
            console.error("Error setting global text direction:", error);
            vscode.window.showErrorMessage("Failed to set global text direction");
        }
    }

    public async handleSetGlobalLineNumbers() {
        try {
            // Step 1: Choose file scope
            const fileScope = await vscode.window.showQuickPick(
                [
                    { label: "Source files only", value: "source" },
                    { label: "Target files only", value: "target" },
                    { label: "Both source and target files", value: "both" }
                ],
                {
                    placeHolder: "Choose which files to update",
                    title: "Global Line Numbers - File Scope"
                }
            );

            if (!fileScope) {
                return; // User cancelled
            }

            // Step 2: Choose update behavior
            const updateBehavior = await vscode.window.showQuickPick(
                [
                    { label: "Update all files (including those with existing line numbers settings)", value: "all" },
                    { label: "Skip files that already have line numbers settings set", value: "skip" }
                ],
                {
                    placeHolder: "Choose update behavior",
                    title: "Global Line Numbers - Update Behavior"
                }
            );

            if (!updateBehavior) {
                return; // User cancelled
            }

            // Step 3: Choose line numbers setting
            const lineNumbersOption = await vscode.window.showQuickPick(
                [
                    { label: "Enable line numbers", value: true },
                    { label: "Disable line numbers", value: false }
                ],
                {
                    placeHolder: "Choose line numbers setting",
                    title: "Choose Line Numbers Setting"
                }
            );

            if (!lineNumbersOption) {
                return; // User cancelled
            }

            const enableLineNumbers = lineNumbersOption.value;

            // Step 4: Confirm the action
            const actionText = enableLineNumbers ? "enable" : "disable";
            const confirmMessage = `This will ${actionText} line numbers for ${fileScope.label.toLowerCase()} ${updateBehavior.label.toLowerCase()}. Continue?`;
            const confirmed = await vscode.window.showWarningMessage(
                confirmMessage,
                { modal: true },
                "Yes, Continue"
            );

            if (!confirmed) {
                return; // User cancelled
            }

            // Step 5: Execute the update
            await this.updateGlobalLineNumbers(enableLineNumbers, fileScope.value, updateBehavior.value);

        } catch (error) {
            console.error("Error setting global line numbers:", error);
            vscode.window.showErrorMessage("Failed to set global line numbers");
        }
    }

    private async updateGlobalFontSize(fontSize: number, fileScope: string, updateBehavior: string) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        // Show progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Updating Global Font Size",
                cancellable: false
            },
            async (progress) => {
                try {
                    // Find files based on scope
                    const filesToUpdate: vscode.Uri[] = [];

                    if (fileScope === "source" || fileScope === "both") {
                        const sourceFiles = await vscode.workspace.findFiles(
                            new vscode.RelativePattern(workspaceFolder, ".project/sourceTexts/*.source")
                        );
                        filesToUpdate.push(...sourceFiles);
                    }

                    if (fileScope === "target" || fileScope === "both") {
                        const targetFiles = await vscode.workspace.findFiles(
                            new vscode.RelativePattern(workspaceFolder, "files/target/*.codex")
                        );
                        filesToUpdate.push(...targetFiles);
                    }

                    progress.report({ message: `Found ${filesToUpdate.length} files to process` });

                    let updatedCount = 0;
                    let skippedCount = 0;

                    for (let i = 0; i < filesToUpdate.length; i++) {
                        const file = filesToUpdate[i];
                        progress.report({
                            message: `Processing ${path.basename(file.fsPath)} (${i + 1}/${filesToUpdate.length})`,
                            increment: (100 / filesToUpdate.length)
                        });

                        try {
                            const updated = await this.updateFileFontSize(file, fontSize, updateBehavior);
                            if (updated) {
                                updatedCount++;
                            } else {
                                skippedCount++;
                            }
                        } catch (error) {
                            console.error(`Error updating font size for ${file.fsPath}:`, error);
                        }
                    }

                    // Show completion message
                    const message = `Font size update complete: ${updatedCount} files updated, ${skippedCount} files skipped`;
                    vscode.window.showInformationMessage(message);

                    // Refresh webviews to show the updated font sizes immediately
                    await this.refreshWebviewsAfterFontSizeUpdate();

                } catch (error) {
                    console.error("Error during font size update:", error);
                    throw error;
                }
            }
        );
    }

    private async updateFileFontSize(fileUri: vscode.Uri, fontSize: number, updateBehavior: string): Promise<boolean> {
        try {
            // Read the file content
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            const fileData = JSON.parse(fileContent.toString());

            // Check if file already has font size set
            const currentFontSize = fileData.metadata?.fontSize;
            const currentFontSizeSource = fileData.metadata?.fontSizeSource;

            // For "skip" behavior, skip files that have local font changes
            // This preserves user's manual font size adjustments
            if (updateBehavior === "skip" && currentFontSize !== undefined && currentFontSizeSource === "local") {
                return false; // Skip this file
            }

            // Update the font size and mark it as globally set
            if (!fileData.metadata) {
                fileData.metadata = {};
            }
            fileData.metadata.fontSize = fontSize;
            fileData.metadata.fontSizeSource = "global"; // Mark as globally set

            // Write the updated content back to the file
            const updatedContent = JSON.stringify(fileData, null, 2);
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedContent, 'utf8'));

            return true; // File was updated

        } catch (error) {
            console.error(`Error updating font size for ${fileUri.fsPath}:`, error);
            return false;
        }
    }

    private async refreshWebviewsAfterFontSizeUpdate() {
        try {
            // Refresh the main menu webview
            if (this._view) {
                await this.store.refreshState();
                this.sendProjectStateToWebview();
            }

            // Notify other webviews that font sizes have changed
            // Send a message to all active webviews to refresh their content
            vscode.commands.executeCommand("codex-editor.refreshAllWebviews");

            // Also refresh the metadata manager to ensure all webviews get updated data
            const metadataManager = getNotebookMetadataManager();
            await metadataManager.loadMetadata();

        } catch (error) {
            console.error("Error refreshing webviews after font size update:", error);
        }
    }

    private async updateGlobalLineNumbers(enableLineNumbers: boolean, fileScope: string, updateBehavior: string) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        // Show progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Updating Global Line Numbers",
                cancellable: false
            },
            async (progress) => {
                try {
                    // Find files based on scope
                    const filesToUpdate: vscode.Uri[] = [];

                    if (fileScope === "source" || fileScope === "both") {
                        const sourceFiles = await vscode.workspace.findFiles(
                            new vscode.RelativePattern(workspaceFolder, ".project/sourceTexts/*.source")
                        );
                        filesToUpdate.push(...sourceFiles);
                    }

                    if (fileScope === "target" || fileScope === "both") {
                        const targetFiles = await vscode.workspace.findFiles(
                            new vscode.RelativePattern(workspaceFolder, "files/target/*.codex")
                        );
                        filesToUpdate.push(...targetFiles);
                    }

                    progress.report({ message: `Found ${filesToUpdate.length} files to process` });

                    let updatedCount = 0;
                    let skippedCount = 0;

                    for (let i = 0; i < filesToUpdate.length; i++) {
                        const file = filesToUpdate[i];
                        progress.report({
                            message: `Processing ${path.basename(file.fsPath)} (${i + 1}/${filesToUpdate.length})`,
                            increment: (100 / filesToUpdate.length)
                        });

                        try {
                            const updated = await this.updateFileLineNumbers(file, enableLineNumbers, updateBehavior);
                            if (updated) {
                                updatedCount++;
                            } else {
                                skippedCount++;
                            }
                        } catch (error) {
                            console.error(`Error updating line numbers for ${file.fsPath}:`, error);
                        }
                    }

                    // Show completion message
                    const actionText = enableLineNumbers ? "enabled" : "disabled";
                    const message = `Line numbers ${actionText}: ${updatedCount} files updated, ${skippedCount} files skipped`;
                    vscode.window.showInformationMessage(message);

                    // Refresh webviews to show the updated line numbers immediately
                    await this.refreshWebviewsAfterLineNumbersUpdate();

                } catch (error) {
                    console.error("Error during line numbers update:", error);
                    throw error;
                }
            }
        );
    }

    private async updateFileLineNumbers(fileUri: vscode.Uri, enableLineNumbers: boolean, updateBehavior: string): Promise<boolean> {
        try {
            // Read the file content
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            const fileData = JSON.parse(fileContent.toString());

            // Check if file already has line numbers setting
            const currentLineNumbersEnabled = fileData.metadata?.lineNumbersEnabled;
            const currentLineNumbersEnabledSource = fileData.metadata?.lineNumbersEnabledSource;

            // For "skip" behavior, skip files that have local line numbers changes
            // This preserves user's manual line numbers adjustments
            if (updateBehavior === "skip" && currentLineNumbersEnabled !== undefined && currentLineNumbersEnabledSource === "local") {
                return false; // Skip this file
            }

            // Update the line numbers setting and mark it as globally set
            if (!fileData.metadata) {
                fileData.metadata = {};
            }
            fileData.metadata.lineNumbersEnabled = enableLineNumbers;
            fileData.metadata.lineNumbersEnabledSource = "global"; // Mark as globally set

            // Write the updated content back to the file
            const updatedContent = JSON.stringify(fileData, null, 2);
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedContent, 'utf8'));

            return true; // File was updated

        } catch (error) {
            console.error(`Error updating line numbers for ${fileUri.fsPath}:`, error);
            return false;
        }
    }

    private async refreshWebviewsAfterLineNumbersUpdate() {
        try {
            // Refresh the main menu webview
            if (this._view) {
                await this.store.refreshState();
                this.sendProjectStateToWebview();
            }

            // Notify other webviews that line numbers settings have changed
            // Send a message to all active webviews to refresh their content
            vscode.commands.executeCommand("codex-editor.refreshAllWebviews");

            // Also refresh the metadata manager to ensure all webviews get updated data
            const metadataManager = getNotebookMetadataManager();
            await metadataManager.loadMetadata();

        } catch (error) {
            console.error("Error refreshing webviews after line numbers update:", error);
        }
    }

    private async updateGlobalTextDirection(textDirection: "ltr" | "rtl", fileScope: string, updateBehavior: string) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        // Show progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Updating Global Text Direction",
                cancellable: false
            },
            async (progress) => {
                try {
                    // Find files based on scope
                    const filesToUpdate: vscode.Uri[] = [];

                    if (fileScope === "source" || fileScope === "both") {
                        const sourceFiles = await vscode.workspace.findFiles(
                            new vscode.RelativePattern(workspaceFolder, ".project/sourceTexts/*.source")
                        );
                        filesToUpdate.push(...sourceFiles);
                    }

                    if (fileScope === "target" || fileScope === "both") {
                        const targetFiles = await vscode.workspace.findFiles(
                            new vscode.RelativePattern(workspaceFolder, "files/target/*.codex")
                        );
                        filesToUpdate.push(...targetFiles);
                    }

                    progress.report({ message: `Found ${filesToUpdate.length} files to process` });

                    let updatedCount = 0;
                    let skippedCount = 0;

                    for (let i = 0; i < filesToUpdate.length; i++) {
                        const file = filesToUpdate[i];
                        progress.report({
                            message: `Processing ${path.basename(file.fsPath)} (${i + 1}/${filesToUpdate.length})`,
                            increment: (100 / filesToUpdate.length)
                        });

                        try {
                            const updated = await this.updateFileTextDirection(file, textDirection, updateBehavior);
                            if (updated) {
                                updatedCount++;
                            } else {
                                skippedCount++;
                            }
                        } catch (error) {
                            console.error(`Error updating text direction for ${file.fsPath}:`, error);
                        }
                    }

                    // Show completion message
                    const message = `Text direction update complete: ${updatedCount} files updated, ${skippedCount} files skipped`;
                    vscode.window.showInformationMessage(message);

                    // Refresh webviews to show the updated text direction immediately
                    await this.refreshWebviewsAfterTextDirectionUpdate();

                } catch (error) {
                    console.error("Error during text direction update:", error);
                    throw error;
                }
            }
        );
    }

    private async updateFileTextDirection(fileUri: vscode.Uri, textDirection: "ltr" | "rtl", updateBehavior: string): Promise<boolean> {
        try {
            // Read the file content
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            const fileData = JSON.parse(fileContent.toString());

            // Check if file already has text direction set
            const currentTextDirection = fileData.metadata?.textDirection;
            const currentTextDirectionSource = fileData.metadata?.textDirectionSource;

            // For "skip" behavior, skip files that have local text direction changes
            // This preserves user's manual text direction adjustments
            if (updateBehavior === "skip" && currentTextDirection !== undefined && currentTextDirectionSource === "local") {
                return false; // Skip this file
            }

            // Update the text direction and mark it as globally set
            if (!fileData.metadata) {
                fileData.metadata = {};
            }
            fileData.metadata.textDirection = textDirection;
            fileData.metadata.textDirectionSource = "global"; // Mark as globally set

            // Write the updated content back to the file
            const updatedContent = JSON.stringify(fileData, null, 2);
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedContent, 'utf8'));

            return true; // File was updated

        } catch (error) {
            console.error(`Error updating text direction for ${fileUri.fsPath}:`, error);
            return false;
        }
    }

    private async refreshWebviewsAfterTextDirectionUpdate() {
        try {
            // Refresh the main menu webview
            if (this._view) {
                await this.store.refreshState();
                this.sendProjectStateToWebview();
            }

            // Notify other webviews that text direction has changed
            // Send a message to all active webviews to refresh their content
            vscode.commands.executeCommand("codex-editor.refreshAllWebviews");

            // Also refresh the metadata manager to ensure all webviews get updated data
            const metadataManager = getNotebookMetadataManager();
            await metadataManager.loadMetadata();

        } catch (error) {
            console.error("Error refreshing webviews after text direction update:", error);
        }
    }

    private async handleChangeProjectName(newProjectName: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceFolder) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        try {
            // Get current user name for edit tracking
            let author = "unknown";
            try {
                const authApi = await getAuthApi();
                const userInfo = await authApi?.getUserInfo();
                if (userInfo?.username) {
                    author = userInfo.username;
                } else {
                    // Try git username
                    const gitUsername = vscode.workspace.getConfiguration("git").get<string>("username");
                    if (gitUsername) {
                        author = gitUsername;
                    } else {
                        // Try VS Code authentication session
                        try {
                            const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: false });
                            if (session && session.account) {
                                author = session.account.label;
                            }
                        } catch (e) {
                            // Auth provider might not be available
                        }
                    }
                }
            } catch (error) {
                // Silent fallback to "unknown"
            }

            // Update workspace configuration
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            await config.update(
                "projectName",
                newProjectName,
                vscode.ConfigurationTarget.Workspace
            );

            // Update metadata.json using MetadataManager
            const result = await MetadataManager.safeUpdateMetadata(
                workspaceFolder,
                (project: any) => {
                    const originalProjectName = project.projectName;
                    project.projectName = newProjectName;

                    // Track edit if projectName changed
                    if (originalProjectName !== newProjectName) {
                        // Ensure edits array exists
                        if (!project.edits) {
                            project.edits = [];
                        }
                        addProjectMetadataEdit(project, EditMapUtils.projectName(), newProjectName, author);
                    }

                    return project;
                },
                { author }
            );

            if (!result.success) {
                console.error("Failed to update metadata:", result.error);
                vscode.window.showErrorMessage(
                    `Failed to update project name in metadata.json: ${result.error}`
                );
                return;
            }

            // Refresh state to reflect the change
            await this.store.refreshState();
            await this.updateProjectOverview();

            vscode.window.showInformationMessage(`Project name updated to "${newProjectName}".`);
        } catch (error) {
            console.error("Error updating project name:", error);
            vscode.window.showErrorMessage(
                `Failed to update project name: ${(error as Error).message}`
            );
        }
    }

    private async handleApplyTextDisplaySettings(settings: any): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        // Show progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Applying Text Display Settings",
                cancellable: false
            },
            async (progress) => {
                try {
                    // Find files based on scope
                    const filesToUpdate: vscode.Uri[] = [];

                    if (settings.fileScope === "source" || settings.fileScope === "both") {
                        const sourceFiles = await vscode.workspace.findFiles(
                            new vscode.RelativePattern(workspaceFolder, ".project/sourceTexts/*.source")
                        );
                        filesToUpdate.push(...sourceFiles);
                    }

                    if (settings.fileScope === "target" || settings.fileScope === "both") {
                        const targetFiles = await vscode.workspace.findFiles(
                            new vscode.RelativePattern(workspaceFolder, "files/target/*.codex")
                        );
                        filesToUpdate.push(...targetFiles);
                    }

                    progress.report({ message: `Found ${filesToUpdate.length} files to process` });

                    let updatedCount = 0;
                    let skippedCount = 0;
                    const appliedSettings: string[] = [];

                    if (settings.fontSize !== undefined) appliedSettings.push(`font size to ${settings.fontSize}px`);
                    if (settings.enableLineNumbers !== undefined) appliedSettings.push(`line numbers ${settings.enableLineNumbers ? 'enabled' : 'disabled'}`);
                    if (settings.textDirection !== undefined) appliedSettings.push(`text direction to ${settings.textDirection.toUpperCase()}`);

                    for (let i = 0; i < filesToUpdate.length; i++) {
                        const file = filesToUpdate[i];
                        progress.report({
                            message: `Processing ${path.basename(file.fsPath)} (${i + 1}/${filesToUpdate.length})`,
                            increment: (100 / filesToUpdate.length)
                        });

                        try {
                            const updated = await this.updateFileTextDisplaySettings(file, settings);
                            if (updated) {
                                updatedCount++;
                            } else {
                                skippedCount++;
                            }
                        } catch (error) {
                            console.error(`Error updating text display settings for ${file.fsPath}:`, error);
                        }
                    }

                    // Show completion message
                    const settingsText = appliedSettings.join(', ');
                    const message = `Text display settings applied (${settingsText}): ${updatedCount} files updated, ${skippedCount} files skipped`;
                    vscode.window.showInformationMessage(message);

                    // Refresh webviews to show the updated settings immediately
                    await this.refreshWebviewsAfterTextDisplayUpdate();

                } catch (error) {
                    console.error("Error during text display settings update:", error);
                    throw error;
                }
            }
        );
    }

    private async updateFileTextDisplaySettings(fileUri: vscode.Uri, settings: any): Promise<boolean> {
        try {
            // Read the file content
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            const fileData = JSON.parse(fileContent.toString());

            // Check existing settings to determine if we should skip
            let shouldSkip = false;

            if (settings.updateBehavior === "skip") {
                // Check each setting individually
                if (settings.fontSize !== undefined &&
                    fileData.metadata?.fontSize !== undefined &&
                    fileData.metadata?.fontSizeSource === "local") {
                    shouldSkip = true;
                }
                if (settings.enableLineNumbers !== undefined &&
                    fileData.metadata?.lineNumbersEnabled !== undefined &&
                    fileData.metadata?.lineNumbersEnabledSource === "local") {
                    shouldSkip = true;
                }
                if (settings.textDirection !== undefined &&
                    fileData.metadata?.textDirection !== undefined &&
                    fileData.metadata?.textDirectionSource === "local") {
                    shouldSkip = true;
                }
            }

            if (shouldSkip) {
                return false; // Skip this file
            }

            // Ensure metadata object exists
            if (!fileData.metadata) {
                fileData.metadata = {};
            }

            // Apply the settings
            if (settings.fontSize !== undefined) {
                fileData.metadata.fontSize = settings.fontSize;
                fileData.metadata.fontSizeSource = "global";
            }
            if (settings.enableLineNumbers !== undefined) {
                fileData.metadata.lineNumbersEnabled = settings.enableLineNumbers;
                fileData.metadata.lineNumbersEnabledSource = "global";
            }
            if (settings.textDirection !== undefined) {
                fileData.metadata.textDirection = settings.textDirection;
                fileData.metadata.textDirectionSource = "global";
            }

            // Write the updated content back to the file
            const updatedContent = JSON.stringify(fileData, null, 2);
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedContent, 'utf8'));

            return true; // File was updated

        } catch (error) {
            console.error(`Error updating text display settings for ${fileUri.fsPath}:`, error);
            return false;
        }
    }

    private async refreshWebviewsAfterTextDisplayUpdate() {
        try {
            // Refresh the main menu webview
            if (this._view) {
                await this.store.refreshState();
                this.sendProjectStateToWebview();
            }

            // Notify other webviews that display settings have changed
            vscode.commands.executeCommand("codex-editor.refreshAllWebviews");

            // Also refresh the metadata manager to ensure all webviews get updated data
            const metadataManager = getNotebookMetadataManager();
            await metadataManager.loadMetadata();

        } catch (error) {
            console.error("Error refreshing webviews after text display settings update:", error);
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
