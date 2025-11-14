import {
    MessagesToStartupFlowProvider,
    MessagesFromStartupFlowProvider,
    GitLabProject,
    ProjectWithSyncStatus,
    LocalProject,
    ProjectManagerMessageFromWebview,
} from "../../../types";
import * as vscode from "vscode";
import { PreflightCheck, PreflightState } from "./preflight";
import { findAllCodexProjects } from "../../../src/projectManager/utils/projectUtils";
import { AuthState, FrontierAPI } from "webviews/codex-webviews/src/StartupFlow/types";
import {
    createNewProject,
    createNewWorkspaceAndProject,
    createWorkspaceWithProjectName,
    sanitizeProjectName,
} from "../../utils/projectCreationUtils/projectCreationUtils";
import { getAuthApi } from "../../extension";
import { createMachine, assign, createActor } from "xstate";
import { getCodexProjectsDirectory } from "../../utils/projectLocationUtils";
import JSZip from "jszip";
import { getWebviewHtml } from "../../utils/webviewTemplate";

import { safePostMessageToPanel, safeIsVisible, safeSetHtml, safeSetOptions } from "../../utils/webviewUtils";
import * as path from "path";
import * as fs from "fs";
import git from "isomorphic-git";

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
    private async getCachedPreflightState(): Promise<PreflightState> {
        if (this._preflightPromise) {
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
                        [StartupFlowEvents.SKIP_AUTH]: {
                            target: StartupFlowStates.OPEN_OR_CREATE_PROJECT,
                        },
                    },
                },
                [StartupFlowStates.OPEN_OR_CREATE_PROJECT]: {
                    on: {
                        [StartupFlowEvents.UPDATE_AUTH_STATE]: [
                            {
                                target: StartupFlowStates.LOGIN_REGISTER,
                                guard: ({ event }) => !("data" in event ? event.data.isAuthenticated : true),
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
                            {
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
                    },
                },
                [StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT]: {
                    on: {
                        [StartupFlowEvents.UPDATE_AUTH_STATE]: [
                            {
                                target: StartupFlowStates.LOGIN_REGISTER,
                                guard: ({ event }) => !("data" in event ? event.data.isAuthenticated : true),
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
                            {
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
                        ],
                        [StartupFlowEvents.INITIALIZE_PROJECT]:
                            StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA,
                        [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]:
                            StartupFlowStates.ALREADY_WORKING,
                        [StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA]:
                            StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA,
                        [StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT]:
                            StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT,
                    },
                },
                [StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA]: {
                    on: {
                        [StartupFlowEvents.UPDATE_AUTH_STATE]: [
                            {
                                target: StartupFlowStates.LOGIN_REGISTER,
                                guard: ({ event }) => !("data" in event ? event.data.isAuthenticated : true),
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
                            {
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
                        ],
                        [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]:
                            StartupFlowStates.ALREADY_WORKING,
                    },
                },
                [StartupFlowStates.ALREADY_WORKING]: {
                    type: "final",
                },
            },
        });

        const actor = createActor(machine).start();
        this.stateMachine = actor;

        actor.subscribe((state) => {
            debugLog({ state }, "state in startup flow");
            if (state.value === StartupFlowStates.ALREADY_WORKING) {
                this.webviewPanel?.dispose();
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
                const projectPath = message.projectPath;
                debugLog("Opening project", projectPath);

                // Inform webview that opening is starting
                try {
                    this.safeSendMessage({
                        command: "project.openingInProgress",
                        projectPath,
                        opening: true,
                    } as any);
                } catch (e) {
                    // non-fatal
                }

                try {
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
                        const { getMediaFilesStrategy, getFlags, setLastModeRun, setChangesApplied, getApplyState, setApplyState } = await import("../../utils/localProjectSettings");
                        const strategy = await getMediaFilesStrategy(projectUri);

                        // If there are pending changes (either explicitly marked or
                        // inferred from a mismatch between last run and current), apply now
                        const flags = await getFlags(projectUri);
                        const applyState = await getApplyState(projectUri);
                        if (strategy && (applyState === "pending" || applyState === "applying" || applyState === "failed" || (flags?.lastModeRun && flags.lastModeRun !== strategy))) {
                            const { applyMediaStrategy } = await import("../../utils/mediaStrategyManager");
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
                                // Mark applying while we resume
                                try { await setApplyState("applying", projectUri); } catch (pendingErr) { debugLog("Failed to set applyState=applying before resume", pendingErr); }
                                // Force the apply when lastModeRun differs to ensure on-disk state matches selection
                                await applyMediaStrategy(projectUri, strategy, true);
                                await setLastModeRun(strategy, projectUri);
                                await setApplyState("applied", projectUri);
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
    private async fetchAndSendProgressData() {
        try {
            // Check if frontier authentication is available
            if (!this.frontierApi) {
                this.frontierApi = getAuthApi();
                if (!this.frontierApi) {
                    console.log("Frontier API not available for progress data");
                    return;
                }
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

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Setup metadata watcher
        this.setupMetadataWatcher(webviewPanel);

        // Dispose of previous webview panel if it exists
        this.webviewPanel?.dispose();
        this.webviewPanel = webviewPanel;

        // Notify that startup flow is now open
        StartupFlowGlobalState.instance.setOpen(true);

        // Add the webview panel to disposables
        this.disposables.push(
            webviewPanel.onDidDispose(() => {
                debugLog("Webview panel disposed");
                this.webviewPanel = undefined;
                // Notify that startup flow is now closed
                StartupFlowGlobalState.instance.setOpen(false);
            })
        );

        // Set up webview options first
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "dist"),
                vscode.Uri.joinPath(this.context.extensionUri, "src", "assets"),
                vscode.Uri.joinPath(
                    this.context.extensionUri,
                    "node_modules",
                    "@vscode",
                    "codicons",
                    "dist"
                ),
                vscode.Uri.joinPath(
                    this.context.extensionUri,
                    "webviews",
                    "codex-webviews",
                    "dist"
                ),
            ],
        };

        // Then generate the HTML with the updated webview
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Send initial state immediately after webview is ready
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            try {
                await this.handleMessage(message);
            } catch (error) {
                console.error("Error handling message:", error);
                safePostMessageToPanel(webviewPanel, {
                    command: "error",
                    message: `Failed to handle action: ${(error as Error).message}`,
                });
            }
        });

        // Signal webview is ready faster by deferring expensive operations
        safePostMessageToPanel(webviewPanel, { command: "webview.ready" });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        return getWebviewHtml(webview, this.context, {
            title: "Startup Flow",
            scriptPath: ["StartupFlow", "index.js"],
            csp: `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-\${nonce}' 'strict-dynamic' https://www.youtube.com; frame-src https://www.youtube.com; worker-src ${webview.cspSource} blob:; connect-src https://languagetool.org/api/; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource}; media-src ${webview.cspSource} https: blob:;`
        });
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
     * Recursively add files to a JSZip instance
     * @param currentUri - The directory to add files from
     * @param zipFolder - The JSZip folder to add files to
     * @param options - Options for filtering files
     */
    private async addFilesToZip(
        currentUri: vscode.Uri,
        zipFolder: JSZip,
        options: { excludeGit?: boolean; } = { excludeGit: true }
    ): Promise<void> {
        const entries = await vscode.workspace.fs.readDirectory(currentUri);

        for (const [name, type] of entries) {
            // Skip .git folder based on options
            if (name === ".git" && options.excludeGit) {
                continue;
            }

            const entryUri = vscode.Uri.joinPath(currentUri, name);

            if (type === vscode.FileType.File) {
                const fileData = await vscode.workspace.fs.readFile(entryUri);
                zipFolder.file(name, fileData);
            } else if (type === vscode.FileType.Directory) {
                const newFolder = zipFolder.folder(name);
                if (newFolder) {
                    await this.addFilesToZip(entryUri, newFolder, options);
                }
            }
        }
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

        // Create JSZip instance
        const zip = new JSZip();

        // Add project files to zip
        const projectUri = vscode.Uri.file(projectPath);
        await this.addFilesToZip(projectUri, zip, { excludeGit: !includeGit });

        // Generate and save zip with compression
        const zipContent = await zip.generateAsync({
            type: "nodebuffer",
            compression: "DEFLATE",
            compressionOptions: {
                level: 9 // Maximum compression (1-9)
            }
        });
        await vscode.workspace.fs.writeFile(backupUri, zipContent);

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
                await createNewWorkspaceAndProject();
                break;
            }
            case "project.createEmptyWithName": {
                try {
                    const inputName = (message as any).projectName as string;
                    const sanitized = sanitizeProjectName(inputName);
                    if (sanitized !== inputName) {
                        this.safeSendMessage({
                            command: "project.nameWillBeSanitized",
                            original: inputName,
                            sanitized,
                        } as MessagesFromStartupFlowProvider);
                        // Optionally wait for confirm message from webview
                    } else {
                        await createWorkspaceWithProjectName(sanitized);
                    }
                } catch (error) {
                    console.error("Error creating project with name:", error);
                }
                break;
            }
            case "project.createEmpty.confirm": {
                const { proceed, projectName } = message as any;
                if (proceed && projectName) {
                    await createWorkspaceWithProjectName(projectName);
                }
                break;
            }
            case "project.initialize": {
                debugLog("Initializing project");
                await createNewProject();

                // Wait for metadata.json to be created
                const workspaceFolders = vscode.workspace.workspaceFolders;
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
                // Use cached preflight state instead of creating new PreflightCheck
                const preflightState = await this.getCachedPreflightState();
                debugLog("Sending cached preflight state:", preflightState);
                this.stateMachine.send({
                    type: StartupFlowEvents.UPDATE_AUTH_STATE,
                    data: preflightState.authState,
                });

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
                debugLog("Handling authentication message", message.command);
                await this.handleAuthenticationMessage(this.webviewPanel!, message);
                break;
            case "startup.dismiss":
                debugLog("Dismissing startup flow");
                this.webviewPanel?.dispose();
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
            case "project.clone": {
                debugLog("Cloning repository", message.repoUrl);

                // Extract project name from URL for progress tracking
                const urlParts = message.repoUrl.split("/");
                let projectName = urlParts[urlParts.length - 1];
                if (projectName.endsWith(".git")) {
                    projectName = projectName.slice(0, -4);
                }

                try {
                    // Get the .codex-projects directory
                    const codexProjectsDir = await getCodexProjectsDirectory();

                    // Create a unique folder name if needed
                    let projectDir = vscode.Uri.joinPath(codexProjectsDir, projectName);

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
                            gitOriginUrl: message.repoUrl,
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
                            if (message.mediaStrategy) {
                                const { ensureLocalProjectSettingsExists } = await import("../../utils/localProjectSettings");
                                await ensureLocalProjectSettingsExists(projectDir, {
                                    currentMediaFilesStrategy: message.mediaStrategy,
                                    lastMediaFileStrategyRun: message.mediaStrategy,
                                    mediaFileStrategyApplyState: "applied",
                                    autoDownloadAudioOnOpen: false,
                                });
                                debugLog(`Wrote localProjectSettings.json with strategy: ${message.mediaStrategy} BEFORE cloning`);
                            }
                        } catch (settingsErr) {
                            debugLog("Failed to write localProjectSettings.json before clone:", settingsErr);
                            // Non-fatal: continue with clone
                        }

                        // Clone to the .codex-projects directory and await completion
                        await this.frontierApi?.cloneRepository(
                            message.repoUrl,
                            projectDir.fsPath,
                            undefined,
                            message.mediaStrategy
                        );

                    } finally {
                        // Inform webview that cloning is complete
                        try {
                            this.safeSendMessage({
                                command: "project.cloningInProgress",
                                projectPath: projectDir.fsPath,
                                gitOriginUrl: message.repoUrl,
                                cloning: false,
                            } as any);
                        } catch (e) {
                            // non-fatal
                        }
                    }
                } catch (error) {
                    console.error("Error preparing to clone repository:", error);
                    this.frontierApi?.cloneRepository(
                        message.repoUrl,
                        undefined,
                        undefined,
                        message.mediaStrategy
                    );
                }

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
                        // Show progress indicator
                        await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: "Zipping project...",
                                cancellable: false,
                            },
                            async (progress) => {
                                progress.report({ increment: 0 });

                                // Create JSZip instance
                                const zip = new JSZip();

                                // Use shared method to add files to zip
                                const projectUri = vscode.Uri.file(projectPath);
                                await this.addFilesToZip(projectUri, zip, { excludeGit: !includeGit });

                                progress.report({ increment: 50 });

                                // Generate zip content with compression and write directly to target location
                                const zipContent = await zip.generateAsync({
                                    type: "nodebuffer",
                                    compression: "DEFLATE",
                                    compressionOptions: {
                                        level: 9 // Maximum compression (1-9)
                                    }
                                });
                                await vscode.workspace.fs.writeFile(saveUri, zipContent);

                                progress.report({ increment: 100 });
                            }
                        );

                        const gitMessage = includeGit ? " (including git history)" : "";
                        vscode.window.showInformationMessage(
                            `Project "${projectName}" has been zipped successfully${gitMessage}!`
                        );
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
                    const flags = await getFlags(projectUri);
                    if (flags?.lastModeRun === mediaStrategy) {
                        debugLog(`Switching back to last applied strategy "${mediaStrategy}" - auto-applying without dialog`);

                        // Just update the stored strategy without touching files
                        await setMediaFilesStrategy(mediaStrategy, projectUri);
                        await setLastModeRun(mediaStrategy, projectUri);
                        await setChangesApplied(true, projectUri);

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
                    try {
                        const { getFlags, setLastModeRun, setChangesApplied, setMediaFilesStrategy, setApplyState } = await import("../../utils/localProjectSettings");
                        const flags = await getFlags(projectUri);
                        if (flags?.lastModeRun === mediaStrategy) {
                            // Return to last-run mode: do not touch files. Just ensure
                            // the selected strategy is stored and flags are consistent.
                            await setMediaFilesStrategy(mediaStrategy, projectUri);
                            await setLastModeRun(mediaStrategy, projectUri);
                            await setApplyState("applied", projectUri);
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
            case "project.heal": {
                const { projectName, projectPath, gitOriginUrl } = message;

                if (!gitOriginUrl) {
                    vscode.window.showErrorMessage(
                        "Cannot heal project: No remote repository URL found. This project may not be connected to a remote repository."
                    );
                    return;
                }

                // Show notification first so user knows the process is starting
                vscode.window.showInformationMessage("Heal process starting - check for confirmation dialog");

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

                // Inform webview that healing is starting for this project
                try {
                    this.safeSendMessage({
                        command: "project.healingInProgress",
                        projectPath,
                        healing: true,
                    } as any);
                } catch (e) {
                    // non-fatal
                }

                // Execute the healing process
                try {
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `Healing project "${projectName}"...`,
                            cancellable: false,
                        },
                        async (progress) => {
                            await this.performProjectHeal(progress, projectName, projectPath, gitOriginUrl);
                        }
                    );

                    // Inform webview that healing is complete
                    try {
                        this.safeSendMessage({
                            command: "project.healingInProgress",
                            projectPath,
                            healing: false,
                        } as any);
                    } catch (e) {
                        // non-fatal
                    }
                } catch (error) {
                    console.error("Project healing failed:", error);
                    vscode.window.showErrorMessage(
                        `Failed to heal project: ${error instanceof Error ? error.message : String(error)}`
                    );

                    // Inform webview that healing failed/stopped
                    try {
                        this.safeSendMessage({
                            command: "project.healingInProgress",
                            projectPath,
                            healing: false,
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
     * Perform project healing operation
     */
    private async performProjectHeal(
        progress: vscode.Progress<{ message?: string; increment?: number; }>,
        projectName: string,
        projectPath: string,
        gitOriginUrl: string
    ): Promise<void> {
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

        // Step 1: Create backup
        progress.report({ increment: 10, message: "Creating backup..." });
        const backupUri = await this.createProjectBackup(projectPath, projectName, false);
        const backupFileName = path.basename(backupUri.fsPath);
        debugLog(`Backup created at: ${backupUri.fsPath}`);

        // Step 2: Copy files to temporary folder
        progress.report({ increment: 20, message: "Saving local changes..." });
        const timestamp = this.generateTimestamp();
        const codexProjectsDir = await getCodexProjectsDirectory();
        const tempFolderName = `${projectName}_temp_${timestamp}`;
        const tempFolderUri = vscode.Uri.joinPath(codexProjectsDir, tempFolderName);

        // Create temp directory and copy files
        await vscode.workspace.fs.createDirectory(tempFolderUri);
        const projectUri = vscode.Uri.file(projectPath);
        await this.copyDirectory(projectUri, tempFolderUri, { excludeGit: true });
        debugLog(`Temporary files saved to: ${tempFolderUri.fsPath}`);

        // Determine media strategy before deletion so re-clone respects user's choice
        let healMediaStrategy: "auto-download" | "stream-and-save" | "stream-only" | undefined;
        try {
            const { getMediaFilesStrategy } = await import("../../utils/localProjectSettings");
            healMediaStrategy = await getMediaFilesStrategy(projectUri);
            debugLog(`Heal using media strategy: ${healMediaStrategy || "(default)"}`);
        } catch (e) {
            debugLog("Could not read media strategy before heal; default will be used", e);
        }

        // Step 3: Delete the unhealthy project
        progress.report({ increment: 10, message: "Removing corrupted project..." });
        await vscode.workspace.fs.delete(projectUri, { recursive: true, useTrash: false });
        debugLog(`Deleted project at: ${projectPath}`);

        // Step 4: Re-clone the project
        progress.report({ increment: 20, message: "Re-cloning from remote..." });
        const cloneSuccess = await this.frontierApi?.cloneRepository(
            gitOriginUrl,
            projectPath,
            false,
            healMediaStrategy
        );
        if (!cloneSuccess) {
            throw new Error("Failed to clone repository");
        }

        // Wait for clone to complete
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Step 5: Merge temporary files back
        progress.report({ increment: 20, message: "Merging local changes..." });
        const clonedProjectUri = vscode.Uri.file(projectPath);

        // Verify the cloned project exists
        await vscode.workspace.fs.stat(clonedProjectUri);
        debugLog("Cloned project directory exists");

        // Import types for conflict resolution
        type ConflictFile = import("../../projectManager/utils/merge/types").ConflictFile;

        // Enhanced ConflictFile type to handle binary files
        interface EnhancedConflictFile extends Omit<ConflictFile, 'ours' | 'theirs' | 'base'> {
            ours: string | Uint8Array;
            theirs: string | Uint8Array;
            base: string | Uint8Array;
            isBinary?: boolean;
        }

        // Collect conflicts from temp folder
        const conflicts: EnhancedConflictFile[] = [];
        await this.collectConflictsRecursively(tempFolderUri, clonedProjectUri, conflicts);

        debugLog("Conflicts collected:", {
            totalConflicts: conflicts.length,
            conflicts: conflicts.map(c => ({ filepath: c.filepath, isNew: c.isNew }))
        });

        // Resolve conflicts if any exist
        if (conflicts.length > 0) {
            debugLog(`Merging ${conflicts.length} files...`);
            await this.resolveProjectConflicts(clonedProjectUri, conflicts);
            debugLog("All conflicts resolved");
        }

        // Step 6: Clean up temporary files
        progress.report({ increment: 10, message: "Cleaning up..." });
        await vscode.workspace.fs.delete(tempFolderUri, { recursive: true, useTrash: false });
        debugLog(`Cleaned up temp folder: ${tempFolderUri.fsPath}`);

        // Step 7: Commit the merged changes
        progress.report({ increment: 10, message: "Finalizing healed project..." });
        await this.commitHealedChanges(projectPath);

        // Success notification and cleanup
        vscode.window.showInformationMessage(
            `Project "${projectName}" has been healed successfully! Backup saved to: ${backupFileName}`
        );

        this.safeSendMessage({
            command: "forceRefreshProjectsList",
        });
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
                message: "Healed project: merged local changes after re-clone",
                author
            });

            debugLog("Committed healed project changes");
        } catch (error) {
            console.warn("Error committing healed changes (non-critical):", error);
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

            // Process local projects and check for matches
            for (const project of localProjects) {
                if (!project.gitOriginUrl) {
                    projectList.push({
                        ...project,
                        syncStatus: "localOnlyNotSynced",
                    });
                    continue;
                }

                const matchInRemoteIndex = projectList.findIndex(
                    (p) => p.gitOriginUrl === project.gitOriginUrl
                );

                if (matchInRemoteIndex !== -1) {
                    projectList[matchInRemoteIndex] = {
                        ...project,
                        syncStatus: "downloadedAndSynced",
                    };
                } else {
                    projectList.push({
                        ...project,
                        syncStatus: "localOnlyNotSynced",
                    });
                }
            }

            safePostMessageToPanel(
                webviewPanel,
                {
                    command: "projectsListFromGitLab",
                    projects: projectList,
                } as MessagesFromStartupFlowProvider,
                "StartupFlow"
            );

            const mergeTime = Date.now() - startTime;
            debugLog(`Complete project list sent in ${mergeTime}ms - Total: ${projectList.length} projects`);

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
            const progressData = await vscode.commands.executeCommand(
                "frontier.getAggregatedProgress"
            );
            return progressData;
        } catch (error) {
            console.warn("Error fetching progress data:", error);
            return undefined;
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

            // Clean up project names - remove unique IDs
            remoteProjects.forEach((project) => {
                if (project.name[project.name.length - 23] === "-") {
                    project.name = project.name.slice(0, -23);
                }
            });

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

