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
 * Re-imports: a cell that already holds a translation is only left alone when the incoming text
 * is identical, empty, or the cell's current value was last set by a person in the editor (a
 * user edit, or a validated value). Otherwise the import replaces the text — clients round-trip
 * exported subtitle files through external editors, and their fixes must land on re-upload.
 * Every replacement is recorded as edit-history entries (the previous value is back-filled into
 * the history first when no edit captured it), so nothing is discarded and the new value
 * survives sync merges instead of being reverted to a remote edit.
 *
 * A cell that keeps its text can still take a corrected TIME RANGE, but only from a cue the
 * aligner matched by cell id — proof the file is this project's own export coming back. Timing
 * from a merely overlapping cue is never trusted that way: a file whose clock is offset would
 * otherwise silently shift every cell in the notebook. See the retime branch in pass 2.
 *
 * Nothing here touches a locked cell, and a retime stands down on a validated one, because both
 * are places where a person has said in the editor that this cell is settled.
 *
 * Replacing text in bulk is destructive, and importing the wrong file (another episode's export)
 * aligns by timestamp just as happily as the right one. {@link needsBulkOverwriteConfirmation}
 * spots that shape so the caller can ask before writing; everything else stays silent.
 *
 * This module is pure (no vscode imports) so the merge is unit-testable.
 */

import { CodexCellTypes, EditType } from "../../../types/enums";
import { EditMapUtils } from "../../utils/editMapUtils";

/** Joins the text of two cues folded into the same cell. */
const OVERLAP_JOIN = " ";

/** Timestamps carry millisecond precision; anything closer than this is the same instant. */
const TIME_EPSILON = 1e-3 / 2;

/**
 * A bulk overwrite is only worth interrupting for when it is big in both senses: many cells, and
 * most of the work in the file. Below either threshold the import stays silent.
 */
const BULK_OVERWRITE_MIN_CELLS = 10;
const BULK_OVERWRITE_MIN_SHARE = 0.5;

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
    /**
     * How the aligner chose this cell. `exact-id` means the imported cue named the cell outright,
     * which is only possible for a file exported from this very project.
     */
    alignmentMethod?: string;
    [key: string]: unknown;
}

export interface TranslationWriteStats {
    /** Cells that received imported text they did not have before. */
    insertedCount: number;
    /** Cells whose existing translation was replaced by different imported text. */
    updatedCount: number;
    /** Cells that kept their text but took a corrected time range from an id-matched cue. */
    retimedCount: number;
    /** Cells left untouched: milestones, unchanged translations, and human-authored values. */
    skippedCount: number;
    /** Paratext cells added. */
    paratextCount: number;
    /** Extra cues folded into the text of the cell they overlap. */
    mergedCueCount: number;
}

/** What the caller needs to judge whether this import is about to do something drastic. */
export interface TranslationOverwriteRisk {
    /** Cues the aligner matched to a cell by id — proof the file belongs to this project. */
    exactIdMatches: number;
    /** Cells that already held a translation before this import ran. */
    populatedCellCount: number;
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
    overwriteRisk: TranslationOverwriteRisk;
}

/**
 * True when this import looks like the wrong file rather than a corrected one.
 *
 * Importing another episode's subtitles aligns by timestamp perfectly well — every project starts
 * at zero — so a mistake replaces the whole translation and reports it as a success. The tell is
 * that not one cue named a cell by id, so the file is nobody's export of this project, and yet it
 * is set to replace most of the translations in it. The caller should confirm before writing.
 */
export function needsBulkOverwriteConfirmation(
    stats: TranslationWriteStats,
    risk: TranslationOverwriteRisk
): boolean {
    if (risk.exactIdMatches > 0) return false;
    if (stats.updatedCount < BULK_OVERWRITE_MIN_CELLS) return false;
    return stats.updatedCount > risk.populatedCellCount * BULK_OVERWRITE_MIN_SHARE;
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

/** Shape of an edit-history entry as this module reads and writes it. */
interface CellEdit {
    editMap: readonly string[];
    value: unknown;
    timestamp: number;
    type: EditType;
    author?: string;
    validatedBy?: Array<{ isDeleted?: boolean;[key: string]: unknown }>;
    [key: string]: unknown;
}

/** Imports run under the same synthetic author as re-imports (see reimportMerge.ts). */
const IMPORT_AUTHOR = "system";

const makeImportEdit = (editMap: readonly string[], value: unknown, timestamp: number): CellEdit => ({
    editMap,
    value,
    timestamp,
    type: EditType.INITIAL_IMPORT,
    author: IMPORT_AUTHOR,
    validatedBy: [],
});

const isValueEditMap = (editMap: unknown): boolean =>
    Array.isArray(editMap) && editMap.length === 1 && editMap[0] === "value";

/**
 * True for any edit that records the cell's value, in either storage format.
 *
 * Projects created before edit maps existed store the text as `cellValue` with no `editMap` at
 * all. Those files are only normalized when a sync merge or the edit-history migration happens to
 * touch them (see `resolvers.ts` and `migration_...` in `migrationUtils.ts`), so an untouched old
 * project still holds them — and reading only the new shape would make a person's typed text look
 * machine-written and hand it to the next import to overwrite.
 */
const isValueEdit = (edit: CellEdit | undefined): boolean => {
    if (!edit) return false;
    if (isValueEditMap(edit.editMap)) return true;
    return !edit.editMap && (edit as { cellValue?: unknown }).cellValue !== undefined;
};

/** The text a value edit recorded, wherever that format kept it. */
const valueEditValue = (edit: CellEdit): unknown =>
    edit.value !== undefined ? edit.value : (edit as { cellValue?: unknown }).cellValue;

const cellEdits = (cell: TranslationCell | undefined): CellEdit[] => {
    const edits = cell?.metadata?.edits;
    return Array.isArray(edits) ? (edits as CellEdit[]) : [];
};

/** Someone signed off on this edit and has not withdrawn it. */
const hasActiveValidator = (edit: CellEdit | undefined): boolean =>
    (edit?.validatedBy ?? []).some((entry) => entry && entry.isDeleted !== true);

/** A person set this: they typed it, or they signed off on it. */
const isHumanEdit = (edit: CellEdit): boolean =>
    edit.type === EditType.USER_EDIT || hasActiveValidator(edit);

const lastValueEdit = (cell: TranslationCell | undefined): CellEdit | undefined => {
    const valueEdits = cellEdits(cell).filter(isValueEdit);
    return valueEdits[valueEdits.length - 1];
};

/**
 * A cell whose current value was last authored by a person — typed in the editor, or validated —
 * must never be silently replaced by an import. Machine-written values (previous imports, LLM
 * output, cells with no edit history at all) are fair game: re-importing a corrected file is how
 * clients deliver their fixes.
 */
const valueIsHumanAuthored = (cell: TranslationCell | undefined): boolean => {
    const last = lastValueEdit(cell);
    return last ? isHumanEdit(last) : false;
};

/**
 * Whether the cell's current value carries a live sign-off.
 *
 * The editor reads validation off the LAST entry in a cell's history whatever kind of edit it is
 * (CodexCellEditor.tsx takes `editHistory[editHistory.length - 1]`), so appending a timing edit to
 * a validated cell would quietly clear its badge. A retime is an automatic correction and is not
 * worth costing someone their sign-off, so it stands down instead.
 */
const valueIsValidated = (cell: TranslationCell | undefined): boolean =>
    hasActiveValidator(lastValueEdit(cell));

const isTimingEditMap = (editMap: unknown, field: "startTime" | "endTime"): boolean =>
    Array.isArray(editMap) &&
    editMap.length === 3 &&
    editMap[0] === "metadata" &&
    editMap[1] === "data" &&
    editMap[2] === field;

/**
 * Whether a person set this cell's time range by hand. Retiming is only ever an automatic
 * correction, so it must yield to someone who deliberately placed the cell where it is.
 */
const timingIsHumanAuthored = (cell: TranslationCell | undefined): boolean => {
    const edits = cellEdits(cell);
    return (["startTime", "endTime"] as const).some((field) => {
        const timingEdits = edits.filter((edit) => isTimingEditMap(edit?.editMap, field));
        const last = timingEdits[timingEdits.length - 1];
        return last ? isHumanEdit(last) : false;
    });
};

/**
 * Whether an incoming timestamp is a real change from the stored one. An unreadable incoming time
 * is never a reason to rewrite anything; an unreadable stored time means the cell has no usable
 * range yet, so any real incoming time is an improvement.
 */
const timeChanged = (
    incoming: number | string | undefined,
    existing: unknown
): boolean => {
    const incomingSeconds = toSeconds(incoming);
    if (Number.isNaN(incomingSeconds)) return false;
    const existingSeconds = toSeconds(existing as number | string | undefined);
    if (Number.isNaN(existingSeconds)) return true;
    return Math.abs(incomingSeconds - existingSeconds) > TIME_EPSILON;
};

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
        updatedCount: 0,
        retimedCount: 0,
        skippedCount: 0,
        paratextCount: 0,
        mergedCueCount: 0,
    };

    const overwriteRisk: TranslationOverwriteRisk = {
        exactIdMatches: alignedContent.filter((entry) => entry.alignmentMethod === "exact-id")
            .length,
        populatedCellCount: (existingNotebook.cells ?? []).filter(
            (existing) =>
                existing.metadata?.type !== CodexCellTypes.MILESTONE && hasText(existing.value)
        ).length,
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

        // A locked cell is off limits. The editor refuses even its own timestamp updates on one
        // ("Block timestamp updates to locked cells", codexDocument.ts), so an import writing the
        // file directly must not be the way around that.
        const isLocked =
            existingCell?.metadata?.isLocked === true || notebookCell.metadata?.isLocked === true;
        if (isLocked) {
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

        const existingValue = existingCell?.value ?? notebookCell.value ?? "";
        const isOverwrite = hasText(existingValue);
        if (
            isOverwrite &&
            (value === existingValue || !hasText(value) || valueIsHumanAuthored(existingCell))
        ) {
            // Unchanged, nothing real to write, or a person authored the current value: the text
            // stays as it is.
            const keptCell = existingCell ?? notebookCell;
            const keptData = (keptCell.metadata?.data ?? {}) as Record<string, unknown>;

            // The range can still be wrong while the text is right — a client retimes a line in an
            // external editor and changes nothing else, and a cell displaced by the pre-#1144
            // importer holds the correct words under a nested cue's range. Take the correction only
            // from a cue that named this cell by id, so it is provably this project's own export,
            // and never from a range a person placed by hand.
            const retimeFields =
                aligned.alignmentMethod === "exact-id" &&
                hasText(value) &&
                !timingIsHumanAuthored(existingCell) &&
                !valueIsValidated(existingCell)
                    ? (["startTime", "endTime"] as const).filter((field) =>
                        timeChanged(imported[field], keptData[field])
                    )
                    : [];

            if (retimeFields.length === 0) {
                updatesMap.set(targetId, keptCell);
                stats.skippedCount++;
                continue;
            }

            const editTimestamp = Date.parse(timestamp) || 0;
            const retimedData: Record<string, unknown> = { ...keptData };
            const retimedEdits = [...cellEdits(existingCell)];
            for (const field of retimeFields) {
                retimedData[field] = imported[field];
                retimedEdits.push(
                    makeImportEdit(
                        EditMapUtils.metadataNested("data", field),
                        imported[field],
                        editTimestamp
                    )
                );
            }

            updatesMap.set(targetId, {
                ...keptCell,
                metadata: {
                    ...keptCell.metadata,
                    id: targetId,
                    data: retimedData,
                    edits: retimedEdits,
                },
            });
            stats.retimedCount++;
            continue;
        }

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

        // Keep whatever kind of cell this already is. Timed paratext cells are exported as cues
        // like any other, so an import that stamped TEXT on everything would quietly promote them
        // into ordinary cells. Milestones never reach here — they were skipped above.
        const existingType = existingCell?.metadata?.type ?? notebookCell.metadata?.type;
        const metadata: NonNullable<TranslationCell["metadata"]> = {
            ...(existingCell?.metadata ?? notebookCell.metadata),
            type: hasText(existingType) ? existingType : CodexCellTypes.TEXT,
            id: targetId,
            data,
        };

        if (isOverwrite) {
            // Replacing an existing translation: record it in the edit history so the previous
            // value is preserved and the new one wins sync merges instead of being reverted.
            const editTimestamp = Date.parse(timestamp) || 0;
            const edits = [...cellEdits(existingCell)];
            if (!edits.some((edit) => isValueEdit(edit) && valueEditValue(edit) === existingValue)) {
                edits.push(makeImportEdit(EditMapUtils.value(), existingValue, editTimestamp - 1));
            }
            edits.push(makeImportEdit(EditMapUtils.value(), value, editTimestamp));

            const oldData = (existingCell?.metadata?.data ?? {}) as Record<string, unknown>;
            for (const field of ["startTime", "endTime"] as const) {
                if (
                    data[field] !== undefined &&
                    JSON.stringify(oldData[field]) !== JSON.stringify(data[field])
                ) {
                    edits.push(
                        makeImportEdit(
                            EditMapUtils.metadataNested("data", field),
                            data[field],
                            editTimestamp
                        )
                    );
                }
            }
            metadata.edits = edits;
        }

        updatesMap.set(targetId, {
            kind: 1,
            languageId: "html",
            value,
            metadata,
        });

        // Unmatched cells come back from the aligner carrying their own (empty) content, so only
        // count a cell that genuinely gained text.
        if (isOverwrite) {
            stats.updatedCount++;
        } else if (hasText(value)) {
            stats.insertedCount++;
        }
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
        const existingType = existingCell.metadata?.type;
        updatesMap.set(parentId, {
            kind: 1,
            languageId: "html",
            value,
            metadata: {
                ...existingCell.metadata,
                type: hasText(existingType) ? existingType : CodexCellTypes.TEXT,
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

    // `childCellCount` is the marker the pre-#1144 importer left behind, and the one-off repair
    // command uses it to recognize a damaged project. Overwriting the import record would erase
    // that evidence, so a later import must not make a damaged file look clean.
    const previousImportContext = existingNotebook.metadata?.importContext as
        | Record<string, any>
        | undefined;
    const previousChildCellCount = previousImportContext?.lastTranslationImport?.stats
        ?.childCellCount;
    const damageMarker =
        typeof previousChildCellCount === "number" && previousChildCellCount > 0
            ? { childCellCount: previousChildCellCount }
            : {};

    const updatedNotebook: TranslationNotebook = {
        ...existingNotebook,
        cells: newCells,
        metadata: {
            ...existingNotebook.metadata,
            importerType: options.importerType || (existingNotebook.metadata?.importerType as string),
            importTimestamp: timestamp,
            importContext: {
                ...(previousImportContext ?? {}),
                lastTranslationImport: {
                    importerType: options.importerType,
                    timestamp,
                    sourceFilePath: options.sourceFilePath,
                    stats: { ...stats, ...damageMarker },
                },
            },
        },
    };

    return { updatedNotebook, stats, overwriteRisk };
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
    if (stats.retimedCount > 0) {
        parts.splice(1, 0, `${stats.retimedCount} retimed`);
    }
    if (stats.updatedCount > 0) {
        parts.splice(1, 0, `${stats.updatedCount} updated`);
    }
    return `Translation imported: ${parts.join(", ")}.`;
}
