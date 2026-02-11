import * as assert from "assert";
import { CodexCellTypes } from "../../../../types/enums";
import {
    isParatextCell,
    isMilestoneCell,
    isChildCell,
    isContentCell,
    type CellLike,
} from "../../../utils/cellTypeUtils";

suite("cellTypeUtils shared utilities", () => {
    // ─── isParatextCell ─────────────────────────────────────────────────

    test("isParatextCell: true for metadata-style paratext", () => {
        const cell: CellLike = { metadata: { type: CodexCellTypes.PARATEXT } };
        assert.strictEqual(isParatextCell(cell), true);
    });

    test("isParatextCell: true for quill-style paratext", () => {
        const cell: CellLike = { cellType: CodexCellTypes.PARATEXT };
        assert.strictEqual(isParatextCell(cell), true);
    });

    test("isParatextCell: false for text cell", () => {
        const cell: CellLike = { metadata: { type: CodexCellTypes.TEXT } };
        assert.strictEqual(isParatextCell(cell), false);
    });

    test("isParatextCell: false for undefined type", () => {
        const cell: CellLike = { metadata: {} };
        assert.strictEqual(isParatextCell(cell), false);
    });

    // ─── isMilestoneCell ────────────────────────────────────────────────

    test("isMilestoneCell: true for metadata-style milestone", () => {
        const cell: CellLike = { metadata: { type: CodexCellTypes.MILESTONE } };
        assert.strictEqual(isMilestoneCell(cell), true);
    });

    test("isMilestoneCell: true for quill-style milestone", () => {
        const cell: CellLike = { cellType: CodexCellTypes.MILESTONE };
        assert.strictEqual(isMilestoneCell(cell), true);
    });

    test("isMilestoneCell: false for text cell", () => {
        const cell: CellLike = { metadata: { type: CodexCellTypes.TEXT } };
        assert.strictEqual(isMilestoneCell(cell), false);
    });

    // ─── isChildCell ────────────────────────────────────────────────────

    test("isChildCell: true when metadata.parentId is set", () => {
        const cell: CellLike = { metadata: { id: "child-1", parentId: "parent-1" } };
        assert.strictEqual(isChildCell(cell), true);
    });

    test("isChildCell: true when data.parentId is set (quill compat)", () => {
        const cell: CellLike = { data: { parentId: "parent-1" } };
        assert.strictEqual(isChildCell(cell), true);
    });

    test("isChildCell: true when metadata.data.parentId is set", () => {
        const cell: CellLike = { metadata: { data: { parentId: "parent-1" } } };
        assert.strictEqual(isChildCell(cell), true);
    });

    test("isChildCell: true for legacy colon-based child ID (>2 segments)", () => {
        const cell: CellLike = { metadata: { id: "GEN 1:1:paratext-12345" } };
        assert.strictEqual(isChildCell(cell), true);
    });

    test("isChildCell: false for normal cell ID with 2 segments", () => {
        const cell: CellLike = { metadata: { id: "GEN 1:1" } };
        assert.strictEqual(isChildCell(cell), false);
    });

    test("isChildCell: false for UUID cell without parentId", () => {
        const cell: CellLike = { metadata: { id: "e8676fe1-2971-37cd-7f4c-5e0f117d9862" } };
        assert.strictEqual(isChildCell(cell), false);
    });

    test("isChildCell: false for empty metadata", () => {
        const cell: CellLike = { metadata: {} };
        assert.strictEqual(isChildCell(cell), false);
    });

    test("isChildCell: false when parentId is empty string", () => {
        const cell: CellLike = { metadata: { parentId: "  " } };
        assert.strictEqual(isChildCell(cell), false);
    });

    // ─── isContentCell ──────────────────────────────────────────────────

    test("isContentCell: true for normal text cell", () => {
        const cell: CellLike = { metadata: { id: "cell-1", type: CodexCellTypes.TEXT } };
        assert.strictEqual(isContentCell(cell), true);
    });

    test("isContentCell: false for paratext", () => {
        const cell: CellLike = { metadata: { id: "para-1", type: CodexCellTypes.PARATEXT } };
        assert.strictEqual(isContentCell(cell), false);
    });

    test("isContentCell: false for milestone", () => {
        const cell: CellLike = { metadata: { id: "ms-1", type: CodexCellTypes.MILESTONE } };
        assert.strictEqual(isContentCell(cell), false);
    });

    test("isContentCell: false for child cell", () => {
        const cell: CellLike = {
            metadata: { id: "child-1", type: CodexCellTypes.TEXT, parentId: "parent-1" },
        };
        assert.strictEqual(isContentCell(cell), false);
    });

    test("isContentCell: true for cell with no metadata type (defaults to non-special)", () => {
        const cell: CellLike = { metadata: { id: "cell-1" } };
        assert.strictEqual(isContentCell(cell), true);
    });

    // ─── metadata.type vs cellType precedence ───────────────────────────

    test("metadata.type takes precedence over cellType", () => {
        const cell: CellLike = {
            metadata: { type: CodexCellTypes.TEXT },
            cellType: CodexCellTypes.PARATEXT,
        };
        // metadata.type is TEXT, so this should NOT be paratext
        assert.strictEqual(isParatextCell(cell), false);
        assert.strictEqual(isContentCell(cell), true);
    });

    test("cellType used as fallback when metadata.type is undefined", () => {
        const cell: CellLike = {
            metadata: {},
            cellType: CodexCellTypes.PARATEXT,
        };
        assert.strictEqual(isParatextCell(cell), true);
        assert.strictEqual(isContentCell(cell), false);
    });
});
