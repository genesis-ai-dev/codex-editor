import * as assert from "assert";
import * as vscode from "vscode";
import { CodexContentSerializer } from "../serializer";
import { migration_lineNumbersSettings } from "../projectManager/utils/migrationUtils";

async function createTempNotebookFile(ext: ".codex" | ".source", cells: Array<{ id?: string; cellLabel?: string; value?: string; }>, metadata: any = {}) {
    const serializer = new CodexContentSerializer();
    const uri = vscode.Uri.file(`${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "/tmp"}/test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    const notebook = {
        cells: cells.map((c) => ({
            kind: 2,
            languageId: "scripture",
            value: c.value ?? "",
            metadata: { id: c.id, cellLabel: c.cellLabel },
        })),
        metadata,
    } as any;
    const bytes = await serializer.serializeNotebook(notebook, new vscode.CancellationTokenSource().token);
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
}

suite("Migration: lineNumbers + Bible labeling (integration)", () => {
    test("runs for .codex and .source, sets lineNumbersEnabled and labels Bible verses", async () => {
        // Arrange: create one Bible .codex without labels, one non-Bible .source
        const bibleCodex = await createTempNotebookFile(
            ".codex",
            [{ id: "GEN 1:1" }, { id: "GEN 1:2" }, { id: "GEN 1:3" }],
            { lineNumbersEnabled: undefined }
        );
        const nonBibleSource = await createTempNotebookFile(
            ".source",
            [{ id: "cue-00.100-00.900" }, { id: "cue-01.000-02.000" }],
            { lineNumbersEnabled: undefined }
        );

        // Act: run migration (ensure it can be re-run by clearing the completion flag)
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        await config.update("lineNumbersMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);
        await migration_lineNumbersSettings();

        // Assert: bible got verse labels and lineNumbersEnabled decided; source got lineNumbersEnabled decided
        const serializer = new CodexContentSerializer();
        const bibleBytes = await vscode.workspace.fs.readFile(bibleCodex);
        const bibleData: any = await serializer.deserializeNotebook(bibleBytes, new vscode.CancellationTokenSource().token);
        const labels = (bibleData.cells || []).map((c: any) => c.metadata?.cellLabel);
        assert.deepStrictEqual(labels, ["1", "2", "3"], "Bible cells should be labeled with verse numbers");
        assert.ok(typeof bibleData.metadata?.lineNumbersEnabled === "boolean", "Bible file should have lineNumbersEnabled set");

        const sourceBytes = await vscode.workspace.fs.readFile(nonBibleSource);
        const sourceData: any = await serializer.deserializeNotebook(sourceBytes, new vscode.CancellationTokenSource().token);
        assert.ok(typeof sourceData.metadata?.lineNumbersEnabled === "boolean", ".source file should have lineNumbersEnabled set");
    });
});


