import * as vscode from "vscode";
import { CodexNotebookAsJSONData } from "../../types";
import { CodexCellTypes } from "../../types/enums";
import { parseVerseRef } from "../utils/verseRefUtils";

/**
 * Reads a .codex notebook from disk and parses its JSON content
 */
export async function readCodexNotebookFromUri(
    uri: vscode.Uri
): Promise<CodexNotebookAsJSONData> {
    const fileData = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(fileData).toString()) as CodexNotebookAsJSONData;
}

/**
 * Returns only active cells, excluding merged, deleted, and hidden ones (based on metadata.data).
 * Hidden cells are treated like deleted for export purposes.
 * Keeps the original cell order intact.
 */
export function getActiveCells(cells: CodexNotebookAsJSONData["cells"]) {
    return cells.filter((cell) => {
        const data = (cell.metadata as any)?.data;
        const isMerged = !!(data && data.merged);
        const isDeleted = !!(data && data.deleted);
        const isHidden = !!(data && data.hidden);
        return !isMerged && !isDeleted && !isHidden;
    });
}

/**
 * Checks whether a cell metadata type represents translatable content.
 * Accepts CodexCellTypes.TEXT and the legacy "markdown" type from older markdown imports.
 */
export function isContentCellType(type: string | undefined): boolean {
    return type === CodexCellTypes.TEXT || type === "markdown";
}

/** Verse-marker-shaped label part: digits with an optional segment letter (e.g. "1", "12a"). */
const verseMarkerPartRegex = /^\d+[a-z]?$/i;

/**
 * Normalizes a cell label into a verse marker valid in USFM (`\v 1-3`), or
 * returns null when the label is not verse-marker-shaped (e.g. "Narrator").
 * Multi-part merge chains like "1-2-3" (from merging an already-merged cell)
 * collapse to their span ("1-3") so the marker stays valid USFM.
 */
export function verseMarkerFromCellLabel(cellLabel: unknown): string | null {
    if (typeof cellLabel !== "string") return null;
    const trimmed = cellLabel.trim();
    if (!trimmed) return null;
    const parts = trimmed.split("-").map((part) => part.trim());
    if (!parts.every((part) => verseMarkerPartRegex.test(part))) return null;
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    return first === last ? first : `${first}-${last}`;
}

/**
 * Derives the verse marker to export for a cell (e.g. "3" or "1-3").
 * A UI-merged cell keeps a single-verse globalReference and records the merged
 * span in its cellLabel, so a verse-marker-shaped cellLabel wins; otherwise the
 * ref itself may encode a range ("GEN 1:1-3"), which parseVerseRef resolves
 * (including legacy cell-id-suffixed refs). Falls back to the trailing digits
 * of the ref for anything parseVerseRef rejects.
 */
export function getVerseMarkerForCell(
    cell: { metadata?: any; },
    verseRef: string
): string | null {
    const labelMarker = verseMarkerFromCellLabel(cell.metadata?.cellLabel);
    if (labelMarker) return labelMarker;

    const parsed = parseVerseRef(verseRef);
    if (parsed) return parsed.cellLabel;

    const trailingDigits = verseRef.match(/\d+$/);
    return trailingDigits ? trailingDigits[0] : null;
}
