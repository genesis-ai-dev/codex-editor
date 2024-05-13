"use strict";
import * as vscode from "vscode";
import {
    triggerInlineCompletion,
    disableInlineCompletion,
    provideInlineCompletionItems,
} from "../../providers/translationSuggestions/inlineCompletionsProvider";

export async function languageServerTS(context: vscode.ExtensionContext) {
    const languages = ["scripture"];
    const disposables = languages.map((language) => {
        return vscode.languages.registerInlineCompletionItemProvider(language, {
            provideInlineCompletionItems,
        });
    });
    disposables.forEach((disposable) => context.subscriptions.push(disposable));

    const commandDisposable = vscode.commands.registerCommand(
        "extension.triggerInlineCompletion",
        triggerInlineCompletion,
        triggerInlineCompletion,
    );

    // debounce timer for sending completion request
    let debounceTimer = setTimeout(() => {}, 0);

    vscode.workspace.onDidChangeTextDocument((e) => {
        // Clear previous debounce timer
        clearTimeout(debounceTimer);
        disableInlineCompletion();

        // Set new debounce timer
        debounceTimer = setTimeout(() => {
            // Handle the event that the user has stopped editing the document
            const shouldTriggerInlineCompletion = e.contentChanges.length > 0;
            if (shouldTriggerInlineCompletion) {
                triggerInlineCompletion();
            }
        }, 500);
    });

    context.subscriptions.push(commandDisposable);
}
