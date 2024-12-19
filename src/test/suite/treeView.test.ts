import * as assert from "assert";
import * as vscode from "vscode";
import {
    NextGenCodexTreeViewProvider,
    NextGenCodexItem,
} from "../../providers/treeViews/nextGenCodexTreeViewProvider";

suite("NextGenCodexTreeViewProvider Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests for NextGenCodexTreeViewProvider.");
    const context = {} as vscode.ExtensionContext;
    const provider = new NextGenCodexTreeViewProvider(context);

    test("Initialization of NextGenCodexTreeViewProvider", () => {
        assert.ok(provider, "NextGenCodexTreeViewProvider should be initialized successfully");
    });

    test("getTreeItem should return correct TreeItems for different item types", () => {
        const testItems: NextGenCodexItem[] = [
            {
                uri: vscode.Uri.file("/path/to/Genesis.codex"),
                label: "Genesis Codex",
                type: "codexDocument",
            },
            {
                uri: vscode.Uri.file("/path/to/Hebrew.dictionary"),
                label: "Hebrew Dictionary",
                type: "dictionary",
            },
        ];

        testItems.forEach((item) => {
            const treeItem = provider.getTreeItem(item);
            assert.ok(
                treeItem instanceof vscode.TreeItem,
                `getTreeItem should return a TreeItem instance for ${item.type}`
            );
            assert.strictEqual(
                treeItem.label,
                item.label,
                `TreeItem should have the correct label for ${item.type}`
            );

            assert.strictEqual(
                treeItem.collapsibleState,
                vscode.TreeItemCollapsibleState.None,
                `TreeItem should not be collapsible for ${item.type}`
            );

            assert.ok(
                treeItem.iconPath instanceof vscode.ThemeIcon,
                `${item.type} should have an icon`
            );

            if (item.type === "codexDocument") {
                assert.strictEqual(
                    (treeItem.command as vscode.Command).command,
                    "nextGenCodexTreeView.openFile",
                    "Codex document should have correct command"
                );
            } else if (item.type === "dictionary") {
                assert.strictEqual(
                    (treeItem.command as vscode.Command).command,
                    "vscode.open",
                    "Dictionary should have correct command"
                );
            }
        });
    });

    test("getChildren should return correct items", async () => {
        // Mock the file system results
        const mockCodexUris = [
            vscode.Uri.file("/path/to/Genesis.codex"),
            vscode.Uri.file("/path/to/Exodus.codex"),
        ];
        const mockDictUris = [vscode.Uri.file("/path/to/Hebrew.dictionary")];

        // Mock workspace.findFiles
        const originalFindFiles = vscode.workspace.findFiles;
        vscode.workspace.findFiles = async (pattern: vscode.GlobPattern) => {
            if (pattern.toString().includes(".codex")) {
                return mockCodexUris;
            } else if (pattern.toString().includes(".dictionary")) {
                return mockDictUris;
            }
            return [];
        };

        try {
            await provider.refresh();
            const topLevelItems = await provider.getChildren();

            assert.ok(Array.isArray(topLevelItems), "Top level items should be an array");
            assert.strictEqual(topLevelItems.length, 3, "Should have three items total");

            const codexItems = topLevelItems.filter((item) => item.type === "codexDocument");
            const dictItems = topLevelItems.filter((item) => item.type === "dictionary");

            assert.strictEqual(codexItems.length, 2, "Should have two codex items");
            assert.strictEqual(dictItems.length, 1, "Should have one dictionary item");

            assert.strictEqual(
                codexItems[0].label,
                "Genesis Codex",
                "First codex should be Genesis"
            );
            assert.strictEqual(
                codexItems[1].label,
                "Exodus Codex",
                "Second codex should be Exodus"
            );
            assert.strictEqual(
                dictItems[0].label,
                "Hebrew Dictionary",
                "Dictionary should be Hebrew"
            );
        } finally {
            // Restore original findFiles
            vscode.workspace.findFiles = originalFindFiles;
        }
    });
});
