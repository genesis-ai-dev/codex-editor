import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { CodexContentSerializer } from "../../serializer";
import { migrateVerseRangeLabelsAndPositionsForFile } from "../../projectManager/utils/migrationUtils";
import { resolveCodexCustomMerge } from "../../projectManager/utils/merge/resolvers";
import { CodexCellTypes } from "../../../types/enums";

async function createTempNotebookFile(
    ext: ".codex" | ".source",
    cells: Array<{ kind?: number; languageId?: string; value: string; metadata: any }>
): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    const tmpDir = os.tmpdir();
    const fileName = `verse-range-migration-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
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

function ref(ref: string) {
    return { data: { globalReferences: [ref] } };
}

suite("migrateVerseRangeLabelsAndPositionsForFile", () => {
    let testFiles: vscode.Uri[] = [];

    teardown(async () => {
        for (const uri of testFiles) {
            try {
                await vscode.workspace.fs.delete(uri);
            } catch {
                // ignore
            }
        }
        testFiles = [];
    });

    test("should move verse-range cell (4:1-3) after milestone and set cellLabel", async () => {
        const id1 = randomUUID();
        const id3 = randomUUID();
        const milestoneId = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Jesus knew the Pharisees heard...",
                metadata: {
                    id: id1,
                    type: CodexCellTypes.TEXT,
                    ...ref("JHN 4:1-3"),
                    edits: [],
                },
            },
            {
                value: "John 4",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "He had to pass through Samaria.",
                metadata: {
                    id: id3,
                    type: CodexCellTypes.TEXT,
                    ...ref("JHN 4:4"),
                    cellLabel: "4",
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        const wasMigrated = await migrateVerseRangeLabelsAndPositionsForFile(uri);
        assert.strictEqual(wasMigrated, true, "Migration should have occurred");

        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 3, "Should have 3 cells (milestone + 4:1-3 + 4:4)");

        const first = data.cells[0];
        const second = data.cells[1];
        const third = data.cells[2];

        assert.strictEqual(first.metadata?.type, CodexCellTypes.MILESTONE, "First cell should be milestone");
        assert.strictEqual(first.value, "John 4");

        assert.strictEqual(second.metadata?.type, CodexCellTypes.TEXT, "Second cell should be 4:1-3");
        assert.strictEqual(second.metadata?.id, id1, "Cell should keep its original id");
        assert.deepStrictEqual(second.metadata?.data?.globalReferences, ["JHN 4:1-3"]);
        assert.strictEqual(second.metadata?.cellLabel, "1-3", "Verse range should have cellLabel 1-3");
        assert.strictEqual(second.metadata?.data?.deleted, undefined, "Cell should not be marked deleted");

        assert.strictEqual(third.metadata?.type, CodexCellTypes.TEXT, "Third cell should be content 4:4");
        assert.strictEqual(third.metadata?.cellLabel, "4");
    });

    test("should set cellLabel for mid-chapter verse range (4:7-8)", async () => {
        const id6 = randomUUID();
        const id78 = randomUUID();
        const id9 = randomUUID();
        const milestoneId = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "John 4",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "Jacob's well was there.",
                metadata: {
                    id: id6,
                    type: CodexCellTypes.TEXT,
                    ...ref("JHN 4:6"),
                    cellLabel: "6",
                    edits: [],
                },
            },
            {
                value: "A Samaritan woman came to draw water.",
                metadata: {
                    id: id78,
                    type: CodexCellTypes.TEXT,
                    ...ref("JHN 4:7-8"),
                    edits: [],
                },
            },
            {
                value: "The Samaritan woman said...",
                metadata: {
                    id: id9,
                    type: CodexCellTypes.TEXT,
                    ...ref("JHN 4:9"),
                    cellLabel: "9",
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        const wasMigrated = await migrateVerseRangeLabelsAndPositionsForFile(uri);
        assert.strictEqual(wasMigrated, true, "Migration should have occurred (labelling)");

        const data = await readNotebookFile(uri);
        const cell78 = data.cells.find(
            (c: any) => c.metadata?.data?.globalReferences?.[0] === "JHN 4:7-8"
        );
        assert.ok(cell78, "Should find cell with JHN 4:7-8");
        assert.strictEqual(cell78.metadata?.cellLabel, "7-8", "Verse range 4:7-8 should have cellLabel 7-8");

        const order = data.cells
            .filter((c: any) => c.metadata?.data?.globalReferences?.[0])
            .map((c: any) => c.metadata.data.globalReferences[0]);
        assert.deepStrictEqual(
            order,
            ["JHN 4:6", "JHN 4:7-8", "JHN 4:9"],
            "Order should remain 6, 7-8, 9"
        );
    });

    test("should be idempotent - running twice should not change result", async () => {
        const milestoneId = randomUUID();
        const id1 = randomUUID();
        const id2 = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "John 4",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "Content 4:1-3",
                metadata: {
                    id: id1,
                    type: CodexCellTypes.TEXT,
                    ...ref("JHN 4:1-3"),
                    edits: [],
                },
            },
            {
                value: "Content 4:4",
                metadata: {
                    id: id2,
                    type: CodexCellTypes.TEXT,
                    ...ref("JHN 4:4"),
                    cellLabel: "4",
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        await migrateVerseRangeLabelsAndPositionsForFile(uri);
        const data1 = await readNotebookFile(uri);
        const ids1 = data1.cells.map((c: any) => c.metadata?.id).join(",");

        const second = await migrateVerseRangeLabelsAndPositionsForFile(uri);
        const data2 = await readNotebookFile(uri);
        const ids2 = data2.cells.map((c: any) => c.metadata?.id).join(",");

        assert.strictEqual(second, false, "Second run should report no changes");
        assert.strictEqual(ids1, ids2, "Order should be unchanged");
        const cell13 = data2.cells.find(
            (c: any) => c.metadata?.data?.globalReferences?.[0] === "JHN 4:1-3"
        );
        assert.strictEqual(cell13?.metadata?.cellLabel, "1-3");
    });

    test("should handle empty file gracefully", async () => {
        const uri = await createTempNotebookFile(".codex", []);
        testFiles.push(uri);

        const wasMigrated = await migrateVerseRangeLabelsAndPositionsForFile(uri);
        assert.strictEqual(wasMigrated, false);
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 0);
    });

    test("should process .source file same as .codex", async () => {
        const id1 = randomUUID();
        const id2 = randomUUID();
        const milestoneId = randomUUID();

        const uri = await createTempNotebookFile(".source", [
            {
                value: "Verse range content",
                metadata: {
                    id: id1,
                    type: CodexCellTypes.TEXT,
                    ...ref("JHN 4:1-3"),
                    edits: [],
                },
            },
            {
                value: "John 4",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "Single verse content",
                metadata: {
                    id: id2,
                    type: CodexCellTypes.TEXT,
                    ...ref("JHN 4:4"),
                    cellLabel: "4",
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        const wasMigrated = await migrateVerseRangeLabelsAndPositionsForFile(uri);
        assert.strictEqual(wasMigrated, true);

        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 3);
        assert.strictEqual(data.cells[0].metadata?.type, CodexCellTypes.MILESTONE);
        assert.strictEqual(data.cells[1].metadata?.data?.globalReferences?.[0], "JHN 4:1-3");
        assert.strictEqual(data.cells[1].metadata?.cellLabel, "1-3");
        assert.strictEqual(data.cells[1].metadata?.id, id1);
        assert.strictEqual(data.cells[2].metadata?.data?.globalReferences?.[0], "JHN 4:4");
    });

    test("should soft-delete child and track mergedChildIds when merging split verse-range cells", async () => {
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const childId = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 50",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span>Parent first sentence.</span>",
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 50:12-13"),
                    edits: [],
                },
            },
            {
                value: "<span>Child second sentence.</span>",
                metadata: {
                    id: childId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 50:12-13"),
                    parentId,
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        const wasMigrated = await migrateVerseRangeLabelsAndPositionsForFile(uri);
        assert.strictEqual(wasMigrated, true);

        const data = await readNotebookFile(uri);

        // Child should still be present in the file (soft-deleted, not hard-removed)
        const parent = data.cells.find((c: any) => c.metadata?.id === parentId);
        const child = data.cells.find((c: any) => c.metadata?.id === childId);
        assert.ok(parent, "Parent cell should be in the file");
        assert.ok(child, "Child cell should be soft-deleted but still present in the file");

        // Parent should have the merged value
        assert.strictEqual(
            parent.value,
            "<span>Parent first sentence.</span><span>Child second sentence.</span>"
        );
        assert.strictEqual(parent.metadata?.cellLabel, "12-13");

        // Parent should track merged child id
        assert.deepStrictEqual(parent.metadata?.data?.mergedChildIds, [childId]);

        // Parent should have a value-edit and a mergedChildIds-edit recorded
        const parentEdits: any[] = parent.metadata?.edits || [];
        const valueEdits = parentEdits.filter((e) => e.editMap?.join(".") === "value");
        const trackingEdits = parentEdits.filter(
            (e) => e.editMap?.join(".") === "metadata.data.mergedChildIds"
        );
        assert.strictEqual(valueEdits.length, 1, "Should have exactly one value migration edit");
        assert.strictEqual(valueEdits[0].type, "migration");
        assert.strictEqual(trackingEdits.length, 1, "Should have one mergedChildIds edit");
        assert.deepStrictEqual(trackingEdits[0].value, [childId]);

        // Child should be marked deleted with a deletion edit
        assert.strictEqual(child.metadata?.data?.deleted, true);
        const childEdits: any[] = child.metadata?.edits || [];
        const deleteEdits = childEdits.filter(
            (e) => e.editMap?.join(".") === "metadata.data.deleted"
        );
        assert.strictEqual(deleteEdits.length, 1, "Child should have one deletion edit");
        assert.strictEqual(deleteEdits[0].value, true);
        assert.strictEqual(deleteEdits[0].type, "migration");
    });

    test("should not duplicate parent value when re-running migration after a sync re-introduces the child", async () => {
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const childId = randomUUID();

        // Initial state: parent + un-merged child (as-imported)
        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 50",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span>Parent first.</span>",
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 50:12-13"),
                    edits: [],
                },
            },
            {
                value: "<span>Child second.</span>",
                metadata: {
                    id: childId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 50:12-13"),
                    parentId,
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        // First migration: merges child into parent and soft-deletes child
        await migrateVerseRangeLabelsAndPositionsForFile(uri);
        const after1 = await readNotebookFile(uri);
        const parent1 = after1.cells.find((c: any) => c.metadata?.id === parentId);
        const expectedMergedValue =
            "<span>Parent first.</span><span>Child second.</span>";
        assert.strictEqual(parent1.value, expectedMergedValue);

        // Simulate sync: re-introduce child cell WITHOUT data.deleted (as if pulled in from
        // another user's branch where the deletion didn't propagate). The codex merge resolver
        // would normally do this, but mergedChildIds on the parent should still gate the merge.
        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const serializer = new CodexContentSerializer();
        const notebookData: any = await serializer.deserializeNotebook(
            fileBytes,
            new vscode.CancellationTokenSource().token
        );
        const childIdx = notebookData.cells.findIndex(
            (c: any) => c.metadata?.id === childId
        );
        if (childIdx >= 0) {
            const ch = notebookData.cells[childIdx];
            // Strip the deletion (sim a sync that lost the deletion edit)
            if (ch.metadata?.data) {
                delete ch.metadata.data.deleted;
            }
            ch.metadata.edits = (ch.metadata.edits || []).filter(
                (e: any) => e.editMap?.join(".") !== "metadata.data.deleted"
            );
        }
        const reSerialized = await serializer.serializeNotebook(
            notebookData,
            new vscode.CancellationTokenSource().token
        );
        await vscode.workspace.fs.writeFile(uri, reSerialized);

        // Second migration: should NOT re-append the child's value because mergedChildIds
        // already tracks it (even though child no longer has data.deleted).
        await migrateVerseRangeLabelsAndPositionsForFile(uri);
        const after2 = await readNotebookFile(uri);
        const parent2 = after2.cells.find((c: any) => c.metadata?.id === parentId);
        const child2 = after2.cells.find((c: any) => c.metadata?.id === childId);

        assert.strictEqual(
            parent2.value,
            expectedMergedValue,
            "Parent value must NOT be doubled by the second run"
        );

        // Child should be re-soft-deleted by the second run
        assert.strictEqual(child2.metadata?.data?.deleted, true);

        // Parent should still have only ONE value migration edit
        const parentEdits: any[] = parent2.metadata?.edits || [];
        const valueEdits = parentEdits.filter((e) => e.editMap?.join(".") === "value");
        assert.strictEqual(
            valueEdits.length,
            1,
            "There should be exactly one value migration edit (no second append)"
        );
    });

    test("should not duplicate when sync also drops mergedChildIds tracking (endsWith safeguard)", async () => {
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const childId = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 50",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span>Parent A.</span>",
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 50:12-13"),
                    edits: [],
                },
            },
            {
                value: "<span>Child B.</span>",
                metadata: {
                    id: childId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 50:12-13"),
                    parentId,
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        await migrateVerseRangeLabelsAndPositionsForFile(uri);

        // Strip BOTH the parent's mergedChildIds tracking AND the child's data.deleted
        // to simulate the worst-case sync where both signals were lost. The endsWith
        // safeguard should still prevent a duplicate append.
        const serializer = new CodexContentSerializer();
        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const notebookData: any = await serializer.deserializeNotebook(
            fileBytes,
            new vscode.CancellationTokenSource().token
        );
        for (const cell of notebookData.cells) {
            if (cell.metadata?.id === parentId && cell.metadata?.data?.mergedChildIds) {
                delete cell.metadata.data.mergedChildIds;
                cell.metadata.edits = (cell.metadata.edits || []).filter(
                    (e: any) => e.editMap?.join(".") !== "metadata.data.mergedChildIds"
                );
            }
            if (cell.metadata?.id === childId) {
                if (cell.metadata?.data) delete cell.metadata.data.deleted;
                cell.metadata.edits = (cell.metadata.edits || []).filter(
                    (e: any) => e.editMap?.join(".") !== "metadata.data.deleted"
                );
            }
        }
        const reSerialized = await serializer.serializeNotebook(
            notebookData,
            new vscode.CancellationTokenSource().token
        );
        await vscode.workspace.fs.writeFile(uri, reSerialized);

        await migrateVerseRangeLabelsAndPositionsForFile(uri);
        const data = await readNotebookFile(uri);
        const parent = data.cells.find((c: any) => c.metadata?.id === parentId);
        assert.strictEqual(
            parent.value,
            "<span>Parent A.</span><span>Child B.</span>",
            "endsWith guard should prevent doubling even when tracking signals are lost"
        );
    });

    test("should be idempotent across multiple consecutive runs when child has parentId", async () => {
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const childId = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 50",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span>Parent X.</span>",
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 50:12-13"),
                    edits: [],
                },
            },
            {
                value: "<span>Child Y.</span>",
                metadata: {
                    id: childId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 50:12-13"),
                    parentId,
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        await migrateVerseRangeLabelsAndPositionsForFile(uri);
        const second = await migrateVerseRangeLabelsAndPositionsForFile(uri);
        const third = await migrateVerseRangeLabelsAndPositionsForFile(uri);

        assert.strictEqual(second, false, "Second run should report no changes");
        assert.strictEqual(third, false, "Third run should report no changes");

        const data = await readNotebookFile(uri);
        const parent = data.cells.find((c: any) => c.metadata?.id === parentId);
        assert.strictEqual(parent.value, "<span>Parent X.</span><span>Child Y.</span>");
    });

    test("paratext between a milestone and the first verse stays in place", async () => {
        const milestoneId = randomUUID();
        const headingId = randomUUID();
        const verse1Id = randomUUID();
        const verse2Id = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 1",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span><strong>Heading</strong></span>",
                languageId: "html",
                metadata: {
                    id: headingId,
                    type: CodexCellTypes.PARATEXT,
                    parentId: verse1Id,
                    edits: [],
                },
            },
            {
                value: "<span>In the beginning...</span>",
                metadata: {
                    id: verse1Id,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 1:1"),
                    cellLabel: "1",
                    edits: [],
                },
            },
            {
                value: "<span>...and the earth was formless.</span>",
                metadata: {
                    id: verse2Id,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 1:2"),
                    cellLabel: "2",
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        await migrateVerseRangeLabelsAndPositionsForFile(uri);

        const data = await readNotebookFile(uri);
        const ids = data.cells.map((c: any) => c.metadata?.id);
        assert.deepStrictEqual(
            ids,
            [milestoneId, headingId, verse1Id, verse2Id],
            "Heading paratext should stay between the milestone and verse 1"
        );
    });

    test("paratext that originally appeared after its parent is moved above the parent", async () => {
        const milestoneId = randomUUID();
        const verseId = randomUUID();
        const noteId = randomUUID();
        const verse2Id = randomUUID();

        // Section-heading style paratexts in scripture (\\s) belong above the verse they
        // introduce, so the migration normalises every parented paratext to BEFORE its parent
        // regardless of its original index.
        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 1",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span>In the beginning...</span>",
                metadata: {
                    id: verseId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 1:1"),
                    cellLabel: "1",
                    edits: [],
                },
            },
            {
                value: "<span><em>Section heading</em></span>",
                languageId: "html",
                metadata: {
                    id: noteId,
                    type: CodexCellTypes.PARATEXT,
                    parentId: verseId,
                    edits: [],
                },
            },
            {
                value: "<span>...and the earth was formless.</span>",
                metadata: {
                    id: verse2Id,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 1:2"),
                    cellLabel: "2",
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        await migrateVerseRangeLabelsAndPositionsForFile(uri);

        const data = await readNotebookFile(uri);
        const ids = data.cells.map((c: any) => c.metadata?.id);
        assert.deepStrictEqual(
            ids,
            [milestoneId, noteId, verseId, verse2Id],
            "Paratext should be moved above its parent verse, even when originally below"
        );
    });

    test("multiple paratexts before a parent retain their relative order", async () => {
        const milestoneId = randomUUID();
        const heading1 = randomUUID();
        const heading2 = randomUUID();
        const heading3 = randomUUID();
        const verseId = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 1",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span>A</span>",
                languageId: "html",
                metadata: {
                    id: heading1,
                    type: CodexCellTypes.PARATEXT,
                    parentId: verseId,
                    edits: [],
                },
            },
            {
                value: "<span>B</span>",
                languageId: "html",
                metadata: {
                    id: heading2,
                    type: CodexCellTypes.PARATEXT,
                    parentId: verseId,
                    edits: [],
                },
            },
            {
                value: "<span>C</span>",
                languageId: "html",
                metadata: {
                    id: heading3,
                    type: CodexCellTypes.PARATEXT,
                    parentId: verseId,
                    edits: [],
                },
            },
            {
                value: "<span>Verse text.</span>",
                metadata: {
                    id: verseId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 1:1"),
                    cellLabel: "1",
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        await migrateVerseRangeLabelsAndPositionsForFile(uri);

        const data = await readNotebookFile(uri);
        const ids = data.cells.map((c: any) => c.metadata?.id);
        assert.deepStrictEqual(
            ids,
            [milestoneId, heading1, heading2, heading3, verseId],
            "BEFORE-parent paratexts must keep their relative order"
        );
    });

    test("orphan paratext is soft-deleted in place idempotently", async () => {
        const milestoneId = randomUUID();
        const verseId = randomUUID();
        const orphanId = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 1",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span>Verse 1</span>",
                metadata: {
                    id: verseId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 1:1"),
                    cellLabel: "1",
                    edits: [],
                },
            },
            {
                value: "<span>Stale heading</span>",
                languageId: "html",
                metadata: {
                    id: orphanId,
                    type: CodexCellTypes.PARATEXT,
                    parentId: "missing-parent-id",
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        await migrateVerseRangeLabelsAndPositionsForFile(uri);
        const data1 = await readNotebookFile(uri);
        const orphan1 = data1.cells.find((c: any) => c.metadata?.id === orphanId);
        assert.ok(orphan1, "Orphan paratext should still be present");
        assert.strictEqual(orphan1.metadata?.data?.deleted, true, "Orphan should be soft-deleted");
        const orphanIndex1 = data1.cells.findIndex(
            (c: any) => c.metadata?.id === orphanId
        );
        assert.strictEqual(
            orphanIndex1,
            data1.cells.length - 1,
            "Orphan paratext should keep its trailing position"
        );

        const orphanDeleteEdits1 = (orphan1.metadata?.edits || []).filter(
            (e: any) => e.editMap?.join(".") === "metadata.data.deleted"
        );
        assert.strictEqual(orphanDeleteEdits1.length, 1, "First run should add exactly one deletion edit");

        const second = await migrateVerseRangeLabelsAndPositionsForFile(uri);
        assert.strictEqual(second, false, "Second migration run should be a no-op");
        const data2 = await readNotebookFile(uri);
        const orphan2 = data2.cells.find((c: any) => c.metadata?.id === orphanId);
        const orphanDeleteEdits2 = (orphan2.metadata?.edits || []).filter(
            (e: any) => e.editMap?.join(".") === "metadata.data.deleted"
        );
        assert.strictEqual(
            orphanDeleteEdits2.length,
            1,
            "Second run must NOT add another deletion edit"
        );
    });

    test("user-edited cellLabel on a verse-range cell is not overwritten by the helper", async () => {
        const milestoneId = randomUUID();
        const rangeId = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 1",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span>Verses 1-3</span>",
                metadata: {
                    id: rangeId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 1:1-3"),
                    // User has explicitly relabelled this cell
                    cellLabel: "1a",
                    edits: [
                        {
                            editMap: ["metadata", "cellLabel"],
                            value: "1a",
                            timestamp: 1,
                            type: "user-edit",
                            author: "translator",
                            validatedBy: [],
                        },
                    ],
                },
            },
        ]);
        testFiles.push(uri);

        await migrateVerseRangeLabelsAndPositionsForFile(uri);
        await migrateVerseRangeLabelsAndPositionsForFile(uri);

        const data = await readNotebookFile(uri);
        const range = data.cells.find((c: any) => c.metadata?.id === rangeId);
        assert.strictEqual(
            range.metadata?.cellLabel,
            "1a",
            "User-edited cellLabel must be preserved across migration runs"
        );
    });

    test("double-run after a sync round-trip does not append a new mergedChildIds edit", async () => {
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const childId = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 50",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span>Parent first.</span>",
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 50:12-13"),
                    edits: [],
                },
            },
            {
                value: "<span>Child second.</span>",
                metadata: {
                    id: childId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 50:12-13"),
                    parentId,
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        // First migration: merges child -> parent
        await migrateVerseRangeLabelsAndPositionsForFile(uri);
        const after1Bytes = await vscode.workspace.fs.readFile(uri);
        const after1Text = Buffer.from(after1Bytes).toString("utf8");

        // Build a "peer" branch where the child still looks like an unmerged sibling
        // (no data.deleted, no mergedChildIds tracked on the parent).
        const peer: any = JSON.parse(after1Text);
        for (const c of peer.cells) {
            if (c.metadata?.id === childId && c.metadata?.data) {
                delete c.metadata.data.deleted;
                c.metadata.edits = (c.metadata.edits || []).filter(
                    (e: any) => e.editMap?.join(".") !== "metadata.data.deleted"
                );
            }
            if (c.metadata?.id === parentId && c.metadata?.data) {
                delete c.metadata.data.mergedChildIds;
                c.metadata.edits = (c.metadata.edits || []).filter(
                    (e: any) =>
                        e.editMap?.join(".") !== "metadata.data.mergedChildIds" &&
                        e.editMap?.join(".") !== "value"
                );
                c.value = "<span>Parent first.</span>";
            }
        }
        const peerText = JSON.stringify(peer);

        // Sync round-trip: merge ours-migrated against peer-unmigrated. Ours order should win,
        // and the helper running inside the resolver guarantees the merged file is in the
        // migrated cell order with the merge phase's edits intact.
        const merged = await resolveCodexCustomMerge(after1Text, peerText);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(merged, "utf8"));

        // Run the migration again. Because mergedChildIds is still tracked in the merged
        // edit history, the merge phase must NOT append a new mergedChildIds edit.
        await migrateVerseRangeLabelsAndPositionsForFile(uri);

        const final = await readNotebookFile(uri);
        const parentFinal = final.cells.find((c: any) => c.metadata?.id === parentId);
        const trackingEdits = (parentFinal.metadata?.edits || []).filter(
            (e: any) => e.editMap?.join(".") === "metadata.data.mergedChildIds"
        );
        assert.strictEqual(
            trackingEdits.length,
            1,
            "After sync + re-migration there should still be exactly one mergedChildIds edit"
        );
        assert.strictEqual(
            parentFinal.value,
            "<span>Parent first.</span><span>Child second.</span>",
            "Parent value must not be doubled across sync + re-migration"
        );
    });
});
