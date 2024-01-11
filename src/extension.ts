import * as vscode from "vscode";
import { CodexKernel } from "./controller";
import { CodexContentSerializer } from "./serializer";
import {
    NOTEBOOK_TYPE,
    createCodexNotebook,
    createProjectNotebooks,
} from "./codexNotebookUtils";
import { CodexNotebookProvider } from "./tree-view/scriptureTreeViewProvider";
import { getWorkSpaceFolder } from "./utils";
import { ScriptureReferenceProvider } from "./references";

const ROOT_PATH = getWorkSpaceFolder();

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            // { scheme: "file" }, // all files option
            ["scripture"],
            new ScriptureReferenceProvider(),
        ),
    );
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { notebookType: "codex-type" }, // This targets notebook cells within "codex-type" notebooks
            new ScriptureReferenceProvider(),
        ),
    );

    // Register the Codex Notebook serializer for saving and loading .codex files
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            NOTEBOOK_TYPE,
            new CodexContentSerializer(),
            { transientOutputs: true },
        ),
        new CodexKernel(),
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
                vscode.window.showInformationMessage("Creating Codex Project");
                await createProjectNotebooks();
            },
        ),
    );

    // Register and create the Scripture Tree View
    const scriptureTreeViewProvider = new CodexNotebookProvider(ROOT_PATH);
    vscode.window.registerTreeDataProvider(
        "scripture-explorer",
        scriptureTreeViewProvider,
    );
    // vscode.window.createTreeView('scripture-explorer', { treeDataProvider: scriptureTreeViewProvider });
    vscode.commands.registerCommand("scripture-explorer.refreshEntry", () =>
        scriptureTreeViewProvider.refresh(),
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
