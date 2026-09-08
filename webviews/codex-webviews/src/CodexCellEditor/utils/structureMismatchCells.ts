import type { QuillCellContent } from "../../../../../types";
import { getHtmlStructureRepairDiff, type HtmlStructureOptions } from "./htmlStructureValidator";

export function getStructureMismatchCellIds(
    cells: QuillCellContent[],
    sourceCellMap: Record<string, { content: string }>,
    enforceHtmlStructure: boolean,
    isSourceText: boolean,
    options?: HtmlStructureOptions,
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

        const diff = getHtmlStructureRepairDiff(sourceHtml, targetHtml, options);
        if (!diff.isMatch) {
            mismatchedCellIds.push(cellId);
        }
    }

    return mismatchedCellIds;
}
