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
});
