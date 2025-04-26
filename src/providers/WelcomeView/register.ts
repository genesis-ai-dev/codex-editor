import * as vscode from "vscode";
import { WelcomeViewProvider } from "./welcomeViewProvider";

let provider: WelcomeViewProvider;

export function registerWelcomeViewProvider(context: vscode.ExtensionContext): WelcomeViewProvider {
    provider = new WelcomeViewProvider(context.extensionUri);

    // Register a command to show the welcome panel
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor.showWelcomeView", async () => {
            await provider.show();
            return true;
        })
    );

    // Show welcome view when all editors are closed
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
            // Only show welcome view when all editors are closed and we have a workspace
            if (
                editors.length === 0 &&
                vscode.workspace.workspaceFolders &&
                vscode.workspace.workspaceFolders.length > 0
            ) {
                await provider.show();
            }
        })
    );

    // Always dispose the provider when extension is deactivated
    context.subscriptions.push(provider);

    return provider;
}

export function getWelcomeViewProvider(): WelcomeViewProvider {
    return provider;
}

// Check if there are no visible editors and show welcome view if needed
export async function showWelcomeViewIfNeeded() {
    // Only show welcome view when there are no visible editors
    const visibleEditors = vscode.window.visibleTextEditors;

    if (visibleEditors.length === 0) {
        console.log("[WelcomeView] No editors open, showing welcome view");
        await provider.show();
    } else {
        console.log(`[WelcomeView] ${visibleEditors.length} editor(s) open, skipping welcome view`);
    }
}
