import * as assert from "assert";
import * as vscode from "vscode";
import { NotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { CustomNotebookMetadata } from "../../../types";

class MockMemento implements vscode.Memento {
    private storage = new Map<string, any>();

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get(key: string, defaultValue?: any) {
        return this.storage.get(key) ?? defaultValue;
    }

    async update(key: string, value: any): Promise<void> {
        this.storage.set(key, value);
    }

    keys(): readonly string[] {
        return Array.from(this.storage.keys());
    }

    setKeysForSync(keys: readonly string[]): void {
        // No-op implementation for testing
    }
}

class MockSecretStorage implements vscode.SecretStorage {
    private storage = new Map<string, string>();
    private _onDidChange = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
    readonly onDidChange = this._onDidChange.event;

    async get(key: string): Promise<string | undefined> {
        return this.storage.get(key);
    }

    async store(key: string, value: string): Promise<void> {
        this.storage.set(key, value);
        this._onDidChange.fire({ key });
    }

    async delete(key: string): Promise<void> {
        this.storage.delete(key);
        this._onDidChange.fire({ key });
    }
}

class MockEnvironmentVariableCollection implements vscode.GlobalEnvironmentVariableCollection {
    private entries = new Map<string, vscode.EnvironmentVariableMutator>();
    
    persistent: boolean = true;
    description: string = 'Mock Environment Collection';
    
    *[Symbol.iterator](): Iterator<[string, vscode.EnvironmentVariableMutator]> {
        yield* this.entries.entries();
    }
    
    getScoped(): vscode.EnvironmentVariableCollection {
        return {
            *[Symbol.iterator](): Iterator<[string, vscode.EnvironmentVariableMutator]> {
                yield* this.entries.entries();
            },
            append: this.append.bind(this),
            prepend: this.prepend.bind(this),
            replace: this.replace.bind(this),
            get: this.get.bind(this),
            forEach: this.forEach.bind(this),
            delete: this.delete.bind(this),
            clear: this.clear.bind(this),
            persistent: this.persistent,
            description: this.description
        };
    }

    replace(variable: string, value: string): void {
        this.entries.set(variable, { 
            value, 
            type: vscode.EnvironmentVariableMutatorType.Replace,
            options: {}
        });
    }

    append(variable: string, value: string): void {
        this.entries.set(variable, { 
            value, 
            type: vscode.EnvironmentVariableMutatorType.Append,
            options: {}
        });
    }

    prepend(variable: string, value: string): void {
        this.entries.set(variable, { 
            value, 
            type: vscode.EnvironmentVariableMutatorType.Prepend,
            options: {}
        });
    }

    get(variable: string): vscode.EnvironmentVariableMutator | undefined {
        return this.entries.get(variable);
    }

    forEach(callback: (variable: string, mutator: vscode.EnvironmentVariableMutator, collection: vscode.EnvironmentVariableCollection) => any, thisArg?: any): void {
        this.entries.forEach((mutator, variable) => {
            callback.call(thisArg, variable, mutator, this.getScoped());
        });
    }

    delete(variable: string): void {
        this.entries.delete(variable);
    }

    clear(): void {
        this.entries.clear();
    }
}

const createMockContext = (): vscode.ExtensionContext => {
    const partial: Partial<vscode.ExtensionContext> = {
        subscriptions: [],
        workspaceState: new MockMemento(),
        globalState: new MockMemento(),
        extensionUri: vscode.Uri.file(''),
        extensionPath: '',
        asAbsolutePath: (path: string) => path,
        storagePath: '',
        globalStoragePath: '',
        logPath: '',
        secrets: new MockSecretStorage(),
        environmentVariableCollection: new MockEnvironmentVariableCollection(),
        storageUri: vscode.Uri.file(''),
        globalStorageUri: vscode.Uri.file(''),
        logUri: vscode.Uri.file(''),
        extensionMode: vscode.ExtensionMode.Test
    };
    return partial as vscode.ExtensionContext;
};

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
        NotebookMetadataManager.resetInstance();
        // Create a mock context for testing
        const mockContext = createMockContext();
        manager = NotebookMetadataManager.getInstance(mockContext);
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

        // Simulate VS Code crash/reload
        NotebookMetadataManager.resetInstance();
        const newManager = NotebookMetadataManager.getInstance(createMockContext());
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
