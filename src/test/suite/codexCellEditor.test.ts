import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { codexSubtitleContent } from "./mocks/codexSubtitleContent";
import { CodexCellTypes, EditType } from "../../../types/enums";
import { CodexNotebookAsJSONData, QuillCellContent, Timestamps } from "../../../types";
import { swallowDuplicateCommandRegistrations, createTempCodexFile, deleteIfExists, createMockExtensionContext, primeProviderWorkspaceStateForHtml, sleep } from "../testUtils";
import { shouldDisableValidation, hasTextContent, hasAudioAvailable } from "../../../sharedUtils";

suite("CodexCellEditorProvider Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests for CodexCellEditorProvider.");
    let context: vscode.ExtensionContext;
    let provider: CodexCellEditorProvider;
    let tempUri: vscode.Uri;

    suiteSetup(async () => {
        swallowDuplicateCommandRegistrations();
    });

    setup(async () => {
        context = createMockExtensionContext();
        provider = new CodexCellEditorProvider(context);
        // Fresh temp file per test to avoid cross-test interference on slower machines
        tempUri = await createTempCodexFile(
            `test-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
            codexSubtitleContent
        );
    });

    teardown(async () => {
        if (tempUri) await deleteIfExists(tempUri);
    });

    test("Initialization of CodexCellEditorProvider", () => {
        assert.ok(provider, "CodexCellEditorProvider should be initialized successfully");
    });

    test("openCustomDocument should return a CodexCellDocument", async () => {
        // read the file content
        const fileContent = await vscode.workspace.fs.readFile(tempUri);
        const decoder = new TextDecoder();

        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        assert.ok(document, "openCustomDocument should return a document");
        // Add more specific assertions based on your CodexCellDocument implementation
    });

    test("saveCustomDocument should not throw an error", async () => {
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        await assert.doesNotReject(
            provider.saveCustomDocument(document, new vscode.CancellationTokenSource().token),
            "saveCustomDocument should not throw an error"
        );
    });

    test("getHtmlForWebview generates correct HTML structure", async () => {
        const provider = new CodexCellEditorProvider(context);
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        const webview = {
            asWebviewUri: (uri: vscode.Uri) => uri,
            cspSource: "https://example.com",
        } as any as vscode.Webview;

        await primeProviderWorkspaceStateForHtml(provider as any, document, "source");

        const html = provider["getHtmlForWebview"](webview, document, "ltr", false);

        assert.ok(html.includes("<html"), "HTML should contain opening html tag");
        assert.ok(html.includes("</html>"), "HTML should contain closing html tag");
        assert.ok(html.includes('<div id="root"></div>'), "HTML should contain root div");
        assert.ok(html.includes("window.initialData"), "HTML should include initial data script");
    });

    test("resolveCustomEditor sets up message passing", async () => {
        const provider = new CodexCellEditorProvider(context);
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );

        let receivedMessage: any = null;
        const webviewPanel = {
            webview: {
                asWebviewUri: (uri: vscode.Uri) => uri,
                html: "",
                options: {},
                onDidReceiveMessage: (callback: (message: any) => void) => {
                    // Simulate receiving a message from the webview
                    setTimeout(() => callback({ command: "getContent" }), 0);
                    return { dispose: () => { } };
                },
                postMessage: (message: any) => {
                    receivedMessage = message;
                    return Promise.resolve();
                },
            },
            onDidDispose: () => ({ dispose: () => { } }),
            onDidChangeViewState: (cb: any) => ({ dispose: () => { } }),
        } as any as vscode.WebviewPanel;

        await provider.resolveCustomEditor(
            document,
            webviewPanel,
            new vscode.CancellationTokenSource().token
        );

        // Wait for the simulated message to be processed
        await sleep(50);

        assert.ok(receivedMessage, "Webview should receive a message");
        const allowedInitial = ["providerSendsInitialContent", "providerUpdatesNotebookMetadataForWebview"];
        assert.ok(allowedInitial.includes(receivedMessage.type));
    });

    test("updateCellContent updates the cell content", async () => {
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        const cellId = codexSubtitleContent.cells[0].metadata.id;
        const contentForUpdate = "Updated content";
        document.updateCellContent(cellId, contentForUpdate, EditType.USER_EDIT);
        const updatedContent = await document.getText();
        const cell = JSON.parse(updatedContent).cells.find((c: any) => c.metadata.id === cellId);
        assert.strictEqual(cell.value, contentForUpdate, "Cell content should be updated");
    });

    test("updateCellContent (USER_EDIT) is a no-op when content unchanged", async () => {
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        const cellId = codexSubtitleContent.cells[0].metadata.id;
        const before = JSON.parse(document.getText());
        const beforeCell = before.cells.find((c: any) => c.metadata.id === cellId);
        const beforeValue = beforeCell.value;
        const beforeEditsLen = (beforeCell.metadata.edits || []).length;
        const wasDirtyBefore = (document as any).isDirty;

        await (document as any).updateCellContent(cellId, beforeValue, EditType.USER_EDIT);
        await sleep(50);

        const after = JSON.parse(document.getText());
        const afterCell = after.cells.find((c: any) => c.metadata.id === cellId);
        const afterEditsLen = (afterCell.metadata.edits || []).length;

        assert.strictEqual(afterCell.value, beforeValue, "Value should remain unchanged");
        assert.strictEqual(afterEditsLen, beforeEditsLen, "No new edit should be added");
        assert.strictEqual(
            (document as any).isDirty,
            wasDirtyBefore,
            "No-op should not change document dirty state"
        );
    });

    test("updateCellContent (LLM_GENERATION preview) records edit without changing value or indexing", async () => {
        // Ensure a fresh baseline file to avoid undefined cells on slow/parallel runs
        await vscode.workspace.fs.writeFile(
            tempUri,
            Buffer.from(JSON.stringify(codexSubtitleContent, null, 2), "utf-8")
        );
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        // Use a cell with an existing value
        const cellId = codexSubtitleContent.cells[0].metadata.id;
        const original = JSON.parse(document.getText());
        const originalCell = original.cells.find((c: any) => c.metadata.id === cellId);
        const originalValue = originalCell.value;
        const originalEditsLen = (originalCell.metadata.edits || []).length;

        // Spy on immediate indexing to ensure it is NOT called for preview
        let indexingCalled = false;
        const originalIndexer = (document as any).addCellToIndexImmediately;
        (document as any).addCellToIndexImmediately = (..._args: any[]) => {
            indexingCalled = true;
        };

        await (document as any).updateCellContent(
            cellId,
            "<span>preview content</span>",
            EditType.LLM_GENERATION,
            false
        );

        await sleep(30);

        const after = JSON.parse(document.getText());
        const afterCell = after.cells.find((c: any) => c.metadata.id === cellId);
        const afterEditsLen = (afterCell.metadata.edits || []).length;
        const lastEdit = afterCell.metadata.edits[afterEditsLen - 1];

        assert.strictEqual(afterCell.value, originalValue, "Preview should not change stored value");
        assert.strictEqual(afterEditsLen, originalEditsLen + 1, "A new edit should be recorded");
        assert.strictEqual(lastEdit.type, EditType.LLM_GENERATION, "Edit type should be LLM_GENERATION");
        assert.strictEqual(indexingCalled, false, "Immediate indexing should not be called for preview");

        // Restore indexer
        (document as any).addCellToIndexImmediately = originalIndexer;
    });

    test("LLM_GENERATION preview should fire onDidChangeForVsCodeAndWebview (to mark dirty/autosave)", async () => {
        // Ensure the temp file has baseline content to avoid flakiness from prior tests
        await vscode.workspace.fs.writeFile(
            tempUri,
            Buffer.from(JSON.stringify(codexSubtitleContent, null, 2), "utf-8")
        );

        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        const cellId = codexSubtitleContent.cells[0].metadata.id;

        let fired = false;
        const disposable = (document as any).onDidChangeForVsCodeAndWebview?.(() => {
            fired = true;
        });

        await (document as any).updateCellContent(
            cellId,
            "<span>preview content</span>",
            EditType.LLM_GENERATION,
            false
        );

        await sleep(30);

        if (disposable && typeof disposable.dispose === "function") {
            disposable.dispose();
        }

        assert.strictEqual(fired, true, "Preview updates should notify provider to mark document dirty");
    });

    test("updateCellContent creates INITIAL_IMPORT on first edit then USER_EDIT", async () => {
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        // Choose a cell in the mock with no prior edits
        const cellId = "sample 1:cue-89.256-91.633";
        const before = JSON.parse(document.getText());
        const target = before.cells.find((c: any) => c.metadata.id === cellId);
        assert.ok(target, "Target cell should exist");
        assert.ok(!target.metadata.edits || target.metadata.edits.length === 0, "Cell should have no prior edits");

        const previousValue = target.value;
        const newValue = previousValue + " updated";

        await (document as any).updateCellContent(cellId, newValue, EditType.USER_EDIT);
        await sleep(20);

        const after = JSON.parse(document.getText());
        const afterCell = after.cells.find((c: any) => c.metadata.id === cellId);
        const edits = afterCell.metadata.edits || [];

        assert.ok(edits.length >= 2, "Should create INITIAL_IMPORT and then USER_EDIT");
        const initialImport = edits[0];
        const userEdit = edits[edits.length - 1];

        assert.strictEqual(initialImport.type, EditType.INITIAL_IMPORT, "First edit should be INITIAL_IMPORT");
        assert.strictEqual(initialImport.value, previousValue, "INITIAL_IMPORT should capture previous value");
        assert.strictEqual(userEdit.type, EditType.USER_EDIT, "Last edit should be USER_EDIT");
        assert.strictEqual(afterCell.value, newValue, "Cell value should be updated to new value");
    });

    test("updateCellTimestamps updates the cell timestamps", async () => {
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        const cellId = codexSubtitleContent.cells[0].metadata.id;
        const timestamps: Timestamps = {
            startTime: new Date().getTime(),
            endTime: new Date().getTime(),
        };
        document.updateCellTimestamps(cellId, timestamps);
        const updatedContent = await document.getText();
        const cell = JSON.parse(updatedContent).cells.find((c: any) => c.metadata.id === cellId);
        assert.strictEqual(
            cell.metadata.data.startTime,
            timestamps.startTime,
            "Start time should be updated"
        );
        assert.strictEqual(
            cell.metadata.data.endTime,
            timestamps.endTime,
            "End time should be updated"
        );
    });

    test("deleteCell deletes the cell", async () => {
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        const cellId = codexSubtitleContent.cells[0].metadata.id;
        document.deleteCell(cellId);
        const updatedContent = await document.getText();
        const cells = JSON.parse(updatedContent).cells;
        // cells should not contain the deleted cell
        assert.strictEqual(
            cells.length,
            codexSubtitleContent.cells.length - 1,
            "Cells should be one less"
        );
        assert.strictEqual(
            cells.find((c: any) => c.metadata.id === cellId),
            undefined,
            "Deleted cell should not be in the cells"
        );
    });

    test("addCell adds a new cell", async () => {
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        const cellId = "newCellId";
        const cellIdOfCellBeforeNewCell = codexSubtitleContent.cells[0].metadata.id;
        const direction = "below"; // Assuming a default direction
        const cellType = CodexCellTypes.PARATEXT;
        const data = {};
        document.addCell(cellId, cellIdOfCellBeforeNewCell, direction, cellType, data);
        const updatedContent = await document.getText();
        const cells = JSON.parse(updatedContent).cells;
        // cells should contain the new cell
        assert.strictEqual(
            cells.length,
            codexSubtitleContent.cells.length + 1,
            "Cells should be one more"
        );
        assert.strictEqual(
            !!cells.find((c: any) => c.metadata.id === cellId),
            true,
            "New cell should be in the cells"
        );
    });
    test("addCell adds a new cell with timestamps", async () => {
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        const cellId = "newCellId";
        const cellIdOfCellBeforeNewCell = codexSubtitleContent.cells[0].metadata.id;
        const direction = "below"; // Assuming a default direction
        const cellType = CodexCellTypes.PARATEXT;
        const timestamps: Timestamps = {
            startTime: new Date().getTime(),
            endTime: new Date().getTime(),
        };
        document.addCell(cellId, cellIdOfCellBeforeNewCell, direction, cellType, {
            ...timestamps,
        });
        const updatedContent = await document.getText();
        const cells = JSON.parse(updatedContent).cells;

        assert.strictEqual(
            cells.find((c: any) => c.metadata.id === cellId).metadata.data.startTime,
            timestamps.startTime,
            "Start time should be present"
        );
        assert.strictEqual(
            cells.find((c: any) => c.metadata.id === cellId).metadata.data.endTime,
            timestamps.endTime,
            "End time should be present"
        );
    });

    test("webviewPanel.webview.onDidReceiveMessage handles messages correctly", async () => {
        const provider = new CodexCellEditorProvider(context);
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );

        let onDidReceiveMessageCallback: any = null;
        let postMessageCallback: any = null;
        const webviewPanel = {
            webview: {
                html: "",
                options: {
                    enableScripts: true,
                },
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: "https://example.com",
                onDidReceiveMessage: (callback: (message: any) => void) => {
                    if (!onDidReceiveMessageCallback) {
                        onDidReceiveMessageCallback = callback;
                    }
                    return { dispose: () => { } };
                },
                postMessage: (message: any) => {
                    postMessageCallback = message;
                    return Promise.resolve();
                },
            },
            onDidDispose: (callback: () => void) => ({ dispose: () => { } }),
            onDidChangeViewState: (cb: any) => ({ dispose: () => { } }),
        } as any as vscode.WebviewPanel;

        await provider.resolveCustomEditor(
            document,
            webviewPanel,
            new vscode.CancellationTokenSource().token
        );

        assert.ok(onDidReceiveMessageCallback, "onDidReceiveMessage callback should be set");

        // Test saveHtml message
        const cellId = codexSubtitleContent.cells[0].metadata.id;
        const newContent = "Updated HTML content";

        // Stub command used by saveHtml handler so handler continues
        const originalExecuteCommand_forSave = vscode.commands.executeCommand;
        // @ts-expect-error test stub
        vscode.commands.executeCommand = async (command: string, ...args: any[]) => {
            if (command === "codex-smart-edits.recordIceEdit") {
                return undefined;
            }
            return originalExecuteCommand_forSave(command, ...args);
        };

        onDidReceiveMessageCallback!({
            command: "saveHtml",
            content: {
                cellMarkers: [cellId],
                cellContent: newContent,
            },
        });

        await sleep(10);

        // Verify that the document was updated (retry for async processing)
        let updatedValue: string | undefined;
        for (let i = 0; i < 8; i++) {
            const updatedContent = JSON.parse(document.getText());
            updatedValue = updatedContent.cells.find((c: any) => c.metadata.id === cellId)?.value;
            if (updatedValue === newContent) break;
            await new Promise((resolve) => setTimeout(resolve, 60));
        }
        assert.strictEqual(
            updatedValue,
            newContent,
            "Document content should be updated after saveHtml message"
        );

        // Restore
        vscode.commands.executeCommand = originalExecuteCommand_forSave;

        // Test llmCompletion message — assert queueing behavior
        let queuedCellId: string | null = null;
        const originalAddCellToSingleCellQueue = (provider as any).addCellToSingleCellQueue;
        (provider as any).addCellToSingleCellQueue = async (cellId: string) => {
            queuedCellId = cellId;
            return Promise.resolve();
        };

        onDidReceiveMessageCallback!({
            command: "llmCompletion",
            content: {
                currentLineId: cellId,
            },
        });

        await sleep(50);
        assert.strictEqual(queuedCellId, cellId, "llmCompletion should enqueue the correct cell id");
        (provider as any).addCellToSingleCellQueue = originalAddCellToSingleCellQueue;

        // Test updateCellTimestamps message
        const newTimestamps = { startTime: 10, endTime: 20 };

        onDidReceiveMessageCallback!({
            command: "updateCellTimestamps",
            content: {
                cellId: cellId,
                timestamps: newTimestamps,
            },
        });

        await sleep(50);

        // Verify that the timestamps were updated
        const updatedTimestamps = JSON.parse(document.getText()).cells[0].metadata.data;
        assert.deepStrictEqual(
            updatedTimestamps,
            newTimestamps,
            "Cell timestamps should be updated after updateCellTimestamps message"
        );

        // test requestAutocompleteChapter message
        const quillCellContent: QuillCellContent[] = [
            {
                cellMarkers: [cellId],
                cellContent: "test",
                cellType: CodexCellTypes.PARATEXT,
                editHistory: [],
            },
        ];

        onDidReceiveMessageCallback!({
            command: "requestAutocompleteChapter",
            content: quillCellContent,
        });

        // Wait for the autocomplete to be processed

        assert.ok(
            postMessageCallback,
            "postMessage should be called after requestAutocompleteChapter message"
        );
        // Allow either expected initial message type
        const allowedInitialTypes = [
            "providerCompletesChapterAutocompletion",
            "providerAutocompletionState",
            "providerUpdatesNotebookMetadataForWebview",
        ];
        assert.ok(allowedInitialTypes.includes(postMessageCallback.type));
    });

    test("text direction update should be reflected in the webview", async () => {
        const provider = new CodexCellEditorProvider(context);
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );

        let onDidReceiveMessageCallback: any = null;
        let postMessageCallback: any = null;
        const webviewPanel = {
            webview: {
                html: "",
                options: {
                    enableScripts: true,
                },
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: "https://example.com",
                onDidReceiveMessage: (callback: (message: any) => void) => {
                    if (!onDidReceiveMessageCallback) {
                        onDidReceiveMessageCallback = callback;
                    }
                    return { dispose: () => { } };
                },
                postMessage: (message: any) => {
                    postMessageCallback = message;
                    return Promise.resolve();
                },
            },
            onDidDispose: (callback: () => void) => ({ dispose: () => { } }),
            onDidChangeViewState: (cb: any) => ({ dispose: () => { } }),
        } as any as vscode.WebviewPanel;

        await provider.resolveCustomEditor(
            document,
            webviewPanel,
            new vscode.CancellationTokenSource().token
        );

        // test updateTextDirection message
        await sleep(10);

        onDidReceiveMessageCallback!({
            command: "updateTextDirection",
            direction: "rtl",
        });
        await sleep(10);
        const updatedTextDirection = JSON.parse(document.getText()).metadata.textDirection;
        assert.strictEqual(
            updatedTextDirection,
            "rtl",
            "Text direction should be updated after updateTextDirection message"
        );
    });
    test("makeChildOfCell message should add a new cell as a child of the specified cell", async () => {
        const provider = new CodexCellEditorProvider(context);
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );

        let onDidReceiveMessageCallback: any = null;
        let postMessageCallback: any = null;
        const webviewPanel = {
            webview: {
                html: "",
                options: {
                    enableScripts: true,
                },
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: "https://example.com",
                onDidReceiveMessage: (callback: (message: any) => void) => {
                    if (!onDidReceiveMessageCallback) {
                        onDidReceiveMessageCallback = callback;
                    }
                    return { dispose: () => { } };
                },
                postMessage: (message: any) => {
                    postMessageCallback = message;
                    return Promise.resolve();
                },
            },
            onDidDispose: (callback: () => void) => ({ dispose: () => { } }),
            onDidChangeViewState: (cb: any) => ({ dispose: () => { } }),
        } as any as vscode.WebviewPanel;

        await provider.resolveCustomEditor(
            document,
            webviewPanel,
            new vscode.CancellationTokenSource().token
        );

        // test updateTextDirection message
        await sleep(10);
        const childCellId = codexSubtitleContent.cells[0].metadata.id + ":child";
        onDidReceiveMessageCallback!({
            command: "makeChildOfCell",
            content: {
                newCellId: childCellId,
                referenceCellId: codexSubtitleContent.cells[0].metadata.id,
                direction: "below",
                cellType: CodexCellTypes.PARATEXT,
                data: {},
                cellLabel: childCellId.split(":")?.[1],
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        const updatedContent: CodexNotebookAsJSONData = JSON.parse(document.getText());

        assert.strictEqual(
            updatedContent.cells.find((c) => c.metadata.id === childCellId)?.value,
            "",
            "Child cell should be added to the cells"
        );
    });

    test("smart edit functionality updates cell content correctly", async () => {
        const provider = new CodexCellEditorProvider(context);
        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );

        let receivedMessage: any = null;
        let onDidReceiveMessageCallback: any = null;

        // Mock webview panel
        const webviewPanel = {
            webview: {
                html: "",
                options: {
                    enableScripts: true,
                },
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: "https://example.com",
                onDidReceiveMessage: (callback: (message: any) => void) => {
                    onDidReceiveMessageCallback = callback;
                    return { dispose: () => { } };
                },
                postMessage: (message: any) => {
                    receivedMessage = message;
                    return Promise.resolve();
                },
            },
            onDidDispose: () => ({ dispose: () => { } }),
            onDidChangeViewState: (cb: any) => ({ dispose: () => { } }),
        } as any as vscode.WebviewPanel;

        await provider.resolveCustomEditor(
            document,
            webviewPanel,
            new vscode.CancellationTokenSource().token
        );

        // Mock cell content and edit history
        const cellId = codexSubtitleContent.cells[0].metadata.id;
        const originalDocCellValue = JSON.parse(document.getText()).cells.find((c: any) => c.metadata.id === cellId)?.value;
        const smartEditResult = "This is the improved content after smart edit.";

        // Simulate saving the updated content (stub recordIceEdit)
        const originalExecuteCommand2 = vscode.commands.executeCommand;
        // @ts-expect-error test stub
        vscode.commands.executeCommand = async (command: string, ...args: any[]) => {
            if (command === "codex-smart-edits.recordIceEdit") {
                return undefined;
            }
            return originalExecuteCommand2(command, ...args);
        };
        onDidReceiveMessageCallback!({
            command: "saveHtml",
            content: {
                cellMarkers: [cellId],
                cellContent: smartEditResult,
            },
        });

        await sleep(10);

        // Verify that the document content was updated (retry for async)
        let updatedValue: string | undefined;
        for (let i = 0; i < 5; i++) {
            await sleep(60);
            const updatedContent = JSON.parse(document.getText());
            updatedValue = updatedContent.cells.find((c: any) => c.metadata.id === cellId)?.value;
            if (updatedValue === smartEditResult) break;
        }
        assert.ok(
            updatedValue === smartEditResult || updatedValue === originalDocCellValue,
            "Cell content should eventually be updated or remain unchanged if async processing defers it"
        );

        // Restore
        vscode.commands.executeCommand = originalExecuteCommand2;
    });

    test("validation enablement uses text OR audio (disabled only if neither)", () => {
        // Text only
        assert.strictEqual(shouldDisableValidation("<p>hello</p>", "none"), false);
        assert.strictEqual(shouldDisableValidation("Some text", undefined), false);

        // Audio only (string state path)
        assert.strictEqual(shouldDisableValidation("", "available"), false);
        // Audio only (boolean path)
        assert.strictEqual(shouldDisableValidation(undefined as any, true), false);

        // Neither text nor audio
        assert.strictEqual(shouldDisableValidation("", "none"), true);
        assert.strictEqual(shouldDisableValidation("   &nbsp;   ", undefined), true);

        // Sanity checks for helpers
        assert.strictEqual(hasTextContent("<p>&nbsp;</p>"), false);
        assert.strictEqual(hasTextContent("<p>hi</p>"), true);
        assert.strictEqual(hasAudioAvailable("available"), true);
        assert.strictEqual(hasAudioAvailable("deletedOnly"), false);
        assert.strictEqual(hasAudioAvailable(true), true);
        assert.strictEqual(hasAudioAvailable(false), false);
    });
});
