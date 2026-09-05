import * as assert from "assert";
import {
    shouldExcludeCellFromProgress,
    shouldExcludeQuillCellFromProgress,
    computeProgressPercents,
} from "../../../sharedUtils";
import { CodexCellTypes } from "../../../types/enums";
import type { QuillCellContent } from "../../../types";

const makeNotebookCell = (overrides: {
    id?: string;
    type?: string;
    parentId?: string;
    merged?: boolean;
    deleted?: boolean;
    hidden?: boolean;
    dataType?: string;
} = {}) => ({
    metadata: {
        id: overrides.id ?? "GEN 1:1",
        type: overrides.type ?? "text",
        parentId: overrides.parentId,
        data: {
            merged: overrides.merged,
            deleted: overrides.deleted,
            hidden: overrides.hidden,
            type: overrides.dataType,
            parentId: overrides.parentId,
        },
    },
});

const makeQuillCell = (overrides: {
    id?: string;
    cellType?: CodexCellTypes;
    merged?: boolean;
    deleted?: boolean;
    hidden?: boolean;
    dataHidden?: boolean;
    parentId?: string;
    dataParentId?: string;
} = {}): QuillCellContent => ({
    cellMarkers: [overrides.id ?? "GEN 1:1"],
    cellContent: "text",
    cellType: overrides.cellType ?? CodexCellTypes.TEXT,
    editHistory: [],
    merged: overrides.merged,
    deleted: overrides.deleted,
    hidden: overrides.hidden,
    data: {
        hidden: overrides.dataHidden,
        parentId: overrides.dataParentId,
    },
    metadata: {
        parentId: overrides.parentId,
    },
});

suite("Progress exclusion helpers", () => {
    test("shouldExcludeCellFromProgress skips milestone, merged, deleted, hidden, paratext, empty-id, and child cells", () => {
        assert.strictEqual(shouldExcludeCellFromProgress(makeNotebookCell()), false);
        assert.strictEqual(
            shouldExcludeCellFromProgress(makeNotebookCell({ type: "milestone" })),
            true
        );
        assert.strictEqual(shouldExcludeCellFromProgress(makeNotebookCell({ merged: true })), true);
        assert.strictEqual(shouldExcludeCellFromProgress(makeNotebookCell({ deleted: true })), true);
        assert.strictEqual(shouldExcludeCellFromProgress(makeNotebookCell({ hidden: true })), true);
        assert.strictEqual(
            shouldExcludeCellFromProgress(makeNotebookCell({ type: "paratext" })),
            true
        );
        assert.strictEqual(
            shouldExcludeCellFromProgress(makeNotebookCell({ id: "GEN 1:1:paratext-1" })),
            true
        );
        assert.strictEqual(shouldExcludeCellFromProgress(makeNotebookCell({ id: "" })), true);
        assert.strictEqual(
            shouldExcludeCellFromProgress(makeNotebookCell({ parentId: "GEN 1:1" })),
            true
        );
    });

    test("shouldExcludeQuillCellFromProgress treats top-level and data.hidden as excluded", () => {
        assert.strictEqual(shouldExcludeQuillCellFromProgress(makeQuillCell()), false);
        assert.strictEqual(
            shouldExcludeQuillCellFromProgress(makeQuillCell({ hidden: true })),
            true
        );
        assert.strictEqual(
            shouldExcludeQuillCellFromProgress(makeQuillCell({ dataHidden: true })),
            true
        );
        assert.strictEqual(
            shouldExcludeQuillCellFromProgress(makeQuillCell({ merged: true })),
            true
        );
        assert.strictEqual(
            shouldExcludeQuillCellFromProgress(makeQuillCell({ deleted: true })),
            true
        );
        assert.strictEqual(
            shouldExcludeQuillCellFromProgress(
                makeQuillCell({ cellType: CodexCellTypes.MILESTONE, id: "milestone-1" })
            ),
            true
        );
        assert.strictEqual(
            shouldExcludeQuillCellFromProgress(
                makeQuillCell({ cellType: CodexCellTypes.PARATEXT, id: "GEN 1:1:paratext-1" })
            ),
            true
        );
        assert.strictEqual(
            shouldExcludeQuillCellFromProgress(makeQuillCell({ id: "" })),
            true
        );
        assert.strictEqual(
            shouldExcludeQuillCellFromProgress(makeQuillCell({ parentId: "GEN 1:1" })),
            true
        );
        assert.strictEqual(
            shouldExcludeQuillCellFromProgress(makeQuillCell({ dataParentId: "GEN 1:1" })),
            true
        );
    });

    test("computeProgressPercents returns 0 (not NaN) when totalCells is 0", () => {
        const percents = computeProgressPercents(0, 0, 0, 0, 0, 0);
        for (const value of Object.values(percents)) {
            assert.strictEqual(value, 0);
            assert.ok(Number.isFinite(value));
        }
    });
});
