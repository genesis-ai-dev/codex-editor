import { CodexCellTypes } from "../../types/enums";

/**
 * Shared utilities for determining cell types (paratext, child, milestone, content).
 *
 * These helpers accept a minimal "cell-like" object so they can be used in both
 * the extension host (FileData cells, CustomNotebookCellData) and in webview
 * code (QuillCellContent) without importing heavy VS Code types.
 *
 * Convention:
 *   - "metadata-style" cells store type/parentId in `cell.metadata`
 *   - "quill-style"    cells store type in `cell.cellType` and parentId
 *                       in `cell.metadata?.parentId` or `cell.data?.parentId`
 */

/** Minimal shape that both extension and webview cell objects satisfy. */
export interface CellLike {
    metadata?: {
        id?: string;
        type?: string;
        parentId?: string;
        data?: { parentId?: string; };
    };
    /** QuillCellContent uses `cellType` at the top level. */
    cellType?: string;
    /** QuillCellContent uses `data` at the top level. */
    data?: { parentId?: string; };
}

/**
 * Returns `true` when the cell is a **paratext** cell.
 */
export const isParatextCell = (cell: CellLike): boolean => {
    const type = cell.metadata?.type ?? cell.cellType;
    return type === CodexCellTypes.PARATEXT;
};

/**
 * Returns `true` when the cell is a **milestone** cell.
 */
export const isMilestoneCell = (cell: CellLike): boolean => {
    const type = cell.metadata?.type ?? cell.cellType;
    return type === CodexCellTypes.MILESTONE;
};

/**
 * Returns `true` when the cell is a **child** cell (has a parent).
 *
 * Checks in order:
 * 1. `metadata.parentId` (modern UUID format)
 * 2. `data.parentId` / `metadata.data.parentId` (QuillCellContent compat)
 * 3. Legacy: cell ID contains more than two `:` segments
 */
export const isChildCell = (cell: CellLike): boolean => {
    const parentId =
        cell.metadata?.parentId ??
        cell.data?.parentId ??
        cell.metadata?.data?.parentId;

    if (typeof parentId === "string" && parentId.trim()) {
        return true;
    }

    // Legacy fallback: IDs like "GEN 1:1:cue-..." have >2 colon-separated parts
    const cellId = cell.metadata?.id;
    if (typeof cellId === "string" && cellId.trim()) {
        return cellId.split(":").length > 2;
    }

    return false;
};

/**
 * Returns `true` when the cell is a regular content cell — i.e. it is
 * **not** paratext, **not** a milestone, and **not** a child cell.
 */
export const isContentCell = (cell: CellLike): boolean => {
    return !isParatextCell(cell) && !isMilestoneCell(cell) && !isChildCell(cell);
};
