/**
 * Cached notebook serializer for `.codex` / `.source` files.
 *
 * Background: a typical `.codex` document contains thousands of cells (often
 * 3,000–6,000) and weighs several megabytes. Re-running
 * `JSON.stringify(documentData, null, 2)` on every save dominates save latency
 * because most cells are unchanged between saves but still get re-stringified.
 *
 * Strategy: keep a per-cell cache of `JSON.stringify(cell, null, 2)` keyed by
 * the cell's id. On each save we walk the cells in order, use the cached
 * string when present, and only re-stringify cells whose entries have been
 * invalidated (typically by a mutation to that cell). The owner of the cache
 * is responsible for invalidating cell entries when a cell's contents change.
 *
 * This produces byte-identical output to
 * `formatJsonForNotebookFile(notebookAsJson)` for the same input — the cache
 * is purely a CPU optimisation, not a format change.
 */

import {
    ensureSingleTrailingNewline,
    normalizeNewlines,
} from "../../../utils/notebookFileFormattingUtils";

interface CellLike {
    metadata?: { id?: string; };
}

interface NotebookLike<TCell> {
    cells?: TCell[];
    metadata?: unknown;
}

/**
 * Serialize a notebook-shaped object using a per-cell string cache.
 *
 * The output is byte-identical to `formatJsonForNotebookFile(data)` for any
 * input that has `JSON.stringify`-stable key ordering on `data`,
 * `data.cells[*]`, and `data.metadata`.
 */
export function serializeNotebookWithCellCache<TCell extends CellLike>(
    data: NotebookLike<TCell>,
    cellCache: Map<string, string>
): string {
    const cells = data.cells ?? [];

    // Build the cells block. JSON.stringify(value, null, 2) outputs an empty
    // array as `[]` (no newlines), so reproduce that for parity.
    let cellsBlock: string;
    if (cells.length === 0) {
        cellsBlock = `"cells": []`;
    } else {
        const cellLines: string[] = [];
        for (const cell of cells) {
            cellLines.push(serializeCellWithCache(cell, cellCache));
        }
        cellsBlock = `"cells": [\n${cellLines.join(",\n")}\n  ]`;
    }

    // Metadata is always stringified fresh — it is small, contains no nested
    // hot loops, and any growth (e.g. metadata.edits[]) is bounded compared to
    // the cells array.
    const metadataJson = JSON.stringify(data.metadata, null, 2);
    const metadataBlock = `"metadata": ${indentLinesAfterFirst(metadataJson, "  ")}`;

    const body = `{\n  ${cellsBlock},\n  ${metadataBlock}\n}`;
    return ensureSingleTrailingNewline(normalizeNewlines(body));
}

/**
 * Serialize a single cell using the cache. Returns the cell's JSON
 * representation indented to be embedded inside the parent's `cells` array
 * (i.e. each line prefixed with 4 spaces, matching JSON.stringify's depth-2
 * indentation).
 *
 * The cache stores the *already-indented* string so cache hits are an O(1)
 * Map lookup with no further string work — this is the whole point of the
 * cache, since `String.prototype.split` + `.map` + `.join` over a cell's
 * JSON costs roughly the same as `JSON.stringify` of the cell itself.
 */
function serializeCellWithCache<TCell extends CellLike>(
    cell: TCell,
    cellCache: Map<string, string>
): string {
    const id = cell?.metadata?.id;

    if (typeof id === "string" && id.length > 0) {
        const cached = cellCache.get(id);
        if (cached !== undefined) return cached;
        const fresh = indentEveryLine(JSON.stringify(cell, null, 2), "    ");
        cellCache.set(id, fresh);
        return fresh;
    }

    // Cells without a stable id cannot be cached safely.
    return indentEveryLine(JSON.stringify(cell, null, 2), "    ");
}

/**
 * Prefix every line in `text` with `prefix`. Used for embedding a serialized
 * cell into the parent document's `cells` array at depth 2 (4-space indent).
 */
function indentEveryLine(text: string, prefix: string): string {
    if (prefix.length === 0) return text;
    if (!text.includes("\n")) return prefix + text;
    return text
        .split("\n")
        .map((line) => prefix + line)
        .join("\n");
}

/**
 * Prefix every line in `text` EXCEPT the first with `prefix`. Used for
 * embedding `metadata` into the parent document at depth 1 (2-space indent),
 * where the first line follows `"metadata": ` directly on the same line.
 */
function indentLinesAfterFirst(text: string, prefix: string): string {
    if (prefix.length === 0 || !text.includes("\n")) return text;
    const lines = text.split("\n");
    return lines.map((line, idx) => (idx === 0 ? line : prefix + line)).join("\n");
}
