import * as vscode from "vscode";
import { WelcomeViewProvider } from "./welcomeViewProvider";

let provider: WelcomeViewProvider;

export function registerWelcomeViewProvider(context: vscode.ExtensionContext): WelcomeViewProvider {
    provider = new WelcomeViewProvider(context.extensionUri);

    // Register a command to show the welcome panel
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor.showWelcomeView", () => {
            provider.show();
            return true;
        })
    );

    // Add a function to determine if editors are open
    const checkNoEditorsOpen = (): boolean => {
        return vscode.window.visibleTextEditors.length === 0;
    };

    // Show welcome view when all editors are closed
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors((editors) => {
            if (editors.length === 0) {
                provider.show();
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
export function showWelcomeViewIfNeeded() {
    if (vscode.window.visibleTextEditors.length === 0) {
        provider.show();
    }
}
