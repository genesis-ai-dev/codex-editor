import {
    MessagesToStartupFlowProvider,
    MessagesFromStartupFlowProvider,
    GitLabProject,
    ProjectWithSyncStatus,
    LocalProject,
    ProjectManagerMessageFromWebview,
    ProjectMetadata,
    ProjectSwapInfo,
    ProjectSwapEntry,
    ProjectSwapUserEntry,
    MediaFilesStrategy,
} from "../../../types";
import * as vscode from "vscode";
import { PreflightCheck, PreflightState } from "./preflight";
import { findAllCodexProjects } from "../../../src/projectManager/utils/projectUtils";
import { AuthState, FrontierAPI } from "webviews/codex-webviews/src/StartupFlow/types";
import {
    createNewProject,
    createNewWorkspaceAndProject,
    createWorkspaceWithProjectName,
    checkProjectNameExists,
} from "../../utils/projectCreationUtils/projectCreationUtils";
import { generateProjectId, sanitizeProjectName, extractProjectIdFromFolderName } from "../../projectManager/utils/projectUtils";
import { getAuthApi } from "../../extension";
import { MetadataManager } from "../../utils/metadataManager";
import { createMachine, assign, createActor } from "xstate";
import { performProjectSwap } from "./performProjectSwap";
import { getCodexProjectsDirectory } from "../../utils/projectLocationUtils";
import archiver from "archiver";
import { getWebviewHtml } from "../../utils/webviewTemplate";

import { safePostMessageToPanel, safeIsVisible, safeSetHtml, safeSetOptions } from "../../utils/webviewUtils";
import * as path from "path";
import * as fs from "fs";
import git from "isomorphic-git";
import { resolveConflictFiles } from "../../projectManager/utils/merge/resolvers";
import { buildConflictsFromDirectories } from "../../projectManager/utils/merge/directoryConflicts";
import {
    readLocalProjectSettings,
    writeLocalProjectSettings,
    markPendingUpdateRequired,
    clearPendingUpdate,
    type UpdateState,
    type UpdateStep
} from "../../utils/localProjectSettings";
import { ensureConnectivity, handleUpdateError, categorizeError, ErrorType } from "../../utils/connectivityChecker";

// Add global state tracking for startup flow
export class StartupFlowGlobalState {
    private static _instance: StartupFlowGlobalState;
    private _isOpen: boolean = false;
    private _eventEmitter = new vscode.EventEmitter<boolean>();

    public static get instance(): StartupFlowGlobalState {
        if (!StartupFlowGlobalState._instance) {
            StartupFlowGlobalState._instance = new StartupFlowGlobalState();
        }
        return StartupFlowGlobalState._instance;
    }

    public get isOpen(): boolean {
        return this._isOpen;
    }

    public setOpen(isOpen: boolean): void {
        if (this._isOpen !== isOpen) {
            this._isOpen = isOpen;
            this._eventEmitter.fire(isOpen);
        }
    }

    public get onStateChanged(): vscode.Event<boolean> {
        return this._eventEmitter.event;
    }

    public dispose(): void {
        this._eventEmitter.dispose();
    }
}

// State machine types
export enum StartupFlowStates {
    LOGIN_REGISTER = "loginRegister",
    OPEN_OR_CREATE_PROJECT = "createNewProject",
    PROMPT_USER_TO_INITIALIZE_PROJECT = "promptUserToInitializeProject",
    PROMPT_USER_TO_ADD_CRITICAL_DATA = "promptUserToAddCriticalData",
    ALREADY_WORKING = "alreadyWorking",
}

export enum StartupFlowEvents {
    AUTH_LOGGED_IN = "AUTH_LOGGED_IN",
    NO_AUTH_EXTENSION = "NO_AUTH_EXTENSION",
    SKIP_AUTH = "SKIP_AUTH",
    PROJECT_CREATE_EMPTY = "PROJECT_CREATE_EMPTY",
    PROJECT_CLONE_OR_OPEN = "PROJECT_CLONE_OR_OPEN",
    BACK_TO_LOGIN = "BACK_TO_LOGIN",
    UPDATE_AUTH_STATE = "UPDATE_AUTH_STATE",
    INITIALIZE_PROJECT = "INITIALIZE_PROJECT",
    EMPTY_WORKSPACE_THAT_NEEDS_PROJECT = "EMPTY_WORKSPACE_THAT_NEEDS_PROJECT",
    VALIDATE_PROJECT_IS_OPEN = "VALIDATE_PROJECT_IS_OPEN",
    PROJECT_MISSING_CRITICAL_DATA = "PROJECT_MISSING_CRITICAL_DATA",
    SETUP_COMPLETE = "SETUP_COMPLETE",
    SETUP_INCOMPLETE = "SETUP_INCOMPLETE",
}

type StartupFlowContext = {
    authState: {
        isAuthenticated: boolean;
        isAuthExtensionInstalled: boolean;
        isLoading: boolean;
        error: undefined | string;
        gitlabInfo: undefined | any;
        workspaceState: {
            isWorkspaceOpen: boolean;
            isProjectInitialized: boolean;
        };
    };
};

type StartupFlowEvent =
    | {
        type:
        | StartupFlowEvents.UPDATE_AUTH_STATE
        | StartupFlowEvents.AUTH_LOGGED_IN
        | StartupFlowEvents.NO_AUTH_EXTENSION;
        data: StartupFlowContext["authState"];
    }
    | {
        type:
        | StartupFlowEvents.SKIP_AUTH
        | StartupFlowEvents.PROJECT_CREATE_EMPTY
        | StartupFlowEvents.PROJECT_CLONE_OR_OPEN
        | StartupFlowEvents.BACK_TO_LOGIN;
    }
    | {
        type: StartupFlowEvents.INITIALIZE_PROJECT;
    }
    | {
        type: StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN;
    }
    | {
        type: StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT;
    }
    | {
        type: StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA;
    };

const DEBUG_MODE = false; // Set to true to enable debug logging

function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[StartupFlowProvider]", ...args);
    }
}

/**
 * Format bytes as human-readable string
 */
function formatBytesHelper(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export class StartupFlowProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = "startupFlowProvider";
    private disposables: vscode.Disposable[] = [];
    private frontierApi?: FrontierAPI;
    private webviewPanel?: vscode.WebviewPanel;
    private stateMachine!: ReturnType<typeof createActor>;
    private preflightState: PreflightState = {
        authState: {
            isAuthExtensionInstalled: false,
            isAuthenticated: false,
            isLoading: true,
        },
        workspaceState: {
            isOpen: false,
            hasMetadata: false,
            isProjectSetup: false,
        },
        projectSelection: {
            type: undefined,
            path: undefined,
            repoUrl: undefined,
        },
        gitState: {
            isGitRepo: false,
            hasRemote: false,
        },
    };
    private metadataWatcher?: vscode.FileSystemWatcher;
    private _preflightPromise?: Promise<PreflightState>;
    private _forceLogin: boolean = false;
    private static readonly PENDING_UPDATE_SYNC_KEY = "codex.pendingUpdateSync";

    public setForceLogin(force: boolean) {
        this._forceLogin = force;
    }

    constructor(private readonly context: vscode.ExtensionContext) {
        // Initialize components in parallel without waiting
        this.initializeComponentsAsync();

        // Add disposal of webview panel when extension is deactivated
        this.context.subscriptions.push(
            vscode.Disposable.from({
                dispose: () => {
                    this.webviewPanel?.dispose();
                    this.stateMachine?.stop();
                },
            })
        );
    }

    public resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this.webviewPanel = webviewPanel;
        this.disposables.push(webviewPanel);

        // Set options before content
        safeSetOptions(webviewPanel.webview, {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "src", "assets"),
                vscode.Uri.joinPath(this.context.extensionUri, "media"),
                vscode.Uri.joinPath(this.context.extensionUri, "webviews", "codex-webviews", "dist"),
                vscode.Uri.file(path.join(this.context.extensionUri.fsPath, 'node_modules', '@vscode/codicons', 'dist')),
            ],
        });

        // Set initial HTML
        safeSetHtml(webviewPanel.webview, getWebviewHtml(webviewPanel.webview, this.context, {
            title: "Startup Flow",
            scriptPath: ["StartupFlow", "index.js"],
        }), "StartupFlow");

        // Set up message handling
        webviewPanel.webview.onDidReceiveMessage((message) => {
            this.handleMessage(message);
        });

        // Set up metadata.json file watcher
        this.setupMetadataWatcher(webviewPanel);

        // Track visibility state
        const visibilityDisposable = webviewPanel.onDidChangeViewState((e) => {
            const isVisible = e.webviewPanel.visible;
            StartupFlowGlobalState.instance.setOpen(isVisible);

            // When becoming visible again, refresh the list and progress data
            if (isVisible) {
                this.sendList(webviewPanel);
                this.fetchAndSendProgressData(webviewPanel);
            }
        });
        this.disposables.push(visibilityDisposable);

        // Dispose listener
        webviewPanel.onDidDispose(() => {
            StartupFlowGlobalState.instance.setOpen(false);
            this.webviewPanel = undefined;

            // Reset force login flag when panel is closed
            this._forceLogin = false;
        });

        // Set global state to open
        StartupFlowGlobalState.instance.setOpen(true);
    }

    /**
     * Initialize components asynchronously to avoid blocking constructor
     */
    private async initializeComponentsAsync() {
        try {
            // Run preflight check once and cache the result
            this._preflightPromise = this.runPreflightCheck();
            this.preflightState = await this._preflightPromise;

            // Initialize state machine
            this.initializeStateMachine();

            // Initialize Frontier API (but don't fetch project lists yet)
            await this.initializeFrontierApi();
        } catch (error) {
            console.error("Error during startup flow initialization:", error);
        }
    }

    /**
     * Get cached preflight state or run check if not available
     */
    private async getCachedPreflightState(forceRefresh: boolean = false): Promise<PreflightState> {
        if (this._preflightPromise && !forceRefresh) {
            return this._preflightPromise;
        }
        this._preflightPromise = this.runPreflightCheck();
        return this._preflightPromise;
    }

    /**
     * Run the actual preflight check - only called once and cached
     */
    private async runPreflightCheck(): Promise<PreflightState> {
        const preflightCheck = new PreflightCheck();
        return await preflightCheck.preflight();
    }

    private initializeStateMachine() {
        const updateAuthStateAction = assign({
            authState: ({ event }: any) => ({
                isAuthenticated:
                    "data" in event ? !!event.data.isAuthenticated : false,
                isAuthExtensionInstalled:
                    "data" in event
                        ? !!event.data.isAuthExtensionInstalled
                        : false,
                isLoading: "data" in event ? !!event.data.isLoading : false,
                error: "data" in event ? event.data.error : undefined,
                gitlabInfo: "data" in event ? event.data.gitlabInfo : undefined,
                workspaceState: {
                    isWorkspaceOpen:
                        "data" in event
                            ? !!event.data.workspaceState?.isWorkspaceOpen
                            : false,
                    isProjectInitialized:
                        "data" in event
                            ? !!event.data.workspaceState?.isProjectInitialized
                            : false,
                },
            }),
        }) as any;

        const machine = createMachine({
            id: "startupFlow",
            initial: StartupFlowStates.LOGIN_REGISTER,
            context: {
                authState: {
                    isAuthenticated: false,
                    isAuthExtensionInstalled: false,
                    isLoading: true,
                    error: undefined,
                    gitlabInfo: undefined,
                    workspaceState: {
                        isWorkspaceOpen: false,
                        isProjectInitialized: false,
                    },
                },
            },
            types: {} as {
                context: StartupFlowContext;
                events: StartupFlowEvent;
            },
            states: {
                [StartupFlowStates.LOGIN_REGISTER]: {
                    on: {
                        [StartupFlowEvents.UPDATE_AUTH_STATE]: {
                            actions: assign({
                                authState: ({ event }) => ({
                                    isAuthenticated:
                                        "data" in event ? !!event.data.isAuthenticated : false,
                                    isAuthExtensionInstalled:
                                        "data" in event
                                            ? !!event.data.isAuthExtensionInstalled
                                            : false,
                                    isLoading: "data" in event ? !!event.data.isLoading : false,
                                    error: "data" in event ? event.data.error : undefined,
                                    gitlabInfo: "data" in event ? event.data.gitlabInfo : undefined,
                                    workspaceState: {
                                        isWorkspaceOpen:
                                            "data" in event
                                                ? !!event.data.workspaceState?.isWorkspaceOpen
                                                : false,
                                        isProjectInitialized:
                                            "data" in event
                                                ? !!event.data.workspaceState?.isProjectInitialized
                                                : false,
                                    },
                                }),
                            }),
                        },
                        [StartupFlowEvents.AUTH_LOGGED_IN]: [
                            {
                                target: StartupFlowStates.OPEN_OR_CREATE_PROJECT,
                                guard: ({ context }) => this._forceLogin,
                            },
                            {
                                target: StartupFlowStates.OPEN_OR_CREATE_PROJECT,
                                guard: ({ context }) =>
                                    !context.authState?.workspaceState?.isWorkspaceOpen || false,
                            },
                            {
                                target: StartupFlowStates.ALREADY_WORKING,
                                guard: ({ context }) =>
                                    (context.authState?.workspaceState?.isWorkspaceOpen ?? false) &&
                                    (context.authState?.workspaceState?.isProjectInitialized ??
                                        false),
                            },
                            {
                                target: StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT,
                                guard: ({ context }) =>
                                    (context.authState?.workspaceState?.isWorkspaceOpen ?? false) &&
                                    !(
                                        context.authState?.workspaceState?.isProjectInitialized ??
                                        false
                                    ),
                            },
                        ],
                        [StartupFlowEvents.SKIP_AUTH]: [
                            {
                                target: StartupFlowStates.ALREADY_WORKING,
                                guard: ({ context }) => {
                                    // Double check the actual workspace state from VS Code API, 
                                    // as the context might be stale if preflight hasn't re-run
                                    const hasOpenWorkspace = !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
                                    // Also check the context state for consistency
                                    const contextSaysOpen = context.authState?.workspaceState?.isWorkspaceOpen ?? false;

                                    debugLog("SKIP_AUTH guard check:", { hasOpenWorkspace, contextSaysOpen });

                                    // Trust the VS Code API truth over potentially stale context
                                    return hasOpenWorkspace;
                                },
                            },
                            {
                                target: StartupFlowStates.OPEN_OR_CREATE_PROJECT,
                            },
                        ],
                        [StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA]:
                            StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA,
                        [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]:
                            StartupFlowStates.ALREADY_WORKING,
                    },
                },
                [StartupFlowStates.OPEN_OR_CREATE_PROJECT]: {
                    on: {
                        [StartupFlowEvents.UPDATE_AUTH_STATE]: [
                            {
                                target: StartupFlowStates.LOGIN_REGISTER,
                                guard: ({ event }) => !("data" in event ? event.data.isAuthenticated : true),
                                actions: updateAuthStateAction,
                            },
                            {
                                actions: updateAuthStateAction,
                            },
                        ],
                        [StartupFlowEvents.BACK_TO_LOGIN]: StartupFlowStates.LOGIN_REGISTER,
                        [StartupFlowEvents.PROJECT_CREATE_EMPTY]:
                            StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT,
                        [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]:
                            StartupFlowStates.ALREADY_WORKING,
                        [StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT]:
                            StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT,
                        [StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA]:
                            StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA,
                        [StartupFlowEvents.NO_AUTH_EXTENSION]: {
                            target: StartupFlowStates.LOGIN_REGISTER,
                            actions: assign({
                                authState: ({ event }) => ({
                                    isAuthenticated:
                                        "data" in event ? !!event.data.isAuthenticated : false,
                                    isAuthExtensionInstalled:
                                        "data" in event
                                            ? !!event.data.isAuthExtensionInstalled
                                            : false,
                                    isLoading: "data" in event ? !!event.data.isLoading : false,
                                    error: "data" in event ? event.data.error : undefined,
                                    gitlabInfo: "data" in event ? event.data.gitlabInfo : undefined,
                                    workspaceState: {
                                        isWorkspaceOpen:
                                            "data" in event
                                                ? !!event.data.workspaceState?.isWorkspaceOpen
                                                : false,
                                        isProjectInitialized:
                                            "data" in event
                                                ? !!event.data.workspaceState?.isProjectInitialized
                                                : false,
                                    },
                                }),
                            }),
                        },
                    },
                },
                [StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT]: {
                    on: {
                        [StartupFlowEvents.UPDATE_AUTH_STATE]: [
                            {
                                target: StartupFlowStates.LOGIN_REGISTER,
                                guard: ({ event }) => !("data" in event ? event.data.isAuthenticated : true),
                                actions: updateAuthStateAction,
                            },
                            {
                                actions: updateAuthStateAction,
                            },
                        ],
                        [StartupFlowEvents.INITIALIZE_PROJECT]:
                            StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA,
                        [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]:
                            StartupFlowStates.ALREADY_WORKING,
                        [StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA]:
                            StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA,
                        [StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT]:
                            StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT,
                        [StartupFlowEvents.NO_AUTH_EXTENSION]: {
                            target: StartupFlowStates.LOGIN_REGISTER,
                            actions: assign({
                                authState: ({ event }) => ({
                                    isAuthenticated:
                                        "data" in event ? !!event.data.isAuthenticated : false,
                                    isAuthExtensionInstalled:
                                        "data" in event
                                            ? !!event.data.isAuthExtensionInstalled
                                            : false,
                                    isLoading: "data" in event ? !!event.data.isLoading : false,
                                    error: "data" in event ? event.data.error : undefined,
                                    gitlabInfo: "data" in event ? event.data.gitlabInfo : undefined,
                                    workspaceState: {
                                        isWorkspaceOpen:
                                            "data" in event
                                                ? !!event.data.workspaceState?.isWorkspaceOpen
                                                : false,
                                        isProjectInitialized:
                                            "data" in event
                                                ? !!event.data.workspaceState?.isProjectInitialized
                                                : false,
                                    },
                                }),
                            }),
                        },
                    },
                },
                [StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA]: {
                    on: {
                        [StartupFlowEvents.UPDATE_AUTH_STATE]: [
                            {
                                target: StartupFlowStates.LOGIN_REGISTER,
                                guard: ({ event }) => !("data" in event ? event.data.isAuthenticated : true),
                                actions: updateAuthStateAction,
                            },
                            {
                                actions: updateAuthStateAction,
                            },
                        ],
                        [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]:
                            StartupFlowStates.ALREADY_WORKING,
                    },
                },
                [StartupFlowStates.ALREADY_WORKING]: {
                    on: {
                        [StartupFlowEvents.NO_AUTH_EXTENSION]: {
                            target: StartupFlowStates.LOGIN_REGISTER,
                            actions: assign({
                                authState: ({ event }) => ({
                                    isAuthenticated:
                                        "data" in event ? !!event.data.isAuthenticated : false,
                                    isAuthExtensionInstalled:
                                        "data" in event
                                            ? !!event.data.isAuthExtensionInstalled
                                            : false,
                                    isLoading: "data" in event ? !!event.data.isLoading : false,
                                    error: "data" in event ? event.data.error : undefined,
                                    gitlabInfo: "data" in event ? event.data.gitlabInfo : undefined,
                                    workspaceState: {
                                        isWorkspaceOpen:
                                            "data" in event
                                                ? !!event.data.workspaceState?.isWorkspaceOpen
                                                : false,
                                        isProjectInitialized:
                                            "data" in event
                                                ? !!event.data.workspaceState?.isProjectInitialized
                                                : false,
                                    },
                                }),
                            }),
                        },
                        [StartupFlowEvents.UPDATE_AUTH_STATE]: [
                            {
                                target: StartupFlowStates.LOGIN_REGISTER,
                                guard: ({ event }) => !("data" in event ? event.data.isAuthenticated : true),
                                actions: updateAuthStateAction,
                            },
                            {
                                actions: updateAuthStateAction,
                            },
                        ],
                    },
                },
            },
        });

        const actor = createActor(machine).start();
        this.stateMachine = actor;

        actor.subscribe((state) => {
            debugLog({ state }, "state in startup flow");
            if (state.value === StartupFlowStates.ALREADY_WORKING) {
                this.webviewPanel?.dispose();
                return;
            }
            if (this.webviewPanel) {
                this.safeSendMessage({
                    command: "state.update",
                    state: {
                        value: state.value,
                        context: state.context,
                    },
                });
            }
        });
    }

    private async initializeFrontierApi() {
        try {
            this.frontierApi = getAuthApi();
            if (this.frontierApi) {
                // Clear cached preflight check to ensure we get fresh auth state
                this._preflightPromise = undefined;

                // Get initial auth status
                const initialStatus = this.frontierApi?.getAuthStatus();
                this.updateAuthState({
                    isAuthExtensionInstalled: true,
                    isAuthenticated: initialStatus?.isAuthenticated,
                    isLoading: false,
                    workspaceState: {
                        isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                        isProjectInitialized: this.preflightState.workspaceState.isProjectSetup,
                    },
                });

                // Subscribe to auth status changes
                const disposable = this.frontierApi?.onAuthStatusChanged((status) => {
                    this.updateAuthState({
                        isAuthExtensionInstalled: true,
                        isAuthenticated: status?.isAuthenticated,
                        isLoading: false,
                        workspaceState: {
                            isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                            isProjectInitialized: this.preflightState.workspaceState.isProjectSetup,
                        },
                    });
                });
                disposable && this.disposables.push(disposable);
                // Remove expensive sendList call from initialization - defer until needed
            } else {
                this.updateAuthState({
                    isAuthExtensionInstalled: false,
                    isAuthenticated: false,
                    isLoading: false,
                    workspaceState: {
                        isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                        isProjectInitialized: this.preflightState.workspaceState.isProjectSetup,
                    },
                });
            }
        } catch (error) {
            console.error("Error initializing Frontier API:", error);
            this.updateAuthState({
                isAuthExtensionInstalled: false,
                isAuthenticated: false,
                isLoading: false,
                error: "Failed to initialize Frontier API",
                workspaceState: {
                    isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                    isProjectInitialized: this.preflightState.workspaceState.isProjectSetup,
                },
            });
        }
    }

    private async updateAuthState(authState: AuthState) {
        // Add null check before sending
        if (!this.stateMachine) {
            console.warn("State machine not initialized when updating auth state");
            return;
        }

        let eventType: StartupFlowEvents;
        if (!authState.isAuthExtensionInstalled) {
            eventType = StartupFlowEvents.NO_AUTH_EXTENSION;
        } else if (authState.isAuthenticated) {
            eventType = StartupFlowEvents.AUTH_LOGGED_IN;
        } else {
            // This is the key change - explicitly handle not logged in case
            eventType = StartupFlowEvents.UPDATE_AUTH_STATE;
        }

        debugLog({
            eventType,
            authState: authState,
            stateMachine: this.stateMachine,
            preflightState: this.preflightState,
        });
        this.stateMachine.send({
            type: StartupFlowEvents.UPDATE_AUTH_STATE,
            data: {
                ...authState,
                isAuthExtensionInstalled: !!authState.isAuthExtensionInstalled,
                isAuthenticated: !!authState.isAuthenticated,
                isLoading: false,
                workspaceState: {
                    isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                    isProjectInitialized: this.preflightState.workspaceState.isProjectSetup,
                },
            },
        });

        this.stateMachine.send({
            type: eventType,
            data: {
                ...authState,
                isAuthExtensionInstalled: !!authState.isAuthExtensionInstalled,
                isAuthenticated: !!authState.isAuthenticated,
                isLoading: false,
                workspaceState: {
                    isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                    isProjectInitialized: this.preflightState.workspaceState.isProjectSetup,
                },
            },
        });
    }

    private notifyWebviews(message: MessagesFromStartupFlowProvider) {
        // Implement if needed to broadcast to all webviews
    }

    /**
     * Safely send a message to the current webview panel
     */
    private safeSendMessage(message: any): boolean {
        return safePostMessageToPanel(this.webviewPanel, message, "StartupFlow");
    }

    dispose() {
        this.webviewPanel?.dispose();
        this.webviewPanel = undefined;
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.metadataWatcher?.dispose();
    }

    private async handleAuthenticationMessage(
        webviewPanel: vscode.WebviewPanel,
        message: MessagesToStartupFlowProvider
    ) {
        debugLog("Handling authentication message", message.command);

        if (!this.frontierApi) {
            await this.initializeFrontierApi();
        }

        if (!this.frontierApi) {
            debugLog("Auth extension not installed");
            this.stateMachine.send({
                type: StartupFlowEvents.NO_AUTH_EXTENSION,
                data: {
                    isAuthExtensionInstalled: false,
                    isAuthenticated: false,
                    isLoading: false,
                    workspaceState: {
                        isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                        isProjectInitialized: this.preflightState.workspaceState.isProjectSetup,
                    },
                },
            });
            return;
        }

        switch (message.command) {
            case "auth.status": {
                debugLog("Getting auth status");
                try {
                    const status = this.frontierApi.getAuthStatus();
                    debugLog("Got auth status", status);
                    this.stateMachine.send({
                        type: StartupFlowEvents.UPDATE_AUTH_STATE,
                        data: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: status.isAuthenticated,
                            isLoading: false,
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.isProjectSetup,
                            },
                        },
                    });
                } catch (error) {
                    debugLog("Error getting auth status", error);
                    this.stateMachine.send({
                        type: StartupFlowEvents.UPDATE_AUTH_STATE,
                        data: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : "Failed to get auth status",
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.isProjectSetup,
                            },
                        },
                    });
                }
                break;
            }
            case "auth.login": {
                debugLog("Attempting login");
                try {
                    const success = await this.frontierApi.login(
                        message.username,
                        message.password
                    );
                    debugLog("Login attempt result:", {
                        success,
                        stateMachine: this.stateMachine,
                        preflightState: this.preflightState,
                    });
                    if (success) {
                        const status = this.frontierApi.getAuthStatus();
                        this.stateMachine.send({
                            type: StartupFlowEvents.AUTH_LOGGED_IN,
                            data: {
                                isAuthExtensionInstalled: true,
                                isAuthenticated: true,
                                isLoading: false,
                                workspaceState: {
                                    isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                    isProjectInitialized:
                                        this.preflightState.workspaceState.isProjectSetup,
                                },
                            },
                        });
                    } else {
                        throw new Error("Login failed");
                    }
                    await this.handleWorkspaceStatus(webviewPanel);
                } catch (error) {
                    debugLog("Login failed", error);
                    this.stateMachine.send({
                        type: StartupFlowEvents.UPDATE_AUTH_STATE,
                        data: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            error: this.getFormattedAuthError(error instanceof Error ? error.message : "Login failed"),
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.isProjectSetup,
                            },
                        },
                    });
                }
                break;
            }
            case "auth.signup": {
                debugLog("Attempting registration");
                if (!this.frontierApi) {
                    debugLog("Auth extension not installed");
                    this.stateMachine.send({
                        type: StartupFlowEvents.NO_AUTH_EXTENSION,
                        data: {
                            isAuthExtensionInstalled: false,
                            isAuthenticated: false,
                            isLoading: false,
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.isProjectSetup,
                            },
                        },
                    });
                    return;
                }
                try {
                    const wasRegisteredSuccessful = await this.frontierApi.register(
                        message.username,
                        message.email,
                        message.password
                    );
                    debugLog("Registration successful?", wasRegisteredSuccessful);
                    if (wasRegisteredSuccessful) {
                        this.stateMachine.send({
                            type: StartupFlowEvents.AUTH_LOGGED_IN,
                            data: {
                                isAuthExtensionInstalled: true,
                                isAuthenticated: true,
                                isLoading: false,
                                workspaceState: {
                                    isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                    isProjectInitialized:
                                        this.preflightState.workspaceState.isProjectSetup,
                                },
                            },
                        });
                        await this.handleWorkspaceStatus(webviewPanel);
                    } else {
                        throw new Error("Registration failed");
                    }
                } catch (error) {
                    debugLog("Registration failed", error);
                    this.stateMachine.send({
                        type: StartupFlowEvents.UPDATE_AUTH_STATE,
                        data: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            error: this.getFormattedAuthError(error instanceof Error ? error.message : "Registration failed"),
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.isProjectSetup,
                            },
                        },
                    });
                }
                break;
            }
            case "auth.logout": {
                debugLog("Attempting logout");
                try {
                    await this.frontierApi.logout();
                    debugLog("Logout successful");
                    this.stateMachine.send({
                        type: StartupFlowEvents.NO_AUTH_EXTENSION,
                        data: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.isProjectSetup,
                            },
                        },
                    });
                    await this.handleWorkspaceStatus(webviewPanel);
                } catch (error) {
                    debugLog("Logout failed", error);
                    this.stateMachine.send({
                        type: StartupFlowEvents.UPDATE_AUTH_STATE,
                        data: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: true,
                            isLoading: false,
                            error: error instanceof Error ? error.message : "Logout failed",
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.isProjectSetup,
                            },
                        },
                    });
                }
                break;
            }
            case "auth.backToLogin": {
                debugLog("Handling back to login");
                this.stateMachine.send({ type: StartupFlowEvents.BACK_TO_LOGIN });
                break;
            }
            case "auth.requestPasswordReset": {
                debugLog("Requesting password reset");

                try {
                    /*
                    // Legacy flow: POST to password reset endpoint and parse response.
                    const response = await fetch(
                        "https://api.frontierrnd.com/api/v1/auth/password-reset/request",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify({ email: message.resetEmail }),
                        }
                    );

                    if (response.ok) {
                        safePostMessageToPanel(webviewPanel, {
                            command: "passwordReset.success",
                        });
                        break;
                    }

                    const data = await response.json();
                    // Handle error response - detail might be a string or an object (validation error)
                    let errorMessage = "Failed to send reset link";
                    if (data.detail) {
                        if (typeof data.detail === "string") {
                            errorMessage = data.detail;
                        } else if (Array.isArray(data.detail)) {
                            // Handle array of validation errors
                            errorMessage = data.detail
                                .map((err: any) => {
                                    if (typeof err === "string") return err;
                                    if (err.msg) return err.msg;
                                    return JSON.stringify(err);
                                })
                                .join(", ");
                        } else if (typeof data.detail === "object") {
                            // Handle object validation error
                            if (data.detail.msg) {
                                errorMessage = data.detail.msg;
                            } else {
                                errorMessage = JSON.stringify(data.detail);
                            }
                        }
                    } else if (data.message) {
                        errorMessage =
                            typeof data.message === "string"
                                ? data.message
                                : JSON.stringify(data.message);
                    } else if (data.error) {
                        errorMessage =
                            typeof data.error === "string"
                                ? data.error
                                : JSON.stringify(data.error);
                    }
                    safePostMessageToPanel(webviewPanel, {
                        command: "passwordReset.error",
                        error: errorMessage,
                    });
                    break;
                    */

                    const resetUrl = "https://api.frontierrnd.com/login";
                    const didOpen = await vscode.env.openExternal(vscode.Uri.parse(resetUrl));

                    if (didOpen) {
                        safePostMessageToPanel(webviewPanel, {
                            command: "passwordReset.success",
                        });
                    } else {
                        safePostMessageToPanel(webviewPanel, {
                            command: "passwordReset.error",
                            error: `Unable to open the browser. Please visit ${resetUrl}.`,
                        });
                    }
                } catch (error) {
                    debugLog("Password reset request failed", error);
                    const errorMessage = error instanceof Error
                        ? error.message
                        : "An error occurred while requesting password reset";
                    safePostMessageToPanel(webviewPanel, {
                        command: "passwordReset.error",
                        error: errorMessage,
                    });
                }
                break;
            }
            case "startup.dismiss":
                debugLog("Dismissing startup flow");
                webviewPanel.dispose();
                break;
        }
    }

    private async handleWorkspaceStatus(webviewPanel: vscode.WebviewPanel) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const isOpen = !!workspaceFolders?.length;
        debugLog("Workspace status", { isOpen, workspaceFolders });
        if (!isOpen) {
            debugLog("Workspace is not open");
            this.stateMachine.send({ type: StartupFlowEvents.PROJECT_CLONE_OR_OPEN });
            return;
        }

        try {
            const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");
            await vscode.workspace.fs.stat(metadataUri);

            // First check auth status
            const authState = this.frontierApi?.getAuthStatus();
            if (!authState?.isAuthenticated) {
                // If not authenticated, don't send metadata response yet
                return;
            }

            // Read and parse metadata.json to check if project is properly setup
            const metadataContent = await vscode.workspace.fs.readFile(metadataUri);
            const metadata = JSON.parse(metadataContent.toString());

            // Check if metadata has required fields
            const hasProjectName = !!metadata.projectName;
            const sourceLanguage = metadata.languages?.find(
                (l: any) => l.projectStatus === "source"
            );
            const targetLanguage = metadata.languages?.find(
                (l: any) => l.projectStatus === "target"
            );

            // If both languages exist, close the startup flow and show project manager
            if (sourceLanguage && targetLanguage) {
                debugLog("Both languages exist, closing startup flow");
                await vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
                this.stateMachine.send({ type: StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN });
                webviewPanel.dispose();
                return;
            }

            // If only source language exists, go to critical data state to select target
            if (sourceLanguage && !targetLanguage) {
                debugLog("Only source language exists, prompting for target");
                this.stateMachine.send({ type: StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA });
                return;
            }

            // If neither language exists, go to critical data state
            this.stateMachine.send({ type: StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA });
        } catch {
            this.stateMachine.send({ type: StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT });
        }
    }

    private async handleWorkspaceMessage(
        webviewPanel: vscode.WebviewPanel,
        message: MessagesToStartupFlowProvider
    ) {
        debugLog("Handling workspace message", message.command);
        const workspaceFolders = vscode.workspace.workspaceFolders;

        switch (message.command) {
            case "workspace.status": {
                debugLog("Getting workspace status");
                await this.handleWorkspaceStatus(webviewPanel);

                break;
            }
            case "workspace.open": {
                debugLog("Opening workspace");
                const result = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    title: "Select Project Folder",
                });
                if (result && result[0]) {
                    await vscode.commands.executeCommand("vscode.openFolder", result[0]);
                }
                break;
            }
            case "workspace.create": {
                debugLog("Creating new workspace");
                const result = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    title: "Select Parent Folder",
                });
                if (result && result[0]) {
                    const folderName = await vscode.window.showInputBox({
                        prompt: "Enter project name",
                        validateInput: (text) => {
                            return text && text.length > 0 ? null : "Project name is required";
                        },
                    });
                    if (folderName) {
                        const projectPath = vscode.Uri.joinPath(result[0], folderName);
                        await vscode.workspace.fs.createDirectory(projectPath);
                        await vscode.commands.executeCommand("vscode.openFolder", projectPath);
                    }
                }
                break;
            }
            case "workspace.continue": {
                debugLog("Continuing with current workspace");
                // Close the startup flow panel
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    const relativePattern = new vscode.RelativePattern(
                        workspaceFolders[0],
                        "**/*.codex"
                    );
                    const codexNotebooksUris = await vscode.workspace.findFiles(relativePattern);
                    if (codexNotebooksUris.length === 0) {
                        vscode.commands.executeCommand("codex-project-manager.openSourceUpload");
                    } else {
                        vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
                    }
                } else {
                    debugLog("No workspace folder found");
                }
                webviewPanel.dispose();
                break;
            }
            case "project.open": {
                let projectPath = message.projectPath;
                debugLog("Opening project", projectPath);
                // If user selected a backup-named folder, normalize to canonical before proceeding
                try {
                    const normalized = await this.normalizeBackupPathForOpen(projectPath);
                    if (normalized !== projectPath) {
                        debugLog(`Normalized backup path to canonical: ${normalized}`);
                        projectPath = normalized;
                    }
                } catch (e) {
                    debugLog("Failed to normalize backup path for open", e);
                }

                // If this project has been deprecated (old side of a swap), prompt twice before proceeding
                try {
                    const projectUri = vscode.Uri.file(projectPath);
                    const metaResult = await MetadataManager.safeReadMetadata<ProjectMetadata>(projectUri);

                    // Check BOTH metadata.json AND localProjectSwap.json for swap info
                    let swapInfo = metaResult.success
                        ? (metaResult.metadata?.meta?.projectSwap as ProjectSwapInfo | undefined)
                        : undefined;

                    if (!swapInfo) {
                        try {
                            const { readLocalProjectSwapFile } = await import("../../utils/localProjectSettings");
                            const localSwapFile = await readLocalProjectSwapFile(projectUri);
                            if (localSwapFile?.remoteSwapInfo) {
                                swapInfo = localSwapFile.remoteSwapInfo;
                            }
                        } catch {
                            // Non-fatal
                        }
                    }

                    const { getActiveSwapEntry } = await import("../../utils/projectSwapManager");
                    const activeEntry = swapInfo ? getActiveSwapEntry(swapInfo) : undefined;

                    // isOldProject is now in each entry, not at the top level
                    if (activeEntry?.isOldProject) {
                        const displayName = path.basename(projectPath);
                        const recommended = activeEntry?.newProjectName || activeEntry?.newProjectUrl;

                        const firstPrompt = await vscode.window.showWarningMessage(
                            [
                                "This project has been deprecated.",
                                "",
                                recommended ? `Recommended project: ${recommended}` : undefined,
                                "",
                                `Do you still want to open "${displayName}"?`,
                            ]
                                .filter((part) => part !== undefined)
                                .join("\n"),
                            { modal: true },
                            "Open Deprecated Project"
                        );
                        if (firstPrompt !== "Open Deprecated Project") {
                            return;
                        }
                    } else if (!activeEntry && swapInfo?.swapEntries?.length) {
                        // No active swap, but has cancelled swap entries - check if new projects have had swap activity
                        // This indicates work may have continued in the new projects
                        const cancelledOldProjectEntries = swapInfo.swapEntries.filter(
                            (e: ProjectSwapEntry) => e.isOldProject && e.swapStatus === "cancelled"
                        );

                        if (cancelledOldProjectEntries.length > 0) {
                            // Show verifying state in the UI while we check new projects
                            this.safeSendMessage({
                                command: "project.openingInProgress",
                                projectPath,
                                opening: true,
                                verifying: true,
                            } as any);

                            // Get unique new project URLs from cancelled entries
                            const newProjectUrls = [...new Set(
                                cancelledOldProjectEntries
                                    .map((e: ProjectSwapEntry) => e.newProjectUrl)
                                    .filter(Boolean)
                            )] as string[];

                            // Helper to normalize URLs for comparison
                            const normalizeUrlForComparison = (url: string): string => {
                                let normalized = url.toLowerCase().trim();
                                if (normalized.endsWith(".git")) {
                                    normalized = normalized.slice(0, -4);
                                }
                                normalized = normalized.replace(/^https?:\/\//, "").replace(/\/$/, "");
                                return normalized;
                            };

                            // Get all local projects to check if new projects exist locally
                            const localProjects = await findAllCodexProjects();
                            const localProjectsByUrl = new Map<string, typeof localProjects[number]>();
                            for (const lp of localProjects) {
                                if (lp.gitOriginUrl) {
                                    localProjectsByUrl.set(normalizeUrlForComparison(lp.gitOriginUrl), lp);
                                }
                            }

                            // Check if any of the new projects have swap entries (indicating work continued)
                            // Check locally first, then remote if not available locally
                            let workContinuedInNewProjects = false;
                            const { extractProjectIdFromUrl, fetchRemoteMetadata } = await import("../../utils/remoteUpdatingManager");

                            for (const newUrl of newProjectUrls) {
                                try {
                                    const normalizedNewUrl = normalizeUrlForComparison(newUrl);
                                    const localNewProject = localProjectsByUrl.get(normalizedNewUrl);

                                    if (localNewProject) {
                                        // New project exists locally - check its local metadata
                                        debugLog("Checking local new project for swap activity:", localNewProject.path);
                                        try {
                                            const metadataPath = vscode.Uri.file(path.join(localNewProject.path, "metadata.json"));
                                            const metadataBuffer = await vscode.workspace.fs.readFile(metadataPath);
                                            const metadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8"));
                                            const newSwapInfo = metadata?.meta?.projectSwap;
                                            if (newSwapInfo?.swapEntries?.length) {
                                                workContinuedInNewProjects = true;
                                                debugLog("Local new project has swap entries - work continued");
                                                break;
                                            }
                                        } catch {
                                            debugLog("Failed to read local metadata, checking remote");
                                        }
                                    }

                                    // If not available locally or local read failed, check remote
                                    if (!workContinuedInNewProjects) {
                                        const newProjectId = extractProjectIdFromUrl(newUrl);
                                        if (newProjectId) {
                                            debugLog("Checking remote new project for swap activity:", newUrl);
                                            const newProjectMetadata = await fetchRemoteMetadata(newProjectId, false);
                                            const newSwapInfo = newProjectMetadata?.meta?.projectSwap;
                                            if (newSwapInfo?.swapEntries?.length) {
                                                workContinuedInNewProjects = true;
                                                debugLog("Remote new project has swap entries - work continued");
                                                break;
                                            }
                                        }
                                    }
                                } catch {
                                    // Failed to fetch new project metadata - continue checking others
                                }
                            }

                            // Clear verifying state before showing modal
                            this.safeSendMessage({
                                command: "project.openingInProgress",
                                projectPath,
                                opening: false,
                                verifying: false,
                            } as any);

                            if (workContinuedInNewProjects) {
                                // Show informational warning
                                const displayName = path.basename(projectPath);
                                const warningAction = await vscode.window.showWarningMessage(
                                    [
                                        "This project was previously deprecated.",
                                        "",
                                        "Work may have continued in the newer project(s).",
                                        "Opening this project may result in working with outdated content.",
                                        "",
                                        `Do you still want to open "${displayName}"?`,
                                    ].join("\n"),
                                    { modal: true },
                                    "Open Anyway"
                                );

                                if (warningAction !== "Open Anyway") {
                                    debugLog("User cancelled open of previously deprecated project");
                                    return;
                                }
                            }
                        }
                    }
                } catch (deprecatedCheckError) {
                    debugLog("Deprecated project open confirmation failed", deprecatedCheckError);
                    // Clear verifying state on error
                    this.safeSendMessage({
                        command: "project.openingInProgress",
                        projectPath,
                        opening: false,
                        verifying: false,
                    } as any);
                }

                try {
                    // Check if remote update is required before opening or if a local update is in-progress
                    let remoteUpdateWasPerformed = false;
                    let shouldHeal = false;
                    let updatingReason = "Remote requirement";
                    let remoteProjectRequirements:
                        | {
                            updateRequired: boolean;
                            updateReason?: string;
                            swapRequired: boolean;
                            swapReason?: string;
                            swapInfo?: ProjectSwapInfo;
                            currentUsername?: string | null;
                        }
                        | undefined;
                    try {
                        debugLog("Checking remote update requirement for project:", projectPath);
                        const { checkRemoteProjectRequirements } = await import("../../utils/remoteUpdatingManager");
                        // Pass true for bypassCache to ensure we verify connectivity before deciding to heal
                        remoteProjectRequirements = await checkRemoteProjectRequirements(projectPath, undefined, true);

                        if (remoteProjectRequirements.updateRequired) {
                            debugLog("Remote update required for user:", remoteProjectRequirements.currentUsername);
                            try {
                                await markPendingUpdateRequired(vscode.Uri.file(projectPath), "Remote requirement");
                            } catch (e) {
                                debugLog("Failed to persist pending update flag", e);
                            }
                            shouldHeal = true;
                            updatingReason = "Remote requirement";
                        } else {
                            // If remote no longer requires update, still continue if local state indicates an in-progress update
                            const hasLocalPending = await this.hasPendingLocalUpdate(projectPath);
                            if (hasLocalPending) {
                                debugLog("Local update state present; continuing update even though remote no longer requires it");
                                try {
                                    await markPendingUpdateRequired(vscode.Uri.file(projectPath), "Local pending update");
                                } catch (e) {
                                    debugLog("Failed to persist pending update flag for local pending state", e);
                                }
                                shouldHeal = true;
                                updatingReason = "Local pending update";
                            }
                        }

                        if (shouldHeal) {
                            remoteUpdateWasPerformed = true;

                            // Inform webview that updating is starting (not opening)
                            try {
                                this.safeSendMessage({
                                    command: "project.updatingInProgress",
                                    projectPath,
                                    updating: true,
                                } as any);
                            } catch (e) {
                                // non-fatal
                            }

                            // Show notification and perform update
                            await vscode.window.withProgress(
                                {
                                    location: vscode.ProgressLocation.Notification,
                                    title: updatingReason === "Remote requirement"
                                        ? "Project administrator requires update"
                                        : "Continuing update",
                                    cancellable: false,
                                },
                                async (progress) => {
                                    progress.report({ message: "Updating project..." });

                                    // Get project name for the update process
                                    const projectName = projectPath.split(/[\\/]/).pop() || "project";

                                    // Get git origin URL
                                    const git = await import("isomorphic-git");
                                    const fs = await import("fs");
                                    const remotes = await git.listRemotes({ fs, dir: projectPath });
                                    const origin = remotes.find((r) => r.remote === "origin");

                                    if (!origin) {
                                        throw new Error("No git origin found for project");
                                    }

                                    // Perform the update operation (suppress success message, we'll show it after opening)
                                    // Username is passed so local flag can be set BEFORE window reload
                                    await this.performProjectUpdate(
                                        progress,
                                        projectName,
                                        projectPath,
                                        origin.url,
                                        false, // Don't show success message yet
                                        remoteProjectRequirements?.currentUsername || undefined // Pass username for local flag
                                    );

                                    // Update flags are now set INSIDE performProjectUpdate (before window reload)
                                    // This ensures metadata.json has executed:true before sync runs on restart

                                    // Clear pending update flag
                                    try {
                                        await clearPendingUpdate(vscode.Uri.file(projectPath));
                                    } catch {
                                        // Non-fatal error
                                    }

                                    progress.report({ message: "Opening project..." });
                                }
                            );

                            // Clear local pending flag after successful update run (even if remote no longer required it)
                            try {
                                await clearPendingUpdate(vscode.Uri.file(projectPath));
                            } catch {
                                // Non-fatal error
                            }

                            // Inform webview that update is complete
                            try {
                                this.safeSendMessage({
                                    command: "project.updatingInProgress",
                                    projectPath,
                                    updating: false,
                                } as any);
                            } catch (e) {
                                // non-fatal
                            }
                        } else {
                            debugLog("No remote updating required:", remoteProjectRequirements?.updateReason);
                        }
                    } catch (updatingCheckErr) {
                        // If updating was attempted and failed/cancelled, DO NOT open the project.
                        debugLog("Remote updating check failed:", updatingCheckErr);
                        console.error("Remote updating check error:", updatingCheckErr);

                        if (remoteUpdateWasPerformed) {
                            // Clear updating state for the UI
                            try {
                                this.safeSendMessage({
                                    command: "project.updatingInProgress",
                                    projectPath,
                                    updating: false,
                                } as any);
                            } catch {
                                // non-fatal
                            }

                            // Tell the user and abort opening
                            const msg = updatingCheckErr instanceof Error ? updatingCheckErr.message : String(updatingCheckErr);
                            vscode.window.showWarningMessage(
                                "Update was not completed. The project will remain closed. Please try updating again.\n\nDetails: " + msg,
                                { modal: true }
                            );
                            return; // Abort opening flow
                        }
                    }

                    // Check if project swap is required before opening
                    let swapWasPerformed = false;
                    let swappedProjectPath: string | undefined;
                    try {
                        debugLog("Checking project swap requirement for project:", projectPath);
                        if (!remoteProjectRequirements) {
                            const { checkRemoteProjectRequirements } = await import("../../utils/remoteUpdatingManager");
                            remoteProjectRequirements = await checkRemoteProjectRequirements(projectPath, undefined, true);
                        }

                        const { checkProjectSwapRequired } = await import("../../utils/projectSwapManager");
                        const localSwapCheck = await checkProjectSwapRequired(
                            projectPath,
                            remoteProjectRequirements?.currentUsername || undefined
                        );
                        // Use Awaited to get the return type of checkProjectSwapRequired
                        type SwapCheckResult = Awaited<ReturnType<typeof checkProjectSwapRequired>>;
                        const swapCheck: SwapCheckResult = remoteProjectRequirements.swapRequired
                            ? (localSwapCheck.userAlreadySwapped
                                ? localSwapCheck
                                : { required: true, reason: "Remote swap required", swapInfo: remoteProjectRequirements.swapInfo, activeEntry: localSwapCheck.activeEntry })
                            : localSwapCheck;

                        if (swapCheck.userAlreadySwapped && swapCheck.activeEntry) {
                            const activeEntry = swapCheck.activeEntry;
                            const swapTargetLabel =
                                activeEntry.newProjectName || activeEntry.newProjectUrl || "the new project";
                            const alreadySwappedChoice = await vscode.window.showWarningMessage(
                                `You have already swapped to ${swapTargetLabel}.\n\n` +
                                "You can open this deprecated project, delete the local copy, or cancel.",
                                { modal: true },
                                "Open Project",
                                "Delete Local Project"
                            );

                            if (alreadySwappedChoice === "Delete Local Project") {
                                const projectName = projectPath.split(/[\\/]/).pop() || "project";
                                await this.performProjectDeletion(projectPath, projectName);
                                return;
                            }

                            if (alreadySwappedChoice !== "Open Project") {
                                return;
                            }
                        }

                        if (swapCheck.required && swapCheck.activeEntry && remoteProjectRequirements?.currentUsername) {
                            try {
                                const { extractProjectIdFromUrl, fetchRemoteMetadata, normalizeSwapUserEntry } = await import("../../utils/remoteUpdatingManager");
                                const { findSwapEntryByUUID, normalizeProjectSwapInfo } = await import("../../utils/projectSwapManager");
                                const newProjectUrl = swapCheck.activeEntry.newProjectUrl;
                                if (!newProjectUrl) {
                                    debugLog("No newProjectUrl found in swap info");
                                    throw new Error("No newProjectUrl");
                                }
                                const projectId = extractProjectIdFromUrl(newProjectUrl);
                                if (projectId) {
                                    const remoteMetadata = await fetchRemoteMetadata(projectId, false);
                                    const remoteSwap = remoteMetadata?.meta?.projectSwap;
                                    if (remoteSwap) {
                                        // Find matching entry in remote by swapUUID
                                        const normalizedRemoteSwap = normalizeProjectSwapInfo(remoteSwap);
                                        const matchingEntry = findSwapEntryByUUID(normalizedRemoteSwap, swapCheck.activeEntry.swapUUID);
                                        const entries = (matchingEntry?.swappedUsers || []).map((entry: ProjectSwapUserEntry) =>
                                            normalizeSwapUserEntry(entry)
                                        );
                                        const hasAlreadySwapped = entries.some(
                                            (entry: ProjectSwapUserEntry) =>
                                                entry.userToSwap === remoteProjectRequirements?.currentUsername &&
                                                entry.executed
                                        );
                                        if (hasAlreadySwapped) {
                                            const swapTargetLabel =
                                                swapCheck.activeEntry.newProjectName ||
                                                swapCheck.activeEntry.newProjectUrl ||
                                                "the new project";
                                            const alreadySwappedChoice = await vscode.window.showWarningMessage(
                                                `You have already swapped to ${swapTargetLabel}.\n\n` +
                                                "You can open this deprecated project, delete the local copy, or cancel.",
                                                { modal: true },
                                                "Open Project",
                                                "Delete Local Project"
                                            );

                                            if (alreadySwappedChoice === "Delete Local Project") {
                                                const projectName = projectPath.split(/[\\/]/).pop() || "project";
                                                await this.performProjectDeletion(projectPath, projectName);
                                                return;
                                            }

                                            if (alreadySwappedChoice !== "Open Project") {
                                                return;
                                            }
                                        }
                                    }
                                }
                            } catch (alreadySwappedCheckErr) {
                                debugLog("Failed to verify swap completion from new project metadata:", alreadySwappedCheckErr);
                            }
                        }

                        if (swapCheck.required && swapCheck.activeEntry) {
                            debugLog("Project swap required for project");

                            const activeEntry = swapCheck.activeEntry;
                            const newProjectUrl = activeEntry.newProjectUrl;
                            const newProjectName = activeEntry.newProjectName;
                            const swapUUID = activeEntry.swapUUID || "unknown";

                            if (!newProjectUrl) {
                                debugLog("No newProjectUrl found in swap info, skipping swap");
                                // Cannot continue with swap, fall through to normal open
                            } else {
                                const swapDecision = await this.promptForProjectSwapAction(activeEntry);
                                if (swapDecision === "cancel") {
                                    return;
                                }
                                if (swapDecision === "openDeprecated") {
                                    // Continue opening without swapping
                                } else {
                                    swapWasPerformed = true;

                                    // Show notification and perform swap
                                    await vscode.window.withProgress(
                                        {
                                            location: vscode.ProgressLocation.Notification,
                                            title: `Swapping to ${newProjectName}`,
                                            cancellable: false,
                                        },
                                        async (progress) => {
                                            progress.report({ message: "Starting swap..." });

                                            const projectName = projectPath.split(/[\\/]/).pop() || "project";

                                            // Import and perform swap
                                            const { performProjectSwap } = await import("./performProjectSwap");

                                            swappedProjectPath = await performProjectSwap(
                                                progress,
                                                projectName,
                                                projectPath,
                                                newProjectUrl,
                                                swapUUID,
                                                activeEntry.swapInitiatedAt
                                            );

                                            debugLog("Project swap completed successfully");
                                            progress.report({ message: "Swap complete!" });
                                        }
                                    );

                                    // Show success message
                                    vscode.window.showInformationMessage(
                                        `✅ Project swapped to ${newProjectName}\n\nOpening new project...`
                                    );
                                    if (swappedProjectPath) {
                                        await vscode.commands.executeCommand(
                                            "vscode.openFolder",
                                            vscode.Uri.file(swappedProjectPath)
                                        );
                                        return; // Stop the old open flow
                                    }
                                }
                            }
                        }
                    } catch (swapErr) {
                        debugLog("Project swap check/execution failed:", swapErr);
                        console.error("Project swap error:", swapErr);

                        if (swapWasPerformed) {
                            // Tell the user and abort opening
                            const msg = swapErr instanceof Error ? swapErr.message : String(swapErr);
                            vscode.window.showErrorMessage(
                                `Project swap failed.\n\nThe old project has been backed up to the "archived_projects" folder. ` +
                                `Please contact your project administrator for assistance.\n\nError: ${msg}`,
                                { modal: true }
                            );
                            return; // Abort opening flow
                        }
                    }

                    // Now inform webview that opening is starting (after updating/swap is complete)
                    try {
                        this.safeSendMessage({
                            command: "project.openingInProgress",
                            projectPath,
                            opening: true,
                        } as any);
                    } catch (e) {
                        // non-fatal
                    }

                    // If the project is set to auto-download, proactively remove pointer stubs in files/
                    // so that reconciliation will fetch real bytes after open.
                    try {
                        const projectUri = vscode.Uri.file(projectPath);
                        // Ensure settings file exists for this project (with defaults)
                        try {
                            const { ensureLocalProjectSettingsExists } = await import("../../utils/localProjectSettings");
                            await ensureLocalProjectSettingsExists(projectUri);
                        } catch (e) {
                            debugLog("Failed to ensure local project settings exist before open", e);
                        }
                        const { getMediaFilesStrategy, getFlags, setLastModeRun, setChangesApplied, getApplyState, setApplyState, getSwitchStarted, readLocalProjectSettings, writeLocalProjectSettings } = await import("../../utils/localProjectSettings");
                        const strategy = await getMediaFilesStrategy(projectUri);

                        // Initialize switchStarted flag if missing (one-time initialization on project open)
                        try {
                            const settings = await readLocalProjectSettings(projectUri);
                            if (settings.mediaFileStrategySwitchStarted === undefined) {
                                settings.mediaFileStrategySwitchStarted = false;
                                await writeLocalProjectSettings(settings, projectUri);
                                debugLog("Initialized mediaFileStrategySwitchStarted to false on project open");
                            }
                        } catch (initErr) {
                            debugLog("Failed to initialize switchStarted flag", initErr);
                        }

                        // If there are pending changes (either explicitly marked or
                        // inferred from a mismatch between last run and current), apply now
                        const flags = await getFlags(projectUri);
                        const applyState = await getApplyState(projectUri);
                        const switchStarted = await getSwitchStarted(projectUri);

                        // Detect interrupted switches: if switchStarted is true, we need to restart from scratch
                        // regardless of what lastModeRun says, because the previous switch was incomplete
                        if (strategy && (applyState === "pending" || applyState === "applying" || applyState === "failed" || switchStarted || (flags?.lastModeRun && flags.lastModeRun !== strategy))) {
                            const { applyMediaStrategy } = await import("../../utils/mediaStrategyManager");
                            const { setSwitchStarted } = await import("../../utils/localProjectSettings");
                            // Inform webview that we are resuming apply work for this project
                            try {
                                this.safeSendMessage({
                                    command: "project.mediaStrategyApplying",
                                    projectPath,
                                    applying: true,
                                } as any);
                            } catch (notifyStartErr) {
                                debugLog("Failed to send applying=true notification (resume)", notifyStartErr);
                            }
                            try {
                                // Mark applying while we resume and set switchStarted to detect interruptions
                                try {
                                    await setApplyState("applying", projectUri);
                                    await setSwitchStarted(true, projectUri); // Mark switch as started
                                } catch (pendingErr) {
                                    debugLog("Failed to set applyState=applying or switchStarted before resume", pendingErr);
                                }
                                // Force the apply when lastModeRun differs to ensure on-disk state matches selection
                                await applyMediaStrategy(projectUri, strategy, true);
                                await setLastModeRun(strategy, projectUri);
                                await setApplyState("applied", projectUri);
                                await setSwitchStarted(false, projectUri); // Clear flag on successful completion
                            } catch (resumeErr) {
                                debugLog("Failed during resume apply on open", resumeErr);
                                try { await setApplyState("failed", projectUri, { error: String(resumeErr) }); } catch (flagErr) { debugLog("Failed to set applyState=failed after resume error", flagErr); }
                            } finally {
                                try {
                                    this.safeSendMessage({
                                        command: "project.mediaStrategyApplying",
                                        projectPath,
                                        applying: false,
                                    } as any);
                                } catch (notifyEndErr) {
                                    debugLog("Failed to send applying=false notification (resume)", notifyEndErr);
                                }
                            }
                        }
                    } catch (prepErr) {
                        console.error("[StartupFlow] prepErr caught:", prepErr);
                        debugLog("Auto-download pre-open pointer cleanup skipped/failed:", prepErr);
                    }

                    // Open the project directly
                    const projectUri = vscode.Uri.file(projectPath);
                    await vscode.commands.executeCommand("vscode.openFolder", projectUri);

                } catch (error) {
                    console.error("Error opening project:", error);
                    vscode.window.showErrorMessage(
                        `Failed to open project: ${error instanceof Error ? error.message : String(error)}`
                    );
                } finally {
                    // Inform webview that opening is complete
                    try {
                        this.safeSendMessage({
                            command: "project.openingInProgress",
                            projectPath,
                            opening: false,
                        } as any);
                    } catch (e) {
                        // non-fatal
                    }
                }
                break;
            }
        }
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => { } };
    }

    private async handleProjectChange(command: string, data?: any) {
        try {
            if (command === "changeSourceLanguage" || command === "changeTargetLanguage") {
                const config = vscode.workspace.getConfiguration("codex-project-manager");
                const configKey =
                    command === "changeSourceLanguage" ? "sourceLanguage" : "targetLanguage";
                await config.update(configKey, data.language, vscode.ConfigurationTarget.Workspace);
                await vscode.commands.executeCommand("codex-project-manager.updateMetadataFile");
                vscode.window.showInformationMessage(
                    `${command === "changeSourceLanguage" ? "Source" : "Target"} language updated to ${data.language.refName}.`
                );
            } else {
                await vscode.commands.executeCommand(`codex-project-manager.${command}`);
                // After any project change command, show the Project Manager view
                await vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
            }
        } catch (error) {
            console.error(`Error handling ${command}:`, error);
            throw error;
        }
    }

    private setupMetadataWatcher(webviewPanel: vscode.WebviewPanel) {
        // Dispose of any existing watcher
        this.metadataWatcher?.dispose();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        // Create a new watcher for metadata.json
        this.metadataWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolders[0], "metadata.json")
        );

        // When metadata.json is created
        // FIXME: this logic isn't right - metadata.json doesn't get created with the complete project data initially.
        // part of the reason behind this is wanting to init git, create a project id, etc.
        // We *could* refactor the project creation logic to be more concise, but currently we can't say the project is initialized until the metadata.json is created AND populated (in the initialization function).
        // this.metadataWatcher.onDidCreate(() => {
        //     safePostMessageToPanel(webviewPanel, {
        //         command: "project.initializationStatus",
        //         isInitialized: true,
        //     });
        // });

        // Add watcher to disposables
        this.disposables.push(this.metadataWatcher);
    }

    // Add method to fetch project progress data
    private async fetchAndSendProgressData(webviewPanel?: vscode.WebviewPanel) {
        try {
            // Check if frontier authentication is available
            if (!this.frontierApi) {
                this.frontierApi = getAuthApi();
                if (!this.frontierApi) {
                    console.log("Frontier API not available for progress data");
                    return;
                }
            }

            // Check authentication status first
            const authStatus = this.frontierApi.getAuthStatus();
            if (!authStatus?.isAuthenticated) {
                debugLog("User not authenticated, skipping fetchAndSendProgressData");
                return;
            }

            // Try to get aggregated progress data
            try {
                const progressData = await vscode.commands.executeCommand(
                    "frontier.getAggregatedProgress"
                );

                if (progressData && this.webviewPanel) {
                    this.safeSendMessage({
                        command: "progressData",
                        data: progressData,
                    } as MessagesFromStartupFlowProvider);
                }
            } catch (error) {
                console.log("Unable to fetch progress data:", error);
            }
        } catch (error) {
            console.error("Error fetching progress data:", error);
        }
    }

    // Helper function to detect binary files
    private isBinaryFile(filePath: string): boolean {
        const binaryExtensions = [
            // Audio formats
            '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma', '.webm', '.opus', '.amr', '.3gp',
            // Video formats
            '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.m4v', '.mpg', '.mpeg',
            // Image formats
            '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.ico', '.svg', '.webp',
            // Document formats
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
            // Archive formats
            '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',
            // Other binary formats
            '.exe', '.dll', '.so', '.dylib', '.bin', '.dat'
        ];
        const ext = path.extname(filePath).toLowerCase();
        return binaryExtensions.includes(ext);
    }

    /**
     * Generate timestamp string for file naming
     */
    private generateTimestamp(): string {
        return new Date().toISOString().replace(/[:.]/g, "-");
    }

    /**
     * Count files recursively in a directory (for progress reporting)
     */
    private async countFilesRecursively(
        dirPath: string,
        options: { excludeGit?: boolean; } = { excludeGit: true }
    ): Promise<number> {
        let count = 0;

        if (!fs.existsSync(dirPath)) {
            return 0;
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (options.excludeGit && (entry.name === ".git" || entry.name.startsWith(".git"))) {
                continue;
            }

            const fullPath = `${dirPath}/${entry.name}`;
            if (entry.isDirectory()) {
                count += await this.countFilesRecursively(fullPath, options);
            } else if (entry.isFile()) {
                count++;
            }
        }
        return count;
    }

    /**
     * Create a zip file using archiver (streaming - memory efficient for large projects)
     * @param sourcePath - Source directory to zip
     * @param destPath - Destination path for the zip file
     * @param options - Options for the zip operation
     */
    private async createZipWithArchiver(
        sourcePath: string,
        destPath: string,
        options: {
            excludeGit?: boolean;
            rootFolderName?: string;
            onProgress?: (processed: number, total: number, currentFile: string) => void;
            cancellationToken?: vscode.CancellationToken;
        } = { excludeGit: true }
    ): Promise<void> {
        const totalFiles = await this.countFilesRecursively(sourcePath, { excludeGit: options.excludeGit });
        let processedFiles = 0;
        let cancelled = false;

        return new Promise<void>((resolve, reject) => {
            const output = fs.createWriteStream(destPath);
            const archive = archiver("zip", { zlib: { level: 9 } });

            // Handle cancellation
            if (options.cancellationToken) {
                options.cancellationToken.onCancellationRequested(() => {
                    cancelled = true;
                    archive.abort();
                    output.close();
                    // Clean up partial zip file
                    try {
                        if (fs.existsSync(destPath)) {
                            fs.unlinkSync(destPath);
                        }
                    } catch (e) {
                        debugLog("Failed to clean up cancelled zip file:", e);
                    }
                    reject(new Error("Zip operation cancelled"));
                });
            }

            output.on("close", () => {
                if (!cancelled) {
                    debugLog(`Zip created: ${archive.pointer()} bytes, ${processedFiles} files`);
                    resolve();
                }
            });

            output.on("error", (err: Error) => {
                reject(err);
            });

            archive.on("error", (err: Error) => {
                if (!cancelled) {
                    reject(err);
                }
            });

            archive.on("entry", (entry: { name: string; }) => {
                processedFiles++;
                if (options.onProgress && totalFiles > 0) {
                    options.onProgress(processedFiles, totalFiles, entry.name);
                }
            });

            archive.pipe(output);

            if (options.rootFolderName) {
                archive.directory(sourcePath, options.rootFolderName, (entry: { name: string; }) => {
                    if (options.excludeGit && (entry.name.startsWith(".git/") || entry.name === ".git")) {
                        return false;
                    }
                    return entry;
                });
            } else {
                archive.directory(sourcePath, false, (entry: { name: string; }) => {
                    if (options.excludeGit && (entry.name.startsWith(".git/") || entry.name === ".git")) {
                        return false;
                    }
                    return entry;
                });
            }

            archive.finalize().catch(reject);
        });
    }

    /**
     * Recursively copy files from source to destination
     * @param sourceUri - Source directory
     * @param destUri - Destination directory
     * @param options - Options for filtering files
     */
    private async copyDirectory(
        sourceUri: vscode.Uri,
        destUri: vscode.Uri,
        options: { excludeGit?: boolean; excludePatterns?: string[]; } = { excludeGit: true }
    ): Promise<void> {
        const entries = await vscode.workspace.fs.readDirectory(sourceUri);

        for (const [name, type] of entries) {
            // Skip .git folder based on options
            if (name === ".git" && options.excludeGit) {
                continue;
            }

            // Skip based on exclude patterns
            if (options.excludePatterns?.some(pattern => name.match(pattern))) {
                continue;
            }

            const sourceEntryUri = vscode.Uri.joinPath(sourceUri, name);
            const destEntryUri = vscode.Uri.joinPath(destUri, name);

            if (type === vscode.FileType.File) {
                const fileData = await vscode.workspace.fs.readFile(sourceEntryUri);
                await vscode.workspace.fs.writeFile(destEntryUri, fileData);
            } else if (type === vscode.FileType.Directory) {
                await vscode.workspace.fs.createDirectory(destEntryUri);
                await this.copyDirectory(sourceEntryUri, destEntryUri, options);
            }
        }
    }

    /**
     * Create a directory with proper error handling
     * @param dirUri - Directory URI to create
     * @returns true if created or already exists, false on error
     */
    private async ensureDirectoryExists(dirUri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.createDirectory(dirUri);
            return true;
        } catch (error) {
            // Check if directory already exists
            try {
                await vscode.workspace.fs.stat(dirUri);
                return true; // Directory already exists
            } catch {
                debugLog(`Failed to create directory: ${dirUri.fsPath}`, error);
                return false;
            }
        }
    }

    /**
     * Create a backup zip of a project
     * @param projectPath - Path to the project
     * @param projectName - Name of the project
     * @param includeGit - Whether to include .git folder
     * @returns URI of the created backup zip
     */
    private async createProjectBackup(
        projectPath: string,
        projectName: string,
        includeGit: boolean = false
    ): Promise<vscode.Uri> {
        const timestamp = this.generateTimestamp();
        const codexProjectsDir = await getCodexProjectsDirectory();
        const archivedProjectsDir = vscode.Uri.joinPath(codexProjectsDir, "archived_projects");

        // Ensure archived_projects directory exists
        await this.ensureDirectoryExists(archivedProjectsDir);

        // Create backup zip
        const backupFileName = `${projectName}_backup_${timestamp}.zip`;
        const backupUri = vscode.Uri.joinPath(archivedProjectsDir, backupFileName);

        // Use streaming archiver for memory efficiency
        await this.createZipWithArchiver(
            projectPath,
            backupUri.fsPath,
            { excludeGit: !includeGit }
        );

        return backupUri;
    }

    /**
     * Write file content with proper handling for binary vs text files
     * @param fileUri - The file URI to write to
     * @param content - The content to write (string for text, Uint8Array for binary)
     * @param isBinary - Whether the file is binary
     */
    private async writeFileContent(
        fileUri: vscode.Uri,
        content: string | Uint8Array,
        isBinary: boolean
    ): Promise<void> {
        if (isBinary) {
            await vscode.workspace.fs.writeFile(fileUri, content as Uint8Array);
        } else {
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content as string, 'utf8'));
        }
    }

    private async promptForProjectSwapAction(
        activeEntry: ProjectSwapEntry
    ): Promise<"swap" | "openDeprecated" | "cancel"> {
        const confirm = await vscode.window.showWarningMessage(
            `Swap project to "${activeEntry.newProjectName}"?\n\n` +
            `This will:\n` +
            `1. Backup your current project to archives\n` +
            `2. Clone the new repository\n` +
            `3. Merge your local work (.codex, .source, etc.)\n\n` +
            `This process may take a few minutes.`,
            { modal: true },
            "Swap Project",
            "Open Without Swapping"
        );

        if (confirm === "Swap Project") {
            return "swap";
        }

        if (confirm === "Open Without Swapping") {
            const deprecatedChoice = await vscode.window.showWarningMessage(
                [
                    "This project has been deprecated.",
                    activeEntry.newProjectName
                        ? `Recommended project: ${activeEntry.newProjectName}`
                        : activeEntry.newProjectUrl
                            ? `Recommended project: ${activeEntry.newProjectUrl}`
                            : undefined,
                    "",
                    "Opening without swapping will keep you on the deprecated project.",
                    "Do you still want to open it?",
                ]
                    .filter(Boolean)
                    .join("\n"),
                { modal: true },
                "Open Deprecated Project"
            );
            return deprecatedChoice === "Open Deprecated Project" ? "openDeprecated" : "cancel";
        }

        return "cancel";
    }

    private async handleMessage(
        message:
            | MessagesToStartupFlowProvider
            | ProjectManagerMessageFromWebview
            | MessagesFromStartupFlowProvider
    ) {
        switch (message.command) {
            case "openProjectSettings":
            case "renameProject":
            case "editAbbreviation":
            case "changeSourceLanguage":
            case "changeTargetLanguage":
            case "selectCategory":
            case "downloadSourceText":
            case "openAISettings":
            case "openSourceUpload":
                await this.handleProjectChange(message.command, message);
                // FIXME: sometimes this refreshes before the command is finished. Need to return values on all of them
                // Send a response back to the webview
                this.safeSendMessage({ command: "actionCompleted" });
                break;
            case "getAggregatedProgress":
                debugLog("Fetching aggregated progress data");
                try {
                    if (!this.frontierApi) {
                        this.frontierApi = getAuthApi();
                        if (!this.frontierApi) {
                            console.log("Frontier API not available for progress data");
                            return;
                        }
                    }

                    // Check authentication status first
                    const authStatus = this.frontierApi.getAuthStatus();
                    if (!authStatus?.isAuthenticated) {
                        debugLog("User not authenticated, skipping aggregated progress fetch");
                        return;
                    }

                    const progressData = await vscode.commands.executeCommand(
                        "frontier.getAggregatedProgress"
                    );

                    if (progressData) {
                        this.safeSendMessage({
                            command: "aggregatedProgressData",
                            data: progressData,
                        } as MessagesFromStartupFlowProvider);
                    }
                } catch (error) {
                    console.error("Error fetching aggregated progress data:", error);
                    this.safeSendMessage({
                        command: "error",
                        message: `Failed to fetch progress data: ${error instanceof Error ? error.message : String(error)}`,
                    } as MessagesFromStartupFlowProvider);
                }
                break;
            case "project.showManager":
                await vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
                break;
            case "project.createEmpty": {
                debugLog("Creating empty project");
                await createNewWorkspaceAndProject(this.context);
                break;
            }
            case "project.createEmptyWithName": {
                try {
                    const inputName = (message as any).projectName as string;
                    const sanitized = sanitizeProjectName(inputName);
                    if (sanitized !== inputName) {
                        // Generate projectId when sanitization is needed (will be confirmed in modal)
                        const projectId = generateProjectId();
                        this.safeSendMessage({
                            command: "project.nameWillBeSanitized",
                            original: inputName,
                            sanitized,
                            projectId,
                        } as MessagesFromStartupFlowProvider);
                        // Optionally wait for confirm message from webview
                    } else {
                        // Generate projectId immediately if no sanitization needed
                        const projectId = generateProjectId();
                        await this.context.globalState.update("pendingProjectCreate", true);
                        // Store sanitized name WITHOUT UUID for metadata.json
                        // The folder name will still include the UUID via createWorkspaceWithProjectName
                        await this.context.globalState.update("pendingProjectCreateName", sanitized);
                        await this.context.globalState.update("pendingProjectCreateId", projectId);
                        await createWorkspaceWithProjectName(sanitized, projectId);
                    }
                } catch (error) {
                    console.error("Error creating project with name:", error);
                }
                break;
            }
            case "project.createEmpty.confirm": {
                const { proceed, projectName, projectId } = message;
                if (proceed && projectName) {
                    await this.context.globalState.update("pendingProjectCreate", true);
                    // Use provided projectId or generate one if not provided (shouldn't happen in normal flow)
                    const finalProjectId = projectId || generateProjectId();
                    // Store sanitized name WITHOUT UUID for metadata.json
                    // The folder name will still include the UUID via createWorkspaceWithProjectName
                    await this.context.globalState.update("pendingProjectCreateName", projectName);
                    await this.context.globalState.update("pendingProjectCreateId", finalProjectId);
                    await createWorkspaceWithProjectName(projectName, finalProjectId);
                }
                break;
            }
            case "project.checkNameExists": {
                try {
                    const { projectName } = message;
                    const sanitized = sanitizeProjectName(projectName);
                    const checkResult = await checkProjectNameExists(sanitized);
                    this.safeSendMessage({
                        command: "project.nameExistsCheck",
                        exists: checkResult.exists,
                        isCodexProject: checkResult.isCodexProject,
                        errorMessage: checkResult.errorMessage,
                    } as MessagesFromStartupFlowProvider);
                } catch (error) {
                    console.error("Error checking project name:", error);
                    this.safeSendMessage({
                        command: "project.nameExistsCheck",
                        exists: false,
                        isCodexProject: false,
                    } as MessagesFromStartupFlowProvider);
                }
                break;
            }
            case "project.initialize": {
                debugLog("Initializing project");

                // Extract projectId from folder name if it exists
                const workspaceFolders = vscode.workspace.workspaceFolders;
                let projectId: string | undefined;

                if (workspaceFolders && workspaceFolders[0]) {
                    projectId = extractProjectIdFromFolderName(workspaceFolders[0].name);
                    if (projectId) {
                        debugLog("Extracted projectId from folder name:", projectId);
                    }
                }

                await createNewProject({ projectId });

                // Wait for metadata.json to be created
                if (workspaceFolders) {
                    try {
                        const metadataUri = vscode.Uri.joinPath(
                            workspaceFolders[0].uri,
                            "metadata.json"
                        );
                        // Wait for metadata.json to exist
                        await vscode.workspace.fs.stat(metadataUri);

                        // Show Project Manager view first
                        await vscode.commands.executeCommand(
                            "codex-project-manager.showProjectOverview"
                        );

                        // Send initialization status to webview
                        this.safeSendMessage({
                            command: "project.initializationStatus",
                            isInitialized: true,
                        });

                        this.stateMachine.send({ type: StartupFlowEvents.INITIALIZE_PROJECT });
                    } catch (error) {
                        console.error("Error checking metadata.json:", error);
                        // If metadata.json doesn't exist yet, don't transition state
                        this.safeSendMessage({
                            command: "project.initializationStatus",
                            isInitialized: false,
                        });
                    }
                }
                break;
            }
            case "webview.ready": {
                // Try to initialize Frontier API if it's missing (e.g. extension just installed)
                if (!this.frontierApi) {
                    await this.initializeFrontierApi();
                }

                // Use cached preflight state instead of creating new PreflightCheck
                // Force refresh if we are forcing login, to ensure auth state is up to date
                const shouldRefresh = this._forceLogin;
                const preflightState = await this.getCachedPreflightState(shouldRefresh);
                debugLog("Sending cached preflight state:", preflightState);
                this.stateMachine.send({
                    type: StartupFlowEvents.UPDATE_AUTH_STATE,
                    data: preflightState.authState,
                });

                // If forcing login, stay in LOGIN_REGISTER (initial state) and don't auto-redirect
                if (this._forceLogin) {
                    debugLog("Forcing login flow - skipping auto-redirects");
                    this._forceLogin = false; // Reset flag
                    return;
                }

                // Check workspace status
                if (!preflightState.workspaceState.isOpen) {
                    this.stateMachine.send({ type: StartupFlowEvents.PROJECT_CLONE_OR_OPEN });
                    return;
                }

                // Check if metadata exists and project is set up
                if (preflightState.workspaceState.hasMetadata) {
                    if (preflightState.workspaceState.isProjectSetup) {
                        this.stateMachine.send({
                            type: StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN,
                        });
                    } else {
                        this.stateMachine.send({
                            type: StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA,
                        });
                    }
                } else {
                    this.stateMachine.send({
                        type: StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT,
                    });
                }
                break;
            }
            case "auth.status":
            case "auth.login":
            case "auth.signup":
            case "auth.logout":
            case "auth.backToLogin":
            case "auth.requestPasswordReset":
                debugLog("Handling authentication message", message.command);
                await this.handleAuthenticationMessage(this.webviewPanel!, message);
                break;
            case "startup.dismiss":
                debugLog("Dismissing startup flow");
                this.webviewPanel?.dispose();
                break;
            case "skipAuth":
                debugLog("Skipping authentication");
                this.stateMachine.send({ type: StartupFlowEvents.SKIP_AUTH });
                break;
            case "network.connectivityRestored":
                // Notify the auth extension to revalidate the session now that we're back online
                debugLog("Connectivity restored - triggering session revalidation");
                try {
                    await vscode.commands.executeCommand("frontier.onConnectivityRestored");
                } catch (error) {
                    // Auth extension might not be installed, ignore silently
                    debugLog("Could not notify auth extension of connectivity restored:", error);
                }
                break;
            case "extension.installFrontier":
                debugLog("Opening extensions view");
                await vscode.commands.executeCommand("workbench.view.extensions");
                break;
            case "project.triggerSync":
                // Trigger a sync operation via the SyncManager
                try {
                    debugLog("Triggering sync after login");
                    // Destructure message for type safety
                    const { message: commitMessage = "Sync after login" } = message;

                    // Execute the sync command which is registered in syncManager.ts
                    await vscode.commands.executeCommand(
                        "codex-editor-extension.triggerSync",
                        commitMessage
                    );
                } catch (error) {
                    console.error("Error triggering sync:", error);
                }
                break;
            case "project.submitProgressReport":
                // Trigger progress report submission via the SyncManager
                try {
                    debugLog("Submitting progress report");
                    const { forceSubmit = false } = message;

                    // Execute the report submission command which is registered in syncManager.ts
                    await vscode.commands.executeCommand(
                        "codex-editor-extension.submitProgressReport",
                        forceSubmit
                    );

                    // Send response back to webview
                    this.safeSendMessage({
                        command: "project.progressReportSubmitted",
                        success: true,
                    });
                } catch (error) {
                    console.error("Error submitting progress report:", error);
                    // Send error response back to webview
                    this.safeSendMessage({
                        command: "project.progressReportSubmitted",
                        success: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                break;
            case "workspace.status":
            case "workspace.open":
            case "workspace.create":
            case "workspace.continue":
            case "project.open":
                debugLog("Handling workspace message", message.command);
                await this.handleWorkspaceMessage(this.webviewPanel!, message);
                break;
            case "extension.check": {
                this.stateMachine.send({
                    type: "extension.checkResponse",
                    data: {
                        isInstalled: !!this.frontierApi,
                    },
                });
                break;
            }
            case "navigateToMainMenu": {
                await vscode.commands.executeCommand("codex-editor.navigateToMainMenu");
                break;
            }
            case "metadata.check": {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                    try {
                        const metadataUri = vscode.Uri.joinPath(
                            workspaceFolders[0].uri,
                            "metadata.json"
                        );
                        const metadataContent = await vscode.workspace.fs.readFile(metadataUri);
                        const metadata = JSON.parse(metadataContent.toString());

                        const sourceLanguage = metadata.languages?.find(
                            (l: any) => l.projectStatus === "source"
                        );
                        const targetLanguage = metadata.languages?.find(
                            (l: any) => l.projectStatus === "target"
                        );

                        // Get source texts
                        const sourceTexts = metadata.ingredients
                            ? Object.keys(metadata.ingredients)
                            : [];

                        this.safeSendMessage({
                            command: "metadata.checkResponse",
                            data: {
                                sourceLanguage,
                                targetLanguage,
                                sourceTexts,
                            },
                        });
                    } catch (error) {
                        console.error("Error checking metadata:", error);
                        this.safeSendMessage({
                            command: "metadata.checkResponse",
                            data: {
                                sourceLanguage: null,
                                targetLanguage: null,
                                sourceTexts: [],
                            },
                        });
                    }
                }
                break;
            }
            case "getProjectsListFromGitLab": {
                debugLog("Fetching GitLab projects list");
                await this.sendList(this.webviewPanel!);
                break;
            }
            case "getProjectsSyncStatus": {
                debugLog("Fetching projects sync status");
                try {
                    // Get workspace folders to check local repositories
                    const localRepos = new Set<string>();


                    // Get GitLab projects
                    const projects = (await this.frontierApi?.listProjects(false)) || [];

                    // Create status map
                    const status: Record<number, "synced" | "cloud" | "error"> = {};

                    for (const project of projects) {
                        if (localRepos.has(project.url)) {
                            // Project exists locally and is in GitLab
                            status[project.id] = "synced";
                        } else {
                            // Project is only in GitLab
                            status[project.id] = "cloud";
                        }
                    }

                    // Send status back to webview
                    this.stateMachine.send({
                        type: "projectsSyncStatus",
                        data: {
                            status,
                        },
                    });
                } catch (error) {
                    console.error("Failed to get projects sync status:", error);
                    this.stateMachine.send({
                        type: "projectsSyncStatus",
                        data: {
                            status: {},
                            error:
                                error instanceof Error
                                    ? error.message
                                    : "Failed to get projects sync status",
                        },
                    });
                }
                break;
            }
            case "project.cloneDeprecated": {
                await this.cloneProjectWithChecks(message.repoUrl, message.mediaStrategy, true);
                break;
            }
            case "project.clone": {
                await this.cloneProjectWithChecks(message.repoUrl, message.mediaStrategy, false);
                break;
            }
            case "project.delete": {
                debugLog("Project deletion request received:", message);

                // Extract project path from either format
                const projectPath =
                    "projectPath" in message
                        ? message.projectPath
                        : "data" in message &&
                            message.data &&
                            typeof message.data === "object" &&
                            "path" in message.data
                            ? message.data.path
                            : "";

                debugLog("Extracted project path for deletion:", projectPath);

                if (!projectPath) {
                    debugLog("No project path provided in delete message");
                    this.safeSendMessage({
                        command: "project.deleteResponse",
                        success: false,
                        error: "No project path provided",
                    });
                    return;
                }

                // Ensure the path exists
                try {
                    const projectUri = vscode.Uri.file(projectPath);
                    await vscode.workspace.fs.stat(projectUri);

                    // Show confirmation dialog
                    const projectName = projectPath.split("/").pop() || projectPath;



                    // Determine if this is a cloud-synced project
                    let isCloudSynced = false;
                    try {
                        const localProjects = await findAllCodexProjects();
                        const project = localProjects.find((p) => p.path === projectPath);
                        // If the project has a git origin URL, it might be synced with cloud
                        isCloudSynced = !!project?.gitOriginUrl;

                        // If we have sync status info from the message, use that
                        if (
                            "syncStatus" in message &&
                            message.syncStatus === "downloadedAndSynced"
                        ) {
                            isCloudSynced = true;
                        }
                    } catch (error) {
                        console.error("Error determining project sync status:", error);
                        // Fall back to local-only message if we can't determine
                        isCloudSynced = false;
                    }

                    // Confirmation message based on sync status
                    let confirmMessage: string;
                    let actionButtonText: string;

                    if (isCloudSynced) {
                        confirmMessage = `Are you sure you want to delete project \n"${projectName}" locally?\n\nPlease ensure the project is synced before deleting.`;
                        actionButtonText = "Delete";
                    } else {
                        confirmMessage = `Are you sure you want to delete project \n"${projectName}"?\n\nThis action cannot be undone.`;
                        actionButtonText = "Delete";
                    }

                    const confirmResult = await vscode.window.showWarningMessage(
                        confirmMessage,
                        { modal: true },
                        actionButtonText
                    );

                    if (confirmResult === actionButtonText) {
                        // Perform deletion
                        await this.performProjectDeletion(projectPath, projectName);
                    } else {
                        // User cancelled deletion
                        this.safeSendMessage({
                            command: "project.deleteResponse",
                            success: false,
                            error: "Operation cancelled by user",
                        });
                    }
                } catch (error) {
                    console.error("Project not found:", error);
                    vscode.window.showErrorMessage("The specified project could not be found.");

                    // Send error response to webview
                    this.safeSendMessage({
                        command: "project.deleteResponse",
                        success: false,
                        error: "The specified project could not be found.",
                    });

                    // Still attempt to refresh the list to ensure UI is in sync
                    await this.sendList(this.webviewPanel!);
                }

                break;
            }
            case "getProjectProgress":
                // Handle request for project progress data
                await this.fetchAndSendProgressData();
                break;
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
            case "zipProject": {
                const { projectName, projectPath, includeGit = false } = message;

                try {
                    // Show file picker for save location
                    const saveUri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file(`${projectName}.zip`),
                        filters: {
                            "ZIP files": ["zip"],
                        },
                    });

                    if (!saveUri) {
                        return;
                    }

                    // Inform webview that zipping is starting
                    try {
                        this.safeSendMessage({
                            command: "project.zippingInProgress",
                            projectPath,
                            zipType: includeGit ? "full" : "mini",
                            zipping: true,
                        } as any);
                    } catch (e) {
                        // non-fatal
                    }

                    try {
                        let lastReportedPercent = 0;

                        // Show progress indicator with cancel support
                        await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: `Zipping ${projectName}...`,
                                cancellable: true,
                            },
                            async (progress, token) => {
                                progress.report({ increment: 0, message: "Starting..." });

                                // Use streaming archiver for memory efficiency
                                await this.createZipWithArchiver(
                                    projectPath,
                                    saveUri.fsPath,
                                    {
                                        excludeGit: !includeGit,
                                        onProgress: (processed, total, _currentFile) => {
                                            const percent = Math.round((processed / total) * 100);
                                            // Only report every 2% to avoid too many updates
                                            if (percent >= lastReportedPercent + 2 || percent === 100) {
                                                const increment = percent - lastReportedPercent;
                                                progress.report({
                                                    increment,
                                                    message: `${percent}% complete (${processed}/${total} files)`
                                                });
                                                lastReportedPercent = percent;

                                                // Send progress to webview (synced with notification)
                                                try {
                                                    this.safeSendMessage({
                                                        command: "project.zippingInProgress",
                                                        projectPath,
                                                        zipType: includeGit ? "full" : "mini",
                                                        zipping: true,
                                                        percent,
                                                    } as any);
                                                } catch (e) {
                                                    // non-fatal
                                                }
                                            }
                                        },
                                        cancellationToken: token,
                                    }
                                );
                            }
                        );

                        const gitMessage = includeGit ? " (including git history)" : "";
                        vscode.window.showInformationMessage(
                            `Project "${projectName}" has been zipped successfully${gitMessage}!`
                        );
                    } catch (error) {
                        // Handle cancellation separately
                        if (error instanceof Error && error.message === "Zip operation cancelled") {
                            vscode.window.showInformationMessage("Zip operation was cancelled.");
                            return;
                        }
                        throw error; // Re-throw other errors to be handled by outer catch
                    } finally {
                        // Inform webview that zipping is complete
                        try {
                            this.safeSendMessage({
                                command: "project.zippingInProgress",
                                projectPath,
                                zipType: includeGit ? "full" : "mini",
                                zipping: false,
                            } as any);
                        } catch (e) {
                            // non-fatal
                        }
                    }
                } catch (error) {
                    debugLog("Error zipping project:", error);
                    vscode.window.showErrorMessage(
                        `Failed to zip project: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
                break;
            }
            case "project.setMediaStrategy": {
                const { projectPath, mediaStrategy } = message;

                if (!projectPath || !mediaStrategy) {
                    vscode.window.showErrorMessage("Invalid parameters for setting media strategy");
                    return;
                }

                try {
                    // Import required modules
                    const { getMediaFilesStrategy } = await import("../../utils/localProjectSettings");
                    const { applyMediaStrategy, applyMediaStrategyAndRecord } = await import("../../utils/mediaStrategyManager");
                    const { setMediaFilesStrategy, setLastModeRun, setChangesApplied, getFlags } = await import("../../utils/localProjectSettings");

                    const projectUri = vscode.Uri.file(projectPath);
                    // Ensure settings json exists prior to reads/writes
                    try {
                        const { ensureLocalProjectSettingsExists } = await import("../../utils/localProjectSettings");
                        await ensureLocalProjectSettingsExists(projectUri);
                    } catch (e) {
                        debugLog("Failed to ensure local project settings exist before setMediaStrategy", e);
                    }
                    const currentStrategy = await getMediaFilesStrategy(projectUri);

                    // Check if strategy is actually changing
                    if (currentStrategy === mediaStrategy) {
                        debugLog(`Media strategy already set to "${mediaStrategy}"`);
                        // Always notify webview so it can clear any pending UI state
                        try {
                            this.safeSendMessage({
                                command: "project.setMediaStrategyResult",
                                success: true,
                                projectPath,
                                mediaStrategy,
                                noChange: true,
                            } as any);
                        } catch (notifyErr) {
                            debugLog("Failed to notify webview (no change)", notifyErr);
                        }
                        return;
                    }

                    // Check if user is switching back to the last applied strategy
                    // If so, skip the dialog and auto-apply (no file changes needed)
                    // BUT: if switchStarted is true, we need to reapply to recover from an interrupted switch
                    const flags = await getFlags(projectUri);
                    const { getSwitchStarted, setSwitchStarted } = await import("../../utils/localProjectSettings");
                    const switchStarted = await getSwitchStarted(projectUri);

                    if (flags?.lastModeRun === mediaStrategy && !switchStarted) {
                        debugLog(`Switching back to last applied strategy "${mediaStrategy}" - auto-applying without dialog`);

                        // Clear keepFilesOnStreamAndSave if switching away from stream-and-save
                        if (mediaStrategy !== "stream-and-save") {
                            try {
                                const { readLocalProjectSettings, writeLocalProjectSettings } = await import("../../utils/localProjectSettings");
                                const settings = await readLocalProjectSettings(projectUri);
                                if (settings.keepFilesOnStreamAndSave !== undefined) {
                                    settings.keepFilesOnStreamAndSave = undefined;
                                    await writeLocalProjectSettings(settings, projectUri);
                                }
                            } catch (e) { /* ignore */ }
                        }

                        // Just update the stored strategy without touching files
                        await setMediaFilesStrategy(mediaStrategy, projectUri);
                        await setLastModeRun(mediaStrategy, projectUri);
                        await setChangesApplied(true, projectUri);
                        await setSwitchStarted(false, projectUri); // Ensure flag is cleared

                        // Notify webview of success
                        try {
                            this.safeSendMessage({
                                command: "project.setMediaStrategyResult",
                                success: true,
                                projectPath,
                                mediaStrategy,
                                autoApplied: true,
                            } as any);
                        } catch (notifyErr) {
                            debugLog("Failed to notify webview (auto-applied)", notifyErr);
                        }
                        return;
                    }

                    // Show confirmation dialog for strategy changes
                    let confirmMessage = "";
                    const switchButton = "Switch";

                    if (mediaStrategy === "auto-download") {
                        confirmMessage =
                            `Switch to "Auto Download Media"?\n\n` +
                            `This will download all media files.\n\n` +
                            `This may use significant disk space and bandwidth.`;
                    } else if (mediaStrategy === "stream-only") {
                        confirmMessage =
                            `Switch to "Stream Only"?\n\n` +
                            `Media will be streamed from the server when needed.\n\n` +
                            `Requires internet connection to play media.`;
                    } else if (mediaStrategy === "stream-and-save") {
                        confirmMessage =
                            `Switch to "Stream & Save"?\n\n` +
                            `Media files will be downloaded & saved when you play them.\n\n` +
                            `Best balance between disk space and offline availability.`;
                    }

                    const selection = await vscode.window.showInformationMessage(
                        confirmMessage,
                        { modal: true },
                        switchButton
                    );

                    if (!selection) {
                        debugLog("User cancelled media strategy change");
                        // Notify webview to revert selection
                        this.safeSendMessage({
                            command: "project.setMediaStrategyResult",
                            success: false,
                            projectPath,
                            mediaStrategy,
                        } as any);
                        return;
                    }

                    if (selection === switchButton) {
                        // Switch but do not open; mark changesApplied=false and only update strategy

                        // Only ask about keeping files when: auto-download → stream-and-save
                        // For stream-only: always convert to pointers (no prompt)
                        // From stream-only: nothing to keep (no prompt)
                        if (currentStrategy === "auto-download" && mediaStrategy === "stream-and-save") {
                            const { countDownloadedMediaFiles } = await import("../../utils/mediaStrategyManager");
                            const downloadedCount = await countDownloadedMediaFiles(projectPath);

                            if (downloadedCount > 0) {
                                const keepOrFreeChoice = await vscode.window.showInformationMessage(
                                    `${downloadedCount} media file(s) stored locally. Keep or free up space?`,
                                    { modal: true },
                                    "Keep Files",
                                    "Free Space"
                                );

                                if (!keepOrFreeChoice) {
                                    // User cancelled - revert selection
                                    debugLog("User cancelled keep/free choice for media strategy change");
                                    this.safeSendMessage({
                                        command: "project.setMediaStrategyResult",
                                        success: false,
                                        projectPath,
                                        mediaStrategy,
                                    } as any);
                                    return;
                                }

                                // Store choice to apply when project opens
                                const { readLocalProjectSettings, writeLocalProjectSettings } = await import("../../utils/localProjectSettings");
                                const settings = await readLocalProjectSettings(projectUri);
                                settings.keepFilesOnStreamAndSave = (keepOrFreeChoice === "Keep Files");
                                await writeLocalProjectSettings(settings, projectUri);

                                vscode.window.showInformationMessage("Changes apply when project opens.");
                            }
                        } else if (mediaStrategy !== "stream-and-save") {
                            // Clear keepFilesOnStreamAndSave if switching away from stream-and-save
                            // (e.g., user switched to stream-and-save, then back to auto-download)
                            try {
                                const { readLocalProjectSettings, writeLocalProjectSettings } = await import("../../utils/localProjectSettings");
                                const settings = await readLocalProjectSettings(projectUri);
                                if (settings.keepFilesOnStreamAndSave !== undefined) {
                                    settings.keepFilesOnStreamAndSave = undefined;
                                    await writeLocalProjectSettings(settings, projectUri);
                                    debugLog("Cleared keepFilesOnStreamAndSave as strategy changed away from stream-and-save");
                                }
                            } catch (clearErr) {
                                debugLog("Failed to clear keepFilesOnStreamAndSave", clearErr);
                            }
                        }

                        // Initialize switchStarted flag if missing (one-time initialization on strategy change)
                        try {
                            const { readLocalProjectSettings, writeLocalProjectSettings } = await import("../../utils/localProjectSettings");
                            const settings = await readLocalProjectSettings(projectUri);
                            if (settings.mediaFileStrategySwitchStarted === undefined) {
                                settings.mediaFileStrategySwitchStarted = false;
                                await writeLocalProjectSettings(settings, projectUri);
                                debugLog("Initialized mediaFileStrategySwitchStarted to false on strategy change");
                            }
                        } catch (initErr) {
                            debugLog("Failed to initialize switchStarted flag", initErr);
                        }

                        await setMediaFilesStrategy(mediaStrategy, projectUri);

                        const { lastModeRun } = await getFlags(projectUri);
                        // If switching to same as last mode run, no changes needed
                        if (lastModeRun && lastModeRun === mediaStrategy) {
                            await setChangesApplied(true, projectUri);
                        } else {
                            await setChangesApplied(false, projectUri);
                        }
                        // Notify Frontier about strategy so clone/sync respects it
                        try { (this.frontierApi as any)?.setRepoMediaStrategy?.(projectPath, mediaStrategy); } catch (setErr) { debugLog("Failed to set repo media strategy in Frontier API (switchOnly)", setErr); }
                        // Notify success but do not open
                        this.safeSendMessage({
                            command: "project.setMediaStrategyResult",
                            success: true,
                            projectPath,
                            mediaStrategy,
                            switchOnly: true,
                        } as any);
                        return;
                    }

                    // Inform webview that apply operations are starting for this project
                    try {
                        this.safeSendMessage({
                            command: "project.mediaStrategyApplying",
                            projectPath,
                            applying: true,
                        } as any);
                    } catch (e) {
                        // non-fatal
                    }

                    // Switch & Open: apply now only if needed. If the selected
                    // strategy is the same as the last run one, we should not
                    // perform any destructive changes (like replacing files)
                    // and instead just confirm flags and proceed to open.
                    // BUT: if switchStarted is true, we must reapply to recover from interruption
                    try {
                        const { getFlags, setLastModeRun, setChangesApplied, setMediaFilesStrategy, setApplyState, getSwitchStarted, setSwitchStarted, readLocalProjectSettings, writeLocalProjectSettings } = await import("../../utils/localProjectSettings");

                        // Initialize switchStarted flag if missing (one-time initialization on strategy change)
                        try {
                            const settings = await readLocalProjectSettings(projectUri);
                            if (settings.mediaFileStrategySwitchStarted === undefined) {
                                settings.mediaFileStrategySwitchStarted = false;
                                await writeLocalProjectSettings(settings, projectUri);
                                debugLog("Initialized mediaFileStrategySwitchStarted to false on strategy change (switch & open)");
                            }
                        } catch (initErr) {
                            debugLog("Failed to initialize switchStarted flag", initErr);
                        }

                        const flags = await getFlags(projectUri);
                        const switchStartedHere = await getSwitchStarted(projectUri);

                        if (flags?.lastModeRun === mediaStrategy && !switchStartedHere) {
                            // Return to last-run mode: do not touch files. Just ensure
                            // the selected strategy is stored and flags are consistent.
                            await setMediaFilesStrategy(mediaStrategy, projectUri);
                            await setLastModeRun(mediaStrategy, projectUri);
                            await setApplyState("applied", projectUri);
                            await setSwitchStarted(false, projectUri);
                        } else {
                            // Mark pending before kicking off apply work
                            try { await setApplyState("pending", projectUri); } catch (pendingErr) { debugLog("Failed to set applyState=pending before apply", pendingErr); }
                            await applyMediaStrategyAndRecord(projectUri, mediaStrategy);
                        }
                    } catch (e) {
                        try {
                            const { setApplyState } = await import("../../utils/localProjectSettings");
                            await setApplyState("pending", projectUri);
                        } catch (pendingErr) { debugLog("Failed to set applyState=pending in error path", pendingErr); }
                        await applyMediaStrategyAndRecord(projectUri, mediaStrategy);
                    }

                    // Inform the Frontier auth extension so Git reconciliation respects the strategy
                    try {
                        (this.frontierApi as any)?.setRepoMediaStrategy?.(projectPath, mediaStrategy);
                    } catch (err) {
                        debugLog("Failed to set repo media strategy in Frontier API", err);
                    }

                    debugLog(`Successfully changed media strategy to "${mediaStrategy}"`);
                    // Open the project after applying strategy
                    try {
                        await vscode.commands.executeCommand("vscode.openFolder", projectUri);
                    } catch (openErr) {
                        debugLog("Failed to open project after strategy change", openErr);
                    }
                    // Notify webview success and that applying is finished
                    try {
                        this.safeSendMessage({
                            command: "project.mediaStrategyApplying",
                            projectPath,
                            applying: false,
                        } as any);
                    } catch (notifyFinishErr) {
                        debugLog("Failed to send applying=false notification", notifyFinishErr);
                    }
                    this.safeSendMessage({
                        command: "project.setMediaStrategyResult",
                        success: true,
                        projectPath,
                        mediaStrategy,
                    } as any);
                } catch (error) {
                    console.error("Error changing media strategy:", error);
                    vscode.window.showErrorMessage(
                        `Failed to change media strategy: ${error instanceof Error ? error.message : String(error)}`
                    );
                    // Notify webview failure
                    try {
                        this.safeSendMessage({
                            command: "project.mediaStrategyApplying",
                            projectPath: (message as any).projectPath,
                            applying: false,
                        } as any);
                        this.safeSendMessage({
                            command: "project.setMediaStrategyResult",
                            success: false,
                            projectPath: (message as any).projectPath,
                            mediaStrategy: (message as any).mediaStrategy,
                        } as any);
                    } catch (err) {
                        debugLog("Failed to notify webview about media strategy failure", err);
                    }
                }

                break;
            }
            case "project.cleanupMediaFiles": {
                const { projectPath } = message;

                if (!projectPath) {
                    vscode.window.showErrorMessage("No project path provided for media cleanup");
                    return;
                }

                try {
                    // Show confirmation dialog
                    const projectName = projectPath.split("/").pop() || projectPath;
                    const confirmCleanup = await vscode.window.showWarningMessage(
                        `Delete all downloaded media files from "${projectName}"?\n\n` +
                        "This will remove large files (audio, video, etc.) to save disk space. " +
                        "You can stream them again when needed.",
                        { modal: true },
                        "Delete Media Files"
                    );

                    if (confirmCleanup !== "Delete Media Files") {
                        return;
                    }

                    // Inform webview that cleaning is starting
                    try {
                        this.safeSendMessage({
                            command: "project.cleaningInProgress",
                            projectPath,
                            cleaning: true,
                        } as any);
                    } catch (e) {
                        // non-fatal
                    }

                    try {
                        // Find and delete LFS files
                        await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: `Cleaning media files from "${projectName}"...`,
                                cancellable: false,
                            },
                            async () => {
                                const projectUri = vscode.Uri.file(projectPath);
                                // 1) Replace downloaded media bytes in files/ with pointers (only for LFS-tracked media)
                                try {
                                    const { replaceFilesWithPointers } = await import("../../utils/mediaStrategyManager");
                                    await replaceFilesWithPointers(projectPath);
                                } catch (e) {
                                    debugLog("Error replacing files with pointers during cleanup:", e);
                                }

                                // 2) Remove any LFS cache directory (.git/lfs) to free space
                                await this.cleanupLFSFiles(projectUri);
                            }
                        );

                        vscode.window.showInformationMessage(
                            `Media files cleaned up successfully from "${projectName}"`
                        );
                    } finally {
                        // Inform webview that cleaning is complete
                        try {
                            this.safeSendMessage({
                                command: "project.cleaningInProgress",
                                projectPath,
                                cleaning: false,
                            } as any);
                        } catch (e) {
                            // non-fatal
                        }
                    }
                } catch (error) {
                    console.error("Error cleaning up media files:", error);
                    vscode.window.showErrorMessage(
                        `Failed to clean media files: ${error instanceof Error ? error.message : String(error)}`
                    );
                }

                break;
            }
            case "project.fixAndOpen": {
                const { projectPath } = message;
                if (!projectPath) {
                    vscode.window.showErrorMessage("No project path provided for restoration.");
                    return;
                }

                try {
                    const projectUri = vscode.Uri.file(projectPath);
                    const gitPath = vscode.Uri.joinPath(projectUri, ".git");
                    const metadataPath = vscode.Uri.joinPath(projectUri, "metadata.json");

                    // 1. Check if .git exists and confirm with user
                    try {
                        await vscode.workspace.fs.stat(gitPath);
                    } catch {
                        vscode.window.showErrorMessage("No .git folder found to restore from.");
                        return;
                    }

                    const confirm = await vscode.window.showWarningMessage(
                        "This project appears to be missing its remote counterpart. Do you want to fix it as a new local project?\n\nThis will create a full backup of your project (including git history) and re-initialize it.",
                        { modal: true },
                        "Fix & Open"
                    );

                    if (confirm !== "Fix & Open") {
                        return;
                    }

                    // 2. Prepare backup location
                    const codexProjectsRoot = await getCodexProjectsDirectory();
                    const archivedProjectsDir = vscode.Uri.joinPath(codexProjectsRoot, "archived_projects");
                    await this.ensureDirectoryExists(archivedProjectsDir);

                    // Read metadata early
                    const metadataContent = await vscode.workspace.fs.readFile(metadataPath);
                    const metadata = JSON.parse(metadataContent.toString());
                    // Use actual folder name (includes UUID) for both zip filename and internal structure
                    // This allows direct extraction back to the correct location
                    const folderName = path.basename(projectPath);

                    const backupZipPath = vscode.Uri.joinPath(archivedProjectsDir, `${folderName}-full-backup-${Date.now()}.zip`);

                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "Fixing project...",
                        cancellable: false
                    }, async (progress) => {
                        progress.report({ message: "Backing up entire project to archive..." });

                        // Use streaming archiver for memory efficiency
                        // Create a root folder in the zip with the folder name to preserve structure
                        await this.createZipWithArchiver(
                            projectPath,
                            backupZipPath.fsPath,
                            { excludeGit: false, rootFolderName: folderName }
                        );

                        progress.report({ message: "Removing old git configuration..." });
                        // 3. Delete .git folder
                        await vscode.workspace.fs.delete(gitPath, { recursive: true, useTrash: false });

                        progress.report({ message: "Updating project identity..." });
                        // 4. Update metadata with UUID
                        // 5. Rename folder logic
                        const parentDir = path.dirname(projectPath);
                        const currentFolderName = path.basename(projectPath);
                        const metadataProjectId = metadata.projectId;
                        const existingFolderId = extractProjectIdFromFolderName(currentFolderName);

                        let newId: string;
                        let newFolderName = currentFolderName;

                        // SIMPLE CHECK: If folder already ends with metadata's projectId, we're in sync
                        if (metadataProjectId && currentFolderName.endsWith(`-${metadataProjectId}`)) {
                            // Folder and metadata already in sync - nothing to do
                            newId = metadataProjectId;
                        } else if (existingFolderId) {
                            // Folder has a UUID suffix - use it and sync metadata to match
                            newId = existingFolderId;
                            // Folder name doesn't need to change

                            // Extract the base name for projectName if needed
                            if (!metadata.projectName || metadata.projectName.trim() === "") {
                                const baseName = currentFolderName.replace(`-${existingFolderId}`, "").replace(/-+$/, "").replace(/^-+/, "");
                                metadata.projectName = sanitizeProjectName(baseName);
                            }
                        } else {
                            // No existing UUID in folder name - use metadata's projectId or generate new
                            newId = metadataProjectId || generateProjectId();
                            const cleanName = sanitizeProjectName(currentFolderName);
                            newFolderName = `${cleanName}-${newId}`;

                            // Also update the project name in metadata to match the folder name
                            metadata.projectName = cleanName;
                        }

                        metadata.projectId = newId;

                        // Final safety check: if projectName is still empty, use the new folder name (minus ID)
                        if (!metadata.projectName || metadata.projectName.trim() === "") {
                            metadata.projectName = newFolderName.replace(newId, "").replace(/-+$/, "").replace(/^-+/, "");
                        }

                        // Write updated metadata
                        await vscode.workspace.fs.writeFile(metadataPath, Buffer.from(JSON.stringify(metadata, null, 4)));

                        const newProjectPath = path.join(parentDir, newFolderName);

                        // Only rename if different
                        if (newProjectPath !== projectPath) {
                            await vscode.workspace.fs.rename(projectUri, vscode.Uri.file(newProjectPath));
                        }

                        // 6. Pre-open fixes (metadata integrity, LFS structure, rebuild indexes)
                        const newProjectUri = vscode.Uri.file(newProjectPath);

                        // Ensure metadata integrity before opening
                        try {
                            const { validateAndFixProjectMetadata } = await import("../../projectManager/utils/projectUtils");
                            await validateAndFixProjectMetadata(newProjectUri);
                        } catch (e) {
                            console.error("Failed to validate metadata before open:", e);
                        }

                        // Ensure attachments structure exists (files + pointers)
                        try {
                            await this.ensureDirectoryExists(
                                vscode.Uri.joinPath(newProjectUri, ".project", "attachments", "files")
                            );
                            await this.ensureDirectoryExists(
                                vscode.Uri.joinPath(newProjectUri, ".project", "attachments", "pointers")
                            );
                        } catch (e) {
                            console.error("Failed to ensure attachments structure:", e);
                        }

                        // Remove indexes.sqlite so it can be rebuilt
                        try {
                            const indexDbPath = vscode.Uri.joinPath(newProjectUri, ".project", "indexes.sqlite");
                            await vscode.workspace.fs.delete(indexDbPath, { recursive: false, useTrash: false });
                        } catch {
                            // Missing index file is fine
                        }

                        // 7. Initialize git repository (fresh .git)
                        progress.report({ message: "Initializing git repository..." });
                        try {
                            const git = await import("isomorphic-git");
                            const fs = await import("fs");
                            const { ensureGitConfigsAreUpToDate, ensureGitDisabledInSettings } = await import("../../projectManager/utils/projectUtils");

                            await git.init({
                                fs,
                                dir: newProjectPath,
                                defaultBranch: "main",
                            });

                            await ensureGitConfigsAreUpToDate();
                            await ensureGitDisabledInSettings();

                            await git.add({ fs, dir: newProjectPath, filepath: "metadata.json" });

                            const gitignorePath = path.join(newProjectPath, ".gitignore");
                            if (fs.existsSync(gitignorePath)) {
                                await git.add({ fs, dir: newProjectPath, filepath: ".gitignore" });
                            }

                            const gitattributesPath = path.join(newProjectPath, ".gitattributes");
                            if (fs.existsSync(gitattributesPath)) {
                                await git.add({ fs, dir: newProjectPath, filepath: ".gitattributes" });
                            }

                            let authorName = "Codex User";
                            let authorEmail = "user@example.com";
                            try {
                                const authApi = getAuthApi();
                                const userInfo = await authApi?.getUserInfo();
                                if (userInfo?.username) authorName = userInfo.username;
                                if (userInfo?.email) authorEmail = userInfo.email;
                            } catch {
                                // Best effort
                            }

                            await git.commit({
                                fs,
                                dir: newProjectPath,
                                message: "Initial commit",
                                author: {
                                    name: authorName,
                                    email: authorEmail,
                                },
                            });
                        } catch (e) {
                            console.error("Failed to initialize git during fix & open:", e);
                        }

                        // 8. Open the project
                        progress.report({ message: "Opening project..." });
                        await vscode.commands.executeCommand("vscode.openFolder", newProjectUri);
                    });

                } catch (error) {
                    console.error("Error fixing project:", error);
                    vscode.window.showErrorMessage(`Failed to fix project: ${error instanceof Error ? error.message : String(error)}`);
                }
                break;
            }
            case "project.performSwap": {
                const { projectPath } = message;
                if (!projectPath) {
                    vscode.window.showErrorMessage("No project path provided for swap.");
                    return;
                }

                try {
                    const projectUri = vscode.Uri.file(projectPath);
                    const metadataResult = await MetadataManager.safeReadMetadata<ProjectMetadata>(projectUri);

                    // Check BOTH metadata.json AND localProjectSwap.json for swap info
                    let effectiveSwapInfo = metadataResult.metadata?.meta?.projectSwap;

                    if (!effectiveSwapInfo) {
                        // Try localProjectSwap.json
                        try {
                            const { readLocalProjectSwapFile } = await import("../../utils/localProjectSettings");
                            const localSwapFile = await readLocalProjectSwapFile(projectUri);
                            if (localSwapFile?.remoteSwapInfo) {
                                effectiveSwapInfo = localSwapFile.remoteSwapInfo;
                                debugLog("Using swap info from localProjectSwap.json for performSwap");
                            }
                        } catch {
                            // Non-fatal
                        }
                    }

                    if (!effectiveSwapInfo) {
                        vscode.window.showErrorMessage("Cannot perform swap: Project swap metadata missing.");
                        return;
                    }

                    const swapInfo = effectiveSwapInfo;
                    const projectName = metadataResult.metadata?.projectName || path.basename(projectPath);

                    // Normalize swap info to get active entry
                    const { normalizeProjectSwapInfo, getActiveSwapEntry, findSwapEntryByUUID } = await import("../../utils/projectSwapManager");
                    const normalizedSwap = normalizeProjectSwapInfo(swapInfo);
                    const activeEntry = getActiveSwapEntry(normalizedSwap);

                    if (!activeEntry?.newProjectUrl) {
                        vscode.window.showErrorMessage("Cannot perform swap: No target project URL found.");
                        return;
                    }

                    const newProjectUrl = activeEntry.newProjectUrl;

                    try {
                        const { extractProjectIdFromUrl, fetchRemoteMetadata, getCurrentUsername, normalizeSwapUserEntry } = await import("../../utils/remoteUpdatingManager");
                        const projectId = extractProjectIdFromUrl(newProjectUrl);
                        if (projectId) {
                            const currentUsername = await getCurrentUsername();
                            const remoteMetadata = await fetchRemoteMetadata(projectId, false);
                            const remoteSwap = remoteMetadata?.meta?.projectSwap;
                            if (remoteSwap) {
                                // Find matching entry by swapUUID
                                const normalizedRemoteSwap = normalizeProjectSwapInfo(remoteSwap);
                                const matchingEntry = findSwapEntryByUUID(normalizedRemoteSwap, activeEntry.swapUUID);
                                const entries = (matchingEntry?.swappedUsers || []).map((entry: ProjectSwapUserEntry) =>
                                    normalizeSwapUserEntry(entry)
                                );
                                const hasAlreadySwapped = currentUsername
                                    ? entries.some(
                                        (entry: ProjectSwapUserEntry) => entry.userToSwap === currentUsername && entry.executed
                                    )
                                    : false;
                                if (hasAlreadySwapped) {
                                    const swapTargetLabel =
                                        activeEntry.newProjectName || activeEntry.newProjectUrl || "the new project";
                                    const alreadySwappedChoice = await vscode.window.showWarningMessage(
                                        `You have already swapped to ${swapTargetLabel}.\n\n` +
                                        "You can open this deprecated project, delete the local copy, or cancel.",
                                        { modal: true },
                                        "Open Project",
                                        "Delete Local Project"
                                    );

                                    if (alreadySwappedChoice === "Delete Local Project") {
                                        await this.performProjectDeletion(projectPath, projectName);
                                        return;
                                    }

                                    if (alreadySwappedChoice !== "Open Project") {
                                        return;
                                    }
                                }
                            }
                        }
                    } catch {
                        // non-fatal
                    }

                    const swapDecision = await this.promptForProjectSwapAction(activeEntry);
                    if (swapDecision === "openDeprecated") {
                        // Use safe folder opening to ensure metadata integrity
                        const { MetadataManager } = await import("../../utils/metadataManager");
                        await MetadataManager.safeOpenFolder(projectUri);
                        return;
                    }
                    if (swapDecision !== "swap") {
                        return;
                    }

                    const newProjectName = activeEntry.newProjectName || "new project";
                    const swapUUID = activeEntry.swapUUID || "unknown";

                    // Check if there are files that need to be downloaded before swap
                    const { checkSwapPrerequisites, downloadPendingSwapFiles, saveSwapPendingState, clearSwapPendingState } = await import("./performProjectSwap");
                    const prereqResult = await checkSwapPrerequisites(projectPath, newProjectUrl);

                    if (!prereqResult.canProceed && prereqResult.filesNeedingDownload.length > 0) {
                        // Files need to be downloaded first - download them directly without opening project
                        const fileCount = prereqResult.filesNeedingDownload.length;
                        const sizeStr = formatBytesHelper(prereqResult.downloadSizeBytes);

                        // Show modal asking if user wants to proceed with download
                        const action = await vscode.window.showInformationMessage(
                            `Before completing the project swap, ${fileCount} media file(s) (${sizeStr}) need to be downloaded from the old project.`,
                            { modal: true },
                            "Download & Swap"
                        );

                        if (action !== "Download & Swap") {
                            return; // User cancelled
                        }

                        // Save pending state for tracking (in case of interruption)
                        await saveSwapPendingState(projectPath, {
                            swapState: "pending_downloads",
                            filesNeedingDownload: prereqResult.filesNeedingDownload,
                            newProjectUrl,
                            swapUUID,
                            swapInitiatedAt: activeEntry.swapInitiatedAt,
                            createdAt: Date.now()
                        });

                        // Download files directly with progress
                        let downloadResult: { downloaded: number; failed: string[]; total: number; } | undefined;

                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: "Downloading media for swap...",
                            cancellable: true
                        }, async (progress, token) => {
                            let cancelled = false;
                            token.onCancellationRequested(() => {
                                cancelled = true;
                            });

                            progress.report({ message: `0/${fileCount} files` });
                            downloadResult = await downloadPendingSwapFiles(projectPath, progress);

                            if (cancelled) {
                                throw new Error("Download cancelled by user");
                            }
                        });

                        if (!downloadResult) {
                            await clearSwapPendingState(projectPath);
                            return;
                        }

                        // Check if downloads succeeded
                        if (downloadResult.failed.length > 0) {
                            const continueAnyway = await vscode.window.showWarningMessage(
                                `Downloaded ${downloadResult.downloaded}/${downloadResult.total} files. ${downloadResult.failed.length} file(s) failed to download. Continue with swap anyway?`,
                                { modal: true },
                                "Continue Swap"
                            );

                            if (continueAnyway !== "Continue Swap") {
                                await clearSwapPendingState(projectPath);
                                return;
                            }
                        }

                        // Clear pending state since we're proceeding
                        await clearSwapPendingState(projectPath);

                        // Fall through to continue with swap below
                    }

                    // No downloads needed or prerequisites met - proceed with swap
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Swapping project to "${newProjectName}"...`,
                        cancellable: false
                    }, async (progress) => {
                        const newPath = await performProjectSwap(
                            progress,
                            projectName,
                            projectPath,
                            newProjectUrl,
                            swapUUID,
                            activeEntry.swapInitiatedAt
                        );

                        progress.report({ message: "Opening swapped project..." });
                        // Use safe folder opening to ensure writes complete and metadata integrity
                        const { MetadataManager } = await import("../../utils/metadataManager");
                        await MetadataManager.safeOpenFolder(
                            vscode.Uri.file(newPath),
                            projectUri // current workspace for write wait
                        );
                    });

                } catch (error) {
                    console.error("Error performing project swap:", error);
                    vscode.window.showErrorMessage(
                        `Project swap failed.\n\nThe old project has been backed up to the "archived_projects" folder. ` +
                        `Please contact your project administrator for assistance.\n\nError: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
                break;
            }
            case "project.renameFolder": {
                // Legacy command - handling removed as renaming is now automatic during scan
                break;
            }
            case "project.heal": {
                const { projectName, projectPath, gitOriginUrl } = message;

                if (!gitOriginUrl) {
                    vscode.window.showErrorMessage(
                        "Cannot heal project: No remote repository URL found. This project may not be connected to a remote repository."
                    );
                    return;
                }

                // Show notification first so user knows the process is starting
                vscode.window.showInformationMessage("Update process starting - check for confirmation dialog");

                const yesConfirm = "Yes, Heal Project";

                const confirm = await vscode.window.showWarningMessage(
                    `This will heal the project "${projectName}" by:\n\n` +
                    "1. Creating a backup ZIP\n" +
                    "2. Saving your local changes temporarily\n" +
                    "3. Re-cloning from the remote repository\n" +
                    "4. Merging your local changes back\n\n" +
                    "This process may take several minutes. Continue?",
                    { modal: true },
                    yesConfirm
                );

                if (confirm !== yesConfirm) {
                    return;
                }

                // Inform webview that updating is starting for this project
                try {
                    this.safeSendMessage({
                        command: "project.updatingInProgress",
                        projectPath,
                        updating: true,
                    } as any);
                } catch (e) {
                    // non-fatal
                }

                // Execute the update process
                try {
                    // Get current username for local flag
                    let username: string | undefined;
                    try {
                        const authApi = getAuthApi();
                        const userInfo = await authApi?.getUserInfo();
                        username = userInfo?.username;
                    } catch (e) {
                        debugLog("Could not get username for local flag:", e);
                    }

                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `Updating project "${projectName}"...`,
                            cancellable: false,
                        },
                        async (progress) => {
                            await this.performProjectUpdate(progress, projectName, projectPath, gitOriginUrl, true, username);
                        }
                    );

                    // Inform webview that updating is complete
                    try {
                        this.safeSendMessage({
                            command: "project.updatingInProgress",
                            projectPath,
                            updating: false,
                        } as any);
                    } catch (e) {
                        // non-fatal
                    }
                } catch (error) {
                    console.error("Project update failed:", error);
                    vscode.window.showErrorMessage(
                        `Failed to update project: ${error instanceof Error ? error.message : String(error)}`
                    );

                    // Inform webview that update failed/stopped
                    try {
                        this.safeSendMessage({
                            command: "project.updatingInProgress",
                            projectPath,
                            updating: false,
                        } as any);
                    } catch (e) {
                        // non-fatal
                    }
                }
                break;
            }
        }
    }

    /**
     * Perform project deletion
     */
    private async performProjectDeletion(projectPath: string, projectName: string): Promise<void> {
        try {
            // Use vscode.workspace.fs.delete with the recursive flag
            const projectUri = vscode.Uri.file(projectPath);
            await vscode.workspace.fs.delete(projectUri, { recursive: true });

            vscode.window.showInformationMessage(
                `Project "${projectName}" has been deleted.`
            );

            // Send success response to webview
            this.safeSendMessage({
                command: "project.deleteResponse",
                success: true,
                projectPath: projectPath,
            });

        } catch (error) {
            console.error("Error deleting project:", error);
            vscode.window.showErrorMessage(
                `Failed to delete project: ${error instanceof Error ? error.message : String(error)}`
            );

            // Send error response to webview
            this.safeSendMessage({
                command: "project.deleteResponse",
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            // Always refresh the projects list
            await this.sendList(this.webviewPanel!);
        }

    }

    /**
     * Clean up LFS files from a project directory
     */
    private async cleanupLFSFiles(projectUri: vscode.Uri): Promise<void> {
        try {
            // Check if .git/lfs directory exists
            const gitLfsUri = vscode.Uri.joinPath(projectUri, ".git", "lfs");

            try {
                await vscode.workspace.fs.stat(gitLfsUri);
                // Delete the LFS cache directory
                await vscode.workspace.fs.delete(gitLfsUri, { recursive: true });
            } catch {
                // LFS directory doesn't exist, which is fine
            }

            // Find and restore LFS pointer files
            // This will replace the actual files with their pointer versions
            const gitDir = vscode.Uri.joinPath(projectUri, ".git").fsPath;
            const workDir = projectUri.fsPath;

            // Use isomorphic-git to list all files in the repository
            const files = await git.listFiles({ fs, dir: workDir, gitdir: gitDir });

            for (const filepath of files) {
                const fileUri = vscode.Uri.joinPath(projectUri, filepath);

                try {
                    const content = await vscode.workspace.fs.readFile(fileUri);
                    const text = Buffer.from(content).toString('utf-8', 0, 200); // Only read first 200 bytes

                    // Check if this looks like it should be an LFS file
                    // LFS files typically contain "version https://git-lfs.github.com/spec/v1"
                    if (!text.includes('version https://git-lfs.github.com/spec/v1')) {
                        // This might be a real LFS file that's been downloaded
                        // Check if it's a media file by extension
                        const ext = filepath.toLowerCase().split('.').pop();
                        const mediaExtensions = ['mp3', 'mp4', 'wav', 'webm', 'ogg', 'flac', 'm4a', 'mov', 'avi', 'mkv', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'webp'];

                        if (ext && mediaExtensions.includes(ext)) {
                            // Try to get the LFS pointer from git
                            try {
                                const { blob } = await git.readBlob({ fs, dir: workDir, gitdir: gitDir, oid: 'HEAD', filepath });
                                const pointerContent = Buffer.from(blob).toString('utf-8');

                                // If the blob in git is an LFS pointer, restore it
                                if (pointerContent.includes('version https://git-lfs.github.com/spec/v1')) {
                                    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(pointerContent, 'utf-8'));
                                }
                            } catch {
                                // Couldn't read from git, skip this file
                            }
                        }
                    }
                } catch {
                    // Skip files that can't be read
                }
            }
        } catch (error) {
            console.error('Error cleaning up LFS files:', error);
            throw error;
        }
    }

    /**
     * Perform project update operation
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async performProjectUpdate(
        progress: vscode.Progress<{ message?: string; increment?: number; }>,
        projectName: string,
        projectPath: string,
        gitOriginUrl: string,
        showSuccessMessage: boolean = true,
        currentUsername?: string
    ): Promise<void> {
        const cleanedPath = await this.cleanupStaleUpdateState(projectPath, projectName);
        if (cleanedPath && cleanedPath !== projectPath) {
            projectPath = cleanedPath;
            projectName = path.basename(cleanedPath);
        }

        // CRITICAL: Ensure internet connectivity before starting update
        // If offline, this will block with a modal until connectivity is restored
        progress.report({ message: "Checking internet connectivity..." });
        await ensureConnectivity("project update");
        debugLog("✅ Internet connectivity confirmed");

        // Check if frontier extension is available and at required version
        const frontierExtension = vscode.extensions.getExtension("frontier-rnd.frontier-authentication");
        if (!frontierExtension) {
            throw new Error("Frontier Authentication extension is not installed. Please install it to use the heal feature.");
        }

        const requiredVersion = "0.4.11";
        const currentVersion = frontierExtension.packageJSON.version;

        // Simple version comparison (assumes semantic versioning)
        const compareVersions = (current: string, required: string): number => {
            const currentParts = current.split('.').map(Number);
            const requiredParts = required.split('.').map(Number);

            for (let i = 0; i < Math.max(currentParts.length, requiredParts.length); i++) {
                const currentPart = currentParts[i] || 0;
                const requiredPart = requiredParts[i] || 0;

                if (currentPart > requiredPart) return 1;
                if (currentPart < requiredPart) return -1;
            }
            return 0;
        };

        if (compareVersions(currentVersion, requiredVersion) < 0) {
            throw new Error(`Frontier Authentication extension version ${requiredVersion} or later is required. Current version: ${currentVersion}. Please update the extension.`);
        }

        // Determine backup policy based on recent backups
        const codexProjectsRoot = await getCodexProjectsDirectory();
        const archivedProjectsDir = vscode.Uri.joinPath(codexProjectsRoot, "archived_projects");
        await this.ensureDirectoryExists(archivedProjectsDir);

        // If a prior update session exists, reuse its backup choice to avoid re-prompting.
        const projectUri = vscode.Uri.file(projectPath);
        const priorSettings = await readLocalProjectSettings(projectUri);
        const priorState = priorSettings.updateState;
        const priorBackupMode = priorState?.backupMode;

        let hasRecentBackup = false;
        try {
            const entries = await vscode.workspace.fs.readDirectory(archivedProjectsDir);
            const oneHourMs = 60 * 60 * 1000; // 1 hour (3,600,000 ms)
            const now = Date.now();
            for (const [name, type] of entries) {
                if (
                    type === vscode.FileType.File &&
                    name.toLowerCase().endsWith(".zip") &&
                    name.startsWith(`${projectName}_backup_`)
                ) {
                    const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(archivedProjectsDir, name));
                    if (now - stat.mtime < oneHourMs) {
                        hasRecentBackup = true;
                        break;
                    }
                }
            }
        } catch (e) {
            // If inspection fails (e.g., directory missing), treat as no recent backup
            debugLog("Could not inspect archived_projects for recent backups", e);
            hasRecentBackup = false;
        }

        // Ask user for backup preference unless a prior choice exists.
        let backupOption: { includeGit: boolean; label?: string; };
        if (priorBackupMode === "full") {
            backupOption = { includeGit: true, label: "Full Backup (previous selection)" };
        } else if (priorBackupMode === "data-only") {
            backupOption = { includeGit: false, label: "Data Only (previous selection)" };
        } else {
            const backupChoices = hasRecentBackup
                ? [
                    {
                        label: "Full Backup (Recommended)",
                        description: "Includes .git folder and history",
                        detail: "Safest option, but larger file size",
                        includeGit: true,
                    },
                    {
                        label: "Data Only (no .git)",
                        description: "Excludes .git folder",
                        detail: "Smaller file size (recent full backup found in the last hour)",
                        includeGit: false,
                    },
                ]
                : [
                    {
                        label: "Full Backup (Required)",
                        description: "Includes .git folder and history",
                        detail: "No recent full backup found in the last hour; data-only is unavailable",
                        includeGit: true,
                    },
                ];

            const picked = await vscode.window.showQuickPick(backupChoices, {
                placeHolder: "Choose a backup method before updating",
                ignoreFocusOut: true,
            });

            if (!picked) {
                throw new Error("Update cancelled by user (no backup method selected)");
            }
            backupOption = picked;
            await this.persistUpdateState(projectPath, {
                backupMode: picked.includeGit ? "full" : "data-only",
            });
        }

        // Step 1: Create or reuse backup
        const priorBackupZipPath = priorState?.backupZipPath;
        const priorCreatedAt = priorState?.createdAt;
        let backupUri: vscode.Uri | undefined;
        let reuseBackup = false;
        let backupStat: vscode.FileStat | undefined;
        if (priorBackupZipPath) {
            try {
                const priorZipUri = vscode.Uri.file(priorBackupZipPath);
                const priorStat = await vscode.workspace.fs.stat(priorZipUri);
                const toleranceMs = 30 * 60 * 1000; // 30 minutes tolerance
                if (
                    !priorCreatedAt ||
                    Math.abs(priorStat.mtime - priorCreatedAt) <= toleranceMs
                ) {
                    reuseBackup = true;
                    backupUri = priorZipUri;
                    backupStat = priorStat;
                    debugLog(`Reusing existing backup: ${priorBackupZipPath}, mtime=${priorStat.mtime}, createdAt=${priorCreatedAt}`);
                    progress.report({ increment: 10, message: "Reusing existing backup ZIP..." });
                } else {
                    debugLog(
                        `Backup ZIP timestamp mismatch, will recreate. mtime=${priorStat.mtime}, createdAt=${priorCreatedAt}`
                    );
                }
            } catch {
                reuseBackup = false;
                backupUri = undefined;
                backupStat = undefined;
            }
        }

        if (!reuseBackup) {
            progress.report({ increment: 2, message: "Preparing backup (scanning project)..." });
            progress.report({
                increment: 8,
                message: backupOption.includeGit
                    ? "Creating full backup (includes .git)..."
                    : "Creating data-only backup (excluding .git)..."
            });

            try {
                backupUri = await this.createProjectBackup(projectPath, projectName, backupOption.includeGit);
                debugLog(`Backup created at: ${backupUri.fsPath}`);
                try {
                    backupStat = await vscode.workspace.fs.stat(backupUri);
                } catch {
                    backupStat = undefined;
                }
            } catch (backupError) {
                const categorized = categorizeError(backupError);
                if (categorized.type === ErrorType.DISK_FULL) {
                    vscode.window.showErrorMessage(
                        `Cannot create backup: ${categorized.userMessage}\n\nPlease free up disk space and try again.`,
                        { modal: true }
                    );
                    throw backupError;
                } else if (categorized.type === ErrorType.PERMISSION) {
                    vscode.window.showErrorMessage(
                        `Cannot create backup: ${categorized.userMessage}\n\nPlease check permissions for the archived_projects folder.`,
                        { modal: true }
                    );
                    throw backupError;
                } else {
                    throw backupError;
                }
            }
        } else {
            // Reuse requested but backup file missing; recreate
            if (!backupStat) {
                progress.report({ increment: 2, message: "Preparing backup (scanning project)..." });
                progress.report({
                    increment: 8,
                    message: backupOption.includeGit
                        ? "Creating full backup (includes .git)..."
                        : "Creating data-only backup (excluding .git)..."
                });

                try {
                    backupUri = await this.createProjectBackup(projectPath, projectName, backupOption.includeGit);
                    debugLog(`Backup recreated at: ${backupUri.fsPath}`);
                    try {
                        backupStat = await vscode.workspace.fs.stat(backupUri);
                    } catch {
                        backupStat = undefined;
                    }
                    reuseBackup = false;
                } catch (backupError) {
                    const categorized = categorizeError(backupError);
                    if (categorized.type === ErrorType.DISK_FULL) {
                        vscode.window.showErrorMessage(
                            `Cannot create backup: ${categorized.userMessage}\n\nPlease free up disk space and try again.`,
                            { modal: true }
                        );
                        throw backupError;
                    } else if (categorized.type === ErrorType.PERMISSION) {
                        vscode.window.showErrorMessage(
                            `Cannot create backup: ${categorized.userMessage}\n\nPlease check permissions for the archived_projects folder.`,
                            { modal: true }
                        );
                        throw backupError;
                    } else {
                        throw backupError;
                    }
                }
            }
        }

        const backupFileName = path.basename(backupUri!.fsPath);
        progress.report({ increment: 0, message: "Backup ready; preparing temp copy..." });
        await this.persistUpdateState(projectPath, {
            projectPath,
            projectName,
            backupZipPath: backupUri!.fsPath,
            createdAt: reuseBackup && priorCreatedAt ? priorCreatedAt : (backupStat?.mtime ?? Date.now()),
            step: "backup_done",
            completedSteps: ["backup_done"],
            backupMode: backupOption.includeGit ? "full" : "data-only",
        });

        // Step 2: Create or reuse temporary snapshot
        progress.report({ increment: 20, message: "Saving local changes..." });
        let tempFolderUri: vscode.Uri;
        let reuseTemp = false;
        if (priorState?.tempFolderPath) {
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(priorState.tempFolderPath));
                tempFolderUri = vscode.Uri.file(priorState.tempFolderPath);
                reuseTemp = true;
                debugLog(`Reusing existing temp snapshot: ${priorState.tempFolderPath}`);
            } catch {
                reuseTemp = false;
                const timestamp = this.generateTimestamp();
                const tempFolderName = `${projectName}_temp_${timestamp}`;
                tempFolderUri = vscode.Uri.joinPath(codexProjectsRoot, tempFolderName);
            }
        } else {
            const timestamp = this.generateTimestamp();
            const tempFolderName = `${projectName}_temp_${timestamp}`;
            tempFolderUri = vscode.Uri.joinPath(codexProjectsRoot, tempFolderName);
        }

        if (!reuseTemp) {
            try {
                await vscode.workspace.fs.createDirectory(tempFolderUri);
                await this.copyDirectory(projectUri, tempFolderUri, { excludeGit: true });
                debugLog(`Temporary files saved to: ${tempFolderUri.fsPath}`);
            } catch (tempError) {
                const categorized = categorizeError(tempError);
                if (categorized.type === ErrorType.DISK_FULL) {
                    vscode.window.showErrorMessage(
                        `Cannot create temporary snapshot: ${categorized.userMessage}\n\nPlease free up disk space and try again.`,
                        { modal: true }
                    );
                    throw tempError;
                } else if (categorized.type === ErrorType.PERMISSION) {
                    vscode.window.showErrorMessage(
                        `Cannot create temporary snapshot: ${categorized.userMessage}\n\nPlease check permissions for the project directory.`,
                        { modal: true }
                    );
                    throw tempError;
                } else {
                    throw tempError;
                }
            }
        } else {
            progress.report({ increment: 0, message: "Reusing existing temp snapshot..." });
        }

        await this.persistUpdateState(projectPath, {
            tempFolderPath: tempFolderUri.fsPath,
            completedSteps: ["backup_done"],
        });

        // Determine media strategy before deletion so re-clone respects user's choice
        let updateMediaStrategy: "auto-download" | "stream-and-save" | "stream-only" | undefined;
        try {
            const { getMediaFilesStrategy } = await import("../../utils/localProjectSettings");
            updateMediaStrategy = await getMediaFilesStrategy(projectUri);
            debugLog(`Heal using media strategy: ${updateMediaStrategy || "(default)"}`);
        } catch (e) {
            debugLog("Could not read media strategy before heal; default will be used", e);
        }

        // Step 3: Prepare cloning target (canonical_cloning) and delete if stale
        progress.report({ increment: 10, message: "Preparing cloning target..." });
        const parentDir = vscode.Uri.file(path.dirname(projectPath));
        const cloningFolderName = `${projectName}_cloning`;
        const toDeleteFolderName = `${projectName}_toDelete`;
        const cloningProjectUri = vscode.Uri.joinPath(parentDir, cloningFolderName);
        const toDeleteProjectUri = vscode.Uri.joinPath(parentDir, toDeleteFolderName);

        try {
            await vscode.workspace.fs.delete(cloningProjectUri, { recursive: true, useTrash: false });
        } catch {
            // ok if missing
        }
        await this.persistUpdateState(projectPath, {
            clonePath: cloningProjectUri.fsPath,
            step: "moved_original",
            completedSteps: ["backup_done", "moved_original"],
        });

        try {
            // Step 4: Re-clone the project into cloning target
            // CRITICAL: This operation requires internet connectivity
            // Errors are handled organically - network errors trigger wait/retry, server errors prompt user
            progress.report({ increment: 20, message: "Re-cloning from remote..." });

            const attemptClone = async (): Promise<void> => {
                try {
                    const result = await this.frontierApi?.cloneRepository(
                        gitOriginUrl,
                        cloningProjectUri.fsPath,
                        false,
                        updateMediaStrategy
                    );
                    if (!result) {
                        throw new Error("Failed to clone repository");
                    }
                } catch (cloneError) {
                    // Handle clone errors organically
                    await handleUpdateError(cloneError, "project clone", attemptClone);
                }
            };

            await attemptClone();

            await this.persistUpdateState(projectPath, {
                step: "clone_done",
                completedSteps: ["backup_done", "moved_original", "clone_done"],
            });

            // Wait for clone to complete
            await this.sleep(3000);

            // Step 5: Merge temporary files back into cloning target
            progress.report({ increment: 20, message: "Merging local changes..." });

            // Verify the cloned project exists
            await vscode.workspace.fs.stat(cloningProjectUri);
            debugLog("Cloned project directory exists");

            // Build a full merge set from the saved snapshot (ours) vs the freshly-cloned project (theirs/base)
            // Treat everything as a potential conflict, excluding .git/**. Do not delete files.
            const { textConflicts, binaryCopies } = await buildConflictsFromDirectories({
                oursRoot: tempFolderUri,
                theirsRoot: cloningProjectUri,
                exclude: (relativePath) => {
                    // Generated databases should not be preserved during heal
                    return (
                        relativePath.endsWith(".sqlite") ||
                        relativePath.endsWith(".sqlite3") ||
                        relativePath.endsWith(".db")
                    );
                },
                isBinary: (relativePath) => this.isBinaryFile(relativePath),
            });

            debugLog("Heal merge inputs prepared:", {
                textConflicts: textConflicts.length,
                binaryCopies: binaryCopies.length,
            });

            // Merge all text files using the same resolver pipeline as sync.
            // IMPORTANT: do NOT refresh ours from disk during heal; ours is the snapshot content.
            if (textConflicts.length > 0) {
                debugLog(`Merging ${textConflicts.length} text files with shared merge engine...`);
                await resolveConflictFiles(textConflicts, cloningProjectUri.fsPath, { refreshOursFromDisk: false });
                debugLog("All text merges completed");
            }

            // Copy binary files from snapshot into the freshly-cloned project (no content merge).
            if (binaryCopies.length > 0) {
                debugLog(`Copying ${binaryCopies.length} binary files from snapshot...`);

                // Ensure parent directories exist before writing
                const uniqueDirs = new Set<string>();
                for (const file of binaryCopies) {
                    const dir = path.posix.dirname(file.filepath);
                    if (dir && dir !== ".") {
                        uniqueDirs.add(dir);
                    }
                }
                const sortedDirs = Array.from(uniqueDirs).sort(
                    (a, b) => a.split("/").length - b.split("/").length
                );
                for (const dir of sortedDirs) {
                    const dirUri = vscode.Uri.joinPath(cloningProjectUri, ...dir.split("/"));
                    const created = await this.ensureDirectoryExists(dirUri);
                    if (!created) {
                        throw new Error(`Failed to create directory: ${dir}`);
                    }
                }

                for (const file of binaryCopies) {
                    const targetUri = vscode.Uri.joinPath(cloningProjectUri, ...file.filepath.split("/"));
                    await vscode.workspace.fs.writeFile(targetUri, file.content);
                }

                debugLog("Binary copies completed");
            }

            await this.persistUpdateState(projectPath, {
                step: "merge_done",
                completedSteps: ["backup_done", "moved_original", "clone_done", "merge_done"],
            });

            // Step 6: Swap canonical with cloning target
            progress.report({ increment: 10, message: "Swapping healed project into place..." });
            const canonicalUri = vscode.Uri.file(projectPath);
            // Move canonical aside
            try {
                await vscode.workspace.fs.rename(canonicalUri, toDeleteProjectUri);
            } catch (e) {
                debugLog("Failed to move canonical to toDelete; will attempt delete", e);
                try {
                    await vscode.workspace.fs.delete(canonicalUri, { recursive: true, useTrash: false });
                } catch {
                    // ignore
                }
            }
            // Promote cloning to canonical
            await vscode.workspace.fs.rename(cloningProjectUri, canonicalUri);
            await this.persistUpdateState(projectPath, {
                backupProjectPath: toDeleteProjectUri.fsPath,
                step: "swap_done",
                completedSteps: ["backup_done", "moved_original", "clone_done", "merge_done", "swap_done"],
            });
            // Remove the old canonical (now toDelete)
            try {
                await vscode.workspace.fs.delete(toDeleteProjectUri, { recursive: true, useTrash: false });
            } catch {
                // ignore
            }

        } catch (error) {
            console.error("Update failed, attempting to restore original project:", error);
            progress.report({ increment: 0, message: "Update failed, restoring..." });

            // Categorize the error to understand what went wrong
            const categorized = categorizeError(error);

            // 1. Delete the partial/failed clone if it exists
            try {
                await vscode.workspace.fs.delete(cloningProjectUri, { recursive: true, useTrash: false });
            } catch (e) {
                // Ignore if it doesn't exist
            }

            // 2. If canonical was moved to toDelete, attempt to restore it
            try {
                const canonicalUri = vscode.Uri.file(projectPath);
                const toDeleteUri = toDeleteProjectUri;
                let exists = false;
                try {
                    await vscode.workspace.fs.stat(toDeleteUri);
                    exists = true;
                } catch {
                    exists = false;
                }
                if (exists) {
                    await vscode.workspace.fs.rename(toDeleteUri, canonicalUri);
                    debugLog("Restored original project from toDelete backup");
                }
            } catch (restoreError) {
                console.error("CRITICAL: Failed to restore project from toDelete backup:", restoreError);
                vscode.window.showErrorMessage(`Update failed and restoration failed. Your project data may be in: ${toDeleteProjectUri.fsPath}`);
            }

            // Provide user-friendly error message based on error type
            let errorMessage = `Project update failed: ${categorized.userMessage}`;

            if (categorized.type === ErrorType.DISK_FULL) {
                errorMessage += "\n\nYour original project has been restored. Please free up disk space and try again.";
            } else if (categorized.type === ErrorType.PERMISSION) {
                errorMessage += "\n\nYour original project has been restored. Please check file permissions and try again.";
            } else if (categorized.type === ErrorType.SERVER_UNREACHABLE) {
                errorMessage += "\n\nYour original project has been restored. The server may be temporarily unavailable. Please try again later.";
            } else if (categorized.type === ErrorType.NETWORK) {
                errorMessage += "\n\nYour original project has been restored. Please check your internet connection and try again.";
            } else {
                errorMessage += "\n\nYour original project has been restored.";
            }

            vscode.window.showErrorMessage(errorMessage, { modal: true });

            // Re-throw to stop the process
            throw error;
        } finally {
            // Step 6: Clean up temporary files (Snapshot)
            progress.report({ increment: 10, message: "Cleaning up..." });
            try {
                await vscode.workspace.fs.delete(tempFolderUri, { recursive: true, useTrash: false });
                debugLog(`Cleaned up temp folder: ${tempFolderUri.fsPath}`);
            } catch (e) {
                console.warn("Failed to clean up temp folder:", e);
            }
            // Clean up lingering backup folder if it still exists
            try {
                const stat = await vscode.workspace.fs.stat(toDeleteProjectUri);
                if (stat) {
                    await vscode.workspace.fs.delete(toDeleteProjectUri, { recursive: true, useTrash: false });
                    debugLog("Cleaned lingering toDelete folder in finally");
                }
            } catch {
                // ignore if missing
            }
            // As a final guard, attempt to delete the .project/localProjectSettings.json
            // if it exists in the backup folder to avoid stale state preserving backups.
            try {
                const lpsUri = vscode.Uri.joinPath(toDeleteProjectUri, ".project", "localProjectSettings.json");
                await vscode.workspace.fs.delete(lpsUri, { recursive: false, useTrash: false });
                debugLog("Removed lingering localProjectSettings.json from toDelete");
            } catch {
                // ignore if missing
            }
            await this.clearUpdateState(projectPath);
        }

        // Step 7: Finalize by opening the healed project and running the LFS-aware sync on next activation.
        // Opening a folder from an empty window restarts extensions (VS Code prompts if Startup Flow is open),
        // so we persist a "pending heal sync" payload and complete it after reload.
        progress.report({ increment: 10, message: "Opening healed project to sync..." });

        const updatedUri = vscode.Uri.file(projectPath);
        const commitMessage = "Updated project: merged local changes after re-clone";

        await this.context.globalState.update(StartupFlowProvider.PENDING_UPDATE_SYNC_KEY, {
            projectPath,
            projectName,
            backupFileName,
            commitMessage,
            createdAt: Date.now(),
            showSuccessMessage,
        });

        await this.clearUpdateState(projectPath);

        // CRITICAL: Update metadata.json AND set local flag BEFORE window reload
        // DO NOT call markUserAsUpdatedInRemoteList here - it triggers a sync that gets interrupted!
        // Instead, update metadata directly and let the post-reload sync push the changes
        if (currentUsername) {
            try {
                // Update metadata.json directly to set executed: true (NO sync triggered)
                const { normalizeUpdateEntry } = await import("../../utils/remoteUpdatingManager");
                await MetadataManager.safeUpdateMetadata(
                    updatedUri,
                    (meta: any) => {
                        const rawList = meta.meta?.initiateRemoteUpdatingFor || [];
                        // Normalize entries and update the matching one
                        const updatedList = rawList.map((entry: any) => {
                            const normalized = normalizeUpdateEntry(entry);
                            if (normalized.userToUpdate === currentUsername && !normalized.executed) {
                                return {
                                    ...normalized,
                                    executed: true,
                                    updatedAt: Date.now(),
                                };
                            }
                            return normalized;
                        });

                        if (!meta.meta) meta.meta = {};
                        meta.meta.initiateRemoteUpdatingFor = updatedList;
                        return meta;
                    }
                );

                // Set local completion flag to prevent re-prompting before sync
                const { markUpdateCompletedLocally } = await import("../../utils/localProjectSettings");
                await markUpdateCompletedLocally(currentUsername, updatedUri);
            } catch (flagErr) {
                console.error("Failed to set update flags:", flagErr);
            }
        }
        await vscode.commands.executeCommand("vscode.openFolder", updatedUri, false);
        return;
    }

    /**
     * Recursively collect conflicts from temp folder
     */
    private async collectConflictsRecursively(
        tempUri: vscode.Uri,
        clonedProjectUri: vscode.Uri,
        conflicts: any[],
        relativePath: string = ""
    ): Promise<void> {
        const entries = await vscode.workspace.fs.readDirectory(tempUri);
        debugLog(`Collecting conflicts from: ${tempUri.fsPath}, relativePath: "${relativePath}", entries: ${entries.length}`);

        for (const [name, type] of entries) {
            const tempEntryUri = vscode.Uri.joinPath(tempUri, name);
            const relativeFilePath = relativePath ? path.join(relativePath, name) : name;

            // Check if we should process this path
            const normalizedPath = relativeFilePath.replace(/\\/g, '/');
            const shouldProcess =
                // .codex files in files/target folder
                (normalizedPath.startsWith('files/target/') && normalizedPath.endsWith('.codex')) ||
                // Any content in .project/attachments folder
                normalizedPath.startsWith('.project/attachments/') ||
                normalizedPath === '.project/attachments' ||
                // Preserve user's media strategy settings
                normalizedPath === '.project/localProjectSettings.json';

            debugLog(`Processing entry: ${name}, type: ${type === vscode.FileType.Directory ? 'Directory' : 'File'}, relativeFilePath: ${relativeFilePath}, shouldProcess: ${shouldProcess}`);

            if (type === vscode.FileType.File && shouldProcess) {
                await this.processConflictFile(tempEntryUri, clonedProjectUri, relativeFilePath, conflicts);
            } else if (type === vscode.FileType.Directory) {
                // Only recurse into directories that might contain files we want
                const normalizedDirPath = relativeFilePath.replace(/\\/g, '/');
                const shouldRecurse =
                    normalizedDirPath === '' || // Root directory
                    normalizedDirPath === 'files' ||
                    normalizedDirPath === 'files/target' ||
                    normalizedDirPath === '.project' ||
                    normalizedDirPath === '.project/attachments' ||
                    normalizedDirPath.startsWith('.project/attachments/');

                if (shouldRecurse) {
                    debugLog(`Recursing into directory: ${relativeFilePath}`);
                    await this.collectConflictsRecursively(tempEntryUri, clonedProjectUri, conflicts, relativeFilePath);
                } else {
                    debugLog(`Skipping directory: ${relativeFilePath}`);
                }
            }
        }
    }

    // --- Update state helpers for restart-safe cleanup ---
    private async persistUpdateState(projectPath: string, partial: Partial<UpdateState>): Promise<void> {
        try {
            const projectUri = vscode.Uri.file(projectPath);
            const settings = await readLocalProjectSettings(projectUri);
            const current: Partial<UpdateState> = settings.updateState || {};
            const completed = new Set<UpdateStep>(current.completedSteps || []);
            if (partial.completedSteps) {
                partial.completedSteps.forEach((s) => completed.add(s as UpdateStep));
            }
            if (partial.step) {
                completed.add(partial.step as UpdateStep);
            }
            settings.updateState = {
                ...current,
                ...partial,
                projectPath: partial.projectPath ?? current.projectPath ?? projectPath,
                projectName: partial.projectName ?? current.projectName ?? path.basename(projectPath),
                completedSteps: Array.from(completed),
            };
            await writeLocalProjectSettings(settings, projectUri);
        } catch (e) {
            debugLog("Failed to update update state", e);
        }
    }

    private async clearUpdateState(projectPath: string): Promise<void> {
        try {
            const projectUri = vscode.Uri.file(projectPath);
            const settings = await readLocalProjectSettings(projectUri);
            if (settings.updateState || settings.pendingUpdate) {
                settings.updateState = undefined;
                settings.pendingUpdate = undefined;
                await writeLocalProjectSettings(settings, projectUri);
            }
        } catch (e) {
            debugLog("Failed to clear update state", e);
        }
    }

    private async cleanupStaleUpdateState(projectPath: string, projectName?: string): Promise<string | undefined> {
        const projectUri = vscode.Uri.file(projectPath);
        let state: UpdateState | undefined;
        try {
            const settings = await readLocalProjectSettings(projectUri);
            state = settings.updateState;
        } catch (e) {
            debugLog("Could not read update state", e);
            state = undefined;
        }
        const backupNamePattern = /_updating_backup_\d+$/;
        const currentIsBackup = backupNamePattern.test(path.basename(projectPath));

        // If no state and current folder is a backup-named folder, try reading state from canonical path
        if (!state && currentIsBackup) {
            const canonicalCandidate = path.join(
                path.dirname(projectPath),
                path.basename(projectPath).replace(backupNamePattern, "")
            );
            try {
                const canonicalSettings = await readLocalProjectSettings(vscode.Uri.file(canonicalCandidate));
                state = canonicalSettings.updateState;
                if (state) {
                    debugLog("Recovered update state from canonical folder while in backup path");
                }
            } catch {
                // ignore
            }
        }

        if (!state) return undefined;

        const canonicalFromState = state.projectPath ?? projectPath;
        const derivedCanonicalPath = currentIsBackup
            ? path.join(path.dirname(projectPath), path.basename(projectPath).replace(backupNamePattern, ""))
            : canonicalFromState;
        const canonicalProjectPath = derivedCanonicalPath;
        const canonicalProjectUri = vscode.Uri.file(canonicalProjectPath);

        // Ensure we only act on matching projects (by path or known derived names)
        const candidateNames = new Set<string>();
        candidateNames.add(path.basename(projectPath));
        candidateNames.add(path.basename(canonicalProjectPath));
        if (projectName) candidateNames.add(projectName);
        if (state.projectName) candidateNames.add(state.projectName);
        if (state.tempFolderPath) candidateNames.add(path.basename(state.tempFolderPath));
        if (state.backupProjectPath) candidateNames.add(path.basename(state.backupProjectPath));
        if (state.clonePath) candidateNames.add(path.basename(state.clonePath));

        if (!candidateNames.has(path.basename(canonicalProjectPath))) {
            // Not the same project; avoid cleaning unrelated entries
            debugLog("Update state does not match current project; skipping cleanup");
            return undefined;
        }

        const pathExists = async (uri: vscode.Uri): Promise<boolean> => {
            try {
                await vscode.workspace.fs.stat(uri);
                return true;
            } catch {
                return false;
            }
        };
        const safeDelete = async (uri?: vscode.Uri) => {
            if (!uri) return;
            try {
                await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
            } catch {
                // ignore
            }
        };

        const projectExists = await pathExists(canonicalProjectUri);
        const backupProjectUri = state.backupProjectPath ? vscode.Uri.file(state.backupProjectPath) : undefined;
        let backupExists = backupProjectUri ? await pathExists(backupProjectUri) : false;
        const cloneProjectUri = state.clonePath ? vscode.Uri.file(state.clonePath) : undefined;
        let cloneExists = cloneProjectUri ? await pathExists(cloneProjectUri) : false;

        // If the currently opened path is a backup folder, try to restore it to canonical
        if (currentIsBackup) {
            if (projectExists && canonicalProjectUri.fsPath !== projectPath) {
                await safeDelete(canonicalProjectUri);
            }
            try {
                await vscode.workspace.fs.rename(projectUri, canonicalProjectUri);
                debugLog("Restored backup-named folder back to canonical path");
                state.backupProjectPath = undefined;
                backupExists = false;
            } catch (e) {
                debugLog("Failed to rename backup-named folder to canonical", e);
            }
        } else if (backupExists) {
            // If backup exists, restore it to canonical project path
            if (projectExists && state.backupProjectPath !== canonicalProjectUri.fsPath) {
                // Remove the current project (likely incomplete) then restore backup
                await safeDelete(canonicalProjectUri);
            }
            if (state.backupProjectPath !== canonicalProjectUri.fsPath) {
                try {
                    await vscode.workspace.fs.rename(backupProjectUri!, canonicalProjectUri);
                    backupExists = false;
                } catch (e) {
                    debugLog("Failed to restore from backup during cleanup", e);
                }
            }
        } else if (!projectExists && cloneExists) {
            // If canonical missing but cloning exists, promote clone to canonical
            try {
                await vscode.workspace.fs.rename(cloneProjectUri!, canonicalProjectUri);
                cloneExists = false;
                debugLog("Promoted cloning folder to canonical during cleanup");
            } catch (e) {
                debugLog("Failed to promote cloning folder to canonical", e);
            }
        }

        // Remove temp folder
        const tempUri = state.tempFolderPath ? vscode.Uri.file(state.tempFolderPath) : undefined;
        await safeDelete(tempUri);
        const tempExists = tempUri ? await pathExists(tempUri) : false;

        // Remove clone folder if still present and not needed
        if (cloneExists) {
            await safeDelete(cloneProjectUri);
            cloneExists = cloneProjectUri ? await pathExists(cloneProjectUri) : false;
        }

        // Sweep any orphan temp folders for this project name if current temp is gone
        if (!tempExists) {
            try {
                const codexProjectsRoot = await getCodexProjectsDirectory();
                const entries = await vscode.workspace.fs.readDirectory(codexProjectsRoot);
                for (const [name, type] of entries) {
                    if (
                        type === vscode.FileType.Directory &&
                        name.startsWith(`${path.basename(canonicalProjectPath)}_temp_`) &&
                        (!tempUri || name !== path.basename(tempUri.fsPath))
                    ) {
                        try {
                            await vscode.workspace.fs.delete(vscode.Uri.joinPath(codexProjectsRoot, name), {
                                recursive: true,
                                useTrash: false,
                            });
                            debugLog(`Deleted orphan temp folder: ${name}`);
                        } catch (e) {
                            debugLog(`Failed to delete orphan temp folder: ${name}`, e);
                        }
                    }
                }
            } catch (e) {
                debugLog("Failed sweeping orphan temp folders", e);
            }
        }

        // Retain backup choice and mark cleanup done; keep paths for potential resume logic
        await this.persistUpdateState(canonicalProjectPath, {
            projectPath: canonicalProjectPath,
            projectName: state.projectName ?? path.basename(canonicalProjectPath),
            backupMode: state.backupMode,
            createdAt: state.createdAt,
            step: "cleanup_done",
            completedSteps: Array.from(new Set([...(state.completedSteps || []), "cleanup_done"])),
            backupZipPath: state.backupZipPath,
            tempFolderPath: tempExists ? state.tempFolderPath : undefined,
            backupProjectPath: backupExists ? state.backupProjectPath : undefined,
            clonePath: cloneExists ? state.clonePath : undefined,
        });

        return canonicalProjectPath;
    }

    private async hasPendingLocalUpdate(projectPath: string): Promise<boolean> {
        try {
            const projectUri = vscode.Uri.file(projectPath);
            const settings = await readLocalProjectSettings(projectUri);
            const state = settings.updateState;

            // Only return true if updateState exists (update already in progress)
            // pendingUpdate alone is just a UI hint - it requires remote validation
            // and will be cleared by validatePendingUpdates() if remote doesn't confirm
            if (!state) return false;
            return Boolean(
                state.backupProjectPath ||
                state.tempFolderPath ||
                state.backupZipPath ||
                state.clonePath
            );
        } catch {
            return false;
        }
    }

    private async normalizeBackupPathForOpen(projectPath: string): Promise<string> {
        const backupNamePattern = /_updating_backup_\d+$/;
        const isBackup = backupNamePattern.test(path.basename(projectPath));
        if (!isBackup) return projectPath;

        const canonicalPath = path.join(
            path.dirname(projectPath),
            path.basename(projectPath).replace(backupNamePattern, "")
        );
        const canonicalUri = vscode.Uri.file(canonicalPath);
        const backupUri = vscode.Uri.file(projectPath);

        // If canonical already exists, prefer it (do not delete it here).
        try {
            await vscode.workspace.fs.stat(canonicalUri);
            return canonicalPath;
        } catch {
            // canonical missing, try to rename backup to canonical
            try {
                await vscode.workspace.fs.rename(backupUri, canonicalUri);
                return canonicalPath;
            } catch {
                return projectPath; // fallback
            }
        }
    }

    /**
     * Process a single conflict file
     */
    private async processConflictFile(
        tempEntryUri: vscode.Uri,
        clonedProjectUri: vscode.Uri,
        relativeFilePath: string,
        conflicts: any[]
    ): Promise<void> {
        const tempContent = await vscode.workspace.fs.readFile(tempEntryUri);
        const isBinary = this.isBinaryFile(relativeFilePath);

        // Check if file exists in newly cloned project
        const clonedFileUri = vscode.Uri.joinPath(clonedProjectUri, relativeFilePath);
        let clonedContent: Uint8Array | undefined;
        let fileExists = true;

        try {
            clonedContent = await vscode.workspace.fs.readFile(clonedFileUri);
        } catch {
            fileExists = false;
        }

        if (isBinary) {
            // Handle binary files - keep as raw bytes
            debugLog("Collected binary conflict:", {
                filepath: relativeFilePath,
                ours: `<binary file ${tempContent.length} bytes>`,
                theirs: clonedContent ? `<binary file ${clonedContent.length} bytes>` : "<not found>",
                isNew: !fileExists,
                isDeleted: false,
                isBinary: true
            });

            conflicts.push({
                filepath: relativeFilePath.replace(/\\/g, '/'),
                ours: tempContent,  // Keep as Uint8Array
                theirs: clonedContent || new Uint8Array(),  // Keep as Uint8Array
                base: new Uint8Array(),
                isNew: !fileExists,
                isDeleted: false,
                isBinary: true
            });
        } else {
            // Handle text files - convert to strings
            const tempContentStr = Buffer.from(tempContent).toString('utf8');
            const clonedContentStr = clonedContent ? Buffer.from(clonedContent).toString('utf8') : "";

            debugLog("Collected text conflict:", {
                filepath: relativeFilePath,
                ours: tempContentStr.substring(0, 100) + (tempContentStr.length > 100 ? '...' : ''),
                theirs: clonedContentStr.substring(0, 100) + (clonedContentStr.length > 100 ? '...' : ''),
                base: "",
                isNew: !fileExists,
                isDeleted: false,
                isBinary: false
            });

            conflicts.push({
                filepath: relativeFilePath.replace(/\\/g, '/'),
                ours: tempContentStr,  // String content
                theirs: clonedContentStr,  // String content
                base: "",
                isNew: !fileExists,
                isDeleted: false,
                isBinary: false
            });
        }
    }

    /**
     * Resolve conflicts by creating directories and writing files
     */
    private async resolveProjectConflicts(clonedProjectUri: vscode.Uri, conflicts: any[]): Promise<void> {
        // Ensure all parent directories exist before resolving conflicts
        const uniqueDirs = new Set<string>();
        for (const conflict of conflicts) {
            const normalizedPath = conflict.filepath.replace(/\//g, path.sep);
            const dir = path.dirname(normalizedPath);
            if (dir && dir !== '.' && dir !== path.sep) {
                uniqueDirs.add(dir);
            }
        }

        // Create directories in order (parent directories first)
        const sortedDirs = Array.from(uniqueDirs).sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
        debugLog("Creating directories:", { sortedDirs });

        for (const dir of sortedDirs) {
            const dirUri = vscode.Uri.joinPath(clonedProjectUri, ...dir.split(path.sep));
            const created = await this.ensureDirectoryExists(dirUri);
            if (!created) {
                throw new Error(`Failed to create directory: ${dir}`);
            }
        }

        // Write conflict files
        for (const conflict of conflicts) {
            const filePath = vscode.Uri.joinPath(clonedProjectUri, ...conflict.filepath.split('/'));

            if (conflict.isNew || conflict.ours !== conflict.theirs) {
                debugLog(`Writing file: ${conflict.filepath}`);
                await this.writeFileContent(filePath, conflict.ours, conflict.isBinary || false);
            } else {
                debugLog(`Skipping unchanged file: ${conflict.filepath}`);
            }
        }
    }

    /**
     * Commit healed changes to git
     */
    private async commitHealedChanges(projectPath: string): Promise<void> {
        try {
            const author = {
                name: this.frontierApi?.getUserInfo ?
                    (await this.frontierApi.getUserInfo()).username : "Unknown",
                email: this.frontierApi?.getUserInfo ?
                    (await this.frontierApi.getUserInfo()).email : "unknown@unknown.com"
            };

            // Stage all changes
            await git.add({
                fs,
                dir: projectPath,
                filepath: "."
            });

            // Commit the healed changes
            await git.commit({
                fs,
                dir: projectPath,
                message: "Updated project: merged local changes after re-clone",
                author
            });

            debugLog("Committed updated project changes");
        } catch (error) {
            console.warn("Error committing updated changes (non-critical):", error);
            // Non-critical error, don't fail the heal operation
        }
    }

    private async sendList(webviewPanel: vscode.WebviewPanel) {
        if (!safeIsVisible(webviewPanel, "StartupFlow")) {
            debugLog("WebviewPanel is no longer available, skipping sendList");
            return;
        }

        const startTime = Date.now();

        try {
            const [localProjectsResult, remoteProjectsResult] = await Promise.allSettled([
                this.fetchLocalProjects(),
                this.fetchRemoteProjects(),
            ]);

            const localProjects =
                localProjectsResult.status === "fulfilled" ? localProjectsResult.value : [];
            if (localProjectsResult.status === "rejected") {
                console.error("Error fetching local projects:", localProjectsResult.reason);
            }

            const remoteProjects =
                remoteProjectsResult.status === "fulfilled" ? remoteProjectsResult.value : [];
            if (remoteProjectsResult.status === "rejected") {
                console.error("Error fetching remote projects:", remoteProjectsResult.reason);
            }


            const projectList: ProjectWithSyncStatus[] = [];

            // Process remote projects
            for (const project of remoteProjects) {
                projectList.push({
                    name: project.name,
                    path: "",
                    lastOpened: project.lastActivity ? new Date(project.lastActivity) : undefined,
                    lastModified: new Date(project.lastActivity),
                    version: "🚫",
                    hasVersionMismatch: false,
                    gitOriginUrl: project.url,
                    description: project.description || "...",
                    syncStatus: "cloudOnlyNotSynced",
                });
            }

            // Helper to normalize Git URLs for comparison
            // Removes protocol, credentials, .git suffix, and trailing slashes
            const normalizeUrl = (url: string | undefined) => {
                if (!url) return "";
                try {
                    let clean = url.trim();

                    // Handle standard URL format (http/https)
                    if (clean.startsWith('http')) {
                        const urlObj = new URL(clean);
                        // Returns domain/path (e.g., git.genesisrnd.com/group/project)
                        let path = urlObj.pathname;
                        if (path.endsWith('.git')) path = path.slice(0, -4);
                        if (path.endsWith('/')) path = path.slice(0, -1);
                        return `${urlObj.host}${path}`.toLowerCase();
                    }

                    // Handle SSH/SCP format (git@domain:path)
                    if (clean.includes('@') && clean.includes(':')) {
                        const parts = clean.split('@');
                        let domainAndPath = parts[1]; // domain:path
                        // Replace : with / to standardize
                        domainAndPath = domainAndPath.replace(':', '/');
                        if (domainAndPath.endsWith('.git')) domainAndPath = domainAndPath.slice(0, -4);
                        if (domainAndPath.endsWith('/')) domainAndPath = domainAndPath.slice(0, -1);
                        return domainAndPath.toLowerCase();
                    }

                    // Fallback for other formats: just strip common suffixes
                    clean = clean.toLowerCase();
                    if (clean.endsWith('.git')) clean = clean.slice(0, -4);
                    if (clean.endsWith('/')) clean = clean.slice(0, -1);
                    return clean;
                } catch (e) {
                    return url.trim().toLowerCase();
                }
            };

            // Process local projects and check for matches
            for (const project of localProjects) {
                if (!project.gitOriginUrl) {
                    projectList.push({
                        ...project,
                        syncStatus: "localOnlyNotSynced",
                    });
                    continue;
                }

                const localNormalized = normalizeUrl(project.gitOriginUrl);
                const matchInRemoteIndex = projectList.findIndex(
                    (p) => normalizeUrl(p.gitOriginUrl) === localNormalized
                );

                if (matchInRemoteIndex !== -1) {
                    projectList[matchInRemoteIndex] = {
                        ...project,
                        syncStatus: "downloadedAndSynced",
                    };
                } else {
                    // If local project has a git remote but is NOT in the remote list,
                    // mark it as "orphaned" (remote missing or inaccessible).
                    // If no git remote, it's a pure local project.
                    projectList.push({
                        ...project,
                        syncStatus: project.gitOriginUrl ? "orphaned" : "localOnlyNotSynced",
                    });
                }
            }

            // ============================================================
            // CONSOLIDATED SWAP VISIBILITY FILTERING
            // All swap-related project hiding/showing logic is here
            // ============================================================

            // Build set of all known project URLs for swap validation
            const knownProjectUrls = new Set(
                projectList.map(p => normalizeUrl(p.gitOriginUrl)).filter(Boolean)
            );

            // Build set of local project URLs (projects that are downloaded)
            const localDownloadedUrls = new Set(
                projectList
                    .filter(p => p.syncStatus === "downloadedAndSynced" || p.syncStatus === "localOnlyNotSynced" || p.syncStatus === "orphaned")
                    .map(p => normalizeUrl(p.gitOriginUrl))
                    .filter(Boolean)
            );

            // Build sets of URLs to hide based on swap rules:
            // 
            // RULE 1: Hide OLD remote projects when NEW is local AND swap is ACTIVE
            //         (User should complete swap on the new project, not clone the old one)
            //
            // RULE 2: Hide NEW remote projects when OLD is local AND swap is ACTIVE
            //         (User needs to complete swap from old→new, not clone new separately)
            //
            // RULE 3: When swap is COMPLETED/CANCELLED, show BOTH projects
            //         (User may want access to both versions)

            const oldProjectUrlsToHide = new Set<string>();
            const newProjectUrlsToHide = new Set<string>();

            for (const project of projectList) {
                // Skip remote-only projects for building hide lists
                // (we only look at local projects to determine what to hide)
                if (project.syncStatus === "cloudOnlyNotSynced") {
                    continue;
                }

                // Skip if no swap info or swap is not active
                if (!project.projectSwap || project.projectSwap.swapStatus !== "active") {
                    continue;
                }

                // RULE 1: LOCAL OLD project with ACTIVE swap → hide NEW remote
                // isOldProject must be explicitly true (not undefined or false)
                if (project.projectSwap.isOldProject === true && project.projectSwap.newProjectUrl) {
                    const newProjectNormalized = normalizeUrl(project.projectSwap.newProjectUrl);
                    if (newProjectNormalized) {
                        newProjectUrlsToHide.add(newProjectNormalized);
                        debugLog(`Swap filter: hiding NEW remote ${newProjectNormalized} (OLD local ${project.name} has active swap)`);
                    }

                    // Also check: if NEW project is already local, hide OLD remote too
                    if (localDownloadedUrls.has(newProjectNormalized)) {
                        const oldProjectNormalized = normalizeUrl(project.projectSwap.oldProjectUrl);
                        if (oldProjectNormalized) {
                            oldProjectUrlsToHide.add(oldProjectNormalized);
                            debugLog(`Swap filter: hiding OLD remote ${oldProjectNormalized} (NEW is already local)`);
                        }
                    }
                }

                // RULE 2: LOCAL NEW project with ACTIVE swap → hide OLD remote
                // isOldProject must be explicitly false (not undefined or true)
                if (project.projectSwap.isOldProject === false && project.projectSwap.oldProjectUrl) {
                    const oldProjectNormalized = normalizeUrl(project.projectSwap.oldProjectUrl);
                    if (oldProjectNormalized) {
                        oldProjectUrlsToHide.add(oldProjectNormalized);
                        debugLog(`Swap filter: hiding OLD remote ${oldProjectNormalized} (NEW local ${project.name} has active swap)`);
                    }
                }
            }

            // Apply filtering: only hide REMOTE (cloudOnlyNotSynced) projects
            // Local projects are NEVER hidden by swap rules
            const filteredProjectList = projectList.filter(project => {
                // Keep all local projects - they should always be visible
                if (project.syncStatus !== "cloudOnlyNotSynced") {
                    return true;
                }

                const projectUrlNormalized = normalizeUrl(project.gitOriginUrl);
                if (!projectUrlNormalized) {
                    return true; // Can't filter without URL, keep it
                }

                // Hide remote OLD projects per RULE 1 & 2
                if (oldProjectUrlsToHide.has(projectUrlNormalized)) {
                    debugLog(`Swap filter: filtering out remote OLD project ${project.name}`);
                    return false;
                }

                // Hide remote NEW projects per RULE 2
                if (newProjectUrlsToHide.has(projectUrlNormalized)) {
                    debugLog(`Swap filter: filtering out remote NEW project ${project.name}`);
                    return false;
                }

                return true;
            });

            // Validate swap targets: ensure referenced projects exist
            // If they don't exist (locally or remotely), clear swap info to avoid confusion
            for (const project of filteredProjectList) {
                if (!project.projectSwap || project.projectSwap.swapStatus !== "active") {
                    continue;
                }

                // For OLD projects: validate NEW project exists
                if (project.projectSwap.isOldProject === true && project.projectSwap.newProjectUrl) {
                    const newProjectNormalized = normalizeUrl(project.projectSwap.newProjectUrl);
                    if (newProjectNormalized && !knownProjectUrls.has(newProjectNormalized)) {
                        debugLog(`Swap validation: NEW project ${newProjectNormalized} not found, clearing swap for ${project.name}`);
                        project.projectSwap = undefined;
                    }
                }

                // For NEW projects: validate OLD project exists (optional but good for consistency)
                if (project.projectSwap?.isOldProject === false && project.projectSwap.oldProjectUrl) {
                    const oldProjectNormalized = normalizeUrl(project.projectSwap.oldProjectUrl);
                    if (oldProjectNormalized && !knownProjectUrls.has(oldProjectNormalized)) {
                        // OLD project doesn't exist - this is unusual but possible if old was deleted
                        // Keep the swap info but log it for debugging
                        debugLog(`Swap validation: OLD project ${oldProjectNormalized} not found for NEW ${project.name} (keeping swap info)`);
                    }
                }
            }

            // ============================================================
            // END CONSOLIDATED SWAP VISIBILITY FILTERING
            // ============================================================

            safePostMessageToPanel(
                webviewPanel,
                {
                    command: "projectsListFromGitLab",
                    projects: filteredProjectList,
                } as MessagesFromStartupFlowProvider,
                "StartupFlow"
            );

            const mergeTime = Date.now() - startTime;
            debugLog(`Complete project list sent in ${mergeTime}ms - Total: ${filteredProjectList.length} projects`);

            this.fetchProgressDataAsync(webviewPanel);

        } catch (error) {
            console.error("Failed to fetch and process projects:", error);
            safePostMessageToPanel(
                webviewPanel,
                {
                    command: "projectsListFromGitLab",
                    projects: [],
                    error: error instanceof Error ? error.message : "Failed to fetch projects",
                } as MessagesFromStartupFlowProvider,
                "StartupFlow"
            );
        }
    }

    /**
     * Fetch progress data asynchronously and send when ready
     */
    private async fetchProgressDataAsync(webviewPanel: vscode.WebviewPanel) {
        try {
            debugLog("Fetching progress data asynchronously...");
            const progressStartTime = Date.now();

            const progressData = await this.fetchProgressData();

            const progressTime = Date.now() - progressStartTime;
            debugLog(`Progress data fetched in ${progressTime}ms`);

            // Only send if webview is still available
            if (safeIsVisible(webviewPanel, "StartupFlow")) {
                safePostMessageToPanel(webviewPanel, {
                    command: "progressData",
                    data: progressData,
                } as MessagesFromStartupFlowProvider, "StartupFlow");

                debugLog("Progress data sent to webview");
            }
        } catch (error) {
            console.warn("Error fetching progress data:", error);
            // Don't send error for progress data as it's not critical
        }
    }

    /**
     * Fetch progress data with error handling
     */
    private async fetchProgressData(): Promise<any> {
        try {
            if (!this.frontierApi) {
                this.frontierApi = getAuthApi();
            }

            if (this.frontierApi) {
                const authStatus = this.frontierApi.getAuthStatus();
                if (!authStatus?.isAuthenticated) {
                    debugLog("User not authenticated, skipping fetchProgressData");
                    return undefined;
                }
            }

            const progressData = await vscode.commands.executeCommand(
                "frontier.getAggregatedProgress"
            );
            return progressData;
        } catch (error) {
            console.warn("Error fetching progress data:", error);
            return undefined;
        }
    }

    private async cloneProjectWithChecks(
        repoUrl: string,
        mediaStrategy?: MediaFilesStrategy,
        skipDeprecatedPrompt: boolean = false
    ): Promise<void> {
        debugLog("Cloning repository", repoUrl);

        // Extract project name from URL for progress tracking
        const urlParts = repoUrl.split("/");
        let projectName = urlParts[urlParts.length - 1];
        if (projectName.endsWith(".git")) {
            projectName = projectName.slice(0, -4);
        }

        let projectDir: vscode.Uri | undefined;

        try {
            // Check remote metadata to warn if this is the old/deprecated project
            try {
                const { extractProjectIdFromUrl, fetchRemoteMetadata } = await import("../../utils/remoteUpdatingManager");
                const { getActiveSwapEntry, normalizeProjectSwapInfo } = await import("../../utils/projectSwapManager");
                const projectId = extractProjectIdFromUrl(repoUrl);
                if (projectId) {
                    const remoteMetadata = await fetchRemoteMetadata(projectId, false);
                    const swapInfo = remoteMetadata?.meta?.projectSwap as ProjectSwapInfo | undefined;
                    const normalizedSwapInfo = swapInfo ? normalizeProjectSwapInfo(swapInfo) : undefined;
                    const activeEntry = normalizedSwapInfo ? getActiveSwapEntry(normalizedSwapInfo) : undefined;

                    // isOldProject is now in each entry, not at the top level
                    if (activeEntry?.isOldProject) {
                        // ACTIVE swap - this project is currently deprecated
                        const deprecatedMessage = "This project has been deprecated.";

                        this.safeSendMessage({
                            command: "project.swapCloneWarning",
                            repoUrl,
                            isOldProject: true,
                            newProjectName: activeEntry?.newProjectName,
                            message: deprecatedMessage,
                        } as any);

                        // If user has not explicitly confirmed (via banner button), stop here.
                        if (!skipDeprecatedPrompt) {
                            debugLog("Deprecated project clone blocked until user confirms via banner button");
                            return;
                        }
                    } else if (!activeEntry && normalizedSwapInfo?.swapEntries?.length) {
                        // No active swap, but has cancelled swap entries - check if new projects have had swap activity
                        // This indicates work may have continued in the new projects
                        const cancelledOldProjectEntries = normalizedSwapInfo.swapEntries.filter(
                            e => e.isOldProject && e.swapStatus === "cancelled"
                        );

                        if (cancelledOldProjectEntries.length > 0) {
                            // Get unique new project URLs from cancelled entries
                            const newProjectUrls = [...new Set(
                                cancelledOldProjectEntries
                                    .map(e => e.newProjectUrl)
                                    .filter(Boolean)
                            )] as string[];

                            // Helper to normalize URLs for comparison
                            const normalizeUrlForComparison = (url: string): string => {
                                let normalized = url.toLowerCase().trim();
                                if (normalized.endsWith(".git")) {
                                    normalized = normalized.slice(0, -4);
                                }
                                // Remove protocol and trailing slashes
                                normalized = normalized.replace(/^https?:\/\//, "").replace(/\/$/, "");
                                return normalized;
                            };

                            // Get all local projects to check if new projects exist locally
                            const localProjects = await findAllCodexProjects();
                            type LocalProjectType = Awaited<ReturnType<typeof findAllCodexProjects>>[number];
                            const localProjectsByUrl = new Map<string, LocalProjectType>();
                            for (const lp of localProjects) {
                                if (lp.gitOriginUrl) {
                                    localProjectsByUrl.set(normalizeUrlForComparison(lp.gitOriginUrl), lp);
                                }
                            }

                            // Check if any of the new projects have swap entries (indicating work continued)
                            // Check locally first, then remote if not available locally
                            let workContinuedInNewProjects = false;
                            for (const newUrl of newProjectUrls) {
                                try {
                                    const normalizedNewUrl = normalizeUrlForComparison(newUrl);
                                    const localNewProject = localProjectsByUrl.get(normalizedNewUrl);

                                    if (localNewProject) {
                                        // New project exists locally - check its local metadata
                                        debugLog("Checking local new project for swap activity:", localNewProject.path);
                                        try {
                                            const metadataPath = vscode.Uri.file(path.join(localNewProject.path, "metadata.json"));
                                            const metadataBuffer = await vscode.workspace.fs.readFile(metadataPath);
                                            const metadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8"));
                                            const newSwapInfo = metadata?.meta?.projectSwap;
                                            if (newSwapInfo?.swapEntries?.length) {
                                                // New project has swap entries - work/swaps happened there
                                                workContinuedInNewProjects = true;
                                                debugLog("Local new project has swap entries - work continued");
                                                break;
                                            }
                                        } catch {
                                            // Failed to read local metadata, fall through to remote check
                                            debugLog("Failed to read local metadata, checking remote");
                                        }
                                    }

                                    // If not available locally or local read failed, check remote
                                    if (!workContinuedInNewProjects) {
                                        const newProjectId = extractProjectIdFromUrl(newUrl);
                                        if (newProjectId) {
                                            debugLog("Checking remote new project for swap activity:", newUrl);
                                            const newProjectMetadata = await fetchRemoteMetadata(newProjectId, false);
                                            const newSwapInfo = newProjectMetadata?.meta?.projectSwap;
                                            if (newSwapInfo?.swapEntries?.length) {
                                                // New project has swap entries - work/swaps happened there
                                                workContinuedInNewProjects = true;
                                                debugLog("Remote new project has swap entries - work continued");
                                                break;
                                            }
                                        }
                                    }
                                } catch {
                                    // Failed to fetch new project metadata - continue checking others
                                }
                            }

                            if (workContinuedInNewProjects) {
                                // Show informational warning but DON'T block clone
                                const warningAction = await vscode.window.showWarningMessage(
                                    "This project was previously deprecated. Work may have continued in the newer project(s). " +
                                    "Cloning this project may result in working with outdated content.",
                                    { modal: true },
                                    "Clone Anyway"
                                );

                                if (warningAction !== "Clone Anyway") {
                                    debugLog("User cancelled clone of previously deprecated project");
                                    return;
                                }
                            }
                        }

                        // Clear the warning banner since this is not actively deprecated
                        this.safeSendMessage({
                            command: "project.swapCloneWarning",
                            repoUrl,
                            isOldProject: false,
                            message: "",
                        } as any);
                    } else {
                        this.safeSendMessage({
                            command: "project.swapCloneWarning",
                            repoUrl,
                            isOldProject: false,
                            message: "",
                        } as any);
                    }
                }
            } catch (warningErr) {
                debugLog("Failed to check remote metadata for swap warning:", warningErr);
            }

            // Get the .codex-projects directory
            const codexProjectsDir = await getCodexProjectsDirectory();

            // Create a unique folder name if needed
            projectDir = vscode.Uri.joinPath(codexProjectsDir, projectName);

            // Check if directory already exists
            try {
                await vscode.workspace.fs.stat(projectDir);
                // If we get here, the directory exists
                const timestamp = this.generateTimestamp();
                const newProjectName = `${projectName}-${timestamp}`;
                projectDir = vscode.Uri.joinPath(codexProjectsDir, newProjectName);
            } catch {
                // Directory doesn't exist, which is what we want
            }

            // Inform webview that cloning is starting
            try {
                this.safeSendMessage({
                    command: "project.cloningInProgress",
                    projectPath: projectDir.fsPath,
                    gitOriginUrl: repoUrl,
                    cloning: true,
                } as any);
            } catch (e) {
                // non-fatal
            }

            try {
                // Create project and .project directories before cloning
                // This ensures localProjectSettings.json can be written early
                try {
                    const fs = await import("fs");
                    const projectPath = projectDir.fsPath;
                    const projectDotPath = path.join(projectPath, ".project");

                    if (!fs.existsSync(projectPath)) {
                        fs.mkdirSync(projectPath, { recursive: true });
                    }
                    if (!fs.existsSync(projectDotPath)) {
                        fs.mkdirSync(projectDotPath, { recursive: true });
                    }

                    // Write localProjectSettings.json BEFORE cloning starts
                    // This ensures it's one of the first files written (right after directories are created)
                    if (mediaStrategy) {
                        const { ensureLocalProjectSettingsExists } = await import("../../utils/localProjectSettings");
                        await ensureLocalProjectSettingsExists(projectDir, {
                            currentMediaFilesStrategy: mediaStrategy,
                            lastMediaFileStrategyRun: mediaStrategy,
                            mediaFileStrategyApplyState: "applied",
                            autoDownloadAudioOnOpen: false,
                        });
                        debugLog(`Wrote localProjectSettings.json with strategy: ${mediaStrategy} BEFORE cloning`);
                    }
                } catch (settingsErr) {
                    debugLog("Failed to write localProjectSettings.json before clone:", settingsErr);
                    // Non-fatal: continue with clone
                }

                // Clone to the .codex-projects directory and await completion
                await this.frontierApi?.cloneRepository(
                    repoUrl,
                    projectDir.fsPath,
                    undefined,
                    mediaStrategy
                );

            } finally {
                // Inform webview that cloning is complete
                try {
                    this.safeSendMessage({
                        command: "project.cloningInProgress",
                        projectPath: projectDir.fsPath,
                        gitOriginUrl: repoUrl,
                        cloning: false,
                    } as any);
                } catch (e) {
                    // non-fatal
                }
            }
        } catch (error) {
            console.error("Error preparing to clone repository:", error);
            this.frontierApi?.cloneRepository(
                repoUrl,
                projectDir?.fsPath,
                undefined,
                mediaStrategy
            );
        }

        // Refresh list after clone attempt
        try {
            await this.sendList(this.webviewPanel!);
        } catch (refreshErr) {
            debugLog("Failed to refresh project list after clone:", refreshErr);
        }
    }

    /**
     * Fetch remote projects with error handling and cleanup
     */
    private async fetchRemoteProjects(): Promise<GitLabProject[]> {
        if (!this.frontierApi) {
            return [];
        }

        try {
            const remoteProjects = await this.frontierApi.listProjects(false);

            // Keep full project names with UUID for proper identification
            // (Previously stripped the UUID suffix, but now keeping it for differentiation)

            return remoteProjects;
        } catch (error) {
            console.error("Error fetching remote projects:", error);
            return [];
        }
    }

    /**
     * Fetch local projects with error handling
     */
    private async fetchLocalProjects(): Promise<LocalProject[]> {
        try {
            const localProjects = await findAllCodexProjects();
            return localProjects;
        } catch (error) {
            console.error("Error finding local Codex projects:", error);
            return [];
        }
    }

    /**
     * Formats authentication error messages to be more user-friendly
     */
    private getFormattedAuthError(errorMessage: string): string {
        const lowerMessage = errorMessage.toLowerCase();

        // Check for common "user exists" error patterns and make them more user-friendly
        if (lowerMessage.includes('user already exists') ||
            lowerMessage.includes('user exists') ||
            lowerMessage.includes('username already exists') ||
            lowerMessage.includes('already exists')) {
            return "Username has already been taken. Please choose a different username.";
        }

        // Check for other common patterns
        if (lowerMessage.includes('invalid credentials') ||
            lowerMessage.includes('wrong password') ||
            lowerMessage.includes('incorrect password')) {
            return "Invalid username or password. Please check your credentials and try again.";
        }

        // Return the original message if no pattern matches
        return errorMessage;
    }
}

