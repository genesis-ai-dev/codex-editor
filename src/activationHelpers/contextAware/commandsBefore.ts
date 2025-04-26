import * as vscode from "vscode";
import { showWelcomeViewIfNeeded } from "../../providers/WelcomeView/register";

export async function registerCommandsBefore(context: vscode.ExtensionContext) {
    // Add to your command registration
    const toggleWorkspaceUICommand = vscode.commands.registerCommand(
        "codex-editor-extension.toggleWorkspaceUI",
        async () => {
            console.log("Toggling workspace UI...");
            const config = vscode.workspace.getConfiguration();

            // Get current states to determine if we're hiding or showing
            const sidebarVisible = config.get("workbench.sideBar.visible", false);
            console.log("Current sidebar visibility:", sidebarVisible);

            if (sidebarVisible) {
                console.log("Hiding workspace UI elements...");
                // We're currently in normal mode, so hide everything

                // Use maximizeEditorHideSidebar command to hide both activity bar and sidebar in one call
                console.log("Maximizing editor and hiding sidebar...");
                await vscode.commands.executeCommand("workbench.action.maximizeEditorHideSidebar");

                console.log("Hiding status bar...");
                await vscode.commands.executeCommand("workbench.action.toggleStatusbarVisibility");

                // Update settings to hide other UI elements
                console.log("Updating workspace settings for minimal UI...");
                await config.update("workbench.statusBar.visible", false, true);
                await config.update("breadcrumbs.filePath", "last", true);
                await config.update("workbench.editor.editorActionsLocation", "default", true);
                await config.update("workbench.editor.showTabs", "none", true);
                await config.update("window.autoDetectColorScheme", true, true);
                await config.update("workbench.layoutControl.enabled", true, true);
                vscode.window.setStatusBarMessage(
                    "Workspace UI hidden for distraction-free mode",
                    2000
                );
                console.log("Workspace UI hidden successfully");
            } else {
                console.log("Restoring workspace UI elements...");
                // We're in minimal mode, so restore everything

                // Restore sidebar using single command
                console.log("Restoring sidebar and activity bar...");
                await vscode.commands.executeCommand("workbench.action.restoreSidebar");

                console.log("Showing status bar...");
                await vscode.commands.executeCommand("workbench.action.toggleStatusbarVisibility");

                // Restore default settings
                console.log("Restoring default workspace settings...");
                await config.update("workbench.statusBar.visible", true, true);
                await config.update("breadcrumbs.filePath", "full", true);
                await config.update("workbench.editor.editorActionsLocation", "default", true);
                await config.update("workbench.editor.showTabs", "multiple", true);
                await config.update("window.autoDetectColorScheme", false, true);
                await config.update("workbench.layoutControl.enabled", true, true);
                vscode.window.setStatusBarMessage("Workspace UI restored", 2000);
                console.log("Workspace UI restored successfully");
            }
            showWelcomeViewIfNeeded();
        }
    );

    context.subscriptions.push(toggleWorkspaceUICommand);
}
