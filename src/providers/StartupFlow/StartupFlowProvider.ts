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
    private preflightState: PreflightState = {
        authState: {
            isAuthExtensionInstalled: false,
            isAuthenticated: false,
            isLoading: true,
        },
        workspaceState: {
            isOpen: false,
            hasMetadata: false,
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
        this.initializeFrontierApi();
        this.initializePreflightState();

        // Add disposal of webview panel when extension is deactivated
        this.context.subscriptions.push(
            vscode.Disposable.from({
                dispose: () => {
                    this.webviewPanel?.dispose();
                },
            })
        );
    }

    private async initializePreflightState() {
        const preflightCheck = new PreflightCheck();
        this.preflightState = await preflightCheck.preflight(this.context);
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
                        isProjectInitialized: this.preflightState.workspaceState.hasMetadata,
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
                            isProjectInitialized: this.preflightState.workspaceState.hasMetadata,
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
                        isProjectInitialized: this.preflightState.workspaceState.hasMetadata,
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
                    isProjectInitialized: this.preflightState.workspaceState.hasMetadata,
                },
            });
        }
    }

    private async updateAuthState(authState: AuthState) {
        if (this.webviewPanel) {
            await this.webviewPanel.webview.postMessage({
                command: "updateAuthState",
                success: true,
                authState: {
                    isAuthExtensionInstalled: authState.isAuthExtensionInstalled,
                    isAuthenticated: authState.isAuthenticated,
                    isLoading: false,
                    error: authState.error,
                    gitlabInfo: authState.gitlabInfo,
                    workspaceState: {
                        isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                        isProjectInitialized: this.preflightState.workspaceState.hasMetadata,
                    },
                },
            });
        }
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
            webviewPanel.webview.postMessage({
                command: "updateAuthState",
                authState: {
                    isAuthExtensionInstalled: false,
                    isAuthenticated: false,
                    isLoading: false,
                    workspaceState: {
                        isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                        isProjectInitialized: this.preflightState.workspaceState.hasMetadata,
                    },
                },
            } as MessagesFromStartupFlowProvider);
            return;
        }

        switch (message.command) {
            case "auth.status": {
                debugLog("Getting auth status");
                if (!this.frontierApi) {
                    debugLog("Auth extension not installed");
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: false,
                            isAuthenticated: false,
                            isLoading: false,
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.hasMetadata,
                            },
                        },
                    } as MessagesFromStartupFlowProvider);
                    return;
                }
                try {
                    const status = this.frontierApi.getAuthStatus();
                    debugLog("Got auth status", status);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: status.isAuthenticated,
                            isLoading: false,
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.hasMetadata,
                            },
                        },
                    } as MessagesFromStartupFlowProvider);
                } catch (error) {
                    debugLog("Error getting auth status", error);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
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
                                    this.preflightState.workspaceState.hasMetadata,
                            },
                        },
                    } as MessagesFromStartupFlowProvider);
                }
                break;
            }
            case "auth.login": {
                debugLog("Attempting login");
                if (!this.frontierApi) {
                    debugLog("Auth extension not installed");
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: false,
                            isAuthenticated: false,
                            isLoading: false,
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.hasMetadata,
                            },
                        },
                    } as MessagesFromStartupFlowProvider);
                    return;
                }
                try {
                    const success = await this.frontierApi.login(
                        message.username,
                        message.password
                    );
                    debugLog("Login attempt result:", success);
                    if (success) {
                        const status = this.frontierApi.getAuthStatus();
                        webviewPanel.webview.postMessage({
                            command: "updateAuthState",
                            authState: {
                                isAuthExtensionInstalled: true,
                                isAuthenticated: true,
                                isLoading: false,
                                workspaceState: {
                                    isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                    isProjectInitialized:
                                        this.preflightState.workspaceState.hasMetadata,
                                },
                            },
                        } as MessagesFromStartupFlowProvider);
                    } else {
                        throw new Error("Login failed");
                    }
                    await this.handleWorkspaceStatus(webviewPanel);
                } catch (error) {
                    debugLog("Login failed", error);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            error: error instanceof Error ? error.message : "Login failed",
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.hasMetadata,
                            },
                        },
                    } as MessagesFromStartupFlowProvider);
                }
                break;
            }
            case "auth.signup": {
                debugLog("Attempting registration");
                if (!this.frontierApi) {
                    debugLog("Auth extension not installed");
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: false,
                            isAuthenticated: false,
                            isLoading: false,
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.hasMetadata,
                            },
                        },
                    } as MessagesFromStartupFlowProvider);
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
                        webviewPanel.webview.postMessage({
                            command: "updateAuthState",
                            authState: {
                                isAuthExtensionInstalled: true,
                                isAuthenticated: true,
                                isLoading: false,
                                workspaceState: {
                                    isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                    isProjectInitialized:
                                        this.preflightState.workspaceState.hasMetadata,
                                },
                            },
                        } as MessagesFromStartupFlowProvider);
                        await this.handleWorkspaceStatus(webviewPanel);
                    } else {
                        throw new Error("Registration failed");
                    }
                } catch (error) {
                    debugLog("Registration failed", error);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            error: error instanceof Error ? error.message : "Registration failed",
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.hasMetadata,
                            },
                        },
                    } as MessagesFromStartupFlowProvider);
                }
                break;
            }
            case "auth.logout": {
                debugLog("Attempting logout");
                try {
                    await this.frontierApi.logout();
                    debugLog("Logout successful");
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.hasMetadata,
                            },
                        },
                    } as MessagesFromStartupFlowProvider);
                    await this.handleWorkspaceStatus(webviewPanel);
                } catch (error) {
                    debugLog("Logout failed", error);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: true,
                            isLoading: false,
                            error: error instanceof Error ? error.message : "Logout failed",
                            workspaceState: {
                                isWorkspaceOpen: this.preflightState.workspaceState.isOpen,
                                isProjectInitialized:
                                    this.preflightState.workspaceState.hasMetadata,
                            },
                        },
                    } as MessagesFromStartupFlowProvider);
                }
                break;
            }
        }
    }

    private async handleWorkspaceStatus(webviewPanel: vscode.WebviewPanel) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const isOpen = !!workspaceFolders?.length;
        webviewPanel.webview.postMessage({
            command: "workspace.statusResponse",
            isOpen,
            path: workspaceFolders?.[0]?.uri.fsPath,
        } as MessagesFromStartupFlowProvider);

        // If workspace is open, also check for metadata
        if (isOpen) {
            try {
                const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");
                await vscode.workspace.fs.stat(metadataUri);

                // First check auth status
                const authState = this.frontierApi?.getAuthStatus();
                if (!authState?.isAuthenticated) {
                    // If not authenticated, don't send metadata response yet
                    return;
                }

                // Only send metadata exists if authenticated
                webviewPanel.webview.postMessage({
                    command: "metadata.checkResponse",
                    exists: true,
                } as MessagesFromStartupFlowProvider);
            } catch {
                webviewPanel.webview.postMessage({
                    command: "metadata.checkResponse",
                    exists: false,
                } as MessagesFromStartupFlowProvider);
            }
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
                    console.log("No workspace folder found");
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
                    break;
                }
                case "webview.ready": {
                    const preflightState = await preflightCheck.preflight(this.context);
                    debugLog("Sending initial preflight state:", preflightState);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: preflightState.authState,
                    } as MessagesFromStartupFlowProvider);
                    webviewPanel.webview.postMessage({
                        command: "workspace.statusResponse",
                        isOpen: preflightState.workspaceState.isOpen,
                    } as MessagesFromStartupFlowProvider);
                    if (
                        preflightState.workspaceState.isOpen &&
                        preflightState.workspaceState.hasMetadata
                    ) {
                        if (!preflightState.authState.isAuthExtensionInstalled) {
                            webviewPanel.webview.postMessage({
                                command: "setupComplete",
                            } as MessagesFromStartupFlowProvider);
                        } else if (preflightState.authState.isAuthenticated) {
                            webviewPanel.webview.postMessage({
                                command: "setupComplete",
                            } as MessagesFromStartupFlowProvider);
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
                    webviewPanel.webview.postMessage({
                        command: "extension.checkResponse",
                        isInstalled: !!this.frontierApi,
                    } as MessagesFromStartupFlowProvider);

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
                        webviewPanel.webview.postMessage({
                            command: "projectsSyncStatus",
                            status,
                        } as MessagesFromStartupFlowProvider);
                    } catch (error) {
                        console.error("Failed to get projects sync status:", error);
                        webviewPanel.webview.postMessage({
                            command: "projectsSyncStatus",
                            status: {},
                            error:
                                error instanceof Error
                                    ? error.message
                                    : "Failed to get projects sync status",
                        } as MessagesFromStartupFlowProvider);
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
