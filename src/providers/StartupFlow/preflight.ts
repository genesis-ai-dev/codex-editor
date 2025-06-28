import * as vscode from "vscode";
import { waitForExtensionActivation } from "../../utils/vscode";
import { FrontierAPI } from "../../../webviews/codex-webviews/src/StartupFlow/types";
import git from "isomorphic-git";
import * as fs from "fs";
import { getAuthApi } from "../../extension";

interface AuthState {
    isAuthenticated: boolean;
    isAuthExtensionInstalled: boolean;
    isLoading: boolean;
    error?: string;
    gitlabInfo?: any;
}

export interface PreflightState {
    authState: AuthState;
    workspaceState: {
        isOpen: boolean;
        hasMetadata: boolean;
        isProjectSetup: boolean;
        error?: string;
    };
    projectSelection: {
        type?: string;
        path?: string;
        repoUrl?: string;
        error?: string;
    };
    gitState: {
        isGitRepo: boolean;
        hasRemote: boolean;
        error?: string;
    };
}

const DEBUG_MODE = false; // Set to true to enable debug logging

function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[PreflightCheck]", ...args);
    }
}

export class PreflightCheck {
    private frontierApi?: FrontierAPI;
    private authStateSubscription?: vscode.Disposable;

    constructor() {
        debugLog("Initializing PreflightCheck");
        this.initializeFrontierApi();
    }

    private async initializeFrontierApi() {
        debugLog("Attempting to initialize Frontier API");
        try {
            this.frontierApi = getAuthApi();
            debugLog("Successfully initialized Frontier API");
        } catch (error) {
            debugLog("Failed to initialize Frontier API:", error);
            console.error("Failed to initialize Frontier API:", error);
        }
    }

    public async checkAuthentication(): Promise<boolean> {
        debugLog("Checking authentication status");
        if (!this.frontierApi) {
            debugLog("No Frontier API instance, attempting to initialize");
            await this.initializeFrontierApi();
        }

        if (!this.frontierApi) {
            debugLog(
                "Still no Frontier API instance after initialization attempt, returning false"
            );
            return false;
        }

        try {
            const status = this.frontierApi.getAuthStatus();
            debugLog("Got auth status:", status);
            return status.isAuthenticated;
        } catch (error) {
            debugLog("Error checking authentication:", error);
            console.error("Error checking authentication:", error);
            return false;
        }
    }

    public subscribeToAuthChanges(
        callback: (status: { isAuthenticated: boolean; gitlabInfo?: any; }) => void
    ): void {
        debugLog("Setting up auth changes subscription");
        if (this.frontierApi) {
            this.authStateSubscription?.dispose();
            this.authStateSubscription = this.frontierApi.onAuthStatusChanged(callback);
            debugLog("Successfully subscribed to auth changes");
        } else {
            debugLog("Could not subscribe to auth changes - no Frontier API instance");
        }
    }

    public dispose(): void {
        debugLog("Disposing PreflightCheck");
        this.authStateSubscription?.dispose();
    }

    public async preflight(): Promise<PreflightState> {
        debugLog("Starting preflight check");
        const state: PreflightState = {
            authState: {
                isAuthenticated: false,
                isAuthExtensionInstalled: false,
                isLoading: true,
                error: undefined,
                gitlabInfo: undefined,
            },
            workspaceState: {
                isOpen: false,
                hasMetadata: false,
                isProjectSetup: false,
                error: undefined,
            },
            projectSelection: {
                type: undefined,
                path: undefined,
                repoUrl: undefined,
                error: undefined,
            },
            gitState: {
                isGitRepo: false,
                hasRemote: false,
                error: undefined,
            },
        };

        try {
            debugLog("Checking authentication state");
            const isAuthenticated = await this.checkAuthentication();
            state.authState.isAuthenticated = isAuthenticated;
            state.authState.isLoading = false;
            state.authState.isAuthExtensionInstalled = !!this.frontierApi;
            debugLog("Auth state:", state.authState);

            // Subscribe to auth status changes
            debugLog("Setting up auth status change subscription");
            this.subscribeToAuthChanges(() => {
                vscode.commands.executeCommand("codex-project-manager.preflight");
            });
        } catch (error) {
            debugLog("Error during auth extension check:", error);
            console.error("Error during auth extension check:", error);
            state.authState.error = "Failed to check authentication status";
        } finally {
            state.authState.isLoading = false;
        }

        // Check workspace state
        debugLog("Checking workspace state");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        state.workspaceState.isOpen = !!workspaceFolders?.length;
        debugLog("Workspace folders:", workspaceFolders);

        if (workspaceFolders?.length) {
            const workspacePath = workspaceFolders[0].uri.fsPath;

            try {
                debugLog("Checking for metadata.json");
                const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");
                await vscode.workspace.fs.stat(metadataUri);
                state.workspaceState.hasMetadata = true;
                debugLog("Found metadata.json");

                // Read and parse metadata.json to check if project is properly setup
                debugLog("Reading metadata.json content");
                const metadataContent = await vscode.workspace.fs.readFile(metadataUri);
                const metadata = JSON.parse(metadataContent.toString());
                debugLog("Parsed metadata:", metadata);

                // Check if metadata has required fields
                const hasProjectName = !!metadata.projectName;
                const sourceLanguage = metadata.languages?.find(
                    (l: any) => l.projectStatus === "source"
                );
                const targetLanguage = metadata.languages?.find(
                    (l: any) => l.projectStatus === "target"
                );

                state.workspaceState.isProjectSetup =
                    hasProjectName && !!sourceLanguage && !!targetLanguage;
                debugLog("Project setup status:", {
                    hasProjectName,
                    hasSourceLanguage: !!sourceLanguage,
                    hasTargetLanguage: !!targetLanguage,
                    isProjectSetup: state.workspaceState.isProjectSetup,
                });

                // Optimize git operations - run in parallel and with shorter timeouts
                debugLog("Checking git status for workspace:", workspacePath);
                try {
                    // Use Promise.race with timeout to avoid hanging on slow git operations
                    const gitCheckPromise = Promise.all([
                        git.resolveRef({
                            fs,
                            dir: workspacePath,
                            ref: "HEAD",
                        }),
                        git.listRemotes({
                            fs,
                            dir: workspacePath,
                        })
                    ]);

                    // Add 2 second timeout for git operations
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Git operation timeout")), 2000)
                    );

                    const [headRef, remotes] = await Promise.race([gitCheckPromise, timeoutPromise]) as [any, any[]];

                    state.gitState.isGitRepo = true;
                    state.gitState.hasRemote = remotes.length > 0;
                    debugLog("Git operations completed:", { isRepo: true, remotesCount: remotes.length });
                } catch (error) {
                    debugLog("Git check error (expected for non-git repos):", error);
                    state.gitState.isGitRepo = false;
                    state.gitState.hasRemote = false;
                    // Don't set error for non-git repos as it's expected
                    if (error instanceof Error && !error.message.includes("timeout")) {
                        debugLog("Non-timeout git error:", error.message);
                    }
                }
            } catch (error) {
                debugLog("Error checking metadata:", error);
                state.workspaceState.hasMetadata = false;
                // Skip git check if no metadata - likely not a project folder
            }
        }

        debugLog("Final preflight state:", state);
        return state;
    }
}

// Register the preflight command
export const registerPreflightCommand = (context: vscode.ExtensionContext) => {
    debugLog("Registering preflight command");
    const preflightCheck = new PreflightCheck();
    const disposables: vscode.Disposable[] = [];

    const preflightCommand = vscode.commands.registerCommand(
        "codex-project-manager.preflight",
        async () => {
            debugLog("Executing preflight command");
            const state = await preflightCheck.preflight();
            debugLog("Preflight state:", state);

            // Decision tree matching the state machine:
            debugLog("Evaluating decision tree");
            if (state.authState.isAuthExtensionInstalled) {
                if (!state.authState.isAuthenticated) {
                    debugLog(
                        "Auth extension installed but not authenticated - opening startup flow"
                    );
                    vscode.commands.executeCommand("codex-project-manager.openStartupFlow");
                    return;
                }
            }

            if (!state.workspaceState.isOpen) {
                debugLog("No workspace open - opening startup flow");
                vscode.commands.executeCommand("codex-project-manager.openStartupFlow");
                return;
            }

            if (!state.workspaceState.hasMetadata) {
                debugLog("No metadata found - opening startup flow");
                vscode.commands.executeCommand("codex-project-manager.openStartupFlow");
                return;
            }

            if (!state.workspaceState.isProjectSetup) {
                debugLog("Project not properly setup - opening startup flow");
                vscode.commands.executeCommand("codex-project-manager.openStartupFlow");
                return;
            }

            if (!state.gitState.isGitRepo) {
                debugLog("Not a git repository - opening startup flow");
                vscode.commands.executeCommand("codex-project-manager.openStartupFlow");
                return;
            }

            debugLog("All checks passed - no action needed");
        }
    );

    disposables.push(preflightCommand);
    context.subscriptions.push(...disposables);

    // Run initial preflight check
    debugLog("Running initial preflight check");
    vscode.commands.executeCommand("codex-project-manager.preflight");
};
