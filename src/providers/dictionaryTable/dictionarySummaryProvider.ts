import * as vscode from "vscode";
import { DictionarySidePanel } from "./DictionarySidePanel";

export function registerDictionarySummaryProvider(
    context: vscode.ExtensionContext,
) {
    // Register the webview view provider for the sidebar
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "dictionary-side-panel", // This ID should match the one used in the package.json
            new DictionarySidePanel(context.extensionUri),
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
    );

    // // Register a command that activates the sidebar view
    // const command = vscode.commands.registerCommand("dictionaryTable.showDictionaryTable", () => {
    //     vscode.commands.executeCommand('workbench.view.extension.dictionaryTable').then(() => {
    //         // Optional: Additional logic to run after the view is revealed, if necessary
    //     }, console.error);
    // });

    // context.subscriptions.push(command);
}
