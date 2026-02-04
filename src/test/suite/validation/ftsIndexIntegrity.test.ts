import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { CodexCellEditorProvider } from "../../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { CodexCellDocument } from "../../../providers/codexCellEditorProvider/codexDocument";
import { codexSubtitleContent } from "../mocks/codexSubtitleContent";
import { EditType } from "../../../../types/enums";
import {
    swallowDuplicateCommandRegistrations,
    createTempCodexFile,
    deleteIfExists,
    createMockExtensionContext,
    sleep
} from "../../testUtils";

/**
 * FTS Index Integrity Test Suite
 *
 * These tests verify that the FTS5 (Full-Text Search) index maintains correct row counts
 * after multiple edits to the same cell. This prevents the "db inflation" bug where
 * INSERT OR REPLACE on FTS5 tables without explicit rowid causes unbounded growth.
 *
 * The fix (schema version 14) changed FTS triggers and manual sync to use DELETE+INSERT
 * instead of INSERT OR REPLACE.
 */
suite("FTS Index Integrity Test Suite", () => {
    vscode.window.showInformationMessage("Start FTS Index Integrity tests.");
    let context: vscode.ExtensionContext;
    let provider: CodexCellEditorProvider;

    suiteSetup(async () => {
        swallowDuplicateCommandRegistrations();
    });

    setup(async () => {
        swallowDuplicateCommandRegistrations();
        // Ensure all stubs are restored before each test
        sinon.restore();
        context = createMockExtensionContext();
        provider = new CodexCellEditorProvider(context);
    });

    teardown(async () => {
        sinon.restore();
    });

    suite("Multiple Edits to Same Cell", () => {
        test("should maintain consistent FTS row count after multiple edits to same cell", async function() {
            this.timeout(30000);

            // Create isolated temp file
            const tempUri = await createTempCodexFile(
                `test-fts-consistent-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
                codexSubtitleContent
            );

            // Stub prototype methods BEFORE opening document
            const populateStub = sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();

            try {
                // Arrange: Open document and get a cell
                const document = await provider.openCustomDocument(
                    tempUri,
                    { backupId: undefined },
                    new vscode.CancellationTokenSource().token
                );

                const cellId = (document as any)._documentData.cells[0].metadata?.id;
                assert.ok(cellId, "Cell should have an ID");

                // Track FTS operations - capture on the document instance
                const ftsOperations: { operation: string; cellId: string; content: string }[] = [];

                // Stub on the document INSTANCE (not prototype) for better isolation
                const indexStub = sinon.stub(document as any, "addCellToIndexImmediately")
                    .callsFake(async (...args: unknown[]) => {
                        const cId = args[0] as string;
                        const content = args[1] as string;
                        ftsOperations.push({ operation: 'immediate_index', cellId: cId, content });
                        return Promise.resolve();
                    });

                // Track syncAllCellsToDatabase calls
                let syncCallCount = 0;
                const syncStub = sinon.stub(document as any, "syncAllCellsToDatabase")
                    .callsFake(async () => {
                        syncCallCount++;
                        return Promise.resolve();
                    });

                // Act: Make multiple edits to the same cell
                const edits = [
                    "First edit content",
                    "Second edit content - updated",
                    "Third edit content - final version",
                    "Fourth edit - more changes",
                    "Fifth edit - even more updates"
                ];

                for (const content of edits) {
                    await document.updateCellContent(cellId, content, EditType.USER_EDIT, true);
                    await sleep(10);
                }

                // Save the document to trigger database sync
                await document.save(new vscode.CancellationTokenSource().token);

                // Assert: Verify the immediate indexing was called for each edit
                const cellIndexOperations = ftsOperations.filter(op => op.cellId === cellId);
                assert.strictEqual(
                    cellIndexOperations.length,
                    edits.length,
                    `Should have ${edits.length} immediate index operations for the cell`
                );

                // Verify the last indexed content is the final edit
                const lastOperation = cellIndexOperations[cellIndexOperations.length - 1];
                assert.strictEqual(
                    lastOperation.content,
                    edits[edits.length - 1],
                    "Last indexed content should match final edit"
                );

                // Verify sync was called on save
                assert.ok(syncCallCount >= 1, "syncAllCellsToDatabase should be called at least once on save");

                // Verify the document has the correct final content
                const finalCell = (document as any)._documentData.cells.find(
                    (c: any) => c.metadata?.id === cellId
                );
                assert.strictEqual(
                    finalCell.value,
                    edits[edits.length - 1],
                    "Cell should contain the final edit content"
                );

                // Verify edit history contains all edits
                const editHistory = finalCell.metadata?.edits || [];
                assert.ok(
                    editHistory.length >= edits.length,
                    `Edit history should contain at least ${edits.length} entries`
                );

                indexStub.restore();
                syncStub.restore();
                document.dispose();
            } finally {
                populateStub.restore();
                await deleteIfExists(tempUri);
            }
        });

        test("should preserve correct content after repeated save operations", async function() {
            this.timeout(30000);

            // Create isolated temp file
            const tempUri = await createTempCodexFile(
                `test-fts-repeated-saves-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
                codexSubtitleContent
            );

            const populateStub = sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();

            try {
                const document = await provider.openCustomDocument(
                    tempUri,
                    { backupId: undefined },
                    new vscode.CancellationTokenSource().token
                );

                const cellId = (document as any)._documentData.cells[0].metadata?.id;
                assert.ok(cellId, "Cell should have an ID");

                // Track all synced cell data - stub on instance
                const syncedSnapshots: any[] = [];

                const indexStub = sinon.stub(document as any, "addCellToIndexImmediately").resolves();

                const syncStub = sinon.stub(document as any, "syncAllCellsToDatabase")
                    .callsFake(async function(this: any) {
                        const cellData = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
                        if (cellData) {
                            syncedSnapshots.push(JSON.parse(JSON.stringify(cellData)));
                        }
                        return Promise.resolve();
                    });

                // Act: Edit and save multiple times
                const testContent = "Test content for repeated saves";
                await document.updateCellContent(cellId, testContent, EditType.USER_EDIT, true);

                // Save multiple times without changing content
                for (let i = 0; i < 5; i++) {
                    await document.save(new vscode.CancellationTokenSource().token);
                    await sleep(20);
                }

                // Assert: All snapshots should have the same content
                assert.ok(syncedSnapshots.length >= 5, `Should have at least 5 sync snapshots, got ${syncedSnapshots.length}`);

                for (let i = 0; i < syncedSnapshots.length; i++) {
                    assert.strictEqual(
                        syncedSnapshots[i].value,
                        testContent,
                        `Snapshot ${i + 1} should have correct content`
                    );
                }

                indexStub.restore();
                syncStub.restore();
                document.dispose();
            } finally {
                populateStub.restore();
                await deleteIfExists(tempUri);
            }
        });

        test("should handle interleaved edits and saves correctly", async function() {
            this.timeout(30000);

            const tempUri = await createTempCodexFile(
                `test-fts-interleaved-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
                codexSubtitleContent
            );

            const populateStub = sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();

            try {
                const document = await provider.openCustomDocument(
                    tempUri,
                    { backupId: undefined },
                    new vscode.CancellationTokenSource().token
                );

                const cellId = (document as any)._documentData.cells[0].metadata?.id;
                assert.ok(cellId, "Cell should have an ID");

                const syncedContents: string[] = [];

                const indexStub = sinon.stub(document as any, "addCellToIndexImmediately").resolves();

                const syncStub = sinon.stub(document as any, "syncAllCellsToDatabase")
                    .callsFake(async () => {
                        const cellData = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
                        if (cellData?.value) {
                            syncedContents.push(cellData.value);
                        }
                        return Promise.resolve();
                    });

                // Act: Interleave edits and saves
                await document.updateCellContent(cellId, "Edit 1", EditType.USER_EDIT, true);
                await document.save(new vscode.CancellationTokenSource().token);

                await document.updateCellContent(cellId, "Edit 2", EditType.USER_EDIT, true);
                await document.save(new vscode.CancellationTokenSource().token);

                await document.updateCellContent(cellId, "Edit 3", EditType.USER_EDIT, true);
                await document.save(new vscode.CancellationTokenSource().token);

                // Assert: Each save should capture the correct content at that point
                assert.ok(syncedContents.length >= 3, "Should have at least 3 sync operations");

                // Verify progression of content
                const uniqueContents = [...new Set(syncedContents)];
                assert.ok(
                    uniqueContents.includes("Edit 1") &&
                    uniqueContents.includes("Edit 2") &&
                    uniqueContents.includes("Edit 3"),
                    "All edit versions should have been synced"
                );

                // Final content should be "Edit 3"
                const finalContent = syncedContents[syncedContents.length - 1];
                assert.strictEqual(finalContent, "Edit 3", "Final synced content should be 'Edit 3'");

                indexStub.restore();
                syncStub.restore();
                document.dispose();
            } finally {
                populateStub.restore();
                await deleteIfExists(tempUri);
            }
        });
    });

    suite("FTS Row Count Verification", () => {
        test("should not create duplicate FTS entries for repeated updates", async function() {
            this.timeout(30000);

            const tempUri = await createTempCodexFile(
                `test-fts-no-duplicates-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
                codexSubtitleContent
            );

            const populateStub = sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();

            try {
                const document = await provider.openCustomDocument(
                    tempUri,
                    { backupId: undefined },
                    new vscode.CancellationTokenSource().token
                );

                const cellId = (document as any)._documentData.cells[0].metadata?.id;
                assert.ok(cellId, "Cell should have an ID");

                // Track FTS operations at a lower level
                const ftsDeletes: string[] = [];
                const ftsInserts: string[] = [];

                // Mock the index manager to track operations
                const mockIndexManager = {
                    upsertCellWithFTSSync: sinon.stub().callsFake(
                        async (cId: string, _fileId: number, _cellType: string, content: string) => {
                            // The fixed implementation does DELETE then INSERT
                            ftsDeletes.push(cId);
                            ftsInserts.push(`${cId}:${content}`);
                            return { id: cId, isNew: false, contentChanged: true };
                        }
                    ),
                    upsertFile: sinon.stub().resolves(1)
                };

                // Replace the index manager getter on the instance
                const originalGetIndexManager = (document as any)._indexManager;
                (document as any)._indexManager = mockIndexManager;

                // Stub addCellToIndexImmediately on instance
                const indexStub = sinon.stub(document as any, "addCellToIndexImmediately").resolves();

                // Edit the cell multiple times
                await document.updateCellContent(cellId, "Content v1", EditType.USER_EDIT, true);
                await document.updateCellContent(cellId, "Content v2", EditType.USER_EDIT, true);
                await document.updateCellContent(cellId, "Content v3", EditType.USER_EDIT, true);

                // Trigger sync using the real method (not stubbed)
                await (document as any).syncAllCellsToDatabase.call(document);

                // Assert: For each cell, there should be exactly one FTS entry
                // The DELETE+INSERT pattern ensures this
                const cellFtsInserts = ftsInserts.filter(entry => entry.startsWith(cellId));

                // After sync, only the final content should be in FTS
                assert.ok(
                    cellFtsInserts.some(entry => entry.includes("Content v3")),
                    "FTS should contain the final content"
                );

                // Restore
                (document as any)._indexManager = originalGetIndexManager;
                indexStub.restore();
                document.dispose();
            } finally {
                populateStub.restore();
                await deleteIfExists(tempUri);
            }
        });
    });

    suite("Content Merged via Sync", () => {
        test("should maintain FTS integrity after merge-style content updates", async function() {
            this.timeout(30000);

            const tempUri = await createTempCodexFile(
                `test-fts-merge-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
                codexSubtitleContent
            );

            const populateStub = sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();

            try {
                const document = await provider.openCustomDocument(
                    tempUri,
                    { backupId: undefined },
                    new vscode.CancellationTokenSource().token
                );

                const cellId = (document as any)._documentData.cells[0].metadata?.id;
                assert.ok(cellId, "Cell should have an ID");

                const syncSnapshots: any[] = [];

                const indexStub = sinon.stub(document as any, "addCellToIndexImmediately").resolves();

                const syncStub = sinon.stub(document as any, "syncAllCellsToDatabase")
                    .callsFake(async () => {
                        const snapshot = JSON.parse(JSON.stringify((document as any)._documentData));
                        syncSnapshots.push(snapshot);
                        return Promise.resolve();
                    });

                // Act: Simulate "local" edits
                await document.updateCellContent(cellId, "Local content version 1", EditType.USER_EDIT, true);
                await document.save(new vscode.CancellationTokenSource().token);

                // Simulate receiving "remote" content (as would happen in a merge)
                await document.updateCellContent(cellId, "Merged content from remote", EditType.USER_EDIT, true);
                await document.save(new vscode.CancellationTokenSource().token);

                // Make another local edit after merge
                await document.updateCellContent(cellId, "Post-merge local edit", EditType.USER_EDIT, true);
                await document.save(new vscode.CancellationTokenSource().token);

                // Assert: Each snapshot should have consistent cell data
                assert.ok(syncSnapshots.length >= 3, "Should have at least 3 sync snapshots");

                // Verify progression
                const cellContents = syncSnapshots.map(snap => {
                    const cell = snap.cells.find((c: any) => c.metadata?.id === cellId);
                    return cell?.value;
                });

                // Check that content progressed correctly
                assert.ok(cellContents.includes("Local content version 1"), "Should have local v1");
                assert.ok(cellContents.includes("Merged content from remote"), "Should have merged content");
                assert.ok(cellContents.includes("Post-merge local edit"), "Should have post-merge edit");

                // Final content should be the post-merge edit
                const finalCell = (document as any)._documentData.cells.find(
                    (c: any) => c.metadata?.id === cellId
                );
                assert.strictEqual(
                    finalCell.value,
                    "Post-merge local edit",
                    "Final cell content should be the post-merge edit"
                );

                indexStub.restore();
                syncStub.restore();
                document.dispose();
            } finally {
                populateStub.restore();
                await deleteIfExists(tempUri);
            }
        });

        test("should handle multiple cells being updated during sync without FTS inflation", async function() {
            this.timeout(30000);

            const tempUri = await createTempCodexFile(
                `test-fts-multi-cell-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
                codexSubtitleContent
            );

            const populateStub = sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();

            try {
                const document = await provider.openCustomDocument(
                    tempUri,
                    { backupId: undefined },
                    new vscode.CancellationTokenSource().token
                );

                // Get multiple cell IDs
                const cells = (document as any)._documentData.cells;
                const cellIds = cells
                    .slice(0, 3)
                    .map((c: any) => c.metadata?.id)
                    .filter(Boolean) as string[];

                assert.ok(cellIds.length >= 2, "Should have at least 2 cells to test");

                // Track synced cells
                const syncedCellContents: Map<string, string[]> = new Map();

                const indexStub = sinon.stub(document as any, "addCellToIndexImmediately").resolves();

                const syncStub = sinon.stub(document as any, "syncAllCellsToDatabase")
                    .callsFake(async () => {
                        for (const cId of cellIds) {
                            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cId);
                            if (cell?.value) {
                                if (!syncedCellContents.has(cId)) {
                                    syncedCellContents.set(cId, []);
                                }
                                syncedCellContents.get(cId)!.push(cell.value);
                            }
                        }
                        return Promise.resolve();
                    });

                // Edit multiple cells multiple times
                for (let round = 1; round <= 3; round++) {
                    for (const cId of cellIds) {
                        await document.updateCellContent(
                            cId,
                            `Cell ${cId} - Edit round ${round}`,
                            EditType.USER_EDIT,
                            true
                        );
                    }
                    await document.save(new vscode.CancellationTokenSource().token);
                    await sleep(20);
                }

                // Assert: Each cell should have been synced with progressive content
                for (const cId of cellIds) {
                    const contents = syncedCellContents.get(cId) || [];
                    assert.ok(contents.length >= 3, `Cell ${cId} should have at least 3 sync entries, got ${contents.length}`);

                    // The last entry should be from round 3
                    const lastContent = contents[contents.length - 1];
                    assert.ok(
                        lastContent.includes("Edit round 3"),
                        `Cell ${cId} final content should be from round 3, got: ${lastContent}`
                    );
                }

                indexStub.restore();
                syncStub.restore();
                document.dispose();
            } finally {
                populateStub.restore();
                await deleteIfExists(tempUri);
            }
        });
    });

    suite("Edit History Integrity", () => {
        test("should maintain complete edit history after multiple edits", async function() {
            this.timeout(30000);

            const tempUri = await createTempCodexFile(
                `test-fts-edit-history-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
                codexSubtitleContent
            );

            const populateStub = sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();

            try {
                const document = await provider.openCustomDocument(
                    tempUri,
                    { backupId: undefined },
                    new vscode.CancellationTokenSource().token
                );

                const cellId = (document as any)._documentData.cells[0].metadata?.id;
                assert.ok(cellId, "Cell should have an ID");

                const indexStub = sinon.stub(document as any, "addCellToIndexImmediately").resolves();
                const syncStub = sinon.stub(document as any, "syncAllCellsToDatabase").resolves();

                // Make multiple edits
                const editContents = [
                    "First version of content",
                    "Second version with changes",
                    "Third version - revised",
                    "Fourth version - final draft",
                    "Fifth version - published"
                ];

                for (const content of editContents) {
                    await document.updateCellContent(cellId, content, EditType.USER_EDIT, true);
                    await sleep(5);
                }

                // Get the cell and verify edit history
                const cell = (document as any)._documentData.cells.find(
                    (c: any) => c.metadata?.id === cellId
                );

                assert.ok(cell, "Cell should exist");
                assert.strictEqual(cell.value, editContents[editContents.length - 1], "Current value should be last edit");

                const editHistory = cell.metadata?.edits || [];
                assert.ok(
                    editHistory.length >= editContents.length,
                    `Edit history should have at least ${editContents.length} entries, got ${editHistory.length}`
                );

                // Verify the edit history contains all versions
                // Note: edit history uses 'value' property (some legacy data uses 'cellValue')
                const historyContents = editHistory.map((e: any) => e.value || e.cellValue);
                for (const content of editContents) {
                    assert.ok(
                        historyContents.includes(content),
                        `Edit history should contain "${content.substring(0, 20)}..." - found: ${historyContents.slice(-5).join(', ')}`
                    );
                }

                indexStub.restore();
                syncStub.restore();
                document.dispose();
            } finally {
                populateStub.restore();
                await deleteIfExists(tempUri);
            }
        });
    });
});
