import * as assert from "assert";
import * as vscode from "vscode";
import {
    CodexNotebookTreeViewProvider,
    Node,
} from "../../providers/treeViews/scriptureTreeViewProvider";

suite("ScriptureTreeViewProvider Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests for ScriptureTreeViewProvider.");

    test("Initialization of CodexNotebookProvider", () => {
        const folderPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const provider = new CodexNotebookTreeViewProvider(folderPath);
        assert.ok(provider, "CodexNotebookProvider should be initialized successfully");
    });

    test("getTreeItem should return a Node", () => {
        const folderPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const provider = new CodexNotebookTreeViewProvider(folderPath);
        const testNode = new Node("Genesis", "corpus", vscode.TreeItemCollapsibleState.Collapsed);
        const treeItem = provider.getTreeItem(testNode);
        assert.ok(
            treeItem instanceof vscode.TreeItem,
            "getTreeItem should return a TreeItem instance"
        );
        assert.strictEqual(treeItem.label, "Genesis", "TreeItem should have the label 'Genesis'");
    });
});
