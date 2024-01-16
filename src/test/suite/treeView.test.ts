import * as assert from "assert";
import * as vscode from "vscode";
import {
    CodexNotebookProvider,
    Node,
} from "../../tree-view/scriptureTreeViewProvider";

suite("ScriptureTreeViewProvider Test Suite", () => {
    vscode.window.showInformationMessage(
        "Start all tests for ScriptureTreeViewProvider.",
    );

    test("Initialization of CodexNotebookProvider", () => {
        const folderPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const provider = new CodexNotebookProvider(folderPath);
        assert.ok(
            provider,
            "CodexNotebookProvider should be initialized successfully",
        );
    });

    test("getTreeItem should return a Node", () => {
        const folderPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const provider = new CodexNotebookProvider(folderPath);
        const testNode = new Node(
            "Genesis",
            "notebook",
            vscode.TreeItemCollapsibleState.Collapsed,
        );
        const treeItem = provider.getTreeItem(testNode);
        assert.ok(
            treeItem instanceof vscode.TreeItem,
            "getTreeItem should return a TreeItem instance",
        );
        assert.strictEqual(
            treeItem.label,
            "Genesis",
            "TreeItem should have the label 'Genesis'",
        );
    });
});
