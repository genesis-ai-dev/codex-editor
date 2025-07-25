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
} from "../../utils/projectCreationUtils/projectCreationUtils";
import { getAuthApi } from "../../extension";
import { createMachine, assign, createActor } from "xstate";
import { getCodexProjectsDirectory } from "../../utils/projectLocationUtils";
import JSZip from "jszip";
import { getWebviewHtml } from "../../utils/webviewTemplate";

import { safePostMessageToPanel, safeIsVisible, safeSetHtml, safeSetOptions } from "../../utils/webviewUtils";
import * as path from "path";
import * as fs from "fs";

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
                            error: error instanceof Error ? error.message : "Login failed",
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
                            error: error instanceof Error ? error.message : "Registration failed",
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

                try {
                    // Open the project directly
                    const projectUri = vscode.Uri.file(projectPath);
                    await vscode.commands.executeCommand("vscode.openFolder", projectUri);

                } catch (error) {
                    console.error("Error opening project:", error);
                    vscode.window.showErrorMessage(
                        `Failed to open project: ${error instanceof Error ? error.message : String(error)}`
                    );
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
            csp: `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-\${nonce}' https://www.youtube.com; frame-src https://www.youtube.com; worker-src ${webview.cspSource}; connect-src https://languagetool.org/api/; img-src ${webview.cspSource} https:; font-src ${webview.cspSource}; media-src ${webview.cspSource} https: blob:;`
        });
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

                try {
                    // Get the .codex-projects directory
                    const codexProjectsDir = await getCodexProjectsDirectory();

                    // Extract project name from URL to use as folder name
                    const urlParts = message.repoUrl.split("/");
                    let projectName = urlParts[urlParts.length - 1];

                    // Remove .git extension if present
                    if (projectName.endsWith(".git")) {
                        projectName = projectName.slice(0, -4);
                    }

                    // Create a unique folder name if needed
                    let projectDir = vscode.Uri.joinPath(codexProjectsDir, projectName);

                    // Check if directory already exists
                    try {
                        await vscode.workspace.fs.stat(projectDir);
                        // If we get here, the directory exists
                        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                        const newProjectName = `${projectName}-${timestamp}`;
                        projectDir = vscode.Uri.joinPath(codexProjectsDir, newProjectName);
                    } catch {
                        // Directory doesn't exist, which is what we want
                    }

                    // Clone to the .codex-projects directory
                    this.frontierApi?.cloneRepository(message.repoUrl, projectDir.fsPath);
                } catch (error) {
                    console.error("Error preparing to clone repository:", error);
                    this.frontierApi?.cloneRepository(message.repoUrl);
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
                        actionButtonText,
                        "Cancel"
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

                            // Recursive function to add files and folders to zip
                            async function addToZip(currentUri: vscode.Uri, zipFolder: JSZip) {
                                const entries = await vscode.workspace.fs.readDirectory(currentUri);

                                for (const [name, type] of entries) {
                                    // Skip .git folder unless includeGit is true
                                    if (name === ".git" && !includeGit) {
                                        continue;
                                    }

                                    const entryUri = vscode.Uri.joinPath(currentUri, name);

                                    if (type === vscode.FileType.File) {
                                        const fileData =
                                            await vscode.workspace.fs.readFile(entryUri);
                                        zipFolder.file(name, fileData);
                                    } else if (type === vscode.FileType.Directory) {
                                        const newFolder = zipFolder.folder(name);
                                        if (newFolder) {
                                            await addToZip(entryUri, newFolder);
                                        }
                                    }
                                }
                            }

                            // Start adding files from the project root
                            const projectUri = vscode.Uri.file(message.projectPath);
                            await addToZip(projectUri, zip);

                            progress.report({ increment: 50 });

                            // Generate zip content and write directly to target location
                            const zipContent = await zip.generateAsync({ type: "nodebuffer" });
                            await vscode.workspace.fs.writeFile(saveUri, zipContent);

                            progress.report({ increment: 100 });
                        }
                    );

                    const gitMessage = includeGit ? " (including git history)" : "";
                    vscode.window.showInformationMessage(
                        `Project "${message.projectName}" has been zipped successfully${gitMessage}!`
                    );
                } catch (error) {
                    debugLog("Error zipping project:", error);
                    vscode.window.showErrorMessage(
                        `Failed to zip project: ${error instanceof Error ? error.message : String(error)}`
                    );
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
}

