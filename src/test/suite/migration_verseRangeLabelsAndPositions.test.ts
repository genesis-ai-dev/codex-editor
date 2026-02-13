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
        assert.strictEqual(data.cells.length, 3, "Should have same number of cells");

        const first = data.cells[0];
        const second = data.cells[1];
        const third = data.cells[2];

        assert.strictEqual(first.metadata?.type, CodexCellTypes.MILESTONE, "First cell should be milestone");
        assert.strictEqual(first.value, "John 4");

        assert.strictEqual(second.metadata?.type, CodexCellTypes.TEXT, "Second cell should be content 4:1-3");
        assert.deepStrictEqual(second.metadata?.data?.globalReferences, ["JHN 4:1-3"]);
        assert.strictEqual(second.metadata?.cellLabel, "1-3", "Verse range cell should have cellLabel 1-3");

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
        assert.strictEqual(data.cells[0].metadata?.type, CodexCellTypes.MILESTONE);
        assert.strictEqual(data.cells[1].metadata?.data?.globalReferences?.[0], "JHN 4:1-3");
        assert.strictEqual(data.cells[1].metadata?.cellLabel, "1-3");
        assert.strictEqual(data.cells[2].metadata?.data?.globalReferences?.[0], "JHN 4:4");
    });
});
