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
        vscode.commands.registerCommand("codex-project-manager.openStartupFlow", (options?: { forceLogin?: boolean; }) => {
            // Default to forcing login if options are undefined (manual invocation)
            // If options are provided, respect the flag
            const shouldForce = options?.forceLogin ?? true;

            if (shouldForce) {
                startupFlowProvider.setForceLogin(true);
            }

            // Always create the URI, regardless of workspace state
            const uri = vscode.Uri.parse(
                `startupFlowProvider-scheme:Startup Flow`
            );
            vscode.commands.executeCommand(
                "vscode.openWith",
                uri,
                StartupFlowProvider.viewType
            );
        })
    );

    // Allow other parts of the extension (e.g. pending project creation in
    // extension.ts) to tell the Startup Flow to re-check metadata.json and
    // auto-close if the project is now fully set up.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-project-manager.refreshStartupFlowState",
            () => startupFlowProvider.refreshProjectState()
        )
    );
};
