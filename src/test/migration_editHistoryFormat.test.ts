import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { CodexContentSerializer } from "../serializer";
import { migration_editHistoryFormat } from "../projectManager/utils/migrationUtils";

async function createTempNotebookWithEditHistory(
    edits: Array<{ cellValue?: string; value?: string; editMap?: string[]; [key: string]: any }>
): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    const tmpDir = os.tmpdir();
    const fileName = `edit-history-test-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`;
    const uri = vscode.Uri.file(path.join(tmpDir, fileName));

    const notebook: any = {
        cells: [
            {
                kind: 2,
                languageId: "scripture",
                value: "test content",
                metadata: {
                    id: "cell-1",
                    edits: edits,
                },
            },
        ],
        metadata: {},
    };

    const bytes = await serializer.serializeNotebook(notebook, new vscode.CancellationTokenSource().token);
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
}

describe("migration_editHistoryFormat", () => {
    it("converts cellValue to value and adds editMap", async () => {
        const uri = await createTempNotebookWithEditHistory([
            {
                cellValue: "old content",
                type: "USER_EDIT",
                timestamp: Date.now(),
            },
        ]);

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("editHistoryFormatMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_editHistoryFormat();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        const edit = data.cells[0].metadata.edits[0];
        assert.strictEqual(edit.value, "old content");
        assert.deepStrictEqual(edit.editMap, ["value"]);
        assert.strictEqual(edit.cellValue, undefined);
    });

    it("does not modify edits that already have editMap", async () => {
        const uri = await createTempNotebookWithEditHistory([
            {
                value: "new content",
                editMap: ["value"],
                type: "USER_EDIT",
                timestamp: Date.now(),
            },
        ]);

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("editHistoryFormatMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_editHistoryFormat();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        const edit = data.cells[0].metadata.edits[0];
        assert.strictEqual(edit.value, "new content");
        assert.deepStrictEqual(edit.editMap, ["value"]);
        assert.strictEqual(edit.cellValue, undefined);
    });

    it("handles multiple edits with mixed formats", async () => {
        const uri = await createTempNotebookWithEditHistory([
            {
                cellValue: "old content 1",
                type: "USER_EDIT",
                timestamp: Date.now(),
            },
            {
                value: "new content",
                editMap: ["value"],
                type: "USER_EDIT",
                timestamp: Date.now(),
            },
            {
                cellValue: "old content 2",
                type: "USER_EDIT",
                timestamp: Date.now(),
            },
        ]);

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("editHistoryFormatMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_editHistoryFormat();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        const edits = data.cells[0].metadata.edits;
        assert.strictEqual(edits[0].value, "old content 1");
        assert.deepStrictEqual(edits[0].editMap, ["value"]);
        assert.strictEqual(edits[0].cellValue, undefined);

        assert.strictEqual(edits[1].value, "new content");
        assert.deepStrictEqual(edits[1].editMap, ["value"]);

        assert.strictEqual(edits[2].value, "old content 2");
        assert.deepStrictEqual(edits[2].editMap, ["value"]);
        assert.strictEqual(edits[2].cellValue, undefined);
    });

    it("is idempotent - does not modify already migrated edits", async () => {
        const uri = await createTempNotebookWithEditHistory([
            {
                value: "content",
                editMap: ["value"],
                type: "USER_EDIT",
                timestamp: Date.now(),
            },
        ]);

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("editHistoryFormatMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_editHistoryFormat();
        // Run again - should be skipped due to migration flag
        await migration_editHistoryFormat();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        const edit = data.cells[0].metadata.edits[0];
        assert.strictEqual(edit.value, "content");
        assert.deepStrictEqual(edit.editMap, ["value"]);
        assert.strictEqual(edit.cellValue, undefined);
    });

    it("handles cells without edits", async () => {
        const serializer = new CodexContentSerializer();
        const tmpDir = os.tmpdir();
        const fileName = `no-edits-test-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`;
        const uri = vscode.Uri.file(path.join(tmpDir, fileName));

        const notebook: any = {
            cells: [
                {
                    kind: 2,
                    languageId: "scripture",
                    value: "test content",
                    metadata: {
                        id: "cell-1",
                        // No edits property
                    },
                },
            ],
            metadata: {},
        };

        const bytes = await serializer.serializeNotebook(notebook, new vscode.CancellationTokenSource().token);
        await vscode.workspace.fs.writeFile(uri, bytes);

        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("editHistoryFormatMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);

        await migration_editHistoryFormat();

        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const data: any = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        // Should not throw and should preserve cell structure
        assert.strictEqual(data.cells[0].metadata.id, "cell-1");
    });
});

