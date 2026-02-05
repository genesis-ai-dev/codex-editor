/**
 * DOCX table segmentation helpers
 *
 * Goal: identify paragraphs that belong to table cells (<w:tc>) while preserving
 * the *exact* paragraph index ordering used by the exporter (regex over <w:p> in <w:body>).
 *
 * We avoid full XML object parsing here because key iteration order can diverge from
 * the original XML order in complex documents, which would break paragraphIndex mapping.
 */

export type TableCellParagraphGroup = {
    /** Sequential table-cell index in document order (0-based). */
    tableCellIndex: number;
    /** Paragraph indices (global within <w:body>) that are inside this <w:tc>. */
    paragraphIndices: number[];
};

function sliceBodyXml(documentXml: string): string | null {
    const bodyOpenIdx = documentXml.indexOf("<w:body");
    if (bodyOpenIdx < 0) return null;
    const bodyStart = documentXml.indexOf(">", bodyOpenIdx);
    const bodyCloseIdx = documentXml.indexOf("</w:body>");
    if (bodyStart < 0 || bodyCloseIdx < 0) return null;
    return documentXml.slice(bodyStart + 1, bodyCloseIdx);
}

/**
 * Returns groups of paragraphIndices for each table cell (<w:tc>) in document order.
 *
 * Paragraph indices are computed by scanning for <w:p ...> start tags in <w:body> order,
 * which matches the exporter’s paragraph indexing.
 */
export function extractTableCellParagraphGroups(documentXml: string): TableCellParagraphGroup[] {
    const bodyXml = sliceBodyXml(documentXml);
    if (!bodyXml) return [];

    const groups: TableCellParagraphGroup[] = [];
    const tcStack: number[] = [];
    let nextTcId = 0;
    let paragraphIndex = 0;

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

        if (name === "p" && !isClosing) {
            // Count every paragraph start tag (including ones that end up being empty),
            // since exporter indexes all <w:p> nodes in the body.
            if (tcStack.length > 0) {
                const currentTcId = tcStack[tcStack.length - 1];
                groups[currentTcId] = groups[currentTcId] ?? {
                    tableCellIndex: currentTcId,
                    paragraphIndices: [],
                };
                groups[currentTcId].paragraphIndices.push(paragraphIndex);
            }
            paragraphIndex++;

            // For self-closing <w:p .../> there is no </w:p>; nothing else to do.
            if (isSelfClosing) continue;
        }
    }

    // Filter out any sparse holes and empty groups.
    return groups.filter((g): g is TableCellParagraphGroup => Boolean(g && g.paragraphIndices.length > 0));
}

