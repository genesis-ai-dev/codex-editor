import * as vscode from "vscode";
import { registerTextSelectionHandler } from "./handlers/textSelectionHandler";
import { registerReferencesCodeLens } from "./referencesCodeLensProvider";
import { registerSourceCodeLens } from "./sourceCodeLensProvider";
import { indexVerseRefsInSourceText } from "./commands/indexVrefsCommand";
import { registerProviders } from "./providers/registerProviders";
import { registerCommands } from "./activationHelpers/contextAware/commands";
import { initializeWebviews } from "./activationHelpers/contextAware/webviewInitializers";
import { registerCompletionsCodeLensProviders } from "./activationHelpers/contextAware/completionsCodeLensProviders";
import { initializeBibleData } from "./activationHelpers/contextAware/sourceData";
import { registerLanguageServer } from "./tsServer/registerLanguageServer";
import { registerClientCommands } from "./tsServer/registerClientCommands";
import { LanguageClient } from "vscode-languageclient/node";
import { registerProjectManager } from "./projectManager";
import {
    temporaryMigrationScript_checkMatthewNotebook,
    migration_changeDraftFolderToFilesFolder,
} from "./projectManager/utils/migrationUtils";
import { createIndexWithContext } from "./activationHelpers/contextAware/miniIndex/indexes";
import { registerSourceUploadCommands } from "./providers/SourceUpload/registerCommands";
import { migrateSourceFiles } from "./utils/codexNotebookUtils";
import { VideoEditorProvider } from "./providers/VideoEditor/VideoEditorProvider";
import { registerVideoPlayerCommands } from "./providers/VideoPlayer/registerCommands";
let client: LanguageClient | undefined;
let clientCommandsDisposable: vscode.Disposable;

export async function activate(context: vscode.ExtensionContext) {
    // Create metadata.json if it doesn't exist
    const fs = vscode.workspace.fs;
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (workspaceFolders && workspaceFolders.length > 0) {
        const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");

        try {
            await fs.stat(metadataUri);
            console.log("metadata.json already exists");
        } catch {
            console.log("Creating metadata.json");
            const initialContent = JSON.stringify({}, null, 2);
            await fs.writeFile(metadataUri, Buffer.from(initialContent, "utf8"));
        }
    } else {
        console.log("No workspace folder found");
    }
    registerProjectManager(context);
    registerVideoPlayerCommands(context);
    registerSourceUploadCommands(context);

    registerCodeLensProviders(context);
    registerTextSelectionHandler(context, () => undefined);
    registerProviders(context);
    await registerCommands(context);
    await initializeBibleData(context);
    await initializeWebviews(context);
    // context.subscriptions.push(
    //     vscode.window.registerCustomEditorProvider(
    //         SourceUploadProvider.viewType,
    //         new SourceUploadProvider(context),
    //         {
    //             supportsMultipleEditorsPerDocument: false,
    //             webviewOptions: {
    //                 retainContextWhenHidden: true,
    //             },
    //         }
    //     )
    // );

    // vscode.commands.registerCommand("myExtension.openVirtualDocument", () => {
    //     const uri = vscode.Uri.parse("sourceupload:Source Upload");
    //     vscode.commands.executeCommand("vscode.openWith", uri, SourceUploadProvider.viewType);
    // });

    // const sourceUploadProvider = new SourceUploadProvider(context);
    // context.subscriptions.push(
    //     vscode.workspace.registerTextDocumentContentProvider("sourceupload", sourceUploadProvider)
    // );

    client = await registerLanguageServer(context);

    if (client) {
        // Register commands that depend on the client
        clientCommandsDisposable = registerClientCommands(context, client);
        context.subscriptions.push(clientCommandsDisposable);
    }

    await indexVerseRefsInSourceText();
    await createIndexWithContext(context);
    await executeCommandsAfter();
    await temporaryMigrationScript_checkMatthewNotebook();
    await migration_changeDraftFolderToFilesFolder();

    // Add the new migration function
    await migrateSourceFiles();

    context.subscriptions.push(
        // FIXME: move to commands register
        vscode.commands.registerCommand(
            "translation-navigation.openSourceFile",
            async (node: Node & { sourceFile?: string }) => {
                if ("sourceFile" in node && node.sourceFile) {
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (workspaceFolder) {
                        const sourceFileUri = vscode.Uri.joinPath(
                            workspaceFolder.uri,
                            ".project",
                            "sourceTexts",
                            node.sourceFile
                        );

                        try {
                            await vscode.commands.executeCommand(
                                "vscode.openWith",
                                sourceFileUri,
                                "codex.cellEditor",
                                { viewColumn: vscode.ViewColumn.Beside }
                            );
                        } catch (error) {
                            console.error(`Failed to open source file: ${error}`);
                            vscode.window.showErrorMessage(
                                `Failed to open source file: ${JSON.stringify(node)}`
                            );
                        }
                    } else {
                        vscode.window.showErrorMessage("No workspace folder found");
                    }
                }
            }
        )
    );
}

function registerCodeLensProviders(context: vscode.ExtensionContext) {
    registerReferencesCodeLens(context);
    registerSourceCodeLens(context);
    registerCompletionsCodeLensProviders(context);
}

async function executeCommandsAfter() {
    vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
    vscode.commands.executeCommand("translation-navigation.refreshNavigationTreeView");
    vscode.commands.executeCommand("codex-editor-extension.setEditorFontToTargetLanguage");
}

export function deactivate() {
    if (clientCommandsDisposable) {
        clientCommandsDisposable.dispose();
    }
    if (client) {
        return client.stop();
    }
}
