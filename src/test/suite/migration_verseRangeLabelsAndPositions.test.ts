import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { CodexContentSerializer } from "../../serializer";
import { migrateVerseRangeLabelsAndPositionsForFile } from "../../projectManager/utils/migrationUtils";
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
        // Original (deleted) at index 0 + milestone + duplicate + verse 4:4 = 4 cells
        assert.strictEqual(data.cells.length, 4, "Should have 4 cells (deleted original + milestone + duplicate + 4:4)");

        const first = data.cells[0];
        const second = data.cells[1];
        const third = data.cells[2];
        const fourth = data.cells[3];

        // Original stays at index 0, marked as deleted
        assert.strictEqual(first.metadata?.type, CodexCellTypes.TEXT, "First cell should be original (deleted)");
        assert.deepStrictEqual(first.metadata?.data?.globalReferences, ["JHN 4:1-3"]);
        assert.strictEqual(first.metadata?.data?.deleted, true, "Original should be marked deleted");

        assert.strictEqual(second.metadata?.type, CodexCellTypes.MILESTONE, "Second cell should be milestone");
        assert.strictEqual(second.value, "John 4");

        // Duplicate at correct position after milestone
        assert.strictEqual(third.metadata?.type, CodexCellTypes.TEXT, "Third cell should be duplicate 4:1-3");
        assert.strictEqual(third.metadata?.id, `${id1}-duplicated`, "Duplicate should have -duplicated id");
        assert.deepStrictEqual(third.metadata?.data?.globalReferences, ["JHN 4:1-3"]);
        assert.strictEqual(third.metadata?.cellLabel, "1-3", "Verse range duplicate should have cellLabel 1-3");

        assert.strictEqual(fourth.metadata?.type, CodexCellTypes.TEXT, "Fourth cell should be content 4:4");
        assert.strictEqual(fourth.metadata?.cellLabel, "4");
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
        // Same as first test: original (deleted) at 0, milestone at 1, duplicate at 2, 4:4 at 3
        assert.strictEqual(data.cells.length, 4);
        assert.strictEqual(data.cells[0].metadata?.type, CodexCellTypes.TEXT);
        assert.strictEqual(data.cells[0].metadata?.data?.deleted, true);
        assert.strictEqual(data.cells[1].metadata?.type, CodexCellTypes.MILESTONE);
        assert.strictEqual(data.cells[2].metadata?.data?.globalReferences?.[0], "JHN 4:1-3");
        assert.strictEqual(data.cells[2].metadata?.cellLabel, "1-3");
        assert.strictEqual(data.cells[2].metadata?.id, `${id1}-duplicated`);
        assert.strictEqual(data.cells[3].metadata?.data?.globalReferences?.[0], "JHN 4:4");
    });
});
