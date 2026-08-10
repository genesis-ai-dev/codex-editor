import type { QuillCellContent } from "../../../../../types";
import { compareHtmlStructure } from "./htmlStructureValidator";

export function getStructureMismatchCellIds(
    cells: QuillCellContent[],
    sourceCellMap: Record<string, { content: string }>,
    enforceHtmlStructure: boolean,
    isSourceText: boolean,
): string[] {
    if (!enforceHtmlStructure || isSourceText) {
        return [];
    }

    const mismatchedCellIds: string[] = [];

    for (const cell of cells) {
        const cellId = cell.cellMarkers[0];
        if (!cellId) continue;

        const sourceHtml = sourceCellMap[cellId]?.content;
        const targetHtml = cell.cellContent;
        if (!sourceHtml || !targetHtml) continue;

        const diff = compareHtmlStructure(sourceHtml, targetHtml);
        if (!diff.isMatch) {
            mismatchedCellIds.push(cellId);
        }
    }

    return mismatchedCellIds;
}
