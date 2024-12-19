import * as vscode from "vscode";
import { waitForExtensionActivation } from "../../utils/vscode";
import { FrontierAPI } from "../../../webviews/codex-webviews/src/StartupFLow/types";
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

export class PreflightCheck {
    private frontierApi?: FrontierAPI;
    private authStateSubscription?: vscode.Disposable;

    constructor() {
        this.initializeFrontierApi();
    }

    private async initializeFrontierApi() {
        try {
            this.frontierApi = getAuthApi();
        } catch (error) {
            console.error("Failed to initialize Frontier API:", error);
        }
    }

    public async checkAuthentication(): Promise<boolean> {
        if (!this.frontierApi) {
            await this.initializeFrontierApi();
        }

        if (!this.frontierApi) {
            return false;
        }

        try {
            const status = this.frontierApi.getAuthStatus();
            return status.isAuthenticated;
        } catch (error) {
            console.error("Error checking authentication:", error);
            return false;
        }
    }

    public subscribeToAuthChanges(
        callback: (status: { isAuthenticated: boolean; gitlabInfo?: any }) => void
    ): void {
        if (this.frontierApi) {
            this.authStateSubscription?.dispose();
            this.authStateSubscription = this.frontierApi.onAuthStatusChanged(callback);
        }
    }

    public dispose(): void {
        this.authStateSubscription?.dispose();
    }

    public async preflight(context: vscode.ExtensionContext): Promise<PreflightState> {
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
            const isAuthenticated = await this.checkAuthentication();
            state.authState.isAuthenticated = isAuthenticated;
            state.authState.isLoading = false;
            state.authState.isAuthExtensionInstalled = !!this.frontierApi;

            // Subscribe to auth status changes
            this.subscribeToAuthChanges(() => {
                vscode.commands.executeCommand("codex-project-manager.preflight");
            });
        } catch (error) {
            console.error("Error during auth extension check:", error);
            state.authState.error = "Failed to check authentication status";
        } finally {
            state.authState.isLoading = false;
        }

        // Check workspace state
        const workspaceFolders = vscode.workspace.workspaceFolders;
        state.workspaceState.isOpen = !!workspaceFolders?.length;

        if (workspaceFolders?.length) {
            try {
                const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");
                await vscode.workspace.fs.stat(metadataUri);
                state.workspaceState.hasMetadata = true;

                // Check git repository status
                const workspacePath = workspaceFolders[0].uri.fsPath;
                try {
                    // Check if it's a git repository
                    await git.resolveRef({
                        fs,
                        dir: workspacePath,
                        ref: "HEAD",
                    });
                    state.gitState.isGitRepo = true;

                    // Check for remotes
                    const remotes = await git.listRemotes({
                        fs,
                        dir: workspacePath,
                    });
                    state.gitState.hasRemote = remotes.length > 0;
                } catch (error) {
                    console.error("Git check error:", error);
                    state.gitState.error = "Failed to check git repository status";
                }
            } catch {
                state.workspaceState.hasMetadata = false;
            }
        }

        return state;
    }
}

// Register the preflight command
export const registerPreflightCommand = (context: vscode.ExtensionContext) => {
    const preflightCheck = new PreflightCheck();
    const disposables: vscode.Disposable[] = [];

    const preflightCommand = vscode.commands.registerCommand(
        "codex-project-manager.preflight",
        async () => {
            const state = await preflightCheck.preflight(context);
            console.log("Preflight state:", state);

            // Decision tree matching the state machine:
            if (state.authState.isAuthExtensionInstalled) {
                if (!state.authState.isAuthenticated) {
                    vscode.commands.executeCommand("codex-project-manager.openStartupFlow");
                    return;
                }
            }

            if (!state.workspaceState.isOpen) {
                vscode.commands.executeCommand("codex-project-manager.openStartupFlow");
                return;
            }

            if (!state.workspaceState.hasMetadata) {
                vscode.commands.executeCommand("codex-project-manager.openStartupFlow");
                return;
            }

            if (!state.gitState.isGitRepo) {
                vscode.commands.executeCommand("codex-project-manager.openStartupFlow");
                return;
            }
        }
    );

    disposables.push(preflightCommand);
    context.subscriptions.push(...disposables);

    // Run initial preflight check
    vscode.commands.executeCommand("codex-project-manager.preflight");
};
