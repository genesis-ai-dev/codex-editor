import * as vscode from "vscode";

interface PreflightState {
    authState: {
        isAuthenticated: boolean;
        isAuthExtensionInstalled: boolean;
        isLoading: boolean;
        error?: string;
    };
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

/**
 * Checks the current state of the workspace and authentication
 * to determine if and when to show the startup flow.
 * 
 * This preflight check aligns with the startupFlowMachine states:
 * 1. loginRegister -> Checks auth extension and login state
 * 2. workspaceCheck -> Checks if workspace is open
 * 3. metadataCheck -> Checks for metadata.json
 * 4. createNewProject/openSourceFlow/complicatedState -> Handled by the UI
 * 5. alreadyWorking -> Final state when everything is set up
 */
export const preflight = async (context: vscode.ExtensionContext) => {
    const getPreflightState = async (): Promise<PreflightState> => {
        const authExtension = vscode.extensions.getExtension('frontier-rnd.frontier-authentication');
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        // Initialize state to match startupFlowMachine's initial context
        const state: PreflightState = {
            authState: {
                isAuthenticated: false,
                isAuthExtensionInstalled: !!authExtension,
                isLoading: true,
                error: undefined
            },
            workspaceState: {
                isOpen: !!workspaceFolders?.length,
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

        // Check auth state if extension exists
        if (authExtension) {
            try {
                const isLoggedIn = await vscode.commands.executeCommand('frontier-authentication.isLoggedIn');
                state.authState.isAuthenticated = !!isLoggedIn;
            } catch (error) {
                state.authState.error = error instanceof Error ? error.message : 'Unknown error checking auth status';
            }
        }
        state.authState.isLoading = false;

        // Check workspace state
        if (workspaceFolders?.length) {
            try {
                const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'metadata.json');
                await vscode.workspace.fs.stat(metadataUri);
                state.workspaceState.hasMetadata = true;
            } catch (error) {
                state.workspaceState.hasMetadata = false;
                // We don't set error here as missing metadata is an expected state
            }
        }

        return state;
    };

    const preflightCommand = vscode.commands.registerCommand(
        "extension.preflight",
        async () => {
            const state = await getPreflightState();
            console.log('Preflight state:', state); // Helpful for debugging
            
            // Decision tree matching the state machine:
            
            // 1. loginRegister state
            if (state.authState.isAuthExtensionInstalled) {
                if (!state.authState.isAuthenticated) {
                    console.log('Auth extension found but not logged in, showing startup flow');
                    return vscode.commands.executeCommand('codex-project-manager.openStartupFlow');
                }
            } else {
                console.log('No auth extension, proceeding to workspace check');
            }
            
            // 2. workspaceCheck state
            if (!state.workspaceState.isOpen) {
                console.log('No workspace open, showing startup flow for project creation');
                return vscode.commands.executeCommand('codex-project-manager.openStartupFlow');
            }
            
            // 3. metadataCheck state
            if (!state.workspaceState.hasMetadata) {
                console.log('No metadata.json found, showing startup flow for project initialization');
                return vscode.commands.executeCommand('codex-project-manager.openStartupFlow');
            }
            
            // 4. alreadyWorking state (final)
            console.log('User is already working on a project, skipping startup flow');
        }
    );
    
    context.subscriptions.push(preflightCommand);
    
    // Run preflight check immediately on activation
    return vscode.commands.executeCommand('extension.preflight');
};