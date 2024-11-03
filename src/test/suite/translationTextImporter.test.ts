import * as assert from "assert";
import * as vscode from "vscode";
import { importTranslations } from "../../projectManager/translationTextImporter";
import { NotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { CodexContentSerializer } from "../../serializer";

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
        const metadataManager = new NotebookMetadataManager();
        await metadataManager.initialize();

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
