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
            console.log("[WelcomeView] Editors changed, count:", editors.length);
            // Only show welcome view when all editors are closed and we have a workspace
            if (
                editors.length === 0 &&
                vscode.workspace.workspaceFolders &&
                vscode.workspace.workspaceFolders.length > 0
            ) {
                // Additional check for any open tabs/editors of any type
                await showWelcomeViewIfNeeded();
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

    // Also watch for notebook document close events
    context.subscriptions.push(
        vscode.workspace.onDidCloseNotebookDocument(async (document) => {
            console.log(`[WelcomeView] Notebook document closed: ${document.uri.toString()}`);
            // After a short delay, check if all editors are now closed
            setTimeout(() => {
                showWelcomeViewIfNeeded();
            }, 100); // Small delay to ensure editors array is updated
        })
    );

    // Watch for tab close events to catch custom editors and other non-text editors
    if (vscode.window.tabGroups) {
        context.subscriptions.push(
            vscode.window.tabGroups.onDidChangeTabs(async (event) => {
                if (event.closed.length > 0) {
                    console.log(`[WelcomeView] Tabs closed: ${event.closed.length}`);
                    // After a short delay, check if all editors are now closed
                    setTimeout(() => {
                        showWelcomeViewIfNeeded();
                    }, 100); // Small delay to ensure editors array is updated
                }
            })
        );
    }

    // Always dispose the provider when extension is deactivated
    context.subscriptions.push(provider);

    return provider;
}

export function getWelcomeViewProvider(): WelcomeViewProvider {
    return provider;
}

// Check if there are no visible editors and show welcome view if needed
export async function showWelcomeViewIfNeeded() {
    // Safety check - if provider is not initialized, log and return
    if (!provider) {
        console.warn("[WelcomeView] Provider not initialized yet, skipping welcome view");
        return;
    }

    // Check for both text editors and notebook editors
    const visibleTextEditors = vscode.window.visibleTextEditors;
    const hasVisibleEditors = visibleTextEditors.length > 0;

    // Check for open notebook editors
    const hasOpenNotebooks =
        vscode.window.visibleNotebookEditors && vscode.window.visibleNotebookEditors.length > 0;

    // Also check for any active editor (including diff editors, custom editors)
    const hasActiveEditor = !!vscode.window.activeTextEditor;

    // Check all open tabs in all tab groups (this should catch all editors of any type)
    const hasOpenTabs = vscode.window.tabGroups.all.some((group) => group.tabs.length > 0);

    console.log("[WelcomeView]", {
        hasVisibleEditors,
        hasOpenNotebooks,
        hasActiveEditor,
        hasOpenTabs,
        tabsCount: vscode.window.tabGroups.all.reduce(
            (count, group) => count + group.tabs.length,
            0
        ),
    });

    if (!hasVisibleEditors && !hasOpenNotebooks && !hasActiveEditor && !hasOpenTabs) {
        console.log("[WelcomeView] No editors open, showing welcome view");
        await provider.show();
    } else {
        console.log(`[WelcomeView] Editors found, skipping welcome view`);
    }
}
