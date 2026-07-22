/**
 * Shared OOXML body scanning utilities.
 *
 * The importer (docxParser), exporter (docxExporter), and table segmentation
 * all need the SAME paragraph enumeration so that `paragraphIndex` written at
 * import time maps back to the correct `<w:p>` at export time. Keep every
 * paragraph scan in this module so the three can never drift apart.
 *
 * Two structural OOXML facts drive the implementation:
 *
 * 1. `mc:AlternateContent` stores the same content twice — a modern
 *    `mc:Choice` branch and a legacy `mc:Fallback` branch (e.g. a text box is
 *    serialized as both DrawingML and VML). A conformant reader must process
 *    exactly ONE branch. We strip every `mc:Fallback` so content is only ever
 *    read (and written) once, regardless of what kind of element the
 *    AlternateContent holds (text boxes, charts, SmartArt, …).
 *
 * 2. `<w:p>` elements can nest indirectly (a paragraph anchors a text box
 *    whose `<w:txbxContent>` contains its own paragraphs). A flat regex scan
 *    mis-pairs open/close tags and surfaces nested paragraphs as top-level
 *    ones. We therefore enumerate only OUTERMOST `<w:p>` elements with a
 *    depth-aware scan; nested text-box paragraphs stay part of their anchor
 *    paragraph.
 */

export const sliceBodyXml = (documentXml: string): string | null => {
    const bodyOpenIdx = documentXml.indexOf("<w:body");
    if (bodyOpenIdx < 0) return null;
    const bodyStart = documentXml.indexOf(">", bodyOpenIdx);
    const bodyCloseIdx = documentXml.indexOf("</w:body>");
    if (bodyStart < 0 || bodyCloseIdx < 0) return null;
    return documentXml.slice(bodyStart + 1, bodyCloseIdx);
};

/**
 * Remove every `<mc:Fallback>…</mc:Fallback>` element (depth-aware, so nested
 * AlternateContent inside a fallback is handled). The `mc:Choice` branch that
 * remains is the authoritative representation of the same content; keeping
 * both would duplicate every text box's text.
 */
export const stripFallbackElements = (xml: string): string => {
    if (xml.indexOf("<mc:Fallback") < 0) return xml;

    const tagRe = /<\/?mc:Fallback\b[^>]*\/?>/g;
    let result = "";
    let last = 0;
    let depth = 0;
    let m: RegExpExecArray | null;

    while ((m = tagRe.exec(xml)) !== null) {
        const tag = m[0];
        if (tag.startsWith("</")) {
            if (depth > 0 && --depth === 0) {
                last = m.index + tag.length;
            }
        } else if (tag.endsWith("/>")) {
            if (depth === 0) {
                result += xml.slice(last, m.index);
                last = m.index + tag.length;
            }
        } else {
            if (depth === 0) {
                result += xml.slice(last, m.index);
                last = xml.length; // matching close tag will move this back
            }
            depth++;
        }
    }

    result += xml.slice(last);
    return result;
};

export type ParagraphRange = {
    /** Start offset of the `<w:p` open tag within the scanned XML. */
    start: number;
    /** End offset (exclusive) of the matching `</w:p>` (or self-closing tag). */
    end: number;
};

/**
 * Enumerate the OUTERMOST `<w:p>` elements of an XML fragment in document
 * order, returning their full [start, end) ranges. Paragraphs nested inside
 * another paragraph (text-box content) are contained within their anchor
 * paragraph's range and are not enumerated separately. Table-cell paragraphs
 * are not nested inside another `<w:p>`, so they ARE enumerated — matching
 * the historical flat-scan behavior for tables.
 */
export const extractOutermostParagraphRanges = (xml: string): ParagraphRange[] => {
    const ranges: ParagraphRange[] = [];
    const tagRe = /<\/?w:p\b[^>]*\/?>/g;
    let depth = 0;
    let currentStart = 0;
    let m: RegExpExecArray | null;

    while ((m = tagRe.exec(xml)) !== null) {
        const tag = m[0];
        if (tag.startsWith("</")) {
            if (depth > 0 && --depth === 0) {
                ranges.push({ start: currentStart, end: m.index + tag.length });
            }
        } else if (tag.endsWith("/>")) {
            if (depth === 0) {
                ranges.push({ start: m.index, end: m.index + tag.length });
            }
        } else {
            if (depth === 0) {
                currentStart = m.index;
            }
            depth++;
        }
    }

    return ranges;
};

/**
 * Convenience wrapper: strip `mc:Fallback` from the `<w:body>` of a full
 * document XML and return the outermost paragraph XML fragments in order.
 * This is the canonical paragraph enumeration for import, export, and table
 * segmentation.
 */
export const extractBodyParagraphXmls = (documentXml: string): string[] => {
    const bodyXml = sliceBodyXml(documentXml);
    if (!bodyXml) return [];
    const cleaned = stripFallbackElements(bodyXml);
    return extractOutermostParagraphRanges(cleaned).map((r) => cleaned.slice(r.start, r.end));
};
