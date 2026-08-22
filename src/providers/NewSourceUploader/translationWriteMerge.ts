/**
 * Applying an imported translation to an existing .codex notebook.
 *
 * The aligner hands us one entry per target cell, plus extra entries for anything that could not
 * be matched one-to-one:
 *
 * - `isParatext` — content with no cell of its own; inserted as a PARATEXT cell after its parent.
 * - `isAdditionalOverlap` — a second (third, …) imported cue covering a cell that already has a
 *   better match. Subtitle files routinely split one source line across several cues. These are
 *   NOT cells of their own: their text is folded into the cell they overlap, in temporal order,
 *   and the cell keeps the timestamps of its best match. See `mergedOverlaps` below.
 *
 * Issue #1144: additional overlaps used to be keyed by their parent's id alongside the parent's own
 * match, so the last cue to arrive replaced the cell's real translation — text and timestamps both.
 * Nothing was ever written as a child cell despite the import reporting that it had been. Folding
 * the text in is what the parent-keyed map was always incapable of expressing.
 *
 * This module is pure (no vscode imports) so the merge is unit-testable.
 */

import { CodexCellTypes } from "../../../types/enums";

/** Joins the text of two cues folded into the same cell. */
const OVERLAP_JOIN = " ";

export interface TranslationCell {
    kind?: number;
    languageId?: string;
    value: string;
    metadata?: {
        id?: string;
        type?: string;
        data?: Record<string, unknown>;
        parentId?: string;
        [key: string]: unknown;
    };
}

export interface TranslationNotebook {
    cells: TranslationCell[];
    metadata?: Record<string, unknown>;
}

export interface TranslationImportedContent {
    id: string;
    content: string;
    startTime?: number | string;
    endTime?: number | string;
    parentId?: string;
    data?: unknown;
    [key: string]: unknown;
}

export interface TranslationAlignedCell {
    notebookCell: TranslationCell | null;
    importedContent: TranslationImportedContent;
    isParatext?: boolean;
    isAdditionalOverlap?: boolean;
    [key: string]: unknown;
}

export interface TranslationWriteStats {
    /** Cells that received imported text they did not have before. */
    insertedCount: number;
    /** Cells left untouched: milestones, and cells that already hold a translation. */
    skippedCount: number;
    /** Paratext cells added. */
    paratextCount: number;
    /** Extra cues folded into the text of the cell they overlap. */
    mergedCueCount: number;
}

export interface ApplyTranslationOptions {
    importerType?: string;
    sourceFilePath?: string;
    /** ISO timestamp recorded on the import. Injectable so tests are deterministic. */
    timestamp?: string;
}

export interface ApplyTranslationResult {
    updatedNotebook: TranslationNotebook;
    stats: TranslationWriteStats;
}

/** A single cue's contribution to a cell's text. */
interface CuePiece {
    content: string;
    startTime?: number | string;
    endTime?: number | string;
    /** Position in the aligned array, so equal timings still order deterministically. */
    arrival: number;
}

const toSeconds = (value: number | string | undefined): number => {
    if (typeof value === "number") return value;
    if (typeof value !== "string" || value.trim() === "") return Number.NaN;
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
    // "HH:MM:SS.mmm"
    const [time, milliseconds] = value.split(".");
    const parts = time.split(":").map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return Number.NaN;
    return parts[0] * 3600 + parts[1] * 60 + parts[2] + Number(milliseconds || 0) / 1000;
};

/** Temporal order, falling back to arrival order so the result never depends on emission order. */
const byTime = (a: CuePiece, b: CuePiece): number => {
    const aStart = toSeconds(a.startTime);
    const bStart = toSeconds(b.startTime);
    if (!Number.isNaN(aStart) && !Number.isNaN(bStart) && aStart !== bStart) return aStart - bStart;
    const aEnd = toSeconds(a.endTime);
    const bEnd = toSeconds(b.endTime);
    if (!Number.isNaN(aEnd) && !Number.isNaN(bEnd) && aEnd !== bEnd) return aEnd - bEnd;
    return a.arrival - b.arrival;
};

const hasText = (value: string | undefined): boolean =>
    typeof value === "string" && value.trim() !== "";

/**
 * Apply aligned imported content to a notebook, returning a new notebook and the stats that
 * describe what actually changed. Pure: the caller owns reading and writing the file.
 */
export function applyTranslationToNotebook(
    existingNotebook: TranslationNotebook,
    alignedContent: TranslationAlignedCell[],
    options: ApplyTranslationOptions = {}
): ApplyTranslationResult {
    const timestamp = options.timestamp ?? new Date().toISOString();

    const cellsById = new Map<string, TranslationCell>();
    for (const cell of existingNotebook.cells ?? []) {
        const id = cell.metadata?.id;
        if (typeof id === "string") cellsById.set(id, cell);
    }

    const updatesMap = new Map<string, TranslationCell>();
    const paratextCells: Array<{ cell: TranslationCell; parentId?: string }> = [];
    const overlapsByParentId = new Map<string, CuePiece[]>();
    const primaries: Array<{ aligned: TranslationAlignedCell; arrival: number }> = [];

    const stats: TranslationWriteStats = {
        insertedCount: 0,
        skippedCount: 0,
        paratextCount: 0,
        mergedCueCount: 0,
    };

    // Pass 1 — sort the aligned entries into paratext, primary matches, and extra cues.
    alignedContent.forEach((alignedCell, arrival) => {
        const imported = alignedCell.importedContent;

        if (alignedCell.isParatext) {
            const importedData = imported.data;
            const paratextData =
                typeof importedData === "object" && importedData !== null ? importedData : {};
            paratextCells.push({
                cell: {
                    kind: 1,
                    languageId: "html",
                    value: imported.content,
                    metadata: {
                        type: CodexCellTypes.PARATEXT,
                        id: imported.id,
                        data: {
                            ...paratextData,
                            startTime: imported.startTime,
                            endTime: imported.endTime,
                        },
                        parentId: imported.parentId,
                    },
                },
                parentId: imported.parentId,
            });
            stats.paratextCount++;
            return;
        }

        if (!alignedCell.notebookCell) return;

        if (alignedCell.isAdditionalOverlap) {
            // Never its own cell, and never an entry in updatesMap — that is the #1144 bug.
            const parentId = imported.parentId ?? alignedCell.notebookCell.metadata?.id;
            if (typeof parentId !== "string") return;
            const pieces = overlapsByParentId.get(parentId) ?? [];
            pieces.push({
                content: imported.content,
                startTime: imported.startTime,
                endTime: imported.endTime,
                arrival,
            });
            overlapsByParentId.set(parentId, pieces);
            return;
        }

        primaries.push({ aligned: alignedCell, arrival });
    });

    // Pass 2 — build the updated cell for each primary match, folding in any extra cues.
    for (const { aligned, arrival } of primaries) {
        const notebookCell = aligned.notebookCell!;
        const imported = aligned.importedContent;
        const targetId = notebookCell.metadata?.id ?? imported.id;
        if (typeof targetId !== "string") continue;

        const existingCell = cellsById.get(targetId);

        // Never overwrite milestone cells — they are structural markers.
        const isMilestone =
            existingCell?.metadata?.type === CodexCellTypes.MILESTONE ||
            notebookCell.metadata?.type === CodexCellTypes.MILESTONE;
        if (isMilestone) {
            stats.skippedCount++;
            overlapsByParentId.delete(targetId);
            continue;
        }

        const existingValue = existingCell?.value ?? notebookCell.value ?? "";
        if (hasText(existingValue)) {
            // The cell already holds a translation; leave it and its extra cues alone.
            updatesMap.set(targetId, existingCell ?? notebookCell);
            stats.skippedCount++;
            overlapsByParentId.delete(targetId);
            continue;
        }

        const extraCues = (overlapsByParentId.get(targetId) ?? []).slice();
        overlapsByParentId.delete(targetId);

        const pieces: CuePiece[] = [
            {
                content: imported.content,
                startTime: imported.startTime,
                endTime: imported.endTime,
                arrival,
            },
            ...extraCues,
        ]
            .filter((piece) => hasText(piece.content))
            .sort(byTime);

        const value = pieces.map((piece) => piece.content.trim()).join(OVERLAP_JOIN);

        const data: Record<string, unknown> = {
            ...(existingCell?.metadata?.data ?? notebookCell.metadata?.data),
            // The cell keeps the timing of its best match. Extra cues contribute text only:
            // widening the range here would push the cell into overlapping its neighbour.
            startTime: imported.startTime,
            endTime: imported.endTime,
        };

        if (extraCues.length > 0) {
            // Breadcrumb: what was folded in, so the merge stays auditable and reversible.
            data.mergedOverlaps = extraCues
                .slice()
                .sort(byTime)
                .map((cue) => ({
                    startTime: cue.startTime,
                    endTime: cue.endTime,
                    content: cue.content,
                }));
            stats.mergedCueCount += extraCues.length;
        } else {
            delete data.mergedOverlaps;
        }

        updatesMap.set(targetId, {
            kind: 1,
            languageId: "html",
            value,
            metadata: {
                ...(existingCell?.metadata ?? notebookCell.metadata),
                type: CodexCellTypes.TEXT,
                id: targetId,
                data,
            },
        });

        // Unmatched cells come back from the aligner carrying their own (empty) content, so only
        // count a cell that genuinely gained text.
        if (hasText(value)) stats.insertedCount++;
    }

    // Any extra cue whose parent never produced a primary match would otherwise be dropped in
    // silence. Fold it into the parent cell if that cell exists and is still empty.
    for (const [parentId, pieces] of overlapsByParentId) {
        const existingCell = cellsById.get(parentId);
        if (!existingCell || updatesMap.has(parentId)) continue;
        if (existingCell.metadata?.type === CodexCellTypes.MILESTONE) continue;
        if (hasText(existingCell.value)) continue;

        const ordered = pieces.filter((piece) => hasText(piece.content)).sort(byTime);
        if (ordered.length === 0) continue;

        const value = ordered.map((piece) => piece.content.trim()).join(OVERLAP_JOIN);
        updatesMap.set(parentId, {
            kind: 1,
            languageId: "html",
            value,
            metadata: {
                ...existingCell.metadata,
                type: CodexCellTypes.TEXT,
                id: parentId,
                data: {
                    ...existingCell.metadata?.data,
                    startTime: ordered[0].startTime,
                    endTime: ordered[ordered.length - 1].endTime,
                },
            },
        });
        stats.insertedCount++;
        stats.mergedCueCount += ordered.length - 1;
    }

    // Pass 3 — rebuild in the notebook's own order. Driving this from the existing cells (rather
    // than from the aligned array) is what makes the write path immune to aligner emission order.
    const newCells: TranslationCell[] = [];
    for (const cell of existingNotebook.cells ?? []) {
        const cellId = cell.metadata?.id;
        const update = typeof cellId === "string" ? updatesMap.get(cellId) : undefined;
        newCells.push(update ?? cell);

        if (typeof cellId === "string") {
            for (const pt of paratextCells) {
                if (pt.parentId === cellId) newCells.push(pt.cell);
            }
        }
    }

    // Append paratext cells with no parent, or whose parent is not in this notebook.
    for (const pt of paratextCells) {
        const alreadyInserted =
            pt.parentId && newCells.some((c) => c.metadata?.id === pt.cell.metadata?.id);
        if (!alreadyInserted) newCells.push(pt.cell);
    }

    const updatedNotebook: TranslationNotebook = {
        ...existingNotebook,
        cells: newCells,
        metadata: {
            ...existingNotebook.metadata,
            importerType: options.importerType || (existingNotebook.metadata?.importerType as string),
            importTimestamp: timestamp,
            importContext: {
                ...((existingNotebook.metadata?.importContext as Record<string, unknown>) ?? {}),
                lastTranslationImport: {
                    importerType: options.importerType,
                    timestamp,
                    sourceFilePath: options.sourceFilePath,
                    stats: { ...stats },
                },
            },
        },
    };

    return { updatedNotebook, stats };
}

/** The message shown when an import finishes. Kept here so tests can assert it matches the stats. */
export function describeTranslationImport(stats: TranslationWriteStats): string {
    const parts = [
        `${stats.insertedCount} translations`,
        `${stats.paratextCount} paratext cells`,
        `${stats.skippedCount} skipped`,
    ];
    if (stats.mergedCueCount > 0) {
        const cue = stats.mergedCueCount === 1 ? "cue" : "cues";
        parts.splice(2, 0, `${stats.mergedCueCount} overlapping ${cue} merged in`);
    }
    return `Translation imported: ${parts.join(", ")}.`;
}
