import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { codexSubtitleContent } from "./mocks/codexSubtitleContent";

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

    // Add more tests as needed
});
