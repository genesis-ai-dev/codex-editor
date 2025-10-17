import * as assert from "assert";
import * as vscode from "vscode";

import { NewSourceUploaderProvider } from "../../../src/providers/NewSourceUploader/NewSourceUploaderProvider";
import { CodexCellTypes } from "../../../types/enums";
import { createMockExtensionContext, createTempFileWithContent, deleteIfExists } from "../testUtils";

suite("Translation import preserves order and blank cells", () => {
    let provider: NewSourceUploaderProvider;
    let tempTargetUri: vscode.Uri;

    const makeCell = (id: string, value: string = "") => ({
        kind: 1, // vscode.NotebookCellKind.Code
        languageId: "html",
        value,
        metadata: {
            id,
            type: CodexCellTypes.TEXT,
            data: {},
            edits: [],
        },
    });

    setup(() => {
        const context = createMockExtensionContext();
        provider = new NewSourceUploaderProvider(context as unknown as vscode.ExtensionContext);
    });

    teardown(async () => {
        if (tempTargetUri) {
            await deleteIfExists(tempTargetUri);
        }
    });

    test("single middle-row translation is applied in-place; neighbors stay empty; order unchanged", async () => {
        // Arrange: initial target notebook with six ordered cells; all empty values
        const initialCells = [
            makeCell("Example 1:1"),
            makeCell("Example 1:2"),
            makeCell("Example 1:3"),
            makeCell("Example 2:1"),
            makeCell("Example 2:2"),
            makeCell("Example 3:3"),
        ];

        const initialNotebook = {
            cells: initialCells,
            metadata: {
                id: "Example2",
                originalName: "Example2.tsv",
                corpusMarker: "spreadsheet",
            },
        } as any;

        tempTargetUri = await createTempFileWithContent(
            `example2-${Date.now()}.codex`,
            JSON.stringify(initialNotebook, null, 2)
        );

        const token = new vscode.CancellationTokenSource().token;

        const importedTranslation = "She stayed at home.";

        // Aligned content: only middle row (Example 1:2) has content; use the existing notebook cell
        const alignedContent = [
            {
                notebookCell: initialCells[1],
                importedContent: { id: "Example 1:2", content: importedTranslation },
                alignmentMethod: "exact-id",
                confidence: 1.0,
            },
        ];

        // Act: call private handler via any-cast
        await (provider as any).handleWriteTranslation(
            {
                command: "writeTranslation",
                alignedContent,
                sourceFilePath: tempTargetUri.fsPath.replace(/\.codex$/, ".source"),
                targetFilePath: tempTargetUri.fsPath,
                importerType: "spreadsheet",
            },
            token
        );

        // Assert: read back and verify order and values
        const updatedRaw = await vscode.workspace.fs.readFile(tempTargetUri);
        const updated = JSON.parse(new TextDecoder().decode(updatedRaw));

        const ids = updated.cells.map((c: any) => c.metadata?.id);
        assert.deepStrictEqual(
            ids,
            [
                "Example 1:1",
                "Example 1:2",
                "Example 1:3",
                "Example 2:1",
                "Example 2:2",
                "Example 3:3",
            ],
            "Target cell order should be preserved"
        );

        // Values: only middle one updated
        assert.strictEqual(updated.cells[0].value, "", "First cell should remain empty");
        assert.strictEqual(updated.cells[1].value, importedTranslation, "Middle cell should be updated");
        assert.strictEqual(updated.cells[2].value, "", "Third cell should remain empty");
    });
});


