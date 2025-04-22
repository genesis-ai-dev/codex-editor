import * as vscode from "vscode";
export async function registerCommandsBefore(context: vscode.ExtensionContext) {

// Add to your command registration
const toggleWorkspaceUICommand = vscode.commands.registerCommand(
    "codex-editor-extension.toggleWorkspaceUI",
    async () => {
        const config = vscode.workspace.getConfiguration();

        // Get current states to determine if we're hiding or showing
        const sidebarVisible = config.get("workbench.sideBar.visible", true);

        if (sidebarVisible) {
            // We're currently in normal mode, so hide everything

            // Hide sidebars using commands
            await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
            await vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
            await vscode.commands.executeCommand(
                "workbench.action.toggleActivityBarVisibility"
            );
            await vscode.commands.executeCommand(
                "workbench.action.toggleStatusbarVisibility"
            );

            // Update settings to hide other UI elements
            await config.update("workbench.statusBar.visible", false, true);
            await config.update("breadcrumbs.filePath", "last", true);
            await config.update("workbench.editor.editorActionsLocation", "hidden", true);
            await config.update("workbench.editor.showTabs", "none", true);
            await config.update("window.autoDetectColorScheme", true, true);

            vscode.window.setStatusBarMessage(
                "Workspace UI hidden for distraction-free mode",
                2000
            );
        } else {
            // We're in minimal mode, so restore everything

            // Show sidebars using commands
            await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
            await vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
            await vscode.commands.executeCommand(
                "workbench.action.toggleActivityBarVisibility"
            );
            await vscode.commands.executeCommand(
                "workbench.action.toggleStatusbarVisibility"
            );

            // Restore default settings
            await config.update("workbench.statusBar.visible", true, true);
            await config.update("breadcrumbs.filePath", "full", true);
            await config.update("workbench.editor.editorActionsLocation", "default", true);
            await config.update("workbench.editor.showTabs", "multiple", true);
            await config.update("window.autoDetectColorScheme", false, true);

            vscode.window.setStatusBarMessage("Workspace UI restored", 2000);
        }
    }
);

    context.subscriptions.push(toggleWorkspaceUICommand);
}
