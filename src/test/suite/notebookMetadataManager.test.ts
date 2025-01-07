import * as assert from "assert";
import * as vscode from "vscode";
import { NotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { CustomNotebookMetadata } from "../../../types";

suite("NotebookMetadataManager Test Suite", () => {
    let manager: NotebookMetadataManager;
    let testMetadata: CustomNotebookMetadata;
    let tempUri: vscode.Uri;

    suiteSetup(async () => {
        // Ensure a temporary workspace folder is available
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await vscode.workspace.updateWorkspaceFolders(0, 0, {
                uri: vscode.Uri.file("/tmp/test-workspace"),
            });
        }
    });

    setup(async () => {
        // Create mock extension context with required properties
        class MockMemento implements vscode.Memento {
            private storage = new Map<string, any>();

            get<T>(key: string): T | undefined;
            get<T>(key: string, defaultValue: T): T;
            get<T>(key: string, defaultValue?: T): T | undefined {
                return this.storage.get(key) ?? defaultValue;
            }

            update(key: string, value: any): Thenable<void> {
                this.storage.set(key, value);
                return Promise.resolve();
            }

            keys(): readonly string[] {
                return Array.from(this.storage.keys());
            }

            setKeysForSync(keys: readonly string[]): void {
                // No-op for testing
            }
        }

        const mockContext: Partial<vscode.ExtensionContext> = {
            globalStorageUri: vscode.Uri.file("/tmp/test-workspace"),
            subscriptions: [],
            workspaceState: new MockMemento(),
            globalState: new MockMemento(),
            extensionUri: vscode.Uri.file("/tmp/test-workspace"),
            storageUri: vscode.Uri.file("/tmp/test-workspace/storage"),
        };

        manager = NotebookMetadataManager.getInstance(mockContext as vscode.ExtensionContext);
        testMetadata = {
            id: "test-id",
            originalName: "Test Notebook",
            sourceFsPath: "/path/to/source",
            codexFsPath: "/path/to/codex",
            navigation: [],
            sourceCreatedAt: new Date().toISOString(),
            corpusMarker: "test-corpus",
            gitStatus: "untracked",
        };

        // Create a temporary file for testing
        const tempDir = vscode.workspace.workspaceFolders![0].uri;
        tempUri = vscode.Uri.joinPath(tempDir, "test.metadata.json");
        const content = JSON.stringify([testMetadata], null, 2);
        await vscode.workspace.fs.writeFile(tempUri, Buffer.from(content));
    });

    teardown(async () => {
        // Clean up the temporary file
        if (tempUri) {
            try {
                await vscode.workspace.fs.delete(tempUri);
            } catch (error) {
                console.error("Failed to delete temporary file:", error);
            }
        }
    });

    test("should add and retrieve metadata correctly", async () => {
        await manager.addOrUpdateMetadata(testMetadata);
        const retrievedMetadata = await manager.getMetadata(testMetadata.id);

        assert.deepStrictEqual(
            retrievedMetadata,
            testMetadata,
            "The retrieved metadata should match the added metadata"
        );
    });

    test("should update metadata correctly", async () => {
        await manager.addOrUpdateMetadata(testMetadata);
        const updatedMetadata = { ...testMetadata, originalName: "Updated Notebook" };
        await manager.addOrUpdateMetadata(updatedMetadata);

        const retrievedMetadata = await manager.getMetadata(testMetadata.id);
        assert.strictEqual(
            retrievedMetadata?.originalName,
            "Updated Notebook",
            "The metadata should reflect the updated name"
        );
    });

    test("should handle concurrent metadata updates", async () => {
        const updates = [
            manager.addOrUpdateMetadata({ ...testMetadata, originalName: "Update 1" }),
            manager.addOrUpdateMetadata({ ...testMetadata, originalName: "Update 2" }),
        ];

        await Promise.all(updates);

        const retrievedMetadata = await manager.getMetadata(testMetadata.id);
        assert.ok(
            ["Update 1", "Update 2"].includes(retrievedMetadata!.originalName!),
            "The metadata should reflect one of the concurrent updates"
        );
    });

    test("should persist metadata changes across sessions", async () => {
        await manager.addOrUpdateMetadata(testMetadata);

        // Simulate VS Code crash/reload with same context
        const newManager = NotebookMetadataManager.getInstance(manager.getContext());
        await newManager.initialize();

        const retrievedMetadata = await newManager.getMetadata(testMetadata.id);
        assert.deepStrictEqual(
            retrievedMetadata,
            testMetadata,
            "The metadata should persist across sessions"
        );
    });

    test("should create and delete temporary files correctly", async () => {
        const tempFileUri = vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders![0].uri,
            "tempFile.tmp"
        );
        await vscode.workspace.fs.writeFile(tempFileUri, Buffer.from("Temporary content"));

        const stat = await vscode.workspace.fs.stat(tempFileUri);
        assert.ok(stat.type === vscode.FileType.File, "The temporary file should be created");

        await vscode.workspace.fs.delete(tempFileUri);
        await assert.rejects(
            async () => await vscode.workspace.fs.stat(tempFileUri),
            "The temporary file should be deleted"
        );
    });
});
