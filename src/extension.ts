"use strict";
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
import { registerClientCommands } from "./tsServer/clientCommands";
import { LanguageClient } from "vscode-languageclient/node";

let client: LanguageClient;

export async function activate(context: vscode.ExtensionContext) {
    await indexVerseRefsInSourceText();
    registerCodeLensProviders(context);
    registerTextSelectionHandler(context, () => undefined);

    registerProviders(context);
    await registerCommands(context);
    await initializeBibleData(context);
    await initializeWebviews(context);

    client = await registerLanguageServer(context, client);
    if (client) {
        await registerClientCommands(context, client);
    }

    await executeCommandsAfter();
    await temporaryMigrationScript_checkMatthewNotebook();

}

function registerCodeLensProviders(context: vscode.ExtensionContext) {
    registerReferencesCodeLens(context);
    registerSourceCodeLens(context);
    registerCompletionsCodeLensProviders(context);
}

async function executeCommandsAfter() {
    vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
    vscode.commands.executeCommand("translation-navigation.refreshEntry");
    vscode.commands.executeCommand(
        "codex-editor-extension.setEditorFontToTargetLanguage",
    );
}

async function temporaryMigrationScript_checkMatthewNotebook() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    const matthewNotebookPath = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        "/files/target/MAT.codex",
    );
    try {
        const document =
            await vscode.workspace.openNotebookDocument(matthewNotebookPath);
        for (const cell of document.getCells()) {
            if (
                cell.kind === vscode.NotebookCellKind.Code &&
                cell.document.getText().includes("MAT 1:1")
            ) {
                vscode.window.showInformationMessage(
                    "Updating notebook to use cells for verse content.",
                );
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Updating notebooks",
                        cancellable: false,
                    },
                    async (progress) => {
                        progress.report({ increment: 0 });
                        await vscode.commands.executeCommand(
                            "codex-editor-extension.updateProjectNotebooksToUseCellsForVerseContent",
                        );
                        progress.report({ increment: 100 });
                    },
                );
                vscode.window.showInformationMessage(
                    "Updated notebook to use cells for verse content.",
                );
                // Reload the window
                await vscode.commands.executeCommand(
                    "workbench.action.reloadWindow",
                );
                break;
            }
        }
    } catch (error) {
        console.error("Error checking Matthew notebook:", error);
    }
}
