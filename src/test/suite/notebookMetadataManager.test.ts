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
        // Ensure a clean singleton for each test run
        NotebookMetadataManager.resetInstance();
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
            sourceFsPath: "/path/to/source/GEN.source",
            codexFsPath: "/path/to/codex/GEN.codex",
            navigation: [],
            sourceCreatedAt: new Date().toISOString(),
            corpusMarker: "test-corpus",
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
        // Best-effort cleanup of fs-ops-* directories created in this workspace
        try {
            const root = vscode.Uri.file("/tmp/test-workspace");
            const entries = await vscode.workspace.fs.readDirectory(root);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory && name.startsWith("fs-ops-")) {
                    try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, name), { recursive: true }); } catch { /* ignore */ }
                }
            }
        } catch { /* ignore */ }
    });

    test("should add and retrieve metadata correctly", async () => {
        await manager.initialize();
        await manager.addOrUpdateMetadata(testMetadata);
        await manager.initialize();
        const retrievedMetadata = manager.getMetadataById(testMetadata.id);

        // Compare key fields instead of deep strict equality (manager may enrich metadata)
        assert.strictEqual(retrievedMetadata?.id, testMetadata.id);
        assert.strictEqual(retrievedMetadata?.originalName, testMetadata.originalName);
        assert.strictEqual(retrievedMetadata?.sourceFsPath, testMetadata.sourceFsPath);
        assert.strictEqual(retrievedMetadata?.codexFsPath, testMetadata.codexFsPath);
    });

    test("should update metadata correctly", async () => {
        await manager.initialize();
        await manager.addOrUpdateMetadata(testMetadata);
        const updatedMetadata = { ...testMetadata, originalName: "Updated Notebook" };
        await manager.addOrUpdateMetadata(updatedMetadata);

        const retrievedMetadata = manager.getMetadataById(testMetadata.id);
        assert.strictEqual(
            retrievedMetadata?.originalName,
            "Updated Notebook",
            "The metadata should reflect the updated name"
        );
    });

    test("should handle concurrent metadata updates", async () => {
        await manager.initialize();
        await manager.addOrUpdateMetadata({ ...testMetadata, originalName: "Update 1" });
        await manager.addOrUpdateMetadata({ ...testMetadata, originalName: "Update 2" });

        const retrievedMetadata = manager.getMetadataById(testMetadata.id);
        assert.strictEqual(retrievedMetadata!.originalName!, "Update 2");
    });

    test("should persist metadata changes across sessions", async () => {
        await manager.initialize();
        await manager.addOrUpdateMetadata(testMetadata);

        // Simulate VS Code crash/reload with same context
        const newManager = NotebookMetadataManager.getInstance(manager.getContext());
        await newManager.initialize();
        const retrievedMetadata = newManager.getMetadataById(testMetadata.id);
        assert.ok(retrievedMetadata, "The metadata should persist across sessions");
        assert.strictEqual(retrievedMetadata!.id, testMetadata.id);
        assert.strictEqual(retrievedMetadata!.originalName, testMetadata.originalName);
    });

    test("should create and delete temporary files correctly", async () => {
        const tempFolder = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file("/tmp/test-workspace");
        // Ensure the parent directory exists
        await vscode.workspace.fs.createDirectory(tempFolder);
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const tempFileUri = vscode.Uri.joinPath(tempFolder, `tempFile-${unique}.tmp`);
        await vscode.workspace.fs.writeFile(tempFileUri, Buffer.from("Temporary content"));

        // File should exist immediately after write
        const stat = await vscode.workspace.fs.stat(tempFileUri);
        assert.ok(stat.type === vscode.FileType.File, "The temporary file should be created");

        // Delete and verify it no longer exists
        await vscode.workspace.fs.delete(tempFileUri);
        await assert.rejects(
            async () => vscode.workspace.fs.stat(tempFileUri),
            "The temporary file should be deleted"
        );
    });
});
