import * as assert from "assert";
import * as vscode from "vscode";

import { matchMigrationCells } from "../../codexMigrationTool/matcher";
import { applyMigrationToTargetFile } from "../../codexMigrationTool/updater";
import { createTempCodexFile, deleteIfExists } from "../testUtils";
import { CodexCellTypes, EditType } from "../../../types/enums";
import type { FileData } from "../../activationHelpers/contextAware/contentIndexes/indexes/fileReaders";
import type { CodexMigrationMatchMode } from "../../codexMigrationTool/types";
import type { CustomNotebookCellData, CodexNotebookAsJSONData, CustomNotebookMetadata } from "../../../types";
import { CodexContentSerializer } from "../../serializer";
import { EditMapUtils } from "../../utils/editMapUtils";
import type { NavigationCell } from "../../utils/codexNotebookUtils";

const buildNotebookMetadata = (id: string, codexPath: string): CustomNotebookMetadata => ({
    id,
    originalName: "test",
    sourceFsPath: codexPath.replace(/\.codex$/i, ".source"),
    codexFsPath: codexPath,
    navigation: [] as NavigationCell[],
    sourceCreatedAt: new Date(0).toISOString(),
    corpusMarker: "GEN",
    edits: [],
});

const buildFileData = (params: {
    path: string;
    id: string;
    cells: Array<{ id: string; value: string; metadata?: any; }>;
}): FileData => ({
    uri: vscode.Uri.file(params.path),
    id: params.id,
    cells: params.cells.map((cell) => ({
        metadata: {
            id: cell.id,
            type: CodexCellTypes.TEXT,
            ...(cell.metadata || {}),
        },
        value: cell.value,
    })),
});

const buildNotebook = (cells: CustomNotebookCellData[], id: string, codexPath: string): CodexNotebookAsJSONData => ({
    cells,
    metadata: buildNotebookMetadata(id, codexPath),
});

const buildCell = (params: {
    id: string;
    value: string;
    edits?: Array<{ timestamp: number; value: string; type?: EditType; }>;
    data?: Record<string, any>;
}): CustomNotebookCellData => ({
    kind: 2,
    languageId: "html",
    value: params.value,
    metadata: {
        id: params.id,
        type: CodexCellTypes.TEXT,
        data: params.data,
        edits: params.edits?.map((edit) => ({
            editMap: EditMapUtils.value(),
            value: edit.value,
            timestamp: edit.timestamp,
            type: edit.type ?? EditType.USER_EDIT,
            author: "test-user",
        })) ?? [],
    },
});

const buildFileDataWithTypes = (params: {
    path: string;
    id: string;
    cells: Array<{ id: string; value: string; type?: CodexCellTypes; parentId?: string; data?: Record<string, any>; }>;
}): FileData => ({
    uri: vscode.Uri.file(params.path),
    id: params.id,
    cells: params.cells.map((cell) => ({
        metadata: {
            id: cell.id,
            type: cell.type ?? CodexCellTypes.TEXT,
            ...(cell.parentId ? { parentId: cell.parentId } : {}),
            ...(cell.data ? { data: cell.data } : {}),
        },
        value: cell.value,
    })),
});

suite("Codex migration tool integration", function () {
    this.timeout(30_000);

    test("matchMigrationCells: global references mapping", async () => {
        const fromTargetFile = buildFileData({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-1", value: "A", metadata: { data: { globalReferences: ["GEN 1:1"] } } },
                { id: "from-2", value: "B", metadata: { data: { globalReferences: ["GEN 1:2"] } } },
            ],
        });
        const toTargetFile = buildFileData({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "X", metadata: { data: { globalReferences: ["GEN 1:1"] } } },
                { id: "to-2", value: "Y", metadata: { data: { globalReferences: ["GEN 1:3"] } } },
            ],
        });

        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            matchMode: "globalReferences",
        });

        assert.strictEqual(matches.length, 1, "Expected one global reference match");
        assert.strictEqual(matches[0].fromCellId, "from-1");
        assert.strictEqual(matches[0].toCellId, "to-1");
    });

    test("matchMigrationCells: timestamps mapping", async () => {
        const fromTargetFile = buildFileData({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "cue-12.3-13.4", value: "A", metadata: { data: {} } },
            ],
        });
        const toTargetFile = buildFileData({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "B", metadata: { data: { startTime: 12.3, endTime: 13.4 } } },
            ],
        });

        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            matchMode: "timestamps",
        });

        assert.strictEqual(matches.length, 1, "Expected one timestamp match");
        assert.strictEqual(matches[0].fromCellId, "cue-12.3-13.4");
        assert.strictEqual(matches[0].toCellId, "to-1");
    });

    test("matchMigrationCells: sequential source matching skips mismatched lines", async () => {
        const fromTargetFile = buildFileData({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-1", value: "" },
                { id: "from-2", value: "" },
                { id: "from-3", value: "" },
            ],
        });
        const toTargetFile = buildFileData({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "" },
                { id: "to-2", value: "" },
                { id: "to-3", value: "" },
                { id: "to-4", value: "" },
            ],
        });
        const fromSourceFile = buildFileData({
            path: "/tmp/from.source",
            id: "from-source",
            cells: [
                { id: "from-1", value: "<span>alpha</span>" },
                { id: "from-2", value: "<p>UNMATCHED</p>" },
                { id: "from-3", value: "<div>gamma</div>" },
            ],
        });
        const toSourceFile = buildFileData({
            path: "/tmp/to.source",
            id: "to-source",
            cells: [
                { id: "to-1", value: "alpha" },
                { id: "to-2", value: "extra" },
                { id: "to-3", value: "beta" },
                { id: "to-4", value: "gamma" },
            ],
        });

        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            fromSourceFile,
            toSourceFile,
            matchMode: "sequential",
        });

        assert.deepStrictEqual(
            matches.map((match) => [match.fromCellId, match.toCellId]),
            [
                ["from-1", "to-1"],
                ["from-3", "to-4"],
            ],
            "Expected sequential matching to skip unmatched lines and continue"
        );
    });

    test("applyMigrationToTargetFile: force override applies migration edit and wins conflicts", async () => {
        const fromCell = buildCell({
            id: "cell-1",
            value: "from value",
            edits: [{ value: "from value", timestamp: 1000 }],
        });
        const toCell = buildCell({
            id: "cell-1",
            value: "to value",
            edits: [{ value: "to value", timestamp: 2000 }],
        });

        const fromNotebook = buildNotebook([fromCell], "from-notebook", "migration-from.codex");
        const toNotebook = buildNotebook([toCell], "to-notebook", "migration-to.codex");

        const fromUri = await createTempCodexFile("migration-from.codex", fromNotebook);
        const toUri = await createTempCodexFile("migration-to.codex", toNotebook);

        try {
            const matches = [{ fromCellId: "cell-1", toCellId: "cell-1" }];
            await applyMigrationToTargetFile({
                fromFileUri: fromUri,
                toFileUri: toUri,
                matches,
                forceOverride: true,
            });

            const serializer = new CodexContentSerializer();
            const updatedBytes = await vscode.workspace.fs.readFile(toUri);
            const updatedNotebook = await serializer.deserializeNotebook(
                updatedBytes,
                new vscode.CancellationTokenSource().token
            );
            const updatedCell = updatedNotebook.cells[0];

            assert.strictEqual(updatedCell.value, "from value", "Expected migration to override target value");
            const migrationEdits = updatedCell.metadata?.edits?.filter(
                (edit: any) => edit.type === EditType.MIGRATION
            );
            assert.ok(migrationEdits?.length, "Expected migration edit entry to be recorded");
        } finally {
            await deleteIfExists(fromUri);
            await deleteIfExists(toUri);
        }
    });

    test("sequential match + applyMigrationToTargetFile migrates content", async () => {
        const fromTargetFile = buildFileData({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-1", value: "FROM_ONE" },
                { id: "from-2", value: "FROM_TWO" },
            ],
        });
        const toTargetFile = buildFileData({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "TO_ONE" },
                { id: "to-2", value: "TO_TWO" },
            ],
        });
        const fromSourceFile = buildFileData({
            path: "/tmp/from.source",
            id: "from-source",
            cells: [
                { id: "from-1", value: "<span>test&nbsp;paratext&nbsp;</span>" },
                { id: "from-2", value: "<strong>beta</strong>" },
            ],
        });
        const toSourceFile = buildFileData({
            path: "/tmp/to.source",
            id: "to-source",
            cells: [
                { id: "to-1", value: "test paratext" },
                { id: "to-2", value: "beta" },
            ],
        });

        const fromNotebook = buildNotebook([
            buildCell({ id: "from-1", value: "FROM_ONE" }),
            buildCell({ id: "from-2", value: "FROM_TWO" }),
        ], "from-seq", "migration-seq-from.codex");
        const toNotebook = buildNotebook([
            buildCell({ id: "to-1", value: "TO_ONE" }),
            buildCell({ id: "to-2", value: "TO_TWO" }),
        ], "to-seq", "migration-seq-to.codex");

        const fromUri = await createTempCodexFile("migration-seq-from.codex", fromNotebook);
        const toUri = await createTempCodexFile("migration-seq-to.codex", toNotebook);

        try {
            const matches = await matchMigrationCells({
                fromTargetFile,
                toTargetFile,
                fromSourceFile,
                toSourceFile,
                matchMode: "sequential" as CodexMigrationMatchMode,
            });

            assert.strictEqual(matches.length, 2, "Expected two sequential matches");

            await applyMigrationToTargetFile({
                fromFileUri: fromUri,
                toFileUri: toUri,
                matches,
                forceOverride: false,
            });

            const serializer = new CodexContentSerializer();
            const updatedBytes = await vscode.workspace.fs.readFile(toUri);
            const updatedNotebook = await serializer.deserializeNotebook(
                updatedBytes,
                new vscode.CancellationTokenSource().token
            );

            assert.strictEqual(updatedNotebook.cells[0].value, "FROM_ONE");
            assert.strictEqual(updatedNotebook.cells[1].value, "FROM_TWO");
        } finally {
            await deleteIfExists(fromUri);
            await deleteIfExists(toUri);
        }
    });

    // ─── lineNumber mode tests ──────────────────────────────────────────

    test("matchMigrationCells: lineNumber matches cells by position", async () => {
        const fromTargetFile = buildFileData({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-1", value: "A" },
                { id: "from-2", value: "B" },
                { id: "from-3", value: "C" },
            ],
        });
        const toTargetFile = buildFileData({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "X" },
                { id: "to-2", value: "Y" },
                { id: "to-3", value: "Z" },
            ],
        });

        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            matchMode: "lineNumber",
        });

        assert.strictEqual(matches.length, 3, "Expected all three lines to match");
        assert.deepStrictEqual(
            matches.map((m) => [m.fromCellId, m.toCellId]),
            [
                ["from-1", "to-1"],
                ["from-2", "to-2"],
                ["from-3", "to-3"],
            ]
        );
    });

    test("matchMigrationCells: lineNumber skips paratext cells", async () => {
        const fromTargetFile = buildFileDataWithTypes({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-para", value: "\\p", type: CodexCellTypes.PARATEXT },
                { id: "from-1", value: "A" },
                { id: "from-2", value: "B" },
            ],
        });
        const toTargetFile = buildFileDataWithTypes({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "X" },
                { id: "to-para", value: "\\p", type: CodexCellTypes.PARATEXT },
                { id: "to-2", value: "Y" },
            ],
        });

        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            matchMode: "lineNumber",
        });

        assert.strictEqual(matches.length, 2, "Paratext cells should be skipped");
        assert.deepStrictEqual(
            matches.map((m) => [m.fromCellId, m.toCellId]),
            [
                ["from-1", "to-1"],
                ["from-2", "to-2"],
            ]
        );
    });

    test("matchMigrationCells: lineNumber skips child cells (via parentId)", async () => {
        const fromTargetFile = buildFileDataWithTypes({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-1", value: "A" },
                { id: "from-child", value: "child text", parentId: "from-1" },
                { id: "from-2", value: "B" },
            ],
        });
        const toTargetFile = buildFileDataWithTypes({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "X" },
                { id: "to-2", value: "Y" },
            ],
        });

        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            matchMode: "lineNumber",
        });

        assert.strictEqual(matches.length, 2, "Child cells should be skipped");
        assert.deepStrictEqual(
            matches.map((m) => [m.fromCellId, m.toCellId]),
            [
                ["from-1", "to-1"],
                ["from-2", "to-2"],
            ]
        );
    });

    test("matchMigrationCells: lineNumber skips milestone cells", async () => {
        const fromTargetFile = buildFileDataWithTypes({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-ms", value: "", type: CodexCellTypes.MILESTONE },
                { id: "from-1", value: "A" },
                { id: "from-2", value: "B" },
            ],
        });
        const toTargetFile = buildFileDataWithTypes({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "X" },
                { id: "to-ms", value: "", type: CodexCellTypes.MILESTONE },
                { id: "to-2", value: "Y" },
            ],
        });

        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            matchMode: "lineNumber",
        });

        assert.strictEqual(matches.length, 2, "Milestone cells should be skipped");
        assert.deepStrictEqual(
            matches.map((m) => [m.fromCellId, m.toCellId]),
            [
                ["from-1", "to-1"],
                ["from-2", "to-2"],
            ]
        );
    });

    test("matchMigrationCells: lineNumber stops at shorter file", async () => {
        const fromTargetFile = buildFileData({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-1", value: "A" },
                { id: "from-2", value: "B" },
                { id: "from-3", value: "C" },
                { id: "from-4", value: "D" },
            ],
        });
        const toTargetFile = buildFileData({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "X" },
                { id: "to-2", value: "Y" },
            ],
        });

        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            matchMode: "lineNumber",
        });

        assert.strictEqual(matches.length, 2, "Should stop at the shorter file's length");
        assert.strictEqual(matches[0].fromCellId, "from-1");
        assert.strictEqual(matches[1].fromCellId, "from-2");
    });

    test("matchMigrationCells: lineNumber with fromStartLine offset", async () => {
        const fromTargetFile = buildFileData({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-1", value: "A" },
                { id: "from-2", value: "B" },
                { id: "from-3", value: "C" },
                { id: "from-4", value: "D" },
            ],
        });
        const toTargetFile = buildFileData({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "X" },
                { id: "to-2", value: "Y" },
                { id: "to-3", value: "Z" },
            ],
        });

        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            matchMode: "lineNumber",
            fromStartLine: 3,
        });

        assert.strictEqual(matches.length, 2, "Starting from line 3 leaves 2 from-cells");
        assert.deepStrictEqual(
            matches.map((m) => [m.fromCellId, m.toCellId]),
            [
                ["from-3", "to-1"],
                ["from-4", "to-2"],
            ]
        );
    });

    test("matchMigrationCells: lineNumber with toStartLine offset", async () => {
        const fromTargetFile = buildFileData({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-1", value: "A" },
                { id: "from-2", value: "B" },
            ],
        });
        const toTargetFile = buildFileData({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "X" },
                { id: "to-2", value: "Y" },
                { id: "to-3", value: "Z" },
                { id: "to-4", value: "W" },
            ],
        });

        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            matchMode: "lineNumber",
            toStartLine: 3,
        });

        assert.strictEqual(matches.length, 2, "Starting to-file at line 3 leaves 2 to-cells");
        assert.deepStrictEqual(
            matches.map((m) => [m.fromCellId, m.toCellId]),
            [
                ["from-1", "to-3"],
                ["from-2", "to-4"],
            ]
        );
    });

    test("matchMigrationCells: lineNumber with both start line offsets", async () => {
        const fromTargetFile = buildFileData({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-1", value: "A" },
                { id: "from-2", value: "B" },
                { id: "from-3", value: "C" },
                { id: "from-4", value: "D" },
                { id: "from-5", value: "E" },
            ],
        });
        const toTargetFile = buildFileData({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "X" },
                { id: "to-2", value: "Y" },
                { id: "to-3", value: "Z" },
            ],
        });

        // from line 3 in source (from-3, from-4, from-5) -> to line 2 in target (to-2, to-3)
        // limit is min(3, 2) = 2
        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            matchMode: "lineNumber",
            fromStartLine: 3,
            toStartLine: 2,
        });

        assert.strictEqual(matches.length, 2);
        assert.deepStrictEqual(
            matches.map((m) => [m.fromCellId, m.toCellId]),
            [
                ["from-3", "to-2"],
                ["from-4", "to-3"],
            ]
        );
    });

    test("matchMigrationCells: lineNumber with mixed cell types and start offsets", async () => {
        const fromTargetFile = buildFileDataWithTypes({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-ms", value: "", type: CodexCellTypes.MILESTONE },
                { id: "from-1", value: "A" },
                { id: "from-para", value: "\\p", type: CodexCellTypes.PARATEXT },
                { id: "from-2", value: "B" },
                { id: "from-child", value: "child", parentId: "from-2" },
                { id: "from-3", value: "C" },
                { id: "from-4", value: "D" },
            ],
        });
        const toTargetFile = buildFileDataWithTypes({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "X" },
                { id: "to-2", value: "Y" },
                { id: "to-3", value: "Z" },
            ],
        });

        // After filtering: from has [from-1, from-2, from-3, from-4], to has [to-1, to-2, to-3]
        // fromStartLine=2 means start at from-2; toStartLine=1 means start at to-1
        const matches = await matchMigrationCells({
            fromTargetFile,
            toTargetFile,
            matchMode: "lineNumber",
            fromStartLine: 2,
            toStartLine: 1,
        });

        assert.strictEqual(matches.length, 3, "3 remaining from-cells paired with 3 to-cells");
        assert.deepStrictEqual(
            matches.map((m) => [m.fromCellId, m.toCellId]),
            [
                ["from-2", "to-1"],
                ["from-3", "to-2"],
                ["from-4", "to-3"],
            ]
        );
    });

    test("lineNumber + applyMigrationToTargetFile: end-to-end content migration with offsets", async () => {
        const fromTargetFile = buildFileData({
            path: "/tmp/from.codex",
            id: "from",
            cells: [
                { id: "from-1", value: "SKIP_ME" },
                { id: "from-2", value: "MIGRATE_THIS" },
                { id: "from-3", value: "AND_THIS" },
            ],
        });
        const toTargetFile = buildFileData({
            path: "/tmp/to.codex",
            id: "to",
            cells: [
                { id: "to-1", value: "OLD_1" },
                { id: "to-2", value: "OLD_2" },
                { id: "to-3", value: "OLD_3" },
            ],
        });

        const fromNotebook = buildNotebook([
            buildCell({ id: "from-1", value: "SKIP_ME" }),
            buildCell({ id: "from-2", value: "MIGRATE_THIS" }),
            buildCell({ id: "from-3", value: "AND_THIS" }),
        ], "from-ln", "migration-ln-from.codex");
        const toNotebook = buildNotebook([
            buildCell({ id: "to-1", value: "OLD_1" }),
            buildCell({ id: "to-2", value: "OLD_2" }),
            buildCell({ id: "to-3", value: "OLD_3" }),
        ], "to-ln", "migration-ln-to.codex");

        const fromUri = await createTempCodexFile("migration-ln-from.codex", fromNotebook);
        const toUri = await createTempCodexFile("migration-ln-to.codex", toNotebook);

        try {
            // Migrate starting at from-line 2 into to-line 2
            const matches = await matchMigrationCells({
                fromTargetFile,
                toTargetFile,
                matchMode: "lineNumber",
                fromStartLine: 2,
                toStartLine: 2,
            });

            assert.strictEqual(matches.length, 2, "from-2→to-2, from-3→to-3");
            assert.strictEqual(matches[0].fromCellId, "from-2");
            assert.strictEqual(matches[0].toCellId, "to-2");
            assert.strictEqual(matches[1].fromCellId, "from-3");
            assert.strictEqual(matches[1].toCellId, "to-3");

            const { updated, skipped } = await applyMigrationToTargetFile({
                fromFileUri: fromUri,
                toFileUri: toUri,
                matches,
                forceOverride: true,
            });

            assert.strictEqual(updated, 2);
            assert.strictEqual(skipped, 0);

            const serializer = new CodexContentSerializer();
            const updatedBytes = await vscode.workspace.fs.readFile(toUri);
            const updatedNotebookData = await serializer.deserializeNotebook(
                updatedBytes,
                new vscode.CancellationTokenSource().token
            );

            // to-1 was NOT in the match set → stays unchanged
            assert.strictEqual(updatedNotebookData.cells[0].value, "OLD_1", "Unmatched cell should be untouched");
            // to-2 was matched with from-2 → gets migrated
            assert.strictEqual(updatedNotebookData.cells[1].value, "MIGRATE_THIS", "Matched cell should have migrated value");
            // to-3 was matched with from-3 → gets migrated
            assert.strictEqual(updatedNotebookData.cells[2].value, "AND_THIS", "Matched cell should have migrated value");

            // Verify migration edits were recorded
            const migratedEdits = updatedNotebookData.cells[1].metadata?.edits?.filter(
                (e: any) => e.type === EditType.MIGRATION
            );
            assert.ok(migratedEdits?.length, "Migration edit should be recorded on migrated cell");
        } finally {
            await deleteIfExists(fromUri);
            await deleteIfExists(toUri);
        }
    });
});
