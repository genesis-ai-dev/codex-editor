import * as vscode from "vscode";
import SourceUploadDocumentProvider from "./SourceUploadDocumentProvider";
import { SourceUploadProvider } from "./SourceUploadProvider";

export const registerSourceUploadCommands = (context: vscode.ExtensionContext) => {
    // Register the content provider first
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            "sourceUploadProvider-scheme",
            new SourceUploadDocumentProvider()
        )
    );
    const sourceUploadProvider = new SourceUploadProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            SourceUploadProvider.viewType,
            sourceUploadProvider,
            {
                supportsMultipleEditorsPerDocument: false,
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("myExtension.openSourceUpload", () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const uri = vscode.Uri.parse(`sourceUploadProvider-scheme:Upload Document`);
                vscode.commands.executeCommand(
                    "vscode.openWith",
                    uri,
                    SourceUploadProvider.viewType
                );
            }
        })
    );
};
