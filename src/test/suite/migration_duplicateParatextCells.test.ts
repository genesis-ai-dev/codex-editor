import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { CodexContentSerializer } from "../../serializer";
import {
    migrateCellIdsToUuidForFile,
    mergeDuplicateCellsInArray,
} from "../../projectManager/utils/migrationUtils";
import { generateCellIdFromHash } from "../../utils/uuidUtils";
import { CodexCellTypes } from "../../../types/enums";

/**
 * Regression coverage for the duplicate-paratext bug: the cell-ID→UUID migration
 * hashes a legacy-form paratext id (`{parentUuid}:paratext-{ts}-{rand}`) into a
 * deterministic UUID. When the same heading is already present in its migrated
 * UUID form (a common sync/merge outcome), the hashed id collides with the twin
 * and used to produce two byte-identical cells, which the editor surfaces as
 * "Duplicate cells found". The migration must now collapse the collision.
 */

async function createTempNotebookFile(
    ext: ".codex" | ".source",
    cells: Array<{ kind?: number; languageId?: string; value: string; metadata: any }>
): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    const tmpDir = os.tmpdir();
    const fileName = `dup-paratext-migration-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const uri = vscode.Uri.file(path.join(tmpDir, fileName));

    const notebook: any = {
        cells: cells.map((cell) => ({
            kind: cell.kind ?? 2,
            languageId: cell.languageId ?? "scripture",
            value: cell.value,
            metadata: cell.metadata,
        })),
        metadata: {},
    };

    const bytes = await serializer.serializeNotebook(
        notebook,
        new vscode.CancellationTokenSource().token
    );
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
}

async function readNotebookFile(uri: vscode.Uri): Promise<any> {
    const fileBytes = await vscode.workspace.fs.readFile(uri);
    const serializer = new CodexContentSerializer();
    return await serializer.deserializeNotebook(
        fileBytes,
        new vscode.CancellationTokenSource().token
    );
}

const HEADING = "<span><strong>Defeat of King Og</strong></span>";

function headingEdit() {
    return {
        editMap: ["value"],
        value: HEADING,
        timestamp: 1781527255219,
        type: "user-edit",
        author: "tester",
        validatedBy: [],
    };
}

suite("migrateCellIdsToUuidForFile — duplicate paratext collision guard", () => {
    const testFiles: vscode.Uri[] = [];

    teardown(async () => {
        for (const uri of testFiles) {
            try {
                await vscode.workspace.fs.delete(uri);
            } catch {
                // ignore
            }
        }
        testFiles.length = 0;
    });

    test("collapses a legacy paratext cell onto its already-migrated UUID twin", async () => {
        const parentId = randomUUID();
        const legacyId = `${parentId}:paratext-1781527173648-v1dpv509g`;
        // The deterministic UUID the migration will derive from the legacy id; this is
        // exactly the id the twin (already-migrated) copy carries.
        const twinUuid = await generateCellIdFromHash(legacyId);

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "parent verse",
                metadata: { type: CodexCellTypes.TEXT, id: parentId, edits: [] },
            },
            {
                value: HEADING,
                metadata: {
                    type: CodexCellTypes.PARATEXT,
                    id: legacyId,
                    parentId,
                    edits: [headingEdit()],
                },
            },
            {
                value: HEADING,
                metadata: {
                    type: CodexCellTypes.PARATEXT,
                    id: twinUuid,
                    parentId,
                    edits: [headingEdit()],
                },
            },
        ]);
        testFiles.push(uri);

        const changed = await migrateCellIdsToUuidForFile(uri);
        assert.strictEqual(changed, true, "migration should report changes");

        const nb = await readNotebookFile(uri);
        const ids = nb.cells.map((c: any) => c.metadata?.id);

        assert.strictEqual(
            ids.filter((id: string) => id === twinUuid).length,
            1,
            "the legacy cell and its twin should collapse to exactly one cell"
        );
        assert.strictEqual(nb.cells.length, 2, "total cell count should drop by one");
        assert.strictEqual(
            new Set(ids).size,
            ids.length,
            "no duplicate cell ids should remain in the file"
        );

        const survivor = nb.cells.find((c: any) => c.metadata?.id === twinUuid);
        assert.ok(
            (survivor?.metadata?.edits?.length ?? 0) >= 1,
            "surviving cell should retain its edit history"
        );
    });

    test("re-running the migration is a no-op (no new duplicates)", async () => {
        const parentId = randomUUID();
        const legacyId = `${parentId}:paratext-1781527173648-v1dpv509g`;
        const twinUuid = await generateCellIdFromHash(legacyId);

        const uri = await createTempNotebookFile(".codex", [
            { value: "parent verse", metadata: { type: CodexCellTypes.TEXT, id: parentId, edits: [] } },
            { value: HEADING, metadata: { type: CodexCellTypes.PARATEXT, id: legacyId, parentId, edits: [headingEdit()] } },
            { value: HEADING, metadata: { type: CodexCellTypes.PARATEXT, id: twinUuid, parentId, edits: [headingEdit()] } },
        ]);
        testFiles.push(uri);

        await migrateCellIdsToUuidForFile(uri);
        const secondRun = await migrateCellIdsToUuidForFile(uri);
        assert.strictEqual(secondRun, false, "second run should report no changes");

        const nb = await readNotebookFile(uri);
        const ids = nb.cells.map((c: any) => c.metadata?.id);
        assert.strictEqual(new Set(ids).size, ids.length, "no duplicate ids after a second run");
        assert.strictEqual(nb.cells.length, 2, "cell count stays stable");
    });

    test("a file that already uses unique UUIDs is left unchanged", async () => {
        const uri = await createTempNotebookFile(".codex", [
            { value: "a", metadata: { type: CodexCellTypes.TEXT, id: randomUUID(), edits: [] } },
            { value: "b", metadata: { type: CodexCellTypes.TEXT, id: randomUUID(), edits: [] } },
        ]);
        testFiles.push(uri);

        const changed = await migrateCellIdsToUuidForFile(uri);
        assert.strictEqual(changed, false, "clean files should not be rewritten");
    });
});

suite("mergeDuplicateCellsInArray", () => {
    test("collapses duplicate ids into one cell, preserving order", () => {
        const cells = [
            { value: "a", metadata: { type: CodexCellTypes.TEXT, id: "a", edits: [] } },
            { value: "b", metadata: { type: CodexCellTypes.TEXT, id: "b", edits: [] } },
            { value: "a-dup", metadata: { type: CodexCellTypes.TEXT, id: "a", edits: [] } },
        ];
        const { cells: out, mergedCount } = mergeDuplicateCellsInArray(cells);
        assert.strictEqual(mergedCount, 1);
        assert.deepStrictEqual(
            out.map((c: any) => c.metadata.id),
            ["a", "b"],
            "first-occurrence order is preserved"
        );
    });

    test("returns the same array reference when there are no duplicates", () => {
        const cells = [
            { value: "a", metadata: { type: CodexCellTypes.TEXT, id: "a", edits: [] } },
            { value: "b", metadata: { type: CodexCellTypes.TEXT, id: "b", edits: [] } },
        ];
        const { cells: out, mergedCount } = mergeDuplicateCellsInArray(cells);
        assert.strictEqual(mergedCount, 0);
        assert.strictEqual(out, cells);
    });

    test("keeps cells without ids untouched", () => {
        const cells = [
            { value: "noid", metadata: {} },
            { value: "a", metadata: { type: CodexCellTypes.TEXT, id: "a", edits: [] } },
            { value: "a-dup", metadata: { type: CodexCellTypes.TEXT, id: "a", edits: [] } },
        ];
        const { cells: out, mergedCount } = mergeDuplicateCellsInArray(cells);
        assert.strictEqual(mergedCount, 1);
        assert.strictEqual(out.length, 2, "the no-id cell survives alongside the merged cell");
    });
});
