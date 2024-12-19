import * as vscode from "vscode";
import { CodexCellEditorProvider } from "./codexCellEditorProvider/codexCellEditorProvider";
import { NextGenCodexTreeViewProvider } from "./treeViews/nextGenCodexTreeViewProvider";
import { openCodexFile } from "./treeViews/nextGenCodexTreeViewProvider";

export function registerProviders(context: vscode.ExtensionContext) {
    const disposables: vscode.Disposable[] = [];

    // Register CodexCellEditorProvider
    disposables.push(CodexCellEditorProvider.register(context));

    // Register SourceControlProvider
    // const sourceControlProvider = registerSourceControl(context);
    // disposables.push(sourceControlProvider);

    // Register NextGenCodexTreeViewProvider
    const nextGenCodexTreeViewProvider = new NextGenCodexTreeViewProvider(context);
    const treeView = vscode.window.createTreeView("codexNotebookTreeView", {
        treeDataProvider: nextGenCodexTreeViewProvider,
        showCollapseAll: true,
    });

    disposables.push(
        treeView,
        nextGenCodexTreeViewProvider,
        vscode.commands.registerCommand(
            "nextGenCodexTreeView.openFile",
            async (uri: vscode.Uri) => {
                try {
                    await openCodexFile(uri);
                } catch (error) {
                    console.error("Failed to open codex file:", error);
                    vscode.window.showErrorMessage(`Failed to open codex file: ${error}`);
                }
            }
        ),
        vscode.commands.registerCommand("codexNotebookTreeView.refresh", () =>
            nextGenCodexTreeViewProvider.refresh()
        )
    );

    // Add all disposables to the context subscriptions
    context.subscriptions.push(...disposables);
}
