import { waitForExtensionActivation } from "../../utils/vscode";
import {
    MessagesToStartupFlowProvider,
    MessagesFromStartupFlowProvider,
    GitLabProject,
    ProjectWithSyncStatus,
} from "../../../types";
import * as vscode from "vscode";
import { PreflightCheck, PreflightState } from "./preflight";
import { findAllCodexProjects } from "../../../src/projectManager/utils/projectUtils";
import { AuthState, FrontierAPI } from "webviews/codex-webviews/src/StartupFLow/types";
import { CustomWebviewProvider } from "../../projectManager/projectManagerViewProvider";
import {
    createNewProject,
    createNewWorkspaceAndProject,
} from "../../utils/projectCreationUtils/projectCreationUtils";
import { getAuthApi } from "../../extension";
import { createMachine, assign, createActor } from "xstate";

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

function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

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

    constructor(private readonly context: vscode.ExtensionContext) {
        // Initialize state machine first
        this.initializeStateMachine();

        // Then initialize preflight state
        this.initializePreflightState();

        // Finally initialize Frontier API
        this.initializeFrontierApi();

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
                                    !context.authState?.workspaceState?.isWorkspaceOpen ?? false,
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
                                        gitlabInfo:
                                            "data" in event ? event.data.gitlabInfo : undefined,
                                        workspaceState: {
                                            isWorkspaceOpen:
                                                "data" in event
                                                    ? !!event.data.workspaceState?.isWorkspaceOpen
                                                    : false,
                                            isProjectInitialized:
                                                "data" in event
                                                    ? !!event.data.workspaceState
                                                          ?.isProjectInitialized
                                                    : false,
                                        },
                                    }),
                                }),
                            },
                            {
                                target: StartupFlowStates.ALREADY_WORKING,
                                guard: ({ context }) =>
                                    (context.authState?.workspaceState?.isWorkspaceOpen ?? false) &&
                                    (context.authState?.workspaceState?.isProjectInitialized ??
                                        false),
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
                                        gitlabInfo:
                                            "data" in event ? event.data.gitlabInfo : undefined,
                                        workspaceState: {
                                            isWorkspaceOpen:
                                                "data" in event
                                                    ? !!event.data.workspaceState?.isWorkspaceOpen
                                                    : false,
                                            isProjectInitialized:
                                                "data" in event
                                                    ? !!event.data.workspaceState
                                                          ?.isProjectInitialized
                                                    : false,
                                        },
                                    }),
                                }),
                            },
                            {
                                target: StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT,
                                guard: ({ context }) =>
                                    (context.authState?.workspaceState?.isWorkspaceOpen ?? false) &&
                                    !(
                                        context.authState?.workspaceState?.isProjectInitialized ??
                                        false
                                    ),
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
                                        gitlabInfo:
                                            "data" in event ? event.data.gitlabInfo : undefined,
                                        workspaceState: {
                                            isWorkspaceOpen:
                                                "data" in event
                                                    ? !!event.data.workspaceState?.isWorkspaceOpen
                                                    : false,
                                            isProjectInitialized:
                                                "data" in event
                                                    ? !!event.data.workspaceState
                                                          ?.isProjectInitialized
                                                    : false,
                                        },
                                    }),
                                }),
                            },
                        ],
                        [StartupFlowEvents.NO_AUTH_EXTENSION]: [
                            {
                                target: StartupFlowStates.OPEN_OR_CREATE_PROJECT,
                                guard: ({ context }) =>
                                    !context.authState.workspaceState.isWorkspaceOpen,
                                actions: assign({
                                    authState: ({ event }) =>
                                        "data" in event ? event.data : undefined!,
                                }),
                            },
                            {
                                target: StartupFlowStates.ALREADY_WORKING,
                                guard: ({ context }) =>
                                    context.authState.workspaceState.isWorkspaceOpen &&
                                    context.authState.workspaceState.isProjectInitialized,
                                actions: assign({
                                    authState: ({ event }) =>
                                        "data" in event ? event.data : undefined!,
                                }),
                            },
                            {
                                target: StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT,
                                guard: ({ context }) =>
                                    context.authState.workspaceState.isWorkspaceOpen &&
                                    !context.authState.workspaceState.isProjectInitialized,
                                actions: assign({
                                    authState: ({ event }) =>
                                        "data" in event ? event.data : undefined!,
                                }),
                            },
                        ],
                        [StartupFlowEvents.SKIP_AUTH]: {
                            target: StartupFlowStates.OPEN_OR_CREATE_PROJECT,
                        },
                        [StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA]: {
                            target: StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA,
                        },
                        [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]: {
                            target: StartupFlowStates.ALREADY_WORKING,
                        },
                    },
                },
                [StartupFlowStates.OPEN_OR_CREATE_PROJECT]: {
                    on: {
                        [StartupFlowEvents.BACK_TO_LOGIN]: StartupFlowStates.LOGIN_REGISTER,
                        [StartupFlowEvents.PROJECT_CREATE_EMPTY]:
                            StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT,
                        [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]:
                            StartupFlowStates.ALREADY_WORKING,
                        [StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT]:
                            StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT,
                        [StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA]: {
                            target: StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA,
                        },
                    },
                },
                [StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT]: {
                    on: {
                        [StartupFlowEvents.INITIALIZE_PROJECT]:
                            StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA,
                        [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]:
                            StartupFlowStates.ALREADY_WORKING,
                    },
                },
                [StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA]: {
                    on: {
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
                this.webviewPanel.webview.postMessage({
                    command: "state.update",
                    state: {
                        value: state.value,
                        context: state.context,
                    },
                });
            }
        });
    }

    private async initializePreflightState() {
        const preflightCheck = new PreflightCheck();
        this.preflightState = await preflightCheck.preflight();
    }

    private async sendList(webviewPanel: vscode.WebviewPanel) {
        try {
            const projectList: ProjectWithSyncStatus[] = [];

            let remoteProjects: GitLabProject[] = [];
            if (this.frontierApi) {
                remoteProjects = await this.frontierApi.listProjects(false);
            }
            const localProject = await findAllCodexProjects();

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

            for (const project of localProject) {
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
                // console.log({ matchInRemoteIndex, project });
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

            // console.log({ localProject, projects: remoteProjects });

            webviewPanel.webview.postMessage({
                command: "projectsListFromGitLab",
                projects: projectList,
            } as MessagesFromStartupFlowProvider);
        } catch (error) {
            console.error("Failed to fetch GitLab projects:", error);
            webviewPanel.webview.postMessage({
                command: "projectsListFromGitLab",
                projects: [],
                error: error instanceof Error ? error.message : "Failed to fetch GitLab projects",
            } as MessagesFromStartupFlowProvider);
        }
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
                if (this.webviewPanel) {
                    await this.sendList(this.webviewPanel);
                }
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
            authState: JSON.stringify(authState),
            stateMachine: JSON.stringify(this.stateMachine),
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

    dispose() {
        debugLog("Disposing StartupFlowProvider");
        this.webviewPanel?.dispose();
        this.webviewPanel = undefined;
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
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

            const hasCriticalData = hasProjectName && !!sourceLanguage && !!targetLanguage;

            if (hasCriticalData) {
                this.stateMachine.send({ type: StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN });
            } else {
                this.stateMachine.send({ type: StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA });
            }
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
                debugLog("Opening local project", message.projectPath);
                if (message.projectPath) {
                    const projectUri = vscode.Uri.file(message.projectPath);
                    await vscode.commands.executeCommand("vscode.openFolder", projectUri);
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
        return { uri, dispose: () => {} };
    }

    private async handleProjectChange(command: string) {
        try {
            await vscode.commands.executeCommand(`codex-project-manager.${command}`);
            // await this.refreshState();
        } catch (error) {
            console.error(`Error handling ${command}:`, error);
            throw error;
        }
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Dispose of previous webview panel if it exists
        this.webviewPanel?.dispose();
        this.webviewPanel = webviewPanel;

        // Add the webview panel to disposables
        this.disposables.push(
            webviewPanel.onDidDispose(() => {
                debugLog("Webview panel disposed");
                this.webviewPanel = undefined;
            })
        );

        const preflightCheck = new PreflightCheck();

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
                    await this.handleProjectChange(message.command);
                    // FIXME: sometimes this refreshes before the command is finished. Need to return values on all of them
                    // Send a response back to the webview
                    this.webviewPanel?.webview.postMessage({ command: "actionCompleted" });
                    break;
                case "project.createEmpty": {
                    debugLog("Creating empty project");
                    await createNewWorkspaceAndProject();
                    // // open a local folder
                    // const result = await vscode.window.showOpenDialog({
                    //     canSelectFolders: true,
                    //     canSelectFiles: false,
                    //     canSelectMany: false,
                    //     title: "Select Project Folder",
                    // });
                    // if (result && result[0]) {

                    //     // create project locally
                    //     // create metadata.json
                    //     // publish to gitlab
                    // }
                    break;
                }
                case "project.initialize": {
                    debugLog("Initializing project");
                    await createNewProject();
                    this.stateMachine.send({ type: StartupFlowEvents.INITIALIZE_PROJECT });
                    break;
                }
                case "webview.ready": {
                    const preflightState = await preflightCheck.preflight();
                    debugLog("Sending initial preflight state:", preflightState);
                    this.stateMachine.send({
                        type: StartupFlowEvents.UPDATE_AUTH_STATE,
                        data: preflightState.authState,
                    });
                    this.stateMachine.send({
                        type: "workspace.statusResponse",
                        data: {
                            isOpen: preflightState.workspaceState.isOpen,
                        },
                    });
                    if (
                        preflightState.workspaceState.isOpen &&
                        preflightState.workspaceState.hasMetadata
                    ) {
                        if (preflightState.workspaceState.isProjectSetup) {
                            this.stateMachine.send({ type: "setupComplete" });
                        } else {
                            this.stateMachine.send({ type: "setupIncompleteCriticalDataMissing" });
                        }
                    }
                    break;
                }
                case "auth.status":
                case "auth.login":
                case "auth.signup":
                case "auth.logout":
                    debugLog("Handling authentication message", message.command);
                    await this.handleAuthenticationMessage(webviewPanel, message);
                    break;
                case "workspace.status":
                case "workspace.open":
                case "workspace.create":
                case "workspace.continue":
                case "project.open":
                    debugLog("Handling workspace message", message.command);
                    await this.handleWorkspaceMessage(webviewPanel, message);
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
                case "getProjectsListFromGitLab": {
                    debugLog("Fetching GitLab projects list");
                    this.sendList(webviewPanel);
                    break;
                }
                case "getProjectsSyncStatus": {
                    debugLog("Fetching projects sync status");
                    try {
                        // Get workspace folders to check local repositories
                        const workspaceFolders = vscode.workspace.workspaceFolders;
                        const localRepos = new Set<string>();

                        if (workspaceFolders) {
                            // Get all git repositories in the workspace
                            const gitExtension =
                                vscode.extensions.getExtension("vscode.git")?.exports;
                            const git = gitExtension?.getAPI(1);

                            if (git) {
                                const repositories = git.repositories;
                                for (const repo of repositories) {
                                    try {
                                        // Get remote URL
                                        const remoteUrl = await repo.getConfig("remote.origin.url");
                                        if (remoteUrl) {
                                            localRepos.add(remoteUrl.value);
                                        }
                                    } catch (error) {
                                        debugLog("Error getting remote URL for repo:", error);
                                    }
                                }
                            }
                        }

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

                    this.frontierApi?.cloneRepository(message.repoUrl);

                    break;
                }
            }
        });
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "reset.css")
        );
        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "vscode.css")
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "node_modules",
                "@vscode",
                "codicons",
                "dist",
                "codicon.css"
            )
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "StartupFlow",
                "index.js"
            )
        );

        const nonce = getNonce();

        return /*html*/ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
                    webview.cspSource
                } 'unsafe-inline'; script-src 'nonce-${nonce}' https://www.youtube.com; frame-src https://www.youtube.com; worker-src ${
                    webview.cspSource
                }; connect-src https://languagetool.org/api/; img-src ${
                    webview.cspSource
                } https:; font-src ${webview.cspSource}; media-src ${
                    webview.cspSource
                } https: blob:;">
                <link href="${styleResetUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${styleVSCodeUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${codiconsUri}" rel="stylesheet" nonce="${nonce}" />
                <title>Startup Flow</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
