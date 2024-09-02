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
}
