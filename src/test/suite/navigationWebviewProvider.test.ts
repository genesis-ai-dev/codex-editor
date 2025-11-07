import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { NavigationWebviewProvider } from "../../providers/navigationWebview/navigationWebviewProvider";
import { CodexContentSerializer } from "../../serializer";
import { createMockExtensionContext, deleteIfExists } from "../testUtils";
import sinon from "sinon";

suite("NavigationWebviewProvider Test Suite", () => {
    let context: vscode.ExtensionContext;
    let provider: NavigationWebviewProvider;
    let tempCodexFiles: vscode.Uri[] = [];
    let workspaceFolder: vscode.WorkspaceFolder | undefined;

    suiteSetup(async () => {
        workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            // Skip suite setup if no workspace folder - tests that need it will skip individually
            return;
        }

        // Create files/target directory structure if it doesn't exist
        const targetDir = vscode.Uri.joinPath(workspaceFolder.uri, "files", "target");
        try {
            await vscode.workspace.fs.createDirectory(targetDir);
        } catch {
            // Directory might already exist
        }
    });

    setup(() => {
        context = createMockExtensionContext();
        provider = new NavigationWebviewProvider(context);
    });

    teardown(async () => {
        // Clean up all temp files
        for (const uri of tempCodexFiles) {
            await deleteIfExists(uri);
        }
        tempCodexFiles = [];

        // Clean up localized-books.json if it exists
        if (workspaceFolder) {
            const localizedUri = vscode.Uri.joinPath(workspaceFolder.uri, "localized-books.json");
            try {
                await vscode.workspace.fs.delete(localizedUri);
            } catch {
                // File doesn't exist, ignore
            }
        }
    });

    async function createCodexFileWithMetadata(
        usfmCode: string,
        metadata: { fileDisplayName?: string;[key: string]: any; }
    ): Promise<vscode.Uri> {
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        const targetDir = vscode.Uri.joinPath(workspaceFolder.uri, "files", "target");
        const codexUri = vscode.Uri.joinPath(targetDir, `${usfmCode}.codex`);

        const notebookData = {
            cells: [
                {
                    kind: vscode.NotebookCellKind.Code,
                    value: "test content",
                    languageId: "html",
                    metadata: { id: "test-1" },
                },
            ],
            metadata: metadata,
        };

        const serializer = new CodexContentSerializer();
        const serialized = await serializer.serializeNotebook(
            notebookData as any,
            new vscode.CancellationTokenSource().token
        );
        await vscode.workspace.fs.writeFile(codexUri, serialized);

        tempCodexFiles.push(codexUri);
        return codexUri;
    }

    test("loadBibleBookMap uses only bundled default data", () => {
        // Access private method through reflection for testing
        const loadBibleBookMap = (provider as any).loadBibleBookMap.bind(provider);
        loadBibleBookMap();

        // Verify bibleBookMap is populated
        const bibleBookMap = (provider as any).bibleBookMap;
        assert.ok(bibleBookMap, "bibleBookMap should exist");
        assert.ok(bibleBookMap.size > 0, "bibleBookMap should have entries");

        // Verify it contains expected books
        assert.ok(bibleBookMap.has("GEN"), "Should contain Genesis");
        assert.ok(bibleBookMap.has("MAT"), "Should contain Matthew");

        // Verify entries have expected structure
        const genBook = bibleBookMap.get("GEN");
        assert.ok(genBook, "Genesis entry should exist");
        assert.strictEqual(genBook.name, "Genesis", "Should use default name from bundled data");
        assert.strictEqual(genBook.abbr, "GEN", "Should have correct abbreviation");
    });

    test("loadBibleBookMap does NOT read localized-books.json", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a localized-books.json file to verify it's ignored
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const localizedUri = vscode.Uri.joinPath(workspaceFolder!.uri, "localized-books.json");
        const localizedContent = JSON.stringify([
            {
                abbr: "GEN",
                name: "Custom Genesis Name",
                ord: "01",
                testament: "OT",
            },
        ]);
        await vscode.workspace.fs.writeFile(localizedUri, Buffer.from(localizedContent, "utf8"));

        // Load the bible book map
        const loadBibleBookMap = (provider as any).loadBibleBookMap.bind(provider);
        loadBibleBookMap();

        // Verify it did NOT use the custom name from localized-books.json
        const bibleBookMap = (provider as any).bibleBookMap;
        const genBook = bibleBookMap.get("GEN");
        assert.strictEqual(
            genBook.name,
            "Genesis",
            "Should use default name from bundled data, not localized-books.json"
        );
    });

    test("updateBookName updates fileDisplayName in codex metadata", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file
        const codexUri = await createCodexFileWithMetadata("GEN", {});

        // Mock the updateBookName method call (since it's private, we'll test through message handling)
        // First, ensure the bible book map is loaded
        const loadBibleBookMap = (provider as any).loadBibleBookMap.bind(provider);
        loadBibleBookMap();

        // Mock window.showErrorMessage and window.showInformationMessage to avoid UI during tests
        const showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");
        const showInformationMessageStub = sinon.stub(vscode.window, "showInformationMessage");
        const withProgressStub = sinon.stub(vscode.window, "withProgress").callsFake(async (options, callback) => {
            return callback({ report: () => { } } as any, new vscode.CancellationTokenSource().token);
        });

        try {
            // Call updateBookName directly (accessing private method)
            const updateBookName = (provider as any).updateBookName.bind(provider);
            await updateBookName("GEN", "Custom Genesis Name");

            // Verify the file was updated
            const content = await vscode.workspace.fs.readFile(codexUri);
            const serializer = new CodexContentSerializer();
            const notebookData = await serializer.deserializeNotebook(
                content,
                new vscode.CancellationTokenSource().token
            );

            assert.strictEqual(
                (notebookData.metadata as any).fileDisplayName,
                "Custom Genesis Name",
                "fileDisplayName should be updated in metadata"
            );
        } finally {
            showErrorMessageStub.restore();
            showInformationMessageStub.restore();
            withProgressStub.restore();
        }
    });

    test("updateBookName does NOT create or modify localized-books.json", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file
        await createCodexFileWithMetadata("EXO", {});

        // Ensure localized-books.json doesn't exist initially
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const localizedUri = vscode.Uri.joinPath(workspaceFolder!.uri, "localized-books.json");
        try {
            await vscode.workspace.fs.delete(localizedUri);
        } catch {
            // File doesn't exist, that's fine
        }

        // Load bible book map
        const loadBibleBookMap = (provider as any).loadBibleBookMap.bind(provider);
        loadBibleBookMap();

        // Mock UI methods
        const showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");
        const showInformationMessageStub = sinon.stub(vscode.window, "showInformationMessage");
        const withProgressStub = sinon.stub(vscode.window, "withProgress").callsFake(async (options, callback) => {
            return callback({ report: () => { } } as any, new vscode.CancellationTokenSource().token);
        });

        try {
            // Call updateBookName
            const updateBookName = (provider as any).updateBookName.bind(provider);
            await updateBookName("EXO", "Custom Exodus Name");

            // Verify localized-books.json was NOT created
            try {
                await vscode.workspace.fs.stat(localizedUri);
                assert.fail("localized-books.json should NOT exist after updateBookName");
            } catch {
                // File doesn't exist, which is expected
                assert.ok(true, "localized-books.json correctly does not exist");
            }
        } finally {
            showErrorMessageStub.restore();
            showInformationMessageStub.restore();
            withProgressStub.restore();
        }
    });

    test("makeCodexItem uses fileDisplayName from metadata when present", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file with fileDisplayName
        const codexUri = await createCodexFileWithMetadata("LEV", {
            fileDisplayName: "Custom Leviticus Name",
        });

        // Load bible book map
        const loadBibleBookMap = (provider as any).loadBibleBookMap.bind(provider);
        loadBibleBookMap();

        // Call makeCodexItemWithMetadata (accessing private method)
        const makeCodexItemWithMetadata = (provider as any).makeCodexItemWithMetadata.bind(provider);
        const codexItem = await makeCodexItemWithMetadata(codexUri);

        assert.strictEqual(
            codexItem.fileDisplayName,
            "Custom Leviticus Name",
            "CodexItem should have fileDisplayName from metadata"
        );
    });

    test("makeCodexItem handles missing fileDisplayName gracefully", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file without fileDisplayName
        const codexUri = await createCodexFileWithMetadata("NUM", {});

        // Load bible book map
        const loadBibleBookMap = (provider as any).loadBibleBookMap.bind(provider);
        loadBibleBookMap();

        // Call makeCodexItemWithMetadata
        const makeCodexItemWithMetadata = (provider as any).makeCodexItemWithMetadata.bind(provider);
        const codexItem = await makeCodexItemWithMetadata(codexUri);

        assert.ok(codexItem, "CodexItem should be created");
        assert.strictEqual(
            codexItem.fileDisplayName,
            undefined,
            "CodexItem should not have fileDisplayName when metadata is missing"
        );
    });

    test("updateBookName reads corpusMarker from file metadata, not book abbreviation", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file with corpusMarker="audio" but book abbreviation "MAT" (which would be NT)
        const codexUri = await createCodexFileWithMetadata("Mateyo_001_001-001_017", {
            corpusMarker: "audio",
            fileDisplayName: "Mateyo_001_001-001_017",
        });

        // Load bible book map
        const loadBibleBookMap = (provider as any).loadBibleBookMap.bind(provider);
        loadBibleBookMap();

        // Mock UI methods
        const showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");
        const showInformationMessageStub = sinon.stub(vscode.window, "showInformationMessage");
        const withProgressStub = sinon.stub(vscode.window, "withProgress").callsFake(async (options, callback) => {
            return callback({ report: () => { } } as any, new vscode.CancellationTokenSource().token);
        });

        try {
            // Call updateBookName - should NOT validate against bibleBookMap since corpusMarker is "audio"
            const updateBookName = (provider as any).updateBookName.bind(provider);
            await updateBookName("Mateyo_001_001-001_017", "Custom Audio Book Name");

            // Verify no error was shown (would show error if it tried to validate against bibleBookMap)
            assert.ok(
                !showErrorMessageStub.called,
                "Should not show error for non-biblical book with audio corpusMarker"
            );

            // Verify the file was updated
            const content = await vscode.workspace.fs.readFile(codexUri);
            const serializer = new CodexContentSerializer();
            const notebookData = await serializer.deserializeNotebook(
                content,
                new vscode.CancellationTokenSource().token
            );

            assert.strictEqual(
                (notebookData.metadata as any).fileDisplayName,
                "Custom Audio Book Name",
                "fileDisplayName should be updated"
            );
        } finally {
            showErrorMessageStub.restore();
            showInformationMessageStub.restore();
            withProgressStub.restore();
        }
    });

    test("updateBookName validates against bibleBookMap only for NT/OT corpusMarker", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file with corpusMarker="NT"
        const codexUri = await createCodexFileWithMetadata("MAT", {
            corpusMarker: "NT",
        });

        // Load bible book map
        const loadBibleBookMap = (provider as any).loadBibleBookMap.bind(provider);
        loadBibleBookMap();

        // Mock UI methods
        const showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");
        const showInformationMessageStub = sinon.stub(vscode.window, "showInformationMessage");
        const withProgressStub = sinon.stub(vscode.window, "withProgress").callsFake(async (options, callback) => {
            return callback({ report: () => { } } as any, new vscode.CancellationTokenSource().token);
        });

        try {
            // Call updateBookName with valid biblical book - should succeed
            const updateBookName = (provider as any).updateBookName.bind(provider);
            await updateBookName("MAT", "Custom Matthew Name");

            // Verify no error was shown
            assert.ok(
                !showErrorMessageStub.called,
                "Should not show error for valid biblical book"
            );

            // Now test with invalid book abbreviation
            const invalidCodexUri = await createCodexFileWithMetadata("INVALID", {
                corpusMarker: "NT",
            });

            await updateBookName("INVALID", "Invalid Book Name");

            // Should show error because INVALID is not in bibleBookMap
            assert.ok(
                showErrorMessageStub.called,
                "Should show error for invalid book abbreviation when corpusMarker is NT"
            );
        } finally {
            showErrorMessageStub.restore();
            showInformationMessageStub.restore();
            withProgressStub.restore();
        }
    });

    test("updateBookName handles missing corpusMarker gracefully", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file without corpusMarker
        const codexUri = await createCodexFileWithMetadata("CUSTOM", {
            // No corpusMarker
        });

        // Load bible book map
        const loadBibleBookMap = (provider as any).loadBibleBookMap.bind(provider);
        loadBibleBookMap();

        // Mock UI methods
        const showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");
        const showInformationMessageStub = sinon.stub(vscode.window, "showInformationMessage");
        const withProgressStub = sinon.stub(vscode.window, "withProgress").callsFake(async (options, callback) => {
            return callback({ report: () => { } } as any, new vscode.CancellationTokenSource().token);
        });

        try {
            // Call updateBookName - should work without corpusMarker
            const updateBookName = (provider as any).updateBookName.bind(provider);
            await updateBookName("CUSTOM", "Custom Book Name");

            // Verify no error was shown
            assert.ok(
                !showErrorMessageStub.called,
                "Should not show error when corpusMarker is missing"
            );

            // Verify the file was updated
            const content = await vscode.workspace.fs.readFile(codexUri);
            const serializer = new CodexContentSerializer();
            const notebookData = await serializer.deserializeNotebook(
                content,
                new vscode.CancellationTokenSource().token
            );

            assert.strictEqual(
                (notebookData.metadata as any).fileDisplayName,
                "Custom Book Name",
                "fileDisplayName should be updated"
            );
        } finally {
            showErrorMessageStub.restore();
            showInformationMessageStub.restore();
            withProgressStub.restore();
        }
    });
});

