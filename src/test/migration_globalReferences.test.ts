import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { CodexContentSerializer } from "../serializer";
import { migrateGlobalReferencesForFile } from "../projectManager/utils/migrationUtils";
import { CodexCellTypes } from "../../types/enums";
import { createMockExtensionContext } from "./testUtils";

async function createTempNotebookFile(
    ext: ".codex" | ".source",
    cells: Array<{ id?: string; cellLabel?: string; value?: string; metadata?: any; }>,
    metadata: any = {}
): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    const tmpDir = os.tmpdir();
    const fileName = `globalref-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const uri = vscode.Uri.file(path.join(tmpDir, fileName));

    const notebook: any = {
        cells: cells.map((cell) => ({
            kind: 2,
            languageId: "scripture",
            value: cell.value || "test content",
            metadata: {
                id: cell.id || `cell-${Math.random()}`,
                ...cell.metadata,
            },
        })),
        metadata: metadata,
    };

    const bytes = await serializer.serializeNotebook(notebook, new vscode.CancellationTokenSource().token);
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
}

async function readNotebookFile(uri: vscode.Uri): Promise<any> {
    const fileBytes = await vscode.workspace.fs.readFile(uri);
    const serializer = new CodexContentSerializer();
    return await serializer.deserializeNotebook(fileBytes, new vscode.CancellationTokenSource().token);
}

describe("migrateGlobalReferencesForFile", () => {
    let testFiles: vscode.Uri[] = [];

    afterEach(async () => {
        // Clean up test files
        for (const uri of testFiles) {
            try {
                await vscode.workspace.fs.delete(uri);
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        testFiles = [];
    });

    it("should add globalReferences to content cells with their ID", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "LUK 1:1", value: "Forasmuch as many have taken in hand" },
                { id: "LUK 1:2", value: "Even as they delivered them unto us" },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateGlobalReferencesForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 2, "Should have same number of cells");

        // First cell should have globalReferences
        assert.ok(data.cells[0].metadata?.data?.globalReferences, "First cell should have globalReferences");
        assert.deepStrictEqual(
            data.cells[0].metadata.data.globalReferences,
            ["LUK 1:1"],
            "First cell globalReferences should contain its ID"
        );

        // Second cell should have globalReferences
        assert.ok(data.cells[1].metadata?.data?.globalReferences, "Second cell should have globalReferences");
        assert.deepStrictEqual(
            data.cells[1].metadata.data.globalReferences,
            ["LUK 1:2"],
            "Second cell globalReferences should contain its ID"
        );
    });

    it("should skip STYLE cells", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "LUK 1:1", value: "Content cell" },
                { id: "style-1", value: "Style content", metadata: { type: CodexCellTypes.STYLE } },
                { id: "LUK 1:2", value: "Another content cell" },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateGlobalReferencesForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);

        // Content cells should have globalReferences
        assert.ok(data.cells[0].metadata?.data?.globalReferences, "First content cell should have globalReferences");
        assert.ok(data.cells[2].metadata?.data?.globalReferences, "Third content cell should have globalReferences");

        // STYLE cell should NOT have globalReferences
        assert.strictEqual(
            data.cells[1].metadata?.data?.globalReferences,
            undefined,
            "STYLE cell should not have globalReferences"
        );
    });

    it("should skip PARATEXT cells", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "LUK 1:1", value: "Content cell" },
                { id: "LUK 1:1:paratext-123456", value: "Paratext note", metadata: { type: CodexCellTypes.PARATEXT } },
                { id: "LUK 1:2", value: "Another content cell" },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateGlobalReferencesForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);

        // Content cells should have globalReferences
        assert.ok(data.cells[0].metadata?.data?.globalReferences, "First content cell should have globalReferences");
        assert.ok(data.cells[2].metadata?.data?.globalReferences, "Third content cell should have globalReferences");

        // PARATEXT cell should NOT have globalReferences
        assert.strictEqual(
            data.cells[1].metadata?.data?.globalReferences,
            undefined,
            "PARATEXT cell should not have globalReferences"
        );
    });

    it("should skip MILESTONE cells", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "milestone-1", value: "1", metadata: { type: CodexCellTypes.MILESTONE } },
                { id: "LUK 1:1", value: "Content cell" },
                { id: "LUK 1:2", value: "Another content cell" },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateGlobalReferencesForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);

        // Content cells should have globalReferences
        assert.ok(data.cells[1].metadata?.data?.globalReferences, "Second content cell should have globalReferences");
        assert.ok(data.cells[2].metadata?.data?.globalReferences, "Third content cell should have globalReferences");

        // MILESTONE cell should NOT have globalReferences
        assert.strictEqual(
            data.cells[0].metadata?.data?.globalReferences,
            undefined,
            "MILESTONE cell should not have globalReferences"
        );
    });

    it("should skip cells with existing globalReferences", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                {
                    id: "LUK 1:1",
                    value: "Content cell",
                    metadata: {
                        data: {
                            globalReferences: ["LUK 1:1", "existing-ref"]
                        }
                    }
                },
                { id: "LUK 1:2", value: "Another content cell" },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateGlobalReferencesForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);

        // First cell should keep its existing globalReferences
        assert.deepStrictEqual(
            data.cells[0].metadata.data.globalReferences,
            ["LUK 1:1", "existing-ref"],
            "First cell should keep existing globalReferences unchanged"
        );

        // Second cell should get new globalReferences
        assert.deepStrictEqual(
            data.cells[1].metadata.data.globalReferences,
            ["LUK 1:2"],
            "Second cell should have new globalReferences"
        );
    });

    it("should skip cells without IDs", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "LUK 1:1", value: "Content cell with ID" },
                { value: "Content cell without ID", metadata: {} },
                { id: "LUK 1:2", value: "Another content cell with ID" },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateGlobalReferencesForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);

        // Cells with IDs should have globalReferences
        assert.ok(data.cells[0].metadata?.data?.globalReferences, "First cell with ID should have globalReferences");
        assert.ok(data.cells[2].metadata?.data?.globalReferences, "Third cell with ID should have globalReferences");

        // Cell without ID should NOT have globalReferences
        assert.strictEqual(
            data.cells[1].metadata?.data?.globalReferences,
            undefined,
            "Cell without ID should not have globalReferences"
        );
    });

    it("should be idempotent - running twice should not change result", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "LUK 1:1", value: "Content cell" },
                { id: "LUK 1:2", value: "Another content cell" },
            ]
        );
        testFiles.push(uri);

        // First migration
        const firstMigration = await migrateGlobalReferencesForFile(uri);
        assert.strictEqual(firstMigration, true, "First migration should have occurred");
        const firstData = await readNotebookFile(uri);
        const firstGlobalRefs = firstData.cells.map((c: any) => c.metadata?.data?.globalReferences);

        // Second migration
        const secondMigration = await migrateGlobalReferencesForFile(uri);
        assert.strictEqual(secondMigration, false, "Second migration should not have occurred");
        const secondData = await readNotebookFile(uri);
        const secondGlobalRefs = secondData.cells.map((c: any) => c.metadata?.data?.globalReferences);

        assert.deepStrictEqual(firstGlobalRefs, secondGlobalRefs, "GlobalReferences should remain unchanged after second migration");
    });

    it("should handle empty files gracefully", async () => {
        const uri = await createTempNotebookFile(".codex", []);
        testFiles.push(uri);

        const wasMigrated = await migrateGlobalReferencesForFile(uri);

        assert.strictEqual(wasMigrated, false, "Migration should not have occurred for empty file");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 0, "Should remain empty");
    });

    it("should handle files with only STYLE, PARATEXT, and MILESTONE cells", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "milestone-1", value: "1", metadata: { type: CodexCellTypes.MILESTONE } },
                { id: "style-1", value: "Style", metadata: { type: CodexCellTypes.STYLE } },
                { id: "LUK 1:1:paratext-123456", value: "Paratext note", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateGlobalReferencesForFile(uri);

        assert.strictEqual(wasMigrated, false, "Migration should not have occurred when no content cells exist");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 3, "Should have same number of cells");

        // None of the cells should have globalReferences
        for (const cell of data.cells) {
            assert.strictEqual(
                cell.metadata?.data?.globalReferences,
                undefined,
                "Non-content cells should not have globalReferences"
            );
        }
    });

    it("should process both .codex and .source files", async () => {
        const codexUri = await createTempNotebookFile(
            ".codex",
            [
                { id: "LUK 1:1", value: "Codex content" },
                { id: "LUK 1:2", value: "More codex content" },
            ]
        );
        const sourceUri = await createTempNotebookFile(
            ".source",
            [
                { id: "LUK 1:1", value: "Source content" },
                { id: "LUK 1:2", value: "More source content" },
            ]
        );
        testFiles.push(codexUri, sourceUri);

        const codexMigrated = await migrateGlobalReferencesForFile(codexUri);
        const sourceMigrated = await migrateGlobalReferencesForFile(sourceUri);

        assert.strictEqual(codexMigrated, true, "Codex file should be migrated");
        assert.strictEqual(sourceMigrated, true, "Source file should be migrated");

        const codexData = await readNotebookFile(codexUri);
        const sourceData = await readNotebookFile(sourceUri);

        // Both files should have globalReferences
        assert.ok(codexData.cells[0].metadata?.data?.globalReferences, "Codex cell should have globalReferences");
        assert.ok(sourceData.cells[0].metadata?.data?.globalReferences, "Source cell should have globalReferences");
    });

    it("should handle cells without metadata.data", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "LUK 1:1", value: "Content cell", metadata: {} },
                { id: "LUK 1:2", value: "Another content cell" },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateGlobalReferencesForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);

        // Both cells should have globalReferences in metadata.data
        assert.ok(data.cells[0].metadata?.data, "First cell should have metadata.data");
        assert.deepStrictEqual(
            data.cells[0].metadata.data.globalReferences,
            ["LUK 1:1"],
            "First cell should have globalReferences"
        );

        assert.ok(data.cells[1].metadata?.data, "Second cell should have metadata.data");
        assert.deepStrictEqual(
            data.cells[1].metadata.data.globalReferences,
            ["LUK 1:2"],
            "Second cell should have globalReferences"
        );
    });

    it("should handle mixed cell types correctly", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "milestone-1", value: "1", metadata: { type: CodexCellTypes.MILESTONE } },
                { id: "LUK 1:1", value: "Verse 1" },
                { id: "LUK 1:1:paratext-123456", value: "Paratext note", metadata: { type: CodexCellTypes.PARATEXT } },
                { id: "LUK 1:2", value: "Verse 2" },
                { id: "style-1", value: "Style", metadata: { type: CodexCellTypes.STYLE } },
                { id: "LUK 1:3", value: "Verse 3" },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateGlobalReferencesForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);

        // Content cells (LUK 1:1, LUK 1:2, LUK 1:3) should have globalReferences
        const verse1Cell = data.cells.find((c: any) => c.metadata?.id === "LUK 1:1");
        const verse2Cell = data.cells.find((c: any) => c.metadata?.id === "LUK 1:2");
        const verse3Cell = data.cells.find((c: any) => c.metadata?.id === "LUK 1:3");

        assert.ok(verse1Cell?.metadata?.data?.globalReferences, "Verse 1 should have globalReferences");
        assert.deepStrictEqual(verse1Cell.metadata.data.globalReferences, ["LUK 1:1"]);

        assert.ok(verse2Cell?.metadata?.data?.globalReferences, "Verse 2 should have globalReferences");
        assert.deepStrictEqual(verse2Cell.metadata.data.globalReferences, ["LUK 1:2"]);

        assert.ok(verse3Cell?.metadata?.data?.globalReferences, "Verse 3 should have globalReferences");
        assert.deepStrictEqual(verse3Cell.metadata.data.globalReferences, ["LUK 1:3"]);

        // Non-content cells should NOT have globalReferences
        const milestoneCell = data.cells.find((c: any) => c.metadata?.id === "milestone-1");
        const paratextCell = data.cells.find((c: any) => c.metadata?.id === "LUK 1:1:paratext-123456");
        const styleCell = data.cells.find((c: any) => c.metadata?.id === "style-1");

        assert.strictEqual(milestoneCell?.metadata?.data?.globalReferences, undefined, "Milestone should not have globalReferences");
        assert.strictEqual(paratextCell?.metadata?.data?.globalReferences, undefined, "Paratext should not have globalReferences");
        assert.strictEqual(styleCell?.metadata?.data?.globalReferences, undefined, "Style should not have globalReferences");
    });
});
