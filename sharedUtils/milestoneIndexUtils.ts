import type { MilestoneInfo } from "../types";
import { CodexCellTypes } from "../types/enums";

type NotebookCell = {
    value?: string;
    metadata?: {
        id?: string;
        type?: string;
        chapter?: number | string;
        chapterNumber?: number | string;
        data?: {
            deleted?: boolean;
            chapter?: number | string;
            globalReferences?: string[];
        };
    };
};

export type MilestoneIndexModel = {
    milestones: MilestoneInfo[];
    /** 0-based milestone index for each notebook cell index */
    cellMilestoneIndices: number[];
};

/** True when the notebook has at least one non-deleted milestone cell. */
export function hasExplicitMilestonesInCells(cells: NotebookCell[]): boolean {
    return cells.some(
        (cell) =>
            cell.metadata?.type === CodexCellTypes.MILESTONE &&
            cell.metadata?.data?.deleted !== true
    );
}

function isCountableContentCell(cell: NotebookCell): boolean {
    const cellType = cell.metadata?.type;
    if (cellType === CodexCellTypes.MILESTONE || cellType === "paratext") {
        return false;
    }
    return cell.metadata?.data?.deleted !== true;
}

function extractChapterFromCellId(cellId: string): string | null {
    if (!cellId) {
        return null;
    }
    const match = cellId.match(/\s+(\d+):(\d+)(?::|$)/);
    return match ? match[1] : null;
}

/**
 * Unique chapter key for detection (e.g. "MAT-1"), aligned with milestone migration / import helpers.
 */
export function extractChapterKeyForDetection(cell: NotebookCell): string | null {
    const meta = cell.metadata;
    if (meta?.chapterNumber !== undefined && meta.chapterNumber !== null) {
        return String(meta.chapterNumber);
    }
    if (meta?.chapter !== undefined && meta.chapter !== null) {
        return String(meta.chapter);
    }
    if (meta?.data?.chapter !== undefined && meta.data.chapter !== null) {
        return String(meta.data.chapter);
    }

    const globalRefs = meta?.data?.globalReferences;
    if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
        const firstRef = globalRefs[0];
        const chapter = extractChapterFromCellId(firstRef);
        if (chapter) {
            const bookMatch = firstRef.match(/^([^\s]+)/);
            return bookMatch ? `${bookMatch[1]}-${chapter}` : chapter;
        }
    }

    const cellId = meta?.id;
    if (cellId) {
        const chapter = extractChapterFromCellId(cellId);
        if (chapter) {
            const bookMatch = cellId.match(/^([^\s]+)/);
            return bookMatch ? `${bookMatch[1]}-${chapter}` : chapter;
        }
    }

    return null;
}

function milestoneLabelFromChapterKey(chapterKey: string, milestoneIndex: number): string {
    const dash = chapterKey.lastIndexOf("-");
    if (dash > 0) {
        return chapterKey.slice(dash + 1);
    }
    return chapterKey || String(milestoneIndex + 1);
}

function buildFromExplicitMilestoneCells(cells: NotebookCell[]): MilestoneIndexModel | null {
    if (!hasExplicitMilestonesInCells(cells)) {
        return null;
    }

    const milestones: MilestoneInfo[] = [];
    const cellMilestoneIndices = new Array<number>(cells.length).fill(0);
    let totalContentCells = 0;
    let currentMilestoneIndex = -1;
    let currentMilestoneCellCount = 0;

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const cellType = cell.metadata?.type;

        if (cellType === CodexCellTypes.MILESTONE) {
            if (cell.metadata?.data?.deleted !== true) {
                if (currentMilestoneIndex >= 0) {
                    milestones[currentMilestoneIndex].cellCount = currentMilestoneCellCount;
                }
                currentMilestoneIndex++;
                currentMilestoneCellCount = 0;
                milestones.push({
                    index: currentMilestoneIndex,
                    cellIndex: i,
                    value: cell.value || String(currentMilestoneIndex + 1),
                    cellCount: 0,
                });
                cellMilestoneIndices[i] = currentMilestoneIndex;
            }
            continue;
        }

        if (isCountableContentCell(cell)) {
            totalContentCells++;
            const idx = currentMilestoneIndex >= 0 ? currentMilestoneIndex : 0;
            cellMilestoneIndices[i] = idx;
            if (currentMilestoneIndex >= 0) {
                currentMilestoneCellCount++;
            }
        }
    }

    if (currentMilestoneIndex >= 0) {
        milestones[currentMilestoneIndex].cellCount = currentMilestoneCellCount;
    }

    if (milestones.length === 0) {
        return null;
    }

    return { milestones, cellMilestoneIndices };
}

function buildFromChapterBoundaries(cells: NotebookCell[]): MilestoneIndexModel | null {
    const milestones: MilestoneInfo[] = [];
    const cellMilestoneIndices = new Array<number>(cells.length).fill(0);
    const seenChapters = new Set<string>();
    let currentMilestoneIndex = -1;
    let currentMilestoneCellCount = 0;

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];

        if (!isCountableContentCell(cell)) {
            cellMilestoneIndices[i] = currentMilestoneIndex >= 0 ? currentMilestoneIndex : 0;
            continue;
        }

        const chapterKey = extractChapterKeyForDetection(cell);
        if (chapterKey && !seenChapters.has(chapterKey)) {
            if (currentMilestoneIndex >= 0) {
                milestones[currentMilestoneIndex].cellCount = currentMilestoneCellCount;
            }
            currentMilestoneIndex++;
            currentMilestoneCellCount = 0;
            seenChapters.add(chapterKey);
            milestones.push({
                index: currentMilestoneIndex,
                cellIndex: i,
                value: milestoneLabelFromChapterKey(chapterKey, currentMilestoneIndex),
                cellCount: 0,
            });
        }

        const idx = currentMilestoneIndex >= 0 ? currentMilestoneIndex : 0;
        cellMilestoneIndices[i] = idx;
        if (currentMilestoneIndex >= 0) {
            currentMilestoneCellCount++;
        }
    }

    if (currentMilestoneIndex >= 0) {
        milestones[currentMilestoneIndex].cellCount = currentMilestoneCellCount;
    }

    if (milestones.length <= 1) {
        return null;
    }

    return { milestones, cellMilestoneIndices };
}

function buildSyntheticMilestoneModel(cells: NotebookCell[]): MilestoneIndexModel {
    let totalContentCells = 0;
    const cellMilestoneIndices = new Array<number>(cells.length).fill(0);

    for (let i = 0; i < cells.length; i++) {
        if (isCountableContentCell(cells[i])) {
            totalContentCells++;
        }
    }

    return {
        milestones: [{
            index: 0,
            cellIndex: 0,
            value: "1",
            cellCount: totalContentCells,
        }],
        cellMilestoneIndices,
    };
}

/**
 * Builds milestone list and per-cell indices using explicit milestone cells, then chapter
 * boundaries in cell IDs (legacy NT/OT projects), then a single synthetic fallback.
 */
export function buildMilestoneIndexModel(cells: NotebookCell[]): MilestoneIndexModel {
    const explicit = buildFromExplicitMilestoneCells(cells);
    if (explicit && explicit.milestones.length > 1) {
        return explicit;
    }

    const inferred = buildFromChapterBoundaries(cells);
    if (inferred) {
        return inferred;
    }

    if (explicit) {
        return explicit;
    }

    return buildSyntheticMilestoneModel(cells);
}

/**
 * True when the export UI should offer per-chapter milestone selection: explicit
 * milestone cells (including a single chapter) or multiple inferred chapter
 * boundaries. False for the synthetic single-chapter fallback only.
 */
export function hasSelectableMilestonesInCells(cells: NotebookCell[]): boolean {
    if (hasExplicitMilestonesInCells(cells)) {
        return true;
    }
    const inferred = buildFromChapterBoundaries(cells);
    return inferred !== null && inferred.milestones.length > 0;
}

/**
 * Read-only milestone extraction from notebook cells (mirrors codexDocument.buildMilestoneIndex).
 */
export function extractMilestonesFromCells(cells: NotebookCell[]): MilestoneInfo[] {
    return buildMilestoneIndexModel(cells).milestones;
}

/**
 * Returns the milestone index for a cell at the given position while iterating cells in order.
 * Pass the current milestone index from the previous cell; returns updated index when a milestone cell is seen.
 */
export function advanceMilestoneIndexForCell(
    cell: NotebookCell,
    currentMilestoneIndex: number
): number {
    if (
        cell.metadata?.type === CodexCellTypes.MILESTONE &&
        cell.metadata?.data?.deleted !== true
    ) {
        return currentMilestoneIndex + 1;
    }
    return currentMilestoneIndex;
}

/**
 * Effective milestone index for a content cell given the current milestone tracker (-1 if none yet).
 */
export function effectiveMilestoneIndex(currentMilestoneIndex: number): number {
    return currentMilestoneIndex >= 0 ? currentMilestoneIndex : 0;
}
