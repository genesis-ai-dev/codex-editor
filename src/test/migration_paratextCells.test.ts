import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { CodexContentSerializer } from "../serializer";
import { migrateParatextCellsForFile } from "../projectManager/utils/migrationUtils";
import { CodexCellTypes } from "../../types/enums";
import { createMockExtensionContext } from "./testUtils";

async function createTempNotebookFile(
    ext: ".codex" | ".source",
    cells: Array<{ id?: string; cellLabel?: string; value?: string; metadata?: any; }>,
    metadata: any = {}
): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    const tmpDir = os.tmpdir();
    const fileName = `paratext-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
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

describe("migrateParatextCellsForFile", () => {
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

    it("should move misplaced paratext cell to before its parent", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "In the beginning" },
                { id: "GEN 1:2", value: "The earth was formless" },
                { id: "GEN 1:1:paratext-123456", value: "Paratext note", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 3, "Should have same number of cells");
        // Paratext cell should now be before its parent
        assert.strictEqual(data.cells[0].metadata?.id, "GEN 1:1:paratext-123456", "Paratext should be first");
        assert.strictEqual(data.cells[1].metadata?.id, "GEN 1:1", "Parent should be second");
        assert.strictEqual(data.cells[2].metadata?.id, "GEN 1:2", "Other cell should remain");
    });

    it("should handle multiple misplaced paratext cells for different parents", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "Verse 1" },
                { id: "GEN 1:2", value: "Verse 2" },
                { id: "GEN 2:1", value: "Chapter 2 verse 1" },
                { id: "GEN 1:1:paratext-111", value: "Paratext 1", metadata: { type: CodexCellTypes.PARATEXT } },
                { id: "GEN 2:1:paratext-222", value: "Paratext 2", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 5, "Should have same number of cells");
        // First paratext should be before GEN 1:1
        assert.strictEqual(data.cells[0].metadata?.id, "GEN 1:1:paratext-111", "First paratext should be before GEN 1:1");
        assert.strictEqual(data.cells[1].metadata?.id, "GEN 1:1", "GEN 1:1 should follow its paratext");
        assert.strictEqual(data.cells[2].metadata?.id, "GEN 1:2", "GEN 1:2 should remain");
        // Second paratext should be before GEN 2:1
        assert.strictEqual(data.cells[3].metadata?.id, "GEN 2:1:paratext-222", "Second paratext should be before GEN 2:1");
        assert.strictEqual(data.cells[4].metadata?.id, "GEN 2:1", "GEN 2:1 should follow its paratext");
    });

    it("should handle multiple paratext cells for the same parent", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "Verse 1" },
                { id: "GEN 1:2", value: "Verse 2" },
                { id: "GEN 1:1:paratext-111", value: "Paratext 1", metadata: { type: CodexCellTypes.PARATEXT } },
                { id: "GEN 1:1:paratext-222", value: "Paratext 2", metadata: { type: CodexCellTypes.PARATEXT } },
                { id: "GEN 1:1:paratext-333", value: "Paratext 3", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 5, "Should have same number of cells");
        // All paratext cells should be before GEN 1:1, maintaining their relative order
        assert.strictEqual(data.cells[0].metadata?.id, "GEN 1:1:paratext-111", "First paratext should be first");
        assert.strictEqual(data.cells[1].metadata?.id, "GEN 1:1:paratext-222", "Second paratext should be second");
        assert.strictEqual(data.cells[2].metadata?.id, "GEN 1:1:paratext-333", "Third paratext should be third");
        assert.strictEqual(data.cells[3].metadata?.id, "GEN 1:1", "Parent should follow all its paratext cells");
        assert.strictEqual(data.cells[4].metadata?.id, "GEN 1:2", "Other cell should remain");
    });

    it("should not modify files with no paratext cells", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "Verse 1" },
                { id: "GEN 1:2", value: "Verse 2" },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, false, "Migration should not have occurred");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 2, "Should have same number of cells");
    });

    it("should not modify files with correctly positioned paratext cells", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1:paratext-123456", value: "Paratext note", metadata: { type: CodexCellTypes.PARATEXT } },
                { id: "GEN 1:1", value: "In the beginning" },
                { id: "GEN 1:2", value: "The earth was formless" },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, false, "Migration should not have occurred when paratext is correctly positioned");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 3, "Should have same number of cells");
        // Order should remain unchanged
        assert.strictEqual(data.cells[0].metadata?.id, "GEN 1:1:paratext-123456", "Paratext should remain first");
        assert.strictEqual(data.cells[1].metadata?.id, "GEN 1:1", "Parent should remain second");
    });

    it("should not modify files with paratext cells immediately after parent", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "In the beginning" },
                { id: "GEN 1:1:paratext-123456", value: "Paratext note", metadata: { type: CodexCellTypes.PARATEXT } },
                { id: "GEN 1:2", value: "The earth was formless" },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, false, "Migration should not have occurred when paratext is immediately after parent");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 3, "Should have same number of cells");
        // Order should remain unchanged
        assert.strictEqual(data.cells[0].metadata?.id, "GEN 1:1", "Parent should remain first");
        assert.strictEqual(data.cells[1].metadata?.id, "GEN 1:1:paratext-123456", "Paratext should remain second");
    });

    it("should handle files with milestone cells", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "milestone-1", value: "1", metadata: { type: CodexCellTypes.MILESTONE } },
                { id: "GEN 1:1", value: "Verse 1" },
                { id: "GEN 1:2", value: "Verse 2" },
                { id: "GEN 1:1:paratext-123456", value: "Paratext note", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 4, "Should have same number of cells");
        // Milestone should remain first, paratext should be before parent
        assert.strictEqual(data.cells[0].metadata?.id, "milestone-1", "Milestone should remain first");
        assert.strictEqual(data.cells[1].metadata?.id, "GEN 1:1:paratext-123456", "Paratext should be before parent");
        assert.strictEqual(data.cells[2].metadata?.id, "GEN 1:1", "Parent should follow paratext");
        assert.strictEqual(data.cells[3].metadata?.id, "GEN 1:2", "Other cell should remain");
    });

    it("should skip paratext cells with invalid parent IDs", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "Verse 1" },
                { id: "INVALID:paratext-123456", value: "Invalid paratext", metadata: { type: CodexCellTypes.PARATEXT } },
                { id: "GEN 1:1:paratext-111", value: "Valid paratext", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred for valid paratext");
        const data = await readNotebookFile(uri);
        // Valid paratext should be moved, invalid one should remain at end
        const validParatextIndex = data.cells.findIndex((c: any) => c.metadata?.id === "GEN 1:1:paratext-111");
        const invalidParatextIndex = data.cells.findIndex((c: any) => c.metadata?.id === "INVALID:paratext-123456");
        const parentIndex = data.cells.findIndex((c: any) => c.metadata?.id === "GEN 1:1");

        assert.ok(validParatextIndex < parentIndex, "Valid paratext should be before parent");
        assert.ok(invalidParatextIndex > parentIndex, "Invalid paratext should remain after parent");
    });

    it("should skip paratext cells whose parent cell is not found", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "Verse 1" },
                { id: "GEN 2:1:paratext-123456", value: "Paratext for non-existent parent", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, false, "Migration should not have occurred when parent is not found");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 2, "Should have same number of cells");
        // Order should remain unchanged
        assert.strictEqual(data.cells[0].metadata?.id, "GEN 1:1", "Parent should remain first");
        assert.strictEqual(data.cells[1].metadata?.id, "GEN 2:1:paratext-123456", "Paratext should remain at end");
    });

    it("should handle empty files gracefully", async () => {
        const uri = await createTempNotebookFile(".codex", []);
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, false, "Migration should not have occurred for empty file");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 0, "Should remain empty");
    });

    it("should handle files with only paratext and milestone cells", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "milestone-1", value: "1", metadata: { type: CodexCellTypes.MILESTONE } },
                { id: "GEN 1:1:paratext-123456", value: "Paratext note", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, false, "Migration should not have occurred when no content cells exist");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 2, "Should have same number of cells");
    });

    it("should be idempotent - running twice should not change result", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "Verse 1" },
                { id: "GEN 1:2", value: "Verse 2" },
                { id: "GEN 1:1:paratext-123456", value: "Paratext note", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        testFiles.push(uri);

        // First migration
        const firstMigration = await migrateParatextCellsForFile(uri);
        assert.strictEqual(firstMigration, true, "First migration should have occurred");
        const firstData = await readNotebookFile(uri);
        const firstOrder = firstData.cells.map((c: any) => c.metadata?.id);

        // Second migration
        const secondMigration = await migrateParatextCellsForFile(uri);
        assert.strictEqual(secondMigration, false, "Second migration should not have occurred");
        const secondData = await readNotebookFile(uri);
        const secondOrder = secondData.cells.map((c: any) => c.metadata?.id);

        assert.deepStrictEqual(firstOrder, secondOrder, "Order should remain unchanged after second migration");
    });

    it("should handle complex scenario with mixed cell types", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "milestone-1", value: "1", metadata: { type: CodexCellTypes.MILESTONE } },
                { id: "GEN 1:1", value: "Verse 1" },
                { id: "GEN 1:2", value: "Verse 2" },
                { id: "milestone-2", value: "2", metadata: { type: CodexCellTypes.MILESTONE } },
                { id: "GEN 2:1", value: "Chapter 2 verse 1" },
                { id: "GEN 1:1:paratext-111", value: "Paratext 1", metadata: { type: CodexCellTypes.PARATEXT } },
                { id: "GEN 2:1:paratext-222", value: "Paratext 2", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        testFiles.push(uri);

        const wasMigrated = await migrateParatextCellsForFile(uri);

        assert.strictEqual(wasMigrated, true, "Migration should have occurred");
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 7, "Should have same number of cells");

        // Verify order: milestones first, then paratext before their parents
        assert.strictEqual(data.cells[0].metadata?.id, "milestone-1", "First milestone should remain first");
        assert.strictEqual(data.cells[1].metadata?.id, "GEN 1:1:paratext-111", "Paratext 1 should be before GEN 1:1");
        assert.strictEqual(data.cells[2].metadata?.id, "GEN 1:1", "GEN 1:1 should follow its paratext");
        assert.strictEqual(data.cells[3].metadata?.id, "GEN 1:2", "GEN 1:2 should remain");
        assert.strictEqual(data.cells[4].metadata?.id, "milestone-2", "Second milestone should remain");
        assert.strictEqual(data.cells[5].metadata?.id, "GEN 2:1:paratext-222", "Paratext 2 should be before GEN 2:1");
        assert.strictEqual(data.cells[6].metadata?.id, "GEN 2:1", "GEN 2:1 should follow its paratext");
    });

    it("should process both .codex and .source files", async () => {
        const codexUri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "Codex content" },
                { id: "GEN 1:1:paratext-123456", value: "Paratext note", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        const sourceUri = await createTempNotebookFile(
            ".source",
            [
                { id: "GEN 1:1", value: "Source content" },
                { id: "GEN 1:1:paratext-123456", value: "Paratext note", metadata: { type: CodexCellTypes.PARATEXT } },
            ]
        );
        testFiles.push(codexUri, sourceUri);

        const codexMigrated = await migrateParatextCellsForFile(codexUri);
        const sourceMigrated = await migrateParatextCellsForFile(sourceUri);

        assert.strictEqual(codexMigrated, true, "Codex file should be migrated");
        assert.strictEqual(sourceMigrated, true, "Source file should be migrated");

        const codexData = await readNotebookFile(codexUri);
        const sourceData = await readNotebookFile(sourceUri);

        assert.strictEqual(codexData.cells[0].metadata?.id, "GEN 1:1:paratext-123456", "Codex paratext should be first");
        assert.strictEqual(sourceData.cells[0].metadata?.id, "GEN 1:1:paratext-123456", "Source paratext should be first");
    });
});
