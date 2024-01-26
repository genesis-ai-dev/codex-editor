import * as vscode from "vscode";
import { CodexKernel } from "./controller";
import { CodexContentSerializer } from "./serializer";
import {
    NOTEBOOK_TYPE,
    createCodexNotebook,
    createProjectNotebooks,
} from "./codexNotebookUtils";
import { CodexNotebookProvider } from "./tree-view/scriptureTreeViewProvider";
import { getWorkSpaceFolder, jumpToCellInNotebook } from "./utils";
import { registerReferences } from "./referencesProvider";
import { ResourceProvider } from "./tree-view/resourceTreeViewProvider";

const ROOT_PATH = getWorkSpaceFolder();

export function activate(context: vscode.ExtensionContext) {
    registerReferences(context);

    // Register the Codex Notebook serializer for saving and loading .codex files
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            NOTEBOOK_TYPE,
            new CodexContentSerializer(),
            { transientOutputs: true },
        ),
        new CodexKernel(),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-notebook-extension.openChapter",
            async (notebookPath: string, chapterIndex: number) => {
                try {
                    jumpToCellInNotebook(notebookPath, chapterIndex);
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to open chapter: ${error}`,
                    );
                }
            },
        ),
    );
    // Register a command called openChapter that opens a specific .codex notebook to a specific chapter
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-notebook-extension.openFile",
            async (resourceUri: vscode.Uri) => {
                try {
                    const document =
                        await vscode.workspace.openTextDocument(resourceUri);
                    await vscode.window.showTextDocument(
                        document,
                        vscode.ViewColumn.Beside,
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to open document: ${error}`,
                    );
                }
            },
        ),
    );
    // Register extension commands
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-notebook-extension.createCodexNotebook",
            async () => {
                vscode.window.showInformationMessage("Creating Codex Notebook");
                const doc = await createCodexNotebook();
                await vscode.window.showNotebookDocument(doc);
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-notebook-extension.createCodexProject",
            async () => {
                const overwriteConfirmation =
                    await vscode.window.showWarningMessage(
                        "Do you want to overwrite any existing project files?",
                        "Yes",
                        "No",
                    );
                if (overwriteConfirmation === "Yes") {
                    vscode.window.showInformationMessage(
                        "Creating Codex Project with overwrite.",
                    );
                    await createProjectNotebooks(true);
                } else {
                    vscode.window.showInformationMessage(
                        "Creating Codex Project without overwrite.",
                    );
                    await createProjectNotebooks();
                }
            },
        ),
    );

    // Register and create the Scripture Tree View
    const scriptureTreeViewProvider = new CodexNotebookProvider(ROOT_PATH);
    const resourceTreeViewProvider = new ResourceProvider(ROOT_PATH);
    vscode.window.registerTreeDataProvider(
        "resource-explorer",
        resourceTreeViewProvider,
    );
    // vscode.window.createTreeView('scripture-explorer', { treeDataProvider: scriptureTreeViewProvider });
    vscode.commands.registerCommand("resource-explorer.refreshEntry", () =>
        resourceTreeViewProvider.refresh(),
    );
    vscode.window.registerTreeDataProvider(
        "scripture-explorer-activity-bar",
        scriptureTreeViewProvider,
    );
    // vscode.window.createTreeView('scripture-explorer', { treeDataProvider: scriptureTreeViewProvider });
    vscode.commands.registerCommand(
        "scripture-explorer-activity-bar.refreshEntry",
        () => scriptureTreeViewProvider.refresh(),
    );
}
