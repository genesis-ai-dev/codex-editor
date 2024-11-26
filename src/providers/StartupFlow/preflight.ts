import * as vscode from "vscode";
import { waitForExtensionActivation } from '../../utils/vscode';
import { FrontierAPI } from '../../../webviews/codex-webviews/src/StartupFLow/types';

interface AuthState {
    isAuthenticated: boolean;
    isAuthExtensionInstalled: boolean;
    isLoading: boolean;
    error?: string;
    gitlabInfo?: any;
}

interface PreflightState {
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
}

export class PreflightCheck {
    private frontierApi?: FrontierAPI;
    private authStateSubscription?: vscode.Disposable;

    constructor() {
        this.initializeFrontierApi();
    }

    private async initializeFrontierApi() {
        try {
            const extension = await waitForExtensionActivation('frontier-rnd.frontier-authentication');
            if (extension?.isActive) {
                this.frontierApi = extension.exports;
            }
        } catch (error) {
            console.error('Failed to initialize Frontier API:', error);
        }
    }

    public async checkAuthentication(): Promise<boolean> {
        if (!this.frontierApi) {
            await this.initializeFrontierApi();
        }
        
        try {
            const authStatus = await this.frontierApi?.getAuthStatus();
            return authStatus?.isAuthenticated ?? false;
        } catch (error) {
            console.error('Error checking authentication:', error);
            return false;
        }
    }

    public subscribeToAuthChanges(callback: (status: { isAuthenticated: boolean; gitlabInfo?: any }) => void): void {
        if (this.authStateSubscription) {
            this.authStateSubscription.dispose();
        }

        if (this.frontierApi) {
            this.authStateSubscription = this.frontierApi.onAuthStatusChanged(callback);
        }
    }

    public dispose(): void {
        if (this.authStateSubscription) {
            this.authStateSubscription.dispose();
        }
    }
}

export const preflight = async (context: vscode.ExtensionContext) => {
    const preflightCheck = new PreflightCheck();

    const getPreflightState = async (): Promise<PreflightState> => {
        const state: PreflightState = {
            authState: {
                isAuthenticated: false,
                isAuthExtensionInstalled: false,
                isLoading: true,
                error: undefined,
                gitlabInfo: undefined
            },
            workspaceState: {
                isOpen: false,
                hasMetadata: false,
                error: undefined
            },
            projectSelection: {
                type: undefined,
                path: undefined,
                repoUrl: undefined,
                error: undefined
            }
        };

        try {
            const isAuthenticated = await preflightCheck.checkAuthentication();
            state.authState.isAuthenticated = isAuthenticated;
            state.authState.isLoading = false;
            state.authState.isAuthExtensionInstalled = true;

            // Subscribe to auth status changes
            preflightCheck.subscribeToAuthChanges((newAuthState) => {
                vscode.commands.executeCommand('extension.preflight');
            });

        } catch (error) {
            console.error('Error during auth extension check:', error);
            state.authState.error = 'Failed to check authentication status';
        } finally {
            state.authState.isLoading = false;
        }

        // Check workspace state
        const workspaceFolders = vscode.workspace.workspaceFolders;
        state.workspaceState.isOpen = !!workspaceFolders?.length;

        if (workspaceFolders?.length) {
            try {
                const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'metadata.json');
                await vscode.workspace.fs.stat(metadataUri);
                state.workspaceState.hasMetadata = true;
            } catch {
                state.workspaceState.hasMetadata = false;
            }
        }

        return state;
    };

    const disposables: vscode.Disposable[] = [];
    
    const preflightCommand = vscode.commands.registerCommand(
        "extension.preflight",
        async () => {
            const state = await getPreflightState();
            console.log('Preflight state:', state); // Helpful for debugging
            
            // Decision tree matching the state machine:
            if (state.authState.isAuthExtensionInstalled) {
                if (!state.authState.isAuthenticated) {
                    vscode.commands.executeCommand('codex-startup-flow.show');
                    return;
                }
            }
            
            if (!state.workspaceState.isOpen) {
                vscode.commands.executeCommand('codex-startup-flow.show');
                return;
            }
            
            if (!state.workspaceState.hasMetadata) {
                vscode.commands.executeCommand('codex-startup-flow.show');
                return;
            }
        }
    );
    
    disposables.push(preflightCommand);
    context.subscriptions.push(...disposables);
    
    // Run initial preflight check
    await vscode.commands.executeCommand('extension.preflight');
};