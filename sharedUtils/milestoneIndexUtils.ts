import type { MilestoneInfo } from "../types";
import { CodexCellTypes } from "../types/enums";

type NotebookCell = {
    value?: string;
    metadata?: {
        type?: string;
        data?: { deleted?: boolean };
    };
};

/**
 * Read-only milestone extraction from notebook cells (mirrors codexDocument.buildMilestoneIndex).
 */
export function extractMilestonesFromCells(cells: NotebookCell[]): MilestoneInfo[] {
    const milestones: MilestoneInfo[] = [];
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
            }
            continue;
        }

        if (cellType !== CodexCellTypes.MILESTONE && cellType !== "paratext") {
            const isDeleted = cell.metadata?.data?.deleted === true;
            if (!isDeleted) {
                totalContentCells++;
                if (currentMilestoneIndex >= 0) {
                    currentMilestoneCellCount++;
                }
            }
        }
    }

    if (currentMilestoneIndex >= 0) {
        milestones[currentMilestoneIndex].cellCount = currentMilestoneCellCount;
    }

    if (milestones.length === 0) {
        return [{
            index: 0,
            cellIndex: 0,
            value: "1",
            cellCount: totalContentCells,
        }];
    }

    return milestones;
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
