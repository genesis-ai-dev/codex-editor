
"use strict";
import * as vscode from "vscode";
import {
    triggerInlineCompletion,
    provideInlineCompletionItems,
} from "../../providers/translationSuggestions/inlineCompletionsProvider";

export async function langugeServerTS (context: vscode.ExtensionContext){
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

    vscode.workspace.onDidChangeTextDocument((e) => {
        const shouldTriggerInlineCompletion = e.contentChanges.length > 0;
        if (shouldTriggerInlineCompletion) {
            triggerInlineCompletion();
        }
    });

    context.subscriptions.push(commandDisposable);
}