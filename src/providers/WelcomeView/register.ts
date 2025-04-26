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

    // Add watcher for text document close events - this helps catch editor closures
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(async (document) => {
            console.log(`[WelcomeView] Document closed: ${document.uri.toString()}`);
            // After a short delay, check if all editors are now closed and show welcome view if needed
            setTimeout(() => {
                showWelcomeViewIfNeeded();
            }, 100); // Small delay to ensure editors array is updated
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
