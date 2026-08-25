/**
 * Repairing cue timings in a subtitle file that was exported from a project damaged by the
 * pre-#1144 target importer.
 *
 * That importer let the last cue overlapping a cell replace the cell's text AND timestamps, so
 * a cell enclosing a shorter nested cell ended up stamped with the nested cell's exact range.
 * An export of such a project then contains two cues with identical timestamps — the genuine
 * nested cue, and the enclosing cell's cue displaced onto the nested range — and no cue at all
 * covering the enclosing cell's true span. Re-importing that file sends both cues to the nested
 * cell and leaves the enclosing cell empty.
 *
 * Identical (start, end) pairs on two different cues never occur in legitimate subtitle data,
 * so they are a precise fingerprint. This module detects each such group, checks it against the
 * authoritative cell ranges (from the .source notebook, which the old bug never touched), and
 * re-times the displaced cue back to the enclosing cell's true range. Everything downstream —
 * alignment, and the write path stamping the primary cue's timing onto the cell — then heals
 * the import without any further special-casing.
 *
 * This module is pure so the repair is unit-testable.
 */

/** An authoritative cell range to repair against (typically from the .source notebook). */
export interface RepairRangeCell {
    id: string;
    start: number;
    end: number;
}

/** A parsed cue: times in seconds, in file order. */
export interface RepairCue {
    start: number;
    end: number;
}

export interface CueRetiming {
    /** Index of the cue in the input array. */
    cueIndex: number;
    startTime: number;
    endTime: number;
    /** The cell whose range the cue was restored to. */
    cellId: string;
    originalStartTime: number;
    originalEndTime: number;
}

/** Timestamps carry millisecond precision; anything closer than this is the same instant. */
const TIME_EPSILON = 1e-3 / 2;

/**
 * A displaced cue must be materially shorter than the cell it is restored to — the same 90%
 * threshold the repairSubtitleOverlapOverwrite command uses to recognize damaged cells.
 */
const MATERIALLY_SHORTER_RATIO = 0.9;

const sameTime = (a: number, b: number): boolean => Math.abs(a - b) <= TIME_EPSILON;

const sameRange = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean =>
    sameTime(aStart, bStart) && sameTime(aEnd, bEnd);

const strictlyContains = (outerStart: number, outerEnd: number, innerStart: number, innerEnd: number): boolean =>
    outerStart <= innerStart + TIME_EPSILON &&
    outerEnd >= innerEnd - TIME_EPSILON &&
    (innerEnd - innerStart) / (outerEnd - outerStart) < MATERIALLY_SHORTER_RATIO;

/**
 * Detect displaced cues and compute their restored timings. Only acts when the evidence is
 * unambiguous; anything it cannot confidently resolve is left untouched.
 */
export const repairDisplacedCueTimings = (
    cues: RepairCue[],
    rangeCells: RepairRangeCell[]
): CueRetiming[] => {
    const retimings: CueRetiming[] = [];
    if (cues.length === 0 || rangeCells.length === 0) return retimings;

    const validRanges = rangeCells.filter(
        (cell) =>
            Number.isFinite(cell.start) && Number.isFinite(cell.end) && cell.end > cell.start
    );
    if (validRanges.length === 0) return retimings;

    // Group cue indices by their exact (start, end) pair.
    const groups = new Map<string, number[]>();
    cues.forEach((cue, index) => {
        if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) return;
        const key = `${cue.start.toFixed(3)}-->${cue.end.toFixed(3)}`;
        const group = groups.get(key) ?? [];
        group.push(index);
        groups.set(key, group);
    });

    for (const group of groups.values()) {
        if (group.length < 2) continue; // Duplicate timing is the corruption fingerprint.

        const { start, end } = cues[group[0]];

        // Cells whose range matches the duplicated timing exactly — the genuine home of one cue.
        const exactCells = validRanges.filter((cell) => sameRange(cell.start, cell.end, start, end));
        if (exactCells.length === 0) continue;

        // Enclosing cells that this timing could have been displaced from: strictly containing,
        // materially longer, and starving — no cue in the file covers their own range.
        const parentCells = validRanges.filter(
            (cell) =>
                !sameRange(cell.start, cell.end, start, end) &&
                strictlyContains(cell.start, cell.end, start, end) &&
                !cues.some((cue) => sameRange(cue.start, cue.end, cell.start, cell.end))
        );
        if (parentCells.length === 0) continue;

        // Cues in file order must line up one-to-one with the candidate cells in document order
        // (enclosing cells first, since they start earlier / span wider). Any mismatch means the
        // situation is ambiguous, and guessing risks moving a legitimate cue.
        const slots = [...parentCells, ...exactCells].sort(
            (a, b) => a.start - b.start || b.end - a.end
        );
        if (slots.length !== group.length) continue;

        group.forEach((cueIndex, position) => {
            const slot = slots[position];
            if (sameRange(slot.start, slot.end, start, end)) return; // Genuine cue keeps its timing.
            retimings.push({
                cueIndex,
                startTime: slot.start,
                endTime: slot.end,
                cellId: slot.id,
                originalStartTime: cues[cueIndex].start,
                originalEndTime: cues[cueIndex].end,
            });
        });
    }

    return retimings;
};
