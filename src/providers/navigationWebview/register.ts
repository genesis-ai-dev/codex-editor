import * as vscode from "vscode";
import { NavigationWebviewProvider } from "./navigationWebviewProvider";

export function registerNavigationWebviewProvider(context: vscode.ExtensionContext) {
    const provider = new NavigationWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(NavigationWebviewProvider.viewType, provider)
    );
}
