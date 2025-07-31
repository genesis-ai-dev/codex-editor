import * as vscode from "vscode";
import SourceUploadDocumentProvider from "./SourceUploadDocumentProvider";
import { SourceUploadProvider } from "./SourceUploadProvider";
import { NewSourceUploaderProvider } from "../NewSourceUploader/NewSourceUploaderProvider";
import { getWorkSpaceFolder } from "../../utils";

export const registerSourceUploadCommands = (context: vscode.ExtensionContext) => {
    // Register the NEW content provider first
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("newSourceUploaderProvider-scheme", {
            provideTextDocumentContent: () => {
                return "New Source Uploader";
            },
        })
    );

    // Register the NEW source uploader provider
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

    // DEPRECATED: Keep the old provider registered for backward compatibility, but don't use it for the main command
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

    // Update the main command to use the NEW source uploader
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-project-manager.openSourceUpload", () => {
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
