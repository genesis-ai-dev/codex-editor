import * as vscode from "vscode";
import {
    triggerInlineCompletion,
    provideInlineCompletionItems
} from "../../providers/translationSuggestions/inlineCompletionsProvider";
import VerseCompletionCodeLensProvider from "../../providers/translationSuggestions/verseCompletionCodeLensProvider";

let statusBarItem: vscode.StatusBarItem;

export async function registerCompletionsCodeLensProviders(context: vscode.ExtensionContext) {
    try {

        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        context.subscriptions.push(statusBarItem);

        const languages = ["scripture"];
        const disposables = languages.map((language) => {
            return vscode.languages.registerInlineCompletionItemProvider(language, {
                provideInlineCompletionItems,
            });
        });
        disposables.forEach((disposable) => context.subscriptions.push(disposable));

        const commandDisposable = vscode.commands.registerCommand(
            "codex-editor-extension.triggerInlineCompletion",
            async () => {
                await triggerInlineCompletion(statusBarItem);
            }
        );

        context.subscriptions.push(commandDisposable);

        // Register the CodeLensProvider
        context.subscriptions.push(
            vscode.languages.registerCodeLensProvider(
                { language: 'scripture' },
                new VerseCompletionCodeLensProvider()
            )
        );

    } catch (error) {
        console.error("Error activating extension", error);
        vscode.window.showErrorMessage("Failed to activate Translators Copilot. Please check the logs for details.");
    }
}

export function deactivate() {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}