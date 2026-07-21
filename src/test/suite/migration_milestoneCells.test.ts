import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import sinon from "sinon";
import { CodexContentSerializer } from "../../serializer";
import { migration_addMilestoneCells } from "../../projectManager/utils/migrationUtils";
import { CodexCellTypes, EditType } from "../../../types/enums";
import { createMockExtensionContext } from "../testUtils";

async function createTempNotebookFile(
    ext: ".codex" | ".source",
    cells: Array<{ id?: string; cellLabel?: string; value?: string; metadata?: any }>,
    metadata: any = {},
    basename?: string
): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    const tmpDir = os.tmpdir();
    const base =
        basename ?? `milestone-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fileName = `${base}${ext}`;
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

suite("migration_addMilestoneCells", () => {
    let testFiles: vscode.Uri[] = [];
    let context: vscode.ExtensionContext;
    let sandbox: sinon.SinonSandbox;

    setup(async () => {
        context = createMockExtensionContext();
        sandbox = sinon.createSandbox();

        // The migration scans the open workspace folder via `findFiles`. The
        // extension-host test runner opens no folder, so stub a workspace folder
        // and route `findFiles` to the temp files each test creates. Individual
        // tests can override this (see the "no workspace folder" case).
        const workspaceUri = vscode.Uri.file(os.tmpdir());
        sandbox.stub(vscode.workspace, "workspaceFolders").value([
            { uri: workspaceUri, name: "milestone-test-ws", index: 0 },
        ]);
        sandbox.stub(vscode.workspace, "findFiles").callsFake(async (include: any) => {
            const pattern = typeof include === "string" ? include : include?.pattern ?? "";
            if (pattern.endsWith(".codex")) {
                return testFiles.filter((u) => u.fsPath.endsWith(".codex"));
            }
            if (pattern.endsWith(".source")) {
                return testFiles.filter((u) => u.fsPath.endsWith(".source"));
            }
            return [];
        });

        // Reset migration flag
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        try {
            await config.update("milestoneCellsMigrationCompleted", false, vscode.ConfigurationTarget.Workspace);
        } catch (e) {
            // Config key might not exist yet
        }
        await context.workspaceState.update("milestoneCellsMigrationCompleted", false);
    });

    teardown(async () => {
        sandbox.restore();
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

    test("should add milestone cell at beginning of file", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "In the beginning" },
                { id: "GEN 1:2", value: "The earth was formless" },
            ]
        );
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 3, "Should have added one milestone cell");
        assert.strictEqual(data.cells[0].metadata?.type, CodexCellTypes.MILESTONE, "First cell should be milestone");
        assert.strictEqual(data.cells[0].value, "Genesis 1", "Milestone label should be 'Book Chapter'");
        assert.ok(data.cells[0].metadata?.id, "Milestone should have UUID");
    });

    test("should add milestone cells before each new chapter", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "Chapter 1 verse 1" },
                { id: "GEN 1:2", value: "Chapter 1 verse 2" },
                { id: "GEN 2:1", value: "Chapter 2 verse 1" },
                { id: "GEN 2:2", value: "Chapter 2 verse 2" },
                { id: "GEN 3:1", value: "Chapter 3 verse 1" },
            ]
        );
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        // Should have: milestone(1), cell1, cell2, milestone(2), cell3, cell4, milestone(3), cell5
        assert.strictEqual(data.cells.length, 8, "Should have added 3 milestone cells");

        // First milestone (chapter 1)
        assert.strictEqual(data.cells[0].metadata?.type, CodexCellTypes.MILESTONE);
        assert.strictEqual(data.cells[0].value, "Genesis 1");

        // Original cells
        assert.strictEqual(data.cells[1].metadata?.id, "GEN 1:1");
        assert.strictEqual(data.cells[2].metadata?.id, "GEN 1:2");

        // Second milestone (chapter 2)
        assert.strictEqual(data.cells[3].metadata?.type, CodexCellTypes.MILESTONE);
        assert.strictEqual(data.cells[3].value, "Genesis 2");

        // Original cells
        assert.strictEqual(data.cells[4].metadata?.id, "GEN 2:1");
        assert.strictEqual(data.cells[5].metadata?.id, "GEN 2:2");

        // Third milestone (chapter 3)
        assert.strictEqual(data.cells[6].metadata?.type, CodexCellTypes.MILESTONE);
        assert.strictEqual(data.cells[6].value, "Genesis 3");

        // Original cell
        assert.strictEqual(data.cells[7].metadata?.id, "GEN 3:1");
    });

    test("should be idempotent - skip files that already have milestone cells", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                {
                    id: "milestone-1",
                    value: "1",
                    metadata: { type: CodexCellTypes.MILESTONE, id: "milestone-1", edits: [] },
                },
                { id: "GEN 1:1", value: "In the beginning" },
            ]
        );
        testFiles.push(uri);

        const originalData = await readNotebookFile(uri);
        const originalCellCount = originalData.cells.length;

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, originalCellCount, "Should not add duplicate milestone cells");
        assert.strictEqual(data.cells[0].metadata?.id, "milestone-1", "Should preserve existing milestone");
    });

    test("should handle cells without chapter numbers in ID", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "cell-1", value: "Content", metadata: { chapterNumber: 5 } },
                { id: "cell-2", value: "Content", metadata: { chapterNumber: 6 } },
            ]
        );
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        // Chapter BOUNDARIES come from scripture-style ids ("GEN 1:1"); "cell-N" ids
        // have no chapter token, so only the leading milestone is inserted (3 cells).
        // Its label still uses the chapterNumber metadata → "<book> <chapter>".
        assert.strictEqual(data.cells.length, 3);
        assert.strictEqual(data.cells[0].metadata?.type, CodexCellTypes.MILESTONE);
        assert.strictEqual(data.cells[0].value, "cell-1 5");
    });

    test("should use metadata.chapter if available", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "cell-1", value: "Content", metadata: { chapter: 10 } },
                { id: "cell-2", value: "Content", metadata: { chapter: 11 } },
            ]
        );
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 3);
        assert.strictEqual(data.cells[0].value, "cell-1 10");
    });

    test("should use metadata.data.chapter as fallback", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "cell-1", value: "Content", metadata: { data: { chapter: 15 } } },
                { id: "cell-2", value: "Content", metadata: { data: { chapter: 16 } } },
            ]
        );
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 3);
        assert.strictEqual(data.cells[0].value, "cell-1 15");
    });

    test("should use milestoneIndex as final fallback", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "cell-1", value: "Content" },
                { id: "cell-2", value: "Content" },
            ]
        );
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 3);
        // No chapter metadata → ordinal "1" is the chapter fallback; the id
        // ("cell-1") becomes the pseudo-book prefix → "cell-1 1".
        assert.strictEqual(data.cells[0].value, "cell-1 1");
    });

    test("should handle empty files gracefully", async () => {
        const uri = await createTempNotebookFile(".codex", []);
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 0, "Should not add milestones to empty files");
    });

    test("should handle files with cells that have no ID", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { value: "Content without ID" },
                { id: "GEN 1:1", value: "Content with ID" },
            ]
        );
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        // Should find first cell with ID and add milestone
        assert.ok(data.cells.length > 0);
        // First cell with ID should be used for milestone
        const firstCellWithId = data.cells.find((c: any) => c.metadata?.id === "GEN 1:1");
        assert.ok(firstCellWithId, "Should preserve cell with ID");
    });

    test("should process both .codex and .source files", async () => {
        const codexUri = await createTempNotebookFile(
            ".codex",
            [{ id: "GEN 1:1", value: "Codex content" }]
        );
        const sourceUri = await createTempNotebookFile(
            ".source",
            [{ id: "GEN 1:1", value: "Source content" }]
        );
        testFiles.push(codexUri, sourceUri);

        await migration_addMilestoneCells(context);

        const codexData = await readNotebookFile(codexUri);
        const sourceData = await readNotebookFile(sourceUri);

        assert.strictEqual(codexData.cells.length, 2, "Codex file should have milestone");
        assert.strictEqual(sourceData.cells.length, 2, "Source file should have milestone");
        assert.strictEqual(codexData.cells[0].metadata?.type, CodexCellTypes.MILESTONE);
        assert.strictEqual(sourceData.cells[0].metadata?.type, CodexCellTypes.MILESTONE);
    });

    test("should not duplicate milestones for same chapter", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                { id: "GEN 1:1", value: "Verse 1" },
                { id: "GEN 1:2", value: "Verse 2" },
                { id: "GEN 1:3", value: "Verse 3" },
                { id: "GEN 1:4", value: "Verse 4" },
            ]
        );
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        // Should only have one milestone for chapter 1 (at the beginning)
        const milestones = data.cells.filter((c: any) => c.metadata?.type === CodexCellTypes.MILESTONE);
        assert.strictEqual(milestones.length, 1, "Should only have one milestone for same chapter");
        assert.strictEqual(milestones[0].value, "Genesis 1");
    });

    test("should prioritize metadata.chapterNumber over metadata.chapter", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                {
                    id: "cell-1",
                    value: "Content",
                    metadata: { chapterNumber: 5, chapter: 1 },
                },
            ]
        );
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells[0].value, "cell-1 5", "Should prioritize chapterNumber (5, not 1)");
    });

    test("should prioritize metadata.chapter over metadata.data.chapter", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [
                {
                    id: "cell-1",
                    value: "Content",
                    metadata: { chapter: 3, data: { chapter: 1 } },
                },
            ]
        );
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells[0].value, "cell-1 3", "Should prioritize chapter (3, not 1)");
    });

    test("should be idempotent when migration flag is set", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [{ id: "GEN 1:1", value: "Content" }]
        );
        testFiles.push(uri);

        // Run migration first time
        await migration_addMilestoneCells(context);

        const firstRunData = await readNotebookFile(uri);
        const firstRunCellCount = firstRunData.cells.length;

        // Set migration flag
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        try {
            await config.update("milestoneCellsMigrationCompleted", true, vscode.ConfigurationTarget.Workspace);
        } catch (e) {
            await context.workspaceState.update("milestoneCellsMigrationCompleted", true);
        }

        // Run migration again
        await migration_addMilestoneCells(context);

        const secondRunData = await readNotebookFile(uri);
        assert.strictEqual(
            secondRunData.cells.length,
            firstRunCellCount,
            "Should not modify files when migration flag is set"
        );
    });

    test("should handle files with no workspace folder", async () => {
        // This test verifies the migration handles missing workspace gracefully:
        // with no open folder it must return early and leave files untouched.
        const uri = await createTempNotebookFile(
            ".codex",
            [{ id: "GEN 1:1", value: "Content" }]
        );
        testFiles.push(uri);

        // Override the default workspace stub for this test so there is no folder.
        sandbox.restore();
        sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);

        // Migration should complete without errors when there is no workspace.
        await migration_addMilestoneCells(context);

        // No workspace → migration is a no-op; the file is unchanged.
        const data = await readNotebookFile(uri);
        assert.strictEqual(data.cells.length, 1, "No workspace → migration is a no-op");
    });

    test("should create milestone cells with correct structure", async () => {
        const uri = await createTempNotebookFile(
            ".codex",
            [{ id: "GEN 1:1", value: "Content" }]
        );
        testFiles.push(uri);

        await migration_addMilestoneCells(context);

        const data = await readNotebookFile(uri);
        const milestone = data.cells[0];

        assert.strictEqual(milestone.kind, 2, "Should be Code cell kind");
        assert.strictEqual(milestone.languageId, "html", "Should have html languageId");
        assert.strictEqual(milestone.metadata?.type, CodexCellTypes.MILESTONE);
        assert.ok(milestone.metadata?.id, "Should have UUID");
        // The shared builder stamps an INITIAL_IMPORT anchor edit carrying the
        // label so it survives 3-way merges (not an empty edits array).
        assert.strictEqual(
            milestone.metadata?.edits?.length,
            1,
            "Should have one INITIAL_IMPORT anchor edit"
        );
        assert.strictEqual(
            milestone.metadata?.edits?.[0]?.type,
            EditType.INITIAL_IMPORT,
            "Anchor edit should be INITIAL_IMPORT"
        );
        assert.strictEqual(
            milestone.metadata?.edits?.[0]?.value,
            milestone.value,
            "Anchor edit should carry the milestone label"
        );
    });

    test("should handle chapter extraction from various ID formats", async () => {
        // Label format is "<book> <chapter>"; book is the localized name when the
        // id prefix maps to a USFM code (GEN→Genesis, MAT→Matthew), otherwise the
        // raw first token of the id.
        const testCases = [
            { id: "GEN 1:1", expectedLabel: "Genesis 1" },
            { id: "Book Name 2:5", expectedLabel: "Book 2" },
            { id: "filename 10:20", expectedLabel: "filename 10" },
            { id: "MAT 5:1", expectedLabel: "Matthew 5" },
        ];

        for (const testCase of testCases) {
            const uri = await createTempNotebookFile(
                ".codex",
                [{ id: testCase.id, value: "Content" }]
            );
            testFiles.push(uri);

            await migration_addMilestoneCells(context);

            const data = await readNotebookFile(uri);
            assert.strictEqual(
                data.cells[0].value,
                testCase.expectedLabel,
                `Failed for ID: ${testCase.id}`
            );
        }
    });

    test("should assign identical milestone UUIDs to paired source and codex files", async () => {
        // Pairing is by basename, so both files must share one.
        const sharedBase = `milestone-pair-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const codexUri = await createTempNotebookFile(
            ".codex",
            [{ id: "GEN 1:1", value: "Codex content" }],
            {},
            sharedBase
        );
        const sourceUri = await createTempNotebookFile(
            ".source",
            [{ id: "GEN 1:1", value: "Source content" }],
            {},
            sharedBase
        );
        testFiles.push(codexUri, sourceUri);

        await migration_addMilestoneCells(context);

        const codexData = await readNotebookFile(codexUri);
        const sourceData = await readNotebookFile(sourceUri);
        const codexMilestone = codexData.cells.find(
            (c: any) => c.metadata?.type === CodexCellTypes.MILESTONE
        );
        const sourceMilestone = sourceData.cells.find(
            (c: any) => c.metadata?.type === CodexCellTypes.MILESTONE
        );

        assert.ok(codexMilestone?.metadata?.id, "Codex milestone should have a UUID");
        assert.ok(sourceMilestone?.metadata?.id, "Source milestone should have a UUID");
        assert.strictEqual(
            codexMilestone.metadata.id,
            sourceMilestone.metadata.id,
            "Paired source and codex milestones must share the same UUID"
        );
    });

    test("should migrate an orphaned source file (no paired codex) without crashing", async () => {
        const sourceUri = await createTempNotebookFile(
            ".source",
            [
                { id: "GEN 1:1", value: "Source verse 1" },
                { id: "GEN 2:1", value: "Source chapter 2" },
            ]
        );
        testFiles.push(sourceUri);

        await migration_addMilestoneCells(context);

        const sourceData = await readNotebookFile(sourceUri);
        const milestones = sourceData.cells.filter(
            (c: any) => c.metadata?.type === CodexCellTypes.MILESTONE
        );
        assert.strictEqual(
            milestones.length,
            2,
            "Orphaned source should still get a milestone per chapter"
        );
        assert.strictEqual(
            sourceData.cells[0].metadata?.type,
            CodexCellTypes.MILESTONE,
            "First cell should be a milestone"
        );
    });
});

