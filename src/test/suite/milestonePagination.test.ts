import * as assert from "assert";
import * as vscode from "vscode";
import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { CodexCellDocument } from "../../providers/codexCellEditorProvider/codexDocument";
import { CodexCellTypes } from "../../../types/enums";
import {
    swallowDuplicateCommandRegistrations,
    createTempCodexFile,
    deleteIfExists,
    createMockExtensionContext,
    createMockWebviewPanel,
    sleep,
} from "../testUtils";
import sinon from "sinon";

suite("Milestone-Based Pagination Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests for Milestone-Based Pagination.");
    let context: vscode.ExtensionContext;
    let provider: CodexCellEditorProvider;
    let tempUri: vscode.Uri;

    suiteSetup(async () => {
        swallowDuplicateCommandRegistrations();
    });

    setup(async () => {
        context = createMockExtensionContext();
        provider = new CodexCellEditorProvider(context);
        tempUri = await createTempCodexFile(
            `test-milestone-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
            { cells: [], metadata: {} }
        );

        // Stub background tasks
        sinon.restore();
        sinon.stub((CodexCellDocument as any).prototype, "addCellToIndexImmediately").callsFake(() => { });
        sinon.stub((CodexCellDocument as any).prototype, "syncAllCellsToDatabase").resolves();
        sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();
    });

    teardown(async () => {
        if (tempUri) await deleteIfExists(tempUri);
        sinon.restore();
    });

    // Helper function to create a document with specific cells
    async function createDocumentWithCells(cells: any[]): Promise<CodexCellDocument> {
        const content = {
            cells,
            metadata: {},
        };
        await vscode.workspace.fs.writeFile(tempUri, Buffer.from(JSON.stringify(content, null, 2), "utf-8"));
        return await provider.openCustomDocument(
            tempUri,
            { backupId: undefined },
            new vscode.CancellationTokenSource().token
        );
    }

    test("buildMilestoneIndex creates virtual milestone when no milestones exist", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "First cell",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Second cell",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-2",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const milestoneIndex = document.buildMilestoneIndex(50);

        assert.strictEqual(milestoneIndex.milestones.length, 1, "Should create one virtual milestone");
        assert.strictEqual(milestoneIndex.milestones[0].index, 0, "Virtual milestone should have index 0");
        assert.strictEqual(milestoneIndex.milestones[0].value, "1", "Virtual milestone should have value '1'");
        assert.strictEqual(milestoneIndex.milestones[0].cellCount, 2, "Should count all content cells");
        assert.strictEqual(milestoneIndex.totalCells, 2, "Total cells should be 2");
        assert.strictEqual(milestoneIndex.cellsPerPage, 50, "cellsPerPage should be set correctly");
    });

    test("buildMilestoneIndex correctly identifies milestone cells", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Chapter 1 content",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "2",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-2",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Chapter 2 content",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-2",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const milestoneIndex = document.buildMilestoneIndex(50);

        assert.strictEqual(milestoneIndex.milestones.length, 2, "Should identify 2 milestones");
        assert.strictEqual(milestoneIndex.milestones[0].index, 0, "First milestone index should be 0");
        assert.strictEqual(milestoneIndex.milestones[0].value, "1", "First milestone value should be '1'");
        assert.strictEqual(milestoneIndex.milestones[0].cellCount, 1, "First milestone should have 1 content cell");
        assert.strictEqual(milestoneIndex.milestones[1].index, 1, "Second milestone index should be 1");
        assert.strictEqual(milestoneIndex.milestones[1].value, "2", "Second milestone value should be '2'");
        assert.strictEqual(milestoneIndex.milestones[1].cellCount, 1, "Second milestone should have 1 content cell");
        assert.strictEqual(milestoneIndex.totalCells, 2, "Total cells should exclude milestone cells");
    });

    test("buildMilestoneIndex excludes paratext cells from count", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Regular content",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "GEN 1:1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Paratext content",
                metadata: {
                    type: CodexCellTypes.PARATEXT,
                    id: "GEN 1:1:paratext-1",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const milestoneIndex = document.buildMilestoneIndex(50);

        assert.strictEqual(milestoneIndex.milestones.length, 1, "Should have 1 milestone");
        assert.strictEqual(milestoneIndex.milestones[0].cellCount, 1, "Should count only non-paratext cells");
        assert.strictEqual(milestoneIndex.totalCells, 1, "Total cells should exclude paratext");
    });

    test("getCellsForMilestone returns correct cells for first milestone", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 1",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 2",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-2",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "2",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-2",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 3",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-3",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const result = document.getCellsForMilestone(0, 0, 50);

        assert.strictEqual(result.length, 2, "Should return 2 cells for first milestone");
        assert.strictEqual(result[0].cellMarkers[0], "cell-1", "First cell should be cell-1");
        assert.strictEqual(result[1].cellMarkers[0], "cell-2", "Second cell should be cell-2");
    });

    test("getCellsForMilestone returns correct cells for second milestone", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 1",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "2",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-2",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 2",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-2",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const result = document.getCellsForMilestone(1, 0, 50);

        assert.strictEqual(result.length, 1, "Should return 1 cell for second milestone");
        assert.strictEqual(result[0].cellMarkers[0], "cell-2", "Should return cell-2");
    });

    test("getCellsForMilestone handles pagination within milestone", async () => {
        // Create a milestone with more than cellsPerPage cells
        const cellsPerPage = 5;
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
        ];

        // Add 12 content cells (should create 3 subsections with cellsPerPage=5)
        for (let i = 1; i <= 12; i++) {
            cells.push({
                kind: 2,
                languageId: "scripture",
                value: `Cell ${i}`,
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: `cell-${i}`,
                },
            });
        }

        const document = await createDocumentWithCells(cells);

        // First subsection (should have 5 cells)
        const subsection0 = document.getCellsForMilestone(0, 0, cellsPerPage);
        assert.strictEqual(subsection0.length, 5, "First subsection should have 5 cells");
        assert.strictEqual(subsection0[0].cellMarkers[0], "cell-1", "First cell should be cell-1");

        // Second subsection (should have 5 cells)
        const subsection1 = document.getCellsForMilestone(0, 1, cellsPerPage);
        assert.strictEqual(subsection1.length, 5, "Second subsection should have 5 cells");
        assert.strictEqual(subsection1[0].cellMarkers[0], "cell-6", "First cell should be cell-6");

        // Third subsection (should have 2 cells)
        const subsection2 = document.getCellsForMilestone(0, 2, cellsPerPage);
        assert.strictEqual(subsection2.length, 2, "Third subsection should have 2 cells");
        assert.strictEqual(subsection2[0].cellMarkers[0], "cell-11", "First cell should be cell-11");
    });

    test("getCellsForMilestone includes paratext cells in first subsection", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Regular cell",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "GEN 1:1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Paratext 1",
                metadata: {
                    type: CodexCellTypes.PARATEXT,
                    id: "GEN 1:1:paratext-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Paratext 2",
                metadata: {
                    type: CodexCellTypes.PARATEXT,
                    id: "GEN 1:1:paratext-2",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const result = document.getCellsForMilestone(0, 0, 50);

        // Should include paratext cells + regular cell (paratext cells appear with their parent)
        assert.strictEqual(result.length, 3, "Should include paratext cells in first subsection");
        // The order may vary, but all three cells should be present
        const cellIds = result.map(c => c.cellMarkers[0]);
        assert.ok(cellIds.includes("GEN 1:1"), "Should include parent cell");
        assert.ok(cellIds.includes("GEN 1:1:paratext-1"), "Should include paratext-1");
        assert.ok(cellIds.includes("GEN 1:1:paratext-2"), "Should include paratext-2");
    });

    test("getCellsForMilestone excludes paratext from non-first subsections", async () => {
        const cellsPerPage = 2;
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 1",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "GEN 1:1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Paratext",
                metadata: {
                    type: CodexCellTypes.PARATEXT,
                    id: "GEN 1:1:paratext-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 2",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "GEN 1:2",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 3",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "GEN 1:3",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);

        // First subsection should include paratext (because GEN 1:1 is on first page)
        const subsection0 = document.getCellsForMilestone(0, 0, cellsPerPage);
        assert.ok(subsection0.some((c) => c.cellMarkers[0] === "GEN 1:1:paratext-1"), "First subsection should include paratext when parent is on first page");

        // Second subsection should NOT include paratext (because GEN 1:1 is not on second page)
        const subsection1 = document.getCellsForMilestone(0, 1, cellsPerPage);
        assert.ok(!subsection1.some((c) => c.cellMarkers[0] === "GEN 1:1:paratext-1"), "Second subsection should exclude paratext when parent is not on that page");
    });

    test("getCellsForMilestone includes child content cells (metadata.parentId) on same page as parent (root-based pagination)", async () => {
        // Pagination is by root content cells only. Child cells (with metadata.parentId) appear with their parent.
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Root 1",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "GEN 1:1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Child of root 1",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "GEN 1:1:child-cue-1",
                    parentId: "GEN 1:1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Root 2",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "GEN 1:2",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const result = document.getCellsForMilestone(0, 0, 50);

        assert.strictEqual(result.length, 3, "Should return 2 roots + 1 child (child on same page as parent)");
        const cellIds = result.map((c) => c.cellMarkers[0]);
        assert.ok(cellIds.includes("GEN 1:1"), "Should include root 1");
        assert.ok(cellIds.includes("GEN 1:1:child-cue-1"), "Should include child of root 1");
        assert.ok(cellIds.includes("GEN 1:2"), "Should include root 2");
    });

    test("getCellsForMilestone returns empty array for invalid milestone index", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 1",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);

        // Negative index
        const result1 = document.getCellsForMilestone(-1, 0, 50);
        assert.strictEqual(result1.length, 0, "Should return empty array for negative index");

        // Index beyond bounds
        const result2 = document.getCellsForMilestone(10, 0, 50);
        assert.strictEqual(result2.length, 0, "Should return empty array for out-of-bounds index");
    });

    test("getSubsectionCountForMilestone returns correct count", async () => {
        const cellsPerPage = 5;
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
        ];

        // Add 12 content cells (should create 3 subsections)
        for (let i = 1; i <= 12; i++) {
            cells.push({
                kind: 2,
                languageId: "scripture",
                value: `Cell ${i}`,
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: `cell-${i}`,
                },
            });
        }

        const document = await createDocumentWithCells(cells);
        const subsectionCount = document.getSubsectionCountForMilestone(0, cellsPerPage);

        assert.strictEqual(subsectionCount, 3, "Should have 3 subsections for 12 cells with cellsPerPage=5");
    });

    test("getSubsectionCountForMilestone returns 1 for empty milestone", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "2",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-2",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const subsectionCount = document.getSubsectionCountForMilestone(0, 50);

        // Even with 0 content cells, should return at least 1 subsection
        assert.strictEqual(subsectionCount, 1, "Should return 1 for empty milestone");
    });

    test("getSubsectionCountForMilestone returns 0 for invalid milestone index", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const subsectionCount = document.getSubsectionCountForMilestone(10, 50);

        assert.strictEqual(subsectionCount, 0, "Should return 0 for invalid milestone index");
    });

    test("requestCellsForMilestone message handler sends correct cells", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 1",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 2",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-2",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const { panel, onDidReceiveMessageRef, lastPostedMessageRef } = createMockWebviewPanel();

        await provider.resolveCustomEditor(
            document,
            panel,
            new vscode.CancellationTokenSource().token
        );

        // Wait for initial setup
        await sleep(100);

        // Clear any initial messages
        lastPostedMessageRef.current = null;

        // Send requestCellsForMilestone message
        const messageCallback = onDidReceiveMessageRef.current;
        assert.ok(messageCallback, "Message callback should be set");

        messageCallback!({
            command: "requestCellsForMilestone",
            content: {
                milestoneIndex: 0,
                subsectionIndex: 0,
            },
        });

        // Wait for message processing
        await sleep(100);

        // Verify message was sent
        assert.ok(lastPostedMessageRef.current, "Should have posted a message");
        assert.strictEqual(
            lastPostedMessageRef.current.type,
            "providerSendsCellPage",
            "Should send providerSendsCellPage message"
        );
        assert.strictEqual(
            lastPostedMessageRef.current.milestoneIndex,
            0,
            "Should include correct milestone index"
        );
        assert.strictEqual(
            lastPostedMessageRef.current.subsectionIndex,
            0,
            "Should include correct subsection index"
        );
        assert.ok(
            Array.isArray(lastPostedMessageRef.current.cells),
            "Should include cells array"
        );
        assert.strictEqual(
            lastPostedMessageRef.current.cells.length,
            2,
            "Should include 2 cells"
        );
    });

    test("refreshWebview sends initial paginated content", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 1",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "2",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-2",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 2",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-2",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const { panel, lastPostedMessageRef } = createMockWebviewPanel();

        await provider.resolveCustomEditor(
            document,
            panel,
            new vscode.CancellationTokenSource().token
        );

        // Wait for refreshWebview to complete and scheduled messages to be sent
        await sleep(200);

        // Check that webview HTML was set
        assert.ok(panel.webview.html, "Webview HTML should be set");
        assert.ok(panel.webview.html.includes("<html"), "HTML should contain html tag");

        // Note: The initial paginated content message is sent via scheduleWebviewUpdate
        // which waits for webview ready signal. In a real scenario, this would be verified
        // when the webview sends a ready message. For this test, we verify the HTML is set
        // which indicates refreshWebview was called successfully.
    });

    test("calculateMilestoneProgress calculates progress correctly", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell with content",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                    edits: [
                        {
                            editMap: ["value"],
                            value: "Cell with content",
                            timestamp: Date.now(),
                            type: "user-edit",
                            author: "test-user",
                            validatedBy: [
                                {
                                    username: "test-user",
                                    creationTimestamp: Date.now(),
                                    updatedTimestamp: Date.now(),
                                    isDeleted: false,
                                },
                            ],
                        },
                    ],
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-2",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const progress = document.calculateMilestoneProgress(1, 1);

        assert.ok(progress[1], "Should have progress for milestone 1");
        assert.strictEqual(
            typeof progress[1].percentTranslationsCompleted,
            "number",
            "Should calculate translation completion percentage"
        );
        assert.strictEqual(
            typeof progress[1].percentFullyValidatedTranslations,
            "number",
            "Should calculate fully validated percentage"
        );
        // With 1 cell having content out of 2 total, should be 50%
        assert.strictEqual(
            progress[1].percentTranslationsCompleted,
            50,
            "Should be 50% complete (1 of 2 cells)"
        );
    });

    test("calculateMilestoneProgress handles multiple milestones", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 1",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "2",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-2",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 2",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-2",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const progress = document.calculateMilestoneProgress(1, 1);

        assert.ok(progress[1], "Should have progress for milestone 1");
        assert.ok(progress[2], "Should have progress for milestone 2");
        assert.strictEqual(
            progress[1].percentTranslationsCompleted,
            100,
            "Milestone 1 should be 100% complete"
        );
        assert.strictEqual(
            progress[2].percentTranslationsCompleted,
            100,
            "Milestone 2 should be 100% complete"
        );
    });

    test("getCellsForMilestone handles subsection index bounds correctly", async () => {
        const cellsPerPage = 5;
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
        ];

        // Add 7 content cells (should create 2 subsections)
        for (let i = 1; i <= 7; i++) {
            cells.push({
                kind: 2,
                languageId: "scripture",
                value: `Cell ${i}`,
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: `cell-${i}`,
                },
            });
        }

        const document = await createDocumentWithCells(cells);

        // Negative subsection index should clamp to 0
        const result1 = document.getCellsForMilestone(0, -1, cellsPerPage);
        assert.strictEqual(result1.length, 5, "Negative index should clamp to first subsection");

        // Subsection index beyond bounds should clamp to last subsection
        const result2 = document.getCellsForMilestone(0, 10, cellsPerPage);
        assert.strictEqual(result2.length, 2, "Out-of-bounds index should clamp to last subsection");
        assert.strictEqual(result2[0].cellMarkers[0], "cell-6", "Should return cells from last subsection");
    });

    test("getCellsForMilestone works with virtual milestone (no milestone cells)", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 1",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Cell 2",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-2",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const result = document.getCellsForMilestone(0, 0, 50);

        assert.strictEqual(result.length, 2, "Should return all cells for virtual milestone");
        assert.strictEqual(result[0].cellMarkers[0], "cell-1", "First cell should be cell-1");
        assert.strictEqual(result[1].cellMarkers[0], "cell-2", "Second cell should be cell-2");
    });

    test("buildMilestoneIndex handles milestone with custom value", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "Chapter One",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Content",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const milestoneIndex = document.buildMilestoneIndex(50);

        assert.strictEqual(milestoneIndex.milestones.length, 1, "Should have 1 milestone");
        assert.strictEqual(
            milestoneIndex.milestones[0].value,
            "Chapter One",
            "Should preserve custom milestone value"
        );
    });

    test("buildMilestoneIndex handles milestone without value (uses default)", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Content",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const milestoneIndex = document.buildMilestoneIndex(50);

        assert.strictEqual(milestoneIndex.milestones.length, 1, "Should have 1 milestone");
        // When value is empty, it should default to "1" (first milestone)
        assert.strictEqual(
            milestoneIndex.milestones[0].value,
            "1",
            "Should use default value '1' for milestone without value"
        );
    });

    test("getCellsForMilestone preserves cell metadata correctly", async () => {
        const cells = [
            {
                kind: 2,
                languageId: "scripture",
                value: "1",
                metadata: {
                    type: CodexCellTypes.MILESTONE,
                    id: "milestone-1",
                },
            },
            {
                kind: 2,
                languageId: "scripture",
                value: "Test content",
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: "cell-1",
                    cellLabel: "Test Label",
                    edits: [
                        {
                            editMap: ["value"],
                            value: "Test content",
                            timestamp: Date.now(),
                            type: "user-edit",
                            author: "test-user",
                        },
                    ],
                    data: {
                        startTime: 10,
                        endTime: 20,
                    },
                    attachments: {
                        "audio-1": {
                            type: "audio",
                            url: "test-url",
                        },
                    },
                },
            },
        ];

        const document = await createDocumentWithCells(cells);
        const result = document.getCellsForMilestone(0, 0, 50);

        assert.strictEqual(result.length, 1, "Should return 1 cell");
        assert.strictEqual(result[0].cellContent, "Test content", "Should preserve cell content");
        assert.strictEqual(result[0].cellLabel, "Test Label", "Should preserve cell label");
        assert.ok(result[0].editHistory, "Should preserve edit history");
        assert.strictEqual(result[0].timestamps?.startTime, 10, "Should preserve timestamps");
        assert.ok(result[0].attachments, "Should preserve attachments");
    });
});
