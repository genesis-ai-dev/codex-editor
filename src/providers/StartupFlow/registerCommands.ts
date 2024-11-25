import * as vscode from "vscode";
import StartupFlowDocumentProvider from "./StartupFlowDocumentProvider";
import { StartupFlowProvider } from "./StartupFlowProvider";
import { getWorkSpaceFolder } from "../../utils";

export const registerStartupFlowCommands = (context: vscode.ExtensionContext) => {
    // Register the content provider first
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            "startupFlowProvider-scheme",
            new StartupFlowDocumentProvider()
        )
    );
    const startupFlowProvider = new StartupFlowProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            StartupFlowProvider.viewType,
            startupFlowProvider,
            {
                supportsMultipleEditorsPerDocument: false,
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-project-manager.openStartupFlow", () => {
            const workspaceFolder = getWorkSpaceFolder();
            if (workspaceFolder) {
                const uri = vscode.Uri.parse(
                    `startupFlowProvider-scheme:Startup Flow.startupFlowProvider`
                );
                vscode.commands.executeCommand(
                    "vscode.openWith",
                    uri,
                    StartupFlowProvider.viewType
                );
            }
        })
    );
};
