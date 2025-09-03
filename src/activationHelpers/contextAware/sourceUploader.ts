import * as vscode from "vscode";
import { NewSourceUploaderProvider } from "../../providers/NewSourceUploader/NewSourceUploaderProvider";
import { getWorkSpaceFolder } from "../../utils";

export const registerSourceUploaderProvider = (context: vscode.ExtensionContext) => {
    // Register the content provider first
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("newSourceUploaderProvider-scheme", {
            provideTextDocumentContent: () => {
                return "New Source Uploader";
            },
        })
    );

    const newSourceUploadProvider = new NewSourceUploaderProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            NewSourceUploaderProvider.viewType,
            newSourceUploadProvider,
            {
                supportsMultipleEditorsPerDocument: false,
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-project-manager.openNewSourceUpload", () => {
            const workspaceFolder = getWorkSpaceFolder();
            if (workspaceFolder) {
                const uri = vscode.Uri.parse(`newSourceUploaderProvider-scheme:New Source Upload`);
                vscode.commands.executeCommand(
                    "vscode.openWith",
                    uri,
                    NewSourceUploaderProvider.viewType
                );
            }
        })
    );
};
