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

let client: LanguageClient | undefined;
let clientCommandsDisposable: vscode.Disposable;

export async function activate(context: vscode.ExtensionContext) {
    registerProjectManager(context);
    registerCodeLensProviders(context);
    registerTextSelectionHandler(context, () => undefined);
    registerProviders(context);
    await registerCommands(context);
    await initializeBibleData(context);
    await initializeWebviews(context);

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
