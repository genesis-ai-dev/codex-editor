import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { TextEncoder } from "util";
import { CodexContentSerializer } from "../serializer";
import { addCellLabelsToBibleBook, isBibleBook } from "../projectManager/utils/migrationUtils";

// Utility to create a temporary in-memory notebook file
async function createTempCodexFile(cells: Array<{ id?: string; cellLabel?: string; value?: string; }>, metadata: any = {}): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    // Use os.tmpdir() for test environment compatibility
    const tmpDir = os.tmpdir();
    const fileName = `test-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`;
    const uri = vscode.Uri.file(path.join(tmpDir, fileName));

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

describe("migration_lineNumbersSettings Bible labeling", () => {
    it("labels verse-number for Bible IDs without labels", async () => {
        const uri = await createTempCodexFile([
            { id: "GEN 1:1" },
            { id: "GEN 1:2", cellLabel: "2" }, // already labeled; should be preserved
            { id: "GEN 1:3" },
        ]);

        const beforeIsBible = await isBibleBook(uri);
        assert.strictEqual(beforeIsBible, true);

        const changed = await addCellLabelsToBibleBook(uri);
        assert.strictEqual(changed, true);

        // Read back and assert labels
        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const data = await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);

        const labels = (data.cells as any[]).map((c) => c.metadata?.cellLabel || "");
        assert.deepStrictEqual(labels, ["1", "2", "3"]);
    });

    it("does not flag non-Bible notebooks", async () => {
        const uri = await createTempCodexFile([
            { id: "cue-12.345-15.678" },
            { id: "cue-20-25" },
            { id: "AUDIO 001" },
        ]);

        const result = await isBibleBook(uri);
        assert.strictEqual(result, false);

        const changed = await addCellLabelsToBibleBook(uri);
        assert.strictEqual(changed, false);
    });
});


