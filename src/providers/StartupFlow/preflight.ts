import * as vscode from 'vscode';

export const preflight = async (context: vscode.ExtensionContext) => {
    // Check if frontier auth extension is installed
    const authExtension = vscode.extensions.getExtension('frontier-rnd.frontier-authentication');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    const preflightCommand = vscode.commands.registerCommand(
        "extension.preflight",
        async () => {
            if (authExtension) {
                // Auth extension exists, check if user is logged in
                try {
                    // Assuming the auth extension exposes an API to check login state
                    const isLoggedIn = await vscode.commands.executeCommand('frontier-authentication.isLoggedIn');
                    
                    if (!isLoggedIn) {
                        // User needs to log in, show startup flow
                        return vscode.commands.executeCommand('codex-project-manager.openStartupFlow');
                    }
                } catch (error) {
                    console.error('Error checking auth status:', error);
                    // If we can't check auth status, proceed as if no auth extension
                }
            }
            
            // At this point either:
            // 1. No auth extension
            // 2. Auth extension exists and user is logged in
            // Check workspace state
            if (!workspaceFolders || workspaceFolders.length === 0) {
                // No workspace, show startup flow for project creation
                return vscode.commands.executeCommand('codex-project-manager.openStartupFlow');
            }
            
            // Check for metadata.json in workspace
            try {
                const workspaceFolder = workspaceFolders[0];
                const metadataUri = vscode.Uri.joinPath(workspaceFolder.uri, 'metadata.json');
                await vscode.workspace.fs.stat(metadataUri);
                // metadata.json exists, user is already working on something
                console.log('Workspace has metadata.json, skipping startup flow');
            } catch {
                // No metadata.json, show startup flow
                return vscode.commands.executeCommand('codex-project-manager.openStartupFlow');
            }
        }
    );
    
    context.subscriptions.push(preflightCommand);
    
    // Run preflight check immediately on activation
    return vscode.commands.executeCommand('extension.preflight');
};