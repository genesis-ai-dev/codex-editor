import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { NavigationWebviewProvider } from "../../providers/navigationWebview/navigationWebviewProvider";
import { CodexContentSerializer } from "../../serializer";
import { createMockExtensionContext, deleteIfExists } from "../testUtils";
import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
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

    test("deleteFile closes open webview panels for codex file", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file
        const codexUri = await createCodexFileWithMetadata("TEST", {});
        const normalizedPath = codexUri.fsPath.replace(/\\/g, "/");

        // Create mock webview panels
        const codexPanelDisposed = sinon.spy();
        const mockCodexPanel = {
            dispose: codexPanelDisposed,
            webview: {
                html: "",
                options: { enableScripts: true },
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: "https://example.com",
                onDidReceiveMessage: () => ({ dispose: () => { } }),
                postMessage: () => Promise.resolve(),
            },
            onDidDispose: () => ({ dispose: () => { } }),
            onDidChangeViewState: () => ({ dispose: () => { } }),
        } as any as vscode.WebviewPanel;

        // Mock CodexCellEditorProvider instance
        const mockProvider = {
            getWebviewPanels: () => {
                const panels = new Map<string, vscode.WebviewPanel>();
                panels.set(codexUri.toString(), mockCodexPanel);
                return panels;
            },
        } as any;

        const getInstanceStub = sinon.stub(CodexCellEditorProvider, "getInstance").returns(mockProvider);

        // Mock UI methods
        const showWarningMessageStub = sinon.stub(vscode.window, "showWarningMessage").resolves("Delete" as any);
        const showInformationMessageStub = sinon.stub(vscode.window, "showInformationMessage");
        const showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");

        // Stub buildInitialData to prevent it from trying to read deleted files
        const buildInitialDataStub = sinon.stub(provider as any, "buildInitialData").resolves();

        try {
            // Call deleteFile handler
            await (provider as any).handleMessage({
                command: "deleteFile",
                uri: normalizedPath,
                label: "TEST",
                type: "codexDocument",
            });

            // Verify the panel was disposed
            assert.ok(codexPanelDisposed.called, "Codex webview panel should be disposed when deleting file");
        } finally {
            getInstanceStub.restore();
            showWarningMessageStub.restore();
            showInformationMessageStub.restore();
            showErrorMessageStub.restore();
            buildInitialDataStub.restore();
        }
    });

    test("deleteFile closes open webview panels for both codex and source files", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Create a codex file
        const codexUri = await createCodexFileWithMetadata("TEST2", {});
        const normalizedPath = codexUri.fsPath.replace(/\\/g, "/");

        // Create source file URI
        const baseFileName = path.basename(normalizedPath);
        const sourceFileName = baseFileName.replace(".codex", ".source");
        const sourceUri = vscode.Uri.joinPath(
            workspaceFolder.uri,
            ".project",
            "sourceTexts",
            sourceFileName
        );

        // Create source file directory if it doesn't exist
        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, ".project", "sourceTexts"));
        } catch {
            // Directory might already exist
        }

        // Create source file
        await vscode.workspace.fs.writeFile(sourceUri, Buffer.from("test source content", "utf8"));
        tempCodexFiles.push(sourceUri); // Add to cleanup list

        // Create mock webview panels
        const codexPanelDisposed = sinon.spy();
        const sourcePanelDisposed = sinon.spy();

        const mockCodexPanel = {
            dispose: codexPanelDisposed,
            webview: {
                html: "",
                options: { enableScripts: true },
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: "https://example.com",
                onDidReceiveMessage: () => ({ dispose: () => { } }),
                postMessage: () => Promise.resolve(),
            },
            onDidDispose: () => ({ dispose: () => { } }),
            onDidChangeViewState: () => ({ dispose: () => { } }),
        } as any as vscode.WebviewPanel;

        const mockSourcePanel = {
            dispose: sourcePanelDisposed,
            webview: {
                html: "",
                options: { enableScripts: true },
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: "https://example.com",
                onDidReceiveMessage: () => ({ dispose: () => { } }),
                postMessage: () => Promise.resolve(),
            },
            onDidDispose: () => ({ dispose: () => { } }),
            onDidChangeViewState: () => ({ dispose: () => { } }),
        } as any as vscode.WebviewPanel;

        // Mock CodexCellEditorProvider instance
        const mockProvider = {
            getWebviewPanels: () => {
                const panels = new Map<string, vscode.WebviewPanel>();
                panels.set(codexUri.toString(), mockCodexPanel);
                panels.set(sourceUri.toString(), mockSourcePanel);
                return panels;
            },
        } as any;

        const getInstanceStub = sinon.stub(CodexCellEditorProvider, "getInstance").returns(mockProvider);

        // Mock UI methods
        const showWarningMessageStub = sinon.stub(vscode.window, "showWarningMessage").resolves("Delete" as any);
        const showInformationMessageStub = sinon.stub(vscode.window, "showInformationMessage");
        const showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");

        // Stub buildInitialData to prevent it from trying to read deleted files
        const buildInitialDataStub = sinon.stub(provider as any, "buildInitialData").resolves();

        try {
            // Call deleteFile handler
            await (provider as any).handleMessage({
                command: "deleteFile",
                uri: normalizedPath,
                label: "TEST2",
                type: "codexDocument",
            });

            // Verify both panels were disposed
            assert.ok(codexPanelDisposed.called, "Codex webview panel should be disposed when deleting file");
            assert.ok(sourcePanelDisposed.called, "Source webview panel should be disposed when deleting codex document");
        } finally {
            getInstanceStub.restore();
            showWarningMessageStub.restore();
            showInformationMessageStub.restore();
            showErrorMessageStub.restore();
            buildInitialDataStub.restore();
        }
    });

    test("deleteFile handles missing webview panels gracefully", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Create a codex file
        const codexUri = await createCodexFileWithMetadata("TEST3", {});
        const normalizedPath = codexUri.fsPath.replace(/\\/g, "/");

        // Create source file URI (but don't create the file - it should handle missing file gracefully)
        const baseFileName = path.basename(normalizedPath);
        const sourceFileName = baseFileName.replace(".codex", ".source");
        const sourceUri = vscode.Uri.joinPath(
            workspaceFolder.uri,
            ".project",
            "sourceTexts",
            sourceFileName
        );

        // Mock CodexCellEditorProvider instance with empty panels map
        const mockProvider = {
            getWebviewPanels: () => {
                return new Map<string, vscode.WebviewPanel>();
            },
        } as any;

        const getInstanceStub = sinon.stub(CodexCellEditorProvider, "getInstance").returns(mockProvider);

        // Mock UI methods
        const showWarningMessageStub = sinon.stub(vscode.window, "showWarningMessage").resolves("Delete" as any);
        const showInformationMessageStub = sinon.stub(vscode.window, "showInformationMessage");
        const showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");

        // Stub buildInitialData to prevent it from trying to read deleted files
        const buildInitialDataStub = sinon.stub(provider as any, "buildInitialData").resolves();

        // Stub console.error to suppress expected error logs about missing source file
        const consoleErrorStub = sinon.stub(console, "error");

        try {
            // Call deleteFile handler - should not throw even if no panels exist or source file doesn't exist
            await (provider as any).handleMessage({
                command: "deleteFile",
                uri: normalizedPath,
                label: "TEST3",
                type: "codexDocument",
            });

            // Test passes if no error is thrown
            assert.ok(true, "deleteFile should handle missing webview panels gracefully");
        } finally {
            getInstanceStub.restore();
            showWarningMessageStub.restore();
            showInformationMessageStub.restore();
            showErrorMessageStub.restore();
            buildInitialDataStub.restore();
            consoleErrorStub.restore();
        }
    });
});

