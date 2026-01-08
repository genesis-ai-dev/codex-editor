import * as vscode from "vscode";
import StartupFlowDocumentProvider from "./StartupFlowDocumentProvider";
import { StartupFlowProvider } from "./StartupFlowProvider";
import { getWorkSpaceFolder } from "../../utils";
import { setUserPreference } from "../../utils/userPreferences";

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
        vscode.commands.registerCommand("codex-project-manager.openStartupFlow", async (options?: { forceLogin?: boolean }) => {
            // Default to forcing login if options are undefined (manual invocation)
            // If options are provided, respect the flag
            // Always create the URI, regardless of workspace state
            const uri = vscode.Uri.parse(
                `startupFlowProvider-scheme:Startup Flow`
            );
            await vscode.commands.executeCommand(
                "vscode.openWith",
                uri,
                StartupFlowProvider.viewType
            );

            // Send forceLogin message to the webview if requested
            if (options?.forceLogin) {
                // Small delay to ensure webview is ready
                setTimeout(() => {
                    startupFlowProvider.sendForceLoginMessage();
                }, 100);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-project-manager.resetSampleProjectPrompt",
            async () => {
                await setUserPreference(context, "skipSampleProjectPrompt", false);
                vscode.window.showInformationMessage(
                    "Sample project prompt has been reset. You'll see it next time you create a project."
                );
            }
        )
    );
};
