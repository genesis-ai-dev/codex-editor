import * as vscode from "vscode";
import { MainMenuProvider } from "./mainMenuProvider";

export function registerMainMenuProvider(context: vscode.ExtensionContext) {
    const provider = new MainMenuProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(MainMenuProvider.viewType, provider)
    );

    // Don't register the focus command - VS Code does this automatically

    return provider;
}
