import * as vscode from "vscode";
import { CodexCellEditorProvider } from "./codexCellEditorProvider/codexCellEditorProvider";
import { registerSourceControl } from "./sourceControl/sourceControlProvider";
import { CodexNotebookTreeViewProvider } from "../providers/treeViews/navigationTreeViewProvider";

export function registerProviders(context: vscode.ExtensionContext) {
    const disposables: vscode.Disposable[] = [];

    // Register CodexCellEditorProvider
    disposables.push(CodexCellEditorProvider.register(context));

    // Register SourceControlProvider
    const sourceControlProvider = registerSourceControl(context);
    disposables.push(sourceControlProvider);

    // Register CodexNotebookTreeViewProvider
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const codexNotebookTreeViewProvider = new CodexNotebookTreeViewProvider(workspaceRoot, context);
    disposables.push(
        vscode.window.registerTreeDataProvider(
            "codexNotebookTreeView",
            codexNotebookTreeViewProvider
        )
    );

    // Add all disposables to the context subscriptions
    context.subscriptions.push(...disposables);
}
