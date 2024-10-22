import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { codexSubtitleContent } from "./mocks/codexSubtitleContent";
import { EditType } from "../../../types/enums";
import { Timestamps } from "../../../types";

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
        console.log({ fileContent });
        await vscode.workspace.fs.writeFile(tempUri, encoder.encode(fileContent));

        // console.log({ tempUri: tempUri.fsPath, __dirname });
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
        console.log({ tempUri: JSON.stringify(tempUri, null, 2) });

        // read the file content
        const fileContent = await vscode.workspace.fs.readFile(tempUri);
        const decoder = new TextDecoder();
        console.log({ fileContentAsString: decoder.decode(fileContent) });

        const document = await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
        console.log({ document });
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
        console.log({ html });

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
        console.log({ updatedContent });
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
        console.log({ updatedContent });
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
});
