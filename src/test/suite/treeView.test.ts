import * as assert from "assert";
import * as vscode from "vscode";
import {
    CodexNotebookTreeViewProvider,
    CodexNode,
} from "../../providers/treeViews/navigationTreeViewProvider";
import { NotebookMetadataManager } from "../../utils/notebookMetadataManager";

suite("CodexNotebookTreeViewProvider Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests for CodexNotebookTreeViewProvider.");
    const folderPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    const context = {} as vscode.ExtensionContext;
    const provider = new CodexNotebookTreeViewProvider(folderPath, context);

    test("Initialization of CodexNotebookTreeViewProvider", () => {
        assert.ok(provider, "CodexNotebookTreeViewProvider should be initialized successfully");
    });

    test("getTreeItem should return correct TreeItems for different node types", () => {
        const testNodes: CodexNode[] = [
            {
                resource: vscode.Uri.parse("codex-corpus:Old Testament"),
                type: "corpus",
                label: "Old Testament",
            },
            {
                resource: vscode.Uri.file("/path/to/Genesis.codex"),
                type: "document",
                label: "Genesis",
                sourceFileUri: vscode.Uri.file("/path/to/source/Genesis.usfm"),
            },
            {
                resource: vscode.Uri.parse("codex-section:Genesis#chapter1"),
                type: "section",
                label: "Chapter 1",
                cellId: "chapter1",
            },
        ];

        testNodes.forEach((node) => {
            const treeItem = provider.getTreeItem(node);
            assert.ok(
                treeItem instanceof vscode.TreeItem,
                `getTreeItem should return a TreeItem instance for ${node.type}`
            );
            assert.strictEqual(
                treeItem.label,
                node.label,
                `TreeItem should have the correct label for ${node.type}`
            );

            if (node.type !== "section") {
                assert.strictEqual(
                    treeItem.collapsibleState,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    `TreeItem should have the correct collapsible state for ${node.type}`
                );
            } else {
                assert.strictEqual(
                    treeItem.collapsibleState,
                    vscode.TreeItemCollapsibleState.None,
                    `TreeItem should not be collapsible for ${node.type}`
                );
            }

            if (node.type === "document") {
                assert.ok(
                    treeItem.iconPath instanceof vscode.ThemeIcon,
                    "Document node should have an icon"
                );
            }
        });
    });

    test("getChildren should return correct child nodes", async () => {
        // Mock the NotebookMetadataManager
        const mockMetadataManager = {
            getAllMetadata: () => [
                {
                    codexFsPath: "/path/to/Genesis.codex",
                    sourceFsPath: "/path/to/source/Genesis.usfm",
                },
                {
                    codexFsPath: "/path/to/Exodus.codex",
                    sourceFsPath: "/path/to/source/Exodus.usfm",
                },
            ],
        };
        (provider as any).model.notebookMetadataManager = mockMetadataManager;

        const rootNodes = await provider.getChildren();
        assert.ok(Array.isArray(rootNodes), "Root nodes should be an array");
        assert.strictEqual(rootNodes.length, 1, "There should be one root node (Old Testament)");

        const oldTestamentNode = rootNodes[0];
        const bookNodes = await provider.getChildren(oldTestamentNode);
        assert.strictEqual(bookNodes.length, 2, "There should be two book nodes");
        assert.strictEqual(bookNodes[0].label, "Genesis", "First book should be Genesis");
        assert.strictEqual(bookNodes[1].label, "Exodus", "Second book should be Exodus");

        // You might want to add more assertions here to test the structure and content of the tree
    });
});
