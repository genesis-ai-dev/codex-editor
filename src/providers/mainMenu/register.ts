import * as vscode from "vscode";
import { MainMenuProvider } from "./mainMenuProvider";

export function registerMainMenuProvider(context: vscode.ExtensionContext) {
    const provider = new MainMenuProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(MainMenuProvider.viewType, provider)
    );

    // No need to register the command here - it's now registered in commands.ts

    return provider;
}
