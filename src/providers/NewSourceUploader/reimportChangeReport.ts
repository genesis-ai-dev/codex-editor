/**
 * Builds the per-cell change rows shown to the user before an update import
 * is committed, so "Create new updated file" can say exactly what it will do
 * rather than just reporting counts after the fact.
 *
 * Pure (no vscode imports) so the report can be produced by a dry-run merge
 * and unit-tested alongside it.
 */

import type { ReimportCellChange } from "../../../types";
import type { ReimportCell } from "./reimportMerge";

const PREVIEW_MAX_LENGTH = 120;

const truncate = (text: string): string =>
    text.length <= PREVIEW_MAX_LENGTH ? text : `${text.slice(0, PREVIEW_MAX_LENGTH - 1)}…`;

/**
 * Section label used to group the report. Biblica writes the chapter-range
 * label onto every cell at import time, which is the same value the milestone
 * navigation shows, so the report lines up with what the user will see in the
 * editor.
 */
const readMilestone = (cell: ReimportCell): string | undefined => {
    const metadata = cell.metadata;
    if (!metadata) return undefined;
    const chapterNumber = metadata.chapterNumber;
    if (typeof chapterNumber === "string" && chapterNumber.trim() !== "") return chapterNumber;
    if (typeof chapterNumber === "number") return String(chapterNumber);
    const chapter = (metadata.data as Record<string, unknown> | undefined)?.chapter;
    if (typeof chapter === "string" && chapter.trim() !== "") return chapter;
    if (typeof chapter === "number") return String(chapter);
    return undefined;
};

export const describeReimportCell = (
    kind: ReimportCellChange["kind"],
    sourceCell: ReimportCell,
    targetValue: string | undefined,
    needsResolution: boolean,
    plainText: (cell: ReimportCell) => string,
): ReimportCellChange => ({
    kind,
    cellId: (sourceCell.metadata?.id as string | undefined) ?? "",
    milestone: readMilestone(sourceCell),
    preview: truncate(plainText(sourceCell)),
    needsResolution,
    hasTranslation: Boolean(targetValue && targetValue.trim() !== ""),
});
