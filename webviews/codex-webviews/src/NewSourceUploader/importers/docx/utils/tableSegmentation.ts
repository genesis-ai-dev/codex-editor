/**
 * DOCX table segmentation helpers
 *
 * Goal: identify paragraphs that belong to table cells (<w:tc>) while preserving
 * the *exact* paragraph index ordering used by the importer and exporter
 * (see ooxmlScanner.ts: Fallback-stripped body, outermost <w:p> elements only).
 *
 * We avoid full XML object parsing here because key iteration order can diverge from
 * the original XML order in complex documents, which would break paragraphIndex mapping.
 */

import { sliceBodyXml, stripFallbackElements } from "./ooxmlScanner";

export type TableCellParagraphGroup = {
    /** Sequential table-cell index in document order (0-based). */
    tableCellIndex: number;
    /** Paragraph indices (global within <w:body>) that are inside this <w:tc>. */
    paragraphIndices: number[];
};

/**
 * Returns groups of paragraphIndices for each table cell (<w:tc>) in document order.
 *
 * Paragraph indices are computed by scanning outermost <w:p> start tags over the
 * Fallback-stripped <w:body>, which matches the importer's and exporter's
 * paragraph indexing (ooxmlScanner).
 */
export function extractTableCellParagraphGroups(documentXml: string): TableCellParagraphGroup[] {
    const rawBodyXml = sliceBodyXml(documentXml);
    if (!rawBodyXml) return [];
    const bodyXml = stripFallbackElements(rawBodyXml);

    const groups: TableCellParagraphGroup[] = [];
    const tcStack: number[] = [];
    let nextTcId = 0;
    let paragraphIndex = 0;
    let paragraphDepth = 0;

    // Scan only the tags we care about, in-order.
    const tagRe = /<\/?w:(tbl|tr|tc|p)\b[^>]*\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(bodyXml)) !== null) {
        const tag = m[0];
        const name = m[1];
        const isClosing = tag.startsWith("</");
        const isSelfClosing = tag.endsWith("/>");

        if (name === "tc") {
            if (!isClosing) {
                const tcId = nextTcId++;
                tcStack.push(tcId);
                groups[tcId] = groups[tcId] ?? { tableCellIndex: tcId, paragraphIndices: [] };
            } else {
                tcStack.pop();
            }
            continue;
        }

        if (name === "p") {
            if (isClosing) {
                if (paragraphDepth > 0) paragraphDepth--;
                continue;
            }

            // Only count OUTERMOST paragraphs (nested text-box paragraphs
            // belong to their anchor paragraph), matching ooxmlScanner.
            if (paragraphDepth === 0) {
                if (tcStack.length > 0) {
                    const currentTcId = tcStack[tcStack.length - 1];
                    groups[currentTcId] = groups[currentTcId] ?? {
                        tableCellIndex: currentTcId,
                        paragraphIndices: [],
                    };
                    groups[currentTcId].paragraphIndices.push(paragraphIndex);
                }
                paragraphIndex++;
            }

            // For self-closing <w:p .../> there is no </w:p>; depth unchanged.
            if (!isSelfClosing) paragraphDepth++;
        }
    }

    // Filter out any sparse holes and empty groups.
    return groups.filter((g): g is TableCellParagraphGroup => Boolean(g && g.paragraphIndices.length > 0));
}
