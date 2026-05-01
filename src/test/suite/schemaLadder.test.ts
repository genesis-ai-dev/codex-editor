import * as assert from "assert";
import { bringNotebookToCurrent, CURRENT_SCHEMA_VERSION, getSchemaVersion } from "../../projectManager/utils/schema";
import { resolveCodexCustomMerge } from "../../projectManager/utils/merge/resolvers";
import { EditType, CodexCellTypes } from "../../../types/enums";

const ctx = { author: "test-author" };

const buildV0Notebook = () => ({
    cells: [
        // Modern shape — has editMap already, no transform needed.
        {
            kind: 2,
            languageId: "html",
            value: "Hello world",
            metadata: {
                id: "cell-text-1",
                type: CodexCellTypes.TEXT,
                edits: [
                    {
                        editMap: ["value"],
                        value: "Hello world",
                        timestamp: 1_000,
                        type: EditType.INITIAL_IMPORT,
                        author: "alice",
                    },
                ],
            },
        },
        // Legacy shape: edit has cellValue + no editMap. Should be rewritten by v0 → v1.
        {
            kind: 2,
            languageId: "html",
            value: "Legacy text",
            metadata: {
                id: "cell-text-legacy",
                type: CodexCellTypes.TEXT,
                edits: [
                    {
                        cellValue: "Legacy text",
                        timestamp: 2_000,
                        type: EditType.USER_EDIT,
                        author: "bob",
                    } as any,
                ],
            },
        },
        // Milestone with empty edits — must be left alone.
        {
            kind: 2,
            languageId: "html",
            value: "1 John 1",
            metadata: {
                id: "cell-milestone",
                type: CodexCellTypes.MILESTONE,
                edits: [],
            },
        },
    ],
    metadata: {
        id: "notebook-test",
        edits: [],
    },
});

suite("schema ladder", () => {
    test("v0 → current: stamps version, rewrites legacy cellValue, leaves modern shape and milestones alone", async () => {
        const notebook = buildV0Notebook();
        assert.strictEqual(getSchemaVersion(notebook), 0, "starts at v0");

        const result = await bringNotebookToCurrent(notebook, ctx);
        assert.strictEqual(result.migrated, true);
        assert.strictEqual(result.from, 0);
        assert.strictEqual(result.to, CURRENT_SCHEMA_VERSION);
        assert.strictEqual(notebook.metadata.schemaVersion, CURRENT_SCHEMA_VERSION);

        const [textCell, legacyCell, milestoneCell] = notebook.cells;

        // Modern-shape edit: untouched (already had editMap).
        const textEdit = textCell.metadata.edits[0] as any;
        assert.deepStrictEqual(textEdit.editMap, ["value"]);
        assert.strictEqual(textEdit.value, "Hello world");

        // Legacy-shape edit: cellValue lifted to value/editMap.
        const legacyEdit = legacyCell.metadata.edits[0] as any;
        assert.deepStrictEqual(legacyEdit.editMap, ["value"], "legacy cellValue lifted to editMap=['value']");
        assert.strictEqual(legacyEdit.value, "Legacy text", "legacy value preserved");
        assert.strictEqual(legacyEdit.cellValue, undefined, "legacy cellValue field removed");

        // Milestone: untouched.
        assert.deepStrictEqual(milestoneCell.metadata.edits, [], "milestone untouched");
        assert.strictEqual(milestoneCell.value, "1 John 1");
    });

    test("idempotent: a notebook already at current schema is byte-identical after a second pass", async () => {
        const notebook = buildV0Notebook();
        await bringNotebookToCurrent(notebook, ctx);

        const before = JSON.stringify(notebook);
        const second = await bringNotebookToCurrent(notebook, ctx);
        const after = JSON.stringify(notebook);

        assert.strictEqual(second.migrated, false, "second pass reports migrated: false");
        assert.strictEqual(before, after, "no fields mutated on the second pass");
    });

    test("ahead-of-client: notebook with future version is left alone and reported", async () => {
        const future = { metadata: { schemaVersion: CURRENT_SCHEMA_VERSION + 99 }, cells: [] };
        const before = JSON.stringify(future);
        const result = await bringNotebookToCurrent(future, ctx);
        const after = JSON.stringify(future);

        assert.strictEqual(result.migrated, false);
        assert.strictEqual(result.aheadOfClient, true);
        assert.strictEqual(before, after, "future-version notebook untouched");
    });

    test("resolveCodexCustomMerge: v0 inputs produce a current-version output", async () => {
        const ours = JSON.stringify(buildV0Notebook());
        const theirs = JSON.stringify(buildV0Notebook());

        const merged = await resolveCodexCustomMerge(ours, theirs);
        const mergedNotebook = JSON.parse(merged);
        assert.strictEqual(
            mergedNotebook.metadata.schemaVersion,
            CURRENT_SCHEMA_VERSION,
            "merge output is stamped at the current schema version"
        );

        // The legacy edit on both sides should have been rewritten before the merge ran.
        const legacyCell = mergedNotebook.cells.find((c: any) => c.metadata?.id === "cell-text-legacy");
        const legacyEdit = legacyCell.metadata.edits.find(
            (e: any) => Array.isArray(e.editMap) && e.editMap[0] === "value"
        );
        assert.ok(legacyEdit, "legacy edit was lifted into editMap form");
        assert.strictEqual(legacyEdit.cellValue, undefined, "legacy cellValue field gone");
    });
});
