/**
 * Subtitle sub-cue overwrite repair (issue #1144).
 *
 * Before the fix, importing a subtitle file as a target let the LAST cue overlapping a cell replace
 * that cell's real match — text and timestamps both. The cell ended up holding a brief sub-cue's
 * words stamped with the sub-cue's short time range, and the correct translation was gone.
 *
 * Re-importing a corrected file cannot fix those cells: the write path skips any cell that already
 * has text. This module stages them for a corrected re-import instead:
 *
 *   - the cell's timestamps are restored from its counterpart in the .source file,
 *   - the suspect text is moved to `data.repairedFromValue` (never discarded) and `value` cleared,
 *   - MIGRATION edits are appended so the change survives the CRDT sync merge on every machine.
 *
 * The correct text itself is NOT recoverable here — the imported VTT is not retained anywhere — so
 * the caller must tell the user to re-import the corrected target file afterwards. A false positive
 * is therefore self-healing: the cell is cleared and refilled by that same re-import.
 *
 * This module is pure (no vscode imports) so the repair is unit-testable.
 */

import { EditType } from "../../../../../types/enums";
import { CodexCellTypes } from "../../../../../types/enums";
import { EditMapUtils } from "../../../../utils/editMapUtils";

const REPAIR_AUTHOR = "system";

/** Timestamps carry millisecond precision; this only absorbs floating-point noise. */
const TIME_EPSILON = 1e-6;

/**
 * How much shorter than its source range a cell's range must be before we treat it as damaged.
 * A sub-cue is a fragment of its line, so real damage sits far below this; a merely retimed cell
 * stays close to (or longer than) its source duration.
 */
const DURATION_SHORTFALL = 0.9;

interface RepairCellMetadata {
    id?: string;
    type?: string;
    parentId?: string;
    edits?: any[];
    data?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface RepairCell {
    kind?: number;
    languageId?: string;
    value: string;
    metadata?: RepairCellMetadata;
}

export interface RepairNotebook {
    cells: RepairCell[];
    metadata?: Record<string, unknown>;
}

export interface SubtitleOverlapRepairCandidate {
    cellId: string;
    /** The text currently in the cell — a sub-cue's words, not the line's translation. */
    strandedValue: string;
    currentStartTime: number;
    currentEndTime: number;
    sourceStartTime: number;
    sourceEndTime: number;
}

export interface SubtitleOverlapRepairPlan {
    /** True when this notebook was written by the importer that had the bug. */
    isAffectedFile: boolean;
    candidates: SubtitleOverlapRepairCandidate[];
}

const asNumber = (value: unknown): number => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return Number.NaN;
};

const hasText = (value: unknown): boolean =>
    typeof value === "string" && value.replace(/<[^>]*>/g, "").trim() !== "";

/**
 * True when this notebook's last translation import was written by the buggy code.
 *
 * `childCellCount` was only ever written by that version, and it never actually wrote a child cell.
 * The fixed importer records `mergedCueCount` instead. As a guard, a file that really does contain
 * child text cells is left alone — the fingerprint would not apply to it.
 */
export function isAffectedByOverlapOverwrite(notebook: RepairNotebook): boolean {
    const importContext = notebook.metadata?.importContext as Record<string, any> | undefined;
    const stats = importContext?.lastTranslationImport?.stats;
    const childCellCount = asNumber(stats?.childCellCount);
    if (!(childCellCount > 0)) return false;

    const hasRealChildCells = (notebook.cells ?? []).some(
        (cell) =>
            cell.metadata?.type === CodexCellTypes.TEXT &&
            typeof cell.metadata?.parentId === "string" &&
            cell.metadata.parentId.trim() !== ""
    );
    return !hasRealChildCells;
}

/**
 * Identify cells whose stored range is a strict, materially shorter sub-range of their source
 * cell's range — the fingerprint of a cell that was handed a sub-cue's timings.
 */
export function planSubtitleOverlapRepair(
    codex: RepairNotebook,
    source: RepairNotebook
): SubtitleOverlapRepairPlan {
    if (!isAffectedByOverlapOverwrite(codex)) {
        return { isAffectedFile: false, candidates: [] };
    }

    const sourceById = new Map<string, RepairCell>();
    for (const cell of source.cells ?? []) {
        const id = cell.metadata?.id;
        if (typeof id === "string") sourceById.set(id, cell);
    }

    const candidates: SubtitleOverlapRepairCandidate[] = [];

    for (const cell of codex.cells ?? []) {
        const cellId = cell.metadata?.id;
        if (typeof cellId !== "string") continue;
        if (cell.metadata?.type !== CodexCellTypes.TEXT) continue;
        if (cell.metadata?.data?.deleted === true) continue;
        if (!hasText(cell.value)) continue;

        const sourceCell = sourceById.get(cellId);
        if (!sourceCell) continue;

        const currentStartTime = asNumber(cell.metadata?.data?.startTime);
        const currentEndTime = asNumber(cell.metadata?.data?.endTime);
        const sourceStartTime = asNumber(sourceCell.metadata?.data?.startTime);
        const sourceEndTime = asNumber(sourceCell.metadata?.data?.endTime);
        if (
            [currentStartTime, currentEndTime, sourceStartTime, sourceEndTime].some((n) =>
                Number.isNaN(n)
            )
        ) {
            continue;
        }

        const currentDuration = currentEndTime - currentStartTime;
        const sourceDuration = sourceEndTime - sourceStartTime;
        if (currentDuration <= 0 || sourceDuration <= 0) continue;

        // Contained in the source range...
        const isContained =
            currentStartTime >= sourceStartTime - TIME_EPSILON &&
            currentEndTime <= sourceEndTime + TIME_EPSILON;
        // ...and genuinely narrower than it, on at least one edge.
        const isStrictlyInside =
            currentStartTime > sourceStartTime + TIME_EPSILON ||
            currentEndTime < sourceEndTime - TIME_EPSILON;
        const isMateriallyShorter = currentDuration < sourceDuration * DURATION_SHORTFALL;

        if (isContained && isStrictlyInside && isMateriallyShorter) {
            candidates.push({
                cellId,
                strandedValue: cell.value,
                currentStartTime,
                currentEndTime,
                sourceStartTime,
                sourceEndTime,
            });
        }
    }

    return { isAffectedFile: true, candidates };
}

export interface SubtitleOverlapRepairResult {
    changed: boolean;
    repairedCount: number;
}

/**
 * Apply a plan in place: restore each candidate's timestamps from the source, park its text in
 * `data.repairedFromValue`, and clear `value` so a corrected re-import can fill it.
 *
 * Idempotent — a cell that has already been repaired no longer has text, so a second run finds
 * nothing to do.
 */
export function applySubtitleOverlapRepair(
    codex: RepairNotebook,
    plan: SubtitleOverlapRepairPlan,
    timestamp: number
): SubtitleOverlapRepairResult {
    if (!plan.isAffectedFile || plan.candidates.length === 0) {
        return { changed: false, repairedCount: 0 };
    }

    const byId = new Map(plan.candidates.map((c) => [c.cellId, c]));
    let repairedCount = 0;

    for (const cell of codex.cells ?? []) {
        const cellId = cell.metadata?.id;
        if (typeof cellId !== "string") continue;
        const candidate = byId.get(cellId);
        if (!candidate) continue;

        const metadata = (cell.metadata ??= {});
        const data = (metadata.data ??= {});
        const edits = (metadata.edits ??= []);

        data.startTime = candidate.sourceStartTime;
        data.endTime = candidate.sourceEndTime;
        // Keep the stranded sub-cue text rather than destroying it.
        data.repairedFromValue = candidate.strandedValue;
        cell.value = "";

        // Every change is expressed as a CRDT operation so it wins the sync merge everywhere,
        // rather than being reverted by a remote copy's newer edit.
        const makeEdit = (editMap: readonly string[], value: unknown) => ({
            editMap,
            value,
            timestamp,
            type: EditType.MIGRATION,
            author: REPAIR_AUTHOR,
            validatedBy: [],
        });
        edits.push(makeEdit(EditMapUtils.dataStartTime(), candidate.sourceStartTime));
        edits.push(makeEdit(EditMapUtils.dataEndTime(), candidate.sourceEndTime));
        edits.push(makeEdit(EditMapUtils.value(), ""));

        repairedCount++;
    }

    if (repairedCount > 0) {
        // Retire the fingerprint so a repaired file is not re-scanned, and leave a record.
        const importContext = (codex.metadata as Record<string, any>)?.importContext;
        const lastImport = importContext?.lastTranslationImport;
        if (lastImport?.stats) {
            delete lastImport.stats.childCellCount;
            lastImport.stats.repairedOverlapOverwrites = repairedCount;
        }
    }

    return { changed: repairedCount > 0, repairedCount };
}
