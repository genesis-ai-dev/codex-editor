import * as vscode from "vscode";
import { CodexFilesWebviewProvider } from "./codexFilesWebviewProvider";

export function registerCodexFilesWebviewProvider(context: vscode.ExtensionContext) {
    const provider = new CodexFilesWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CodexFilesWebviewProvider.viewType, provider)
    );
}
