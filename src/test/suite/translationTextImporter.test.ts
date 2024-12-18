import * as assert from "assert";
import * as vscode from "vscode";
import { importTranslations } from "../../projectManager/translationTextImporter";
import { NotebookMetadataManager, getNotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { CodexContentSerializer } from "../../serializer";

// Add mock classes and helper function
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
        secrets: {
            get: async (key: string) => undefined,
            store: async (key: string, value: string) => {},
            delete: async (key: string) => {},
            onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
        },
        environmentVariableCollection: {
            persistent: true,
            description: 'Mock Environment Collection',
            append: () => {},
            prepend: () => {},
            replace: () => {},
            get: () => undefined,
            forEach: () => {},
            delete: () => {},
            clear: () => {},
            [Symbol.iterator]: function* () { yield* []; },
            getScoped: () => ({
                persistent: true,
                description: 'Mock Scoped Environment Collection',
                append: () => {},
                prepend: () => {},
                replace: () => {},
                get: () => undefined,
                forEach: () => {},
                delete: () => {},
                clear: () => {},
                [Symbol.iterator]: function* () { yield* []; },
            }),
        },
        storageUri: vscode.Uri.file(''),
        globalStorageUri: vscode.Uri.file(''),
        logUri: vscode.Uri.file(''),
        extensionMode: vscode.ExtensionMode.Test
    };
    return partial as vscode.ExtensionContext;
};

suite("TranslationTextImporter Test Suite", () => {
    let tempSourceUri: vscode.Uri;
    let tempTranslationUri: vscode.Uri;
    let workspaceUri: vscode.Uri;

    suiteSetup(async () => {
        // Ensure a temporary workspace folder is available
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await vscode.workspace.updateWorkspaceFolders(0, 0, {
                uri: vscode.Uri.file("/tmp/test-workspace"),
            });
        }
        workspaceUri = vscode.workspace.workspaceFolders![0].uri;
    });

    setup(async () => {
        // Create a test source file before each test
        tempSourceUri = vscode.Uri.joinPath(workspaceUri, "test.usfm");
        const sourceContent = "\\id GEN\n\\h Genesis\n\\c 1\n\\v 1 In the beginning...";
        await vscode.workspace.fs.writeFile(tempSourceUri, Buffer.from(sourceContent));

        // Create a test translation file
        tempTranslationUri = vscode.Uri.joinPath(workspaceUri, "translation.txt");
        const translationContent = "In principio...";
        await vscode.workspace.fs.writeFile(tempTranslationUri, Buffer.from(translationContent));
    });

    teardown(async () => {
        // Cleanup after each test
        try {
            await vscode.workspace.fs.delete(tempSourceUri, { recursive: true });
            await vscode.workspace.fs.delete(tempTranslationUri, { recursive: true });
        } catch (error) {
            console.error("Cleanup failed:", error);
        }
    });

    test("should create matching .source and .codex notebooks", async () => {
        NotebookMetadataManager.resetInstance();
        const metadataManager = NotebookMetadataManager.getInstance(createMockContext());

        const sourceNotebookId = "test-notebook";
        const progress = { report: (message: { message?: string }) => console.log(message) };
        const token = new vscode.CancellationTokenSource().token;

        await importTranslations(
            {} as vscode.ExtensionContext,
            tempTranslationUri,
            sourceNotebookId,
            progress,
            token
        );

        const sourceMetadata = metadataManager.getMetadataById(sourceNotebookId);
        assert.ok(sourceMetadata, "Source metadata should exist");

        const codexUri = vscode.Uri.file(sourceMetadata!.codexFsPath!);
        const serializer = new CodexContentSerializer();
        const codexNotebook = await serializer.deserializeNotebook(
            await vscode.workspace.fs.readFile(codexUri),
            token
        );

        assert.ok(codexNotebook, "Codex notebook should be created");
        assert.strictEqual(
            codexNotebook.cells.length > 0,
            true,
            "Codex notebook should have cells"
        );
    });
});
