import * as vscode from "vscode";
import { DictionaryEditorProvider } from "./DictionaryEditorProvider";
import { getWorkSpaceUri } from "../../utils";

export function registerDictionaryTableProvider(context: vscode.ExtensionContext) {
    // Register the DictionaryEditorProvider
    const providerRegistration = vscode.window.registerCustomEditorProvider(
        DictionaryEditorProvider.viewType,
        new DictionaryEditorProvider(context),
        {
            webviewOptions: { enableFindWidget: true, retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false,
        }
    );

    // Add the provider registration to the extension context
    context.subscriptions.push(providerRegistration);

    // Register a command to open the dictionary editor
    const openDictionaryEditorCommand = vscode.commands.registerCommand(
        "dictionaryTable.showDictionaryTable",
        async () => {
            const workspaceUri = getWorkSpaceUri();
            if (!workspaceUri) {
                vscode.window.showErrorMessage(
                    "No workspace found. Please open a workspace to access the dictionary."
                );
                return;
            }
            const dictionaryUri = vscode.Uri.joinPath(workspaceUri, "files", "project.dictionary");

            try {
                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    dictionaryUri,
                    DictionaryEditorProvider.viewType
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open dictionary: ${error}`);
            }
        }
    );

    // Add the command to the extension context
    context.subscriptions.push(openDictionaryEditorCommand);
}
