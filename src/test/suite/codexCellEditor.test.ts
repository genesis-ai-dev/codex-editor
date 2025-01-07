import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { codexSubtitleContent } from "./mocks/codexSubtitleContent";
import { CodexCellTypes, EditType } from "../../../types/enums";
import { CodexNotebookAsJSONData, QuillCellContent, Timestamps } from "../../../types";

suite("CodexCellEditorProvider Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests for CodexCellEditorProvider.");
    let context: vscode.ExtensionContext;
    let provider: CodexCellEditorProvider;
    let tempUri: vscode.Uri;

    suiteSetup(async () => {
        // Create a temporary file in the system's temp directory
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const os = require("os");
        const tempDir = os.tmpdir();
        const tempFilePath = path.join(tempDir, "test.codex");
        tempUri = vscode.Uri.file(tempFilePath);

        // Write content to the temporary file
        const encoder = new TextEncoder();
        const fileContent = JSON.stringify(codexSubtitleContent, null, 2);
        await vscode.workspace.fs.writeFile(tempUri, encoder.encode(fileContent));
    });

    suiteTeardown(async () => {
        // Clean up the temporary file
        if (tempUri) {
            try {
                await vscode.workspace.fs.delete(tempUri);
            } catch (error) {
                console.error("Failed to delete temporary file:", error);
            }
        }
    });

    setup(() => {
        // @ts-expect-error: test
        context = {
            extensionUri: vscode.Uri.file(__dirname),
            subscriptions: [],
        } as vscode.ExtensionContext;
        provider = new CodexCellEditorProvider(context);
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
                    return { dispose: () => {} };
                },
                postMessage: (message: any) => {
                    receivedMessage = message;
                    return Promise.resolve();
                },
            },
            onDidDispose: () => ({ dispose: () => {} }),
        } as any as vscode.WebviewPanel;

        await provider.resolveCustomEditor(
            document,
            webviewPanel,
            new vscode.CancellationTokenSource().token
        );

        // Wait for the simulated message to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.ok(receivedMessage, "Webview should receive a message");
        assert.strictEqual(
            receivedMessage.type,
            "providerSendsInitialContent",
            "Initial content should be sent to webview"
        );
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
                    onDidReceiveMessageCallback = callback;
                    return { dispose: () => {} };
                },
                postMessage: (message: any) => {
                    postMessageCallback = message;
                    return Promise.resolve();
                },
            },
            onDidDispose: (callback: () => void) => ({ dispose: () => {} }),
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

        onDidReceiveMessageCallback!({
            command: "saveHtml",
            content: {
                cellMarkers: [cellId],
                cellContent: newContent,
            },
        });

        // Wait for the update to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Verify that the document was updated
        const updatedContent = JSON.parse(document.getText());
        assert.strictEqual(
            updatedContent.cells[0].value,
            newContent,
            "Document content should be updated after saveHtml message"
        );

        // Test llmCompletion message
        let llmCompletionCalled = false;
        (provider as any).performLLMCompletion = async () => {
            llmCompletionCalled = true;
            return "LLM generated content";
        };

        onDidReceiveMessageCallback!({
            command: "llmCompletion",
            content: {
                currentLineId: cellId,
            },
        });

        // Wait for the LLM completion to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.ok(
            llmCompletionCalled,
            "performLLMCompletion should be called after llmCompletion message"
        );

        // Test updateCellTimestamps message
        const newTimestamps = { startTime: 10, endTime: 20 };

        onDidReceiveMessageCallback!({
            command: "updateCellTimestamps",
            content: {
                cellId: cellId,
                timestamps: newTimestamps,
            },
        });

        // Wait for the update to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

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
        assert.strictEqual(
            postMessageCallback.type,
            "providerCompletesChapterAutocompletion",
            "postMessage should be called with providerCompletesChapterAutocompletion type"
        );
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
                    onDidReceiveMessageCallback = callback;
                    return { dispose: () => {} };
                },
                postMessage: (message: any) => {
                    postMessageCallback = message;
                    return Promise.resolve();
                },
            },
            onDidDispose: (callback: () => void) => ({ dispose: () => {} }),
        } as any as vscode.WebviewPanel;

        await provider.resolveCustomEditor(
            document,
            webviewPanel,
            new vscode.CancellationTokenSource().token
        );

        // test updateTextDirection message
        await new Promise((resolve) => setTimeout(resolve, 10));

        onDidReceiveMessageCallback!({
            command: "updateTextDirection",
            direction: "rtl",
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
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
                    onDidReceiveMessageCallback = callback;
                    return { dispose: () => {} };
                },
                postMessage: (message: any) => {
                    postMessageCallback = message;
                    return Promise.resolve();
                },
            },
            onDidDispose: (callback: () => void) => ({ dispose: () => {} }),
        } as any as vscode.WebviewPanel;

        await provider.resolveCustomEditor(
            document,
            webviewPanel,
            new vscode.CancellationTokenSource().token
        );

        // test updateTextDirection message
        await new Promise((resolve) => setTimeout(resolve, 10));
        const childCellId = codexSubtitleContent.cells[0].metadata.id + ":child";
        onDidReceiveMessageCallback!({
            command: "makeChildOfCell",
            content: {
                newCellId: childCellId,
                cellIdOfCellBeforeNewCell: codexSubtitleContent.cells[0].metadata.id,
                cellType: CodexCellTypes.PARATEXT,
                data: {},
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
                    return { dispose: () => {} };
                },
                postMessage: (message: any) => {
                    receivedMessage = message;
                    return Promise.resolve();
                },
            },
            onDidDispose: () => ({ dispose: () => {} }),
        } as any as vscode.WebviewPanel;

        await provider.resolveCustomEditor(
            document,
            webviewPanel,
            new vscode.CancellationTokenSource().token
        );

        // Mock cell content and edit history
        const cellId = "test-cell-1";
        const originalContent = "This is the original content.";
        const smartEditResult = "This is the improved content after smart edit.";

        // Mock vscode.commands.executeCommand for the smart edit
        const originalExecuteCommand = vscode.commands.executeCommand;
        // @ts-expect-error: Mocking executeCommand for testing purposes
        vscode.commands.executeCommand = async (command: string, ...args: any[]) => {
            if (command === "codex-smart-edits.getAndApplyTopPrompts") {
                return smartEditResult;
            }
            return originalExecuteCommand(command, ...args);
        };

        // Simulate receiving a getAndApplyTopPrompts message from the webview
        onDidReceiveMessageCallback!({
            command: "getAndApplyTopPrompts",
            content: {
                text: originalContent,
                cellId: cellId,
            },
        });

        // Wait for the message to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Verify that the provider sent the correct response
        assert.ok(receivedMessage, "Provider should send a response message");
        assert.strictEqual(
            receivedMessage.type,
            "providerSendsPromptedEditResponse",
            "Response should be of type providerSendsPromptedEditResponse"
        );
        assert.strictEqual(
            receivedMessage.content,
            smartEditResult,
            "Response should contain the smart edit result"
        );

        // Simulate saving the updated content
        onDidReceiveMessageCallback!({
            command: "saveHtml",
            content: {
                cellMarkers: [cellId],
                cellContent: smartEditResult,
            },
        });

        // Wait for the save to be processed
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Verify that the document content was updated
        const updatedContent = JSON.parse(document.getText());
        const updatedCell = updatedContent.cells.find((c: any) => c.metadata.id === cellId);
        assert.strictEqual(
            updatedCell.value,
            smartEditResult,
            "Cell content should be updated after smart edit"
        );
    });
});
