import { describe, it, expect } from "vitest";
import {
    extractBodyParagraphXmls,
    extractOutermostParagraphRanges,
    stripFallbackElements,
} from "./ooxmlScanner";
import { extractTableCellParagraphGroups } from "./tableSegmentation";

const wrapBody = (inner: string) =>
    `<?xml version="1.0"?><w:document><w:body>${inner}</w:body></w:document>`;

/**
 * A minimal version of the real-world failure: a paragraph anchoring a text
 * box, where the drawing carries the same text-box content twice — once in
 * mc:Choice (DrawingML) and once in mc:Fallback (legacy VML).
 */
const textBoxParagraph =
    `<w:p><w:r><w:drawing><mc:AlternateContent>` +
    `<mc:Choice Requires="wps"><wps:txbx><w:txbxContent>` +
    `<w:p><w:r><w:t>Box line one.</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>Box line two.</w:t></w:r></w:p>` +
    `</w:txbxContent></wps:txbx></mc:Choice>` +
    `<mc:Fallback><w:pict><v:textbox><w:txbxContent>` +
    `<w:p><w:r><w:t>Box line one.</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>Box line two.</w:t></w:r></w:p>` +
    `</w:txbxContent></v:textbox></w:pict></mc:Fallback>` +
    `</mc:AlternateContent></w:drawing></w:r></w:p>`;

describe("stripFallbackElements", () => {
    it("removes mc:Fallback blocks and keeps mc:Choice content", () => {
        const stripped = stripFallbackElements(textBoxParagraph);
        expect(stripped).not.toContain("mc:Fallback");
        expect(stripped).not.toContain("v:textbox");
        expect(stripped).toContain("mc:Choice");
        // Choice copy retained exactly once
        expect(stripped.match(/Box line one\./g)).toHaveLength(1);
    });

    it("handles nested AlternateContent inside a fallback", () => {
        const xml =
            `<a><mc:Fallback><b/><mc:Fallback><c/></mc:Fallback><d/></mc:Fallback><e/></a>`;
        expect(stripFallbackElements(xml)).toBe("<a><e/></a>");
    });

    it("removes self-closing fallbacks", () => {
        expect(stripFallbackElements("<a><mc:Fallback/><b/></a>")).toBe("<a><b/></a>");
    });

    it("returns input unchanged when no fallback exists", () => {
        const xml = "<w:p><w:r><w:t>hi</w:t></w:r></w:p>";
        expect(stripFallbackElements(xml)).toBe(xml);
    });
});

describe("extractOutermostParagraphRanges", () => {
    it("enumerates flat paragraphs like the historical scan", () => {
        const xml = `<w:p><w:r><w:t>a</w:t></w:r></w:p><w:p/><w:p w:rsidR="1"><w:r><w:t>b</w:t></w:r></w:p>`;
        const ranges = extractOutermostParagraphRanges(xml);
        expect(ranges).toHaveLength(3);
        expect(xml.slice(ranges[0].start, ranges[0].end)).toBe("<w:p><w:r><w:t>a</w:t></w:r></w:p>");
        expect(xml.slice(ranges[1].start, ranges[1].end)).toBe("<w:p/>");
    });

    it("keeps text-box paragraphs inside their anchor paragraph", () => {
        const stripped = stripFallbackElements(textBoxParagraph);
        const ranges = extractOutermostParagraphRanges(stripped);
        expect(ranges).toHaveLength(1);
        expect(stripped.slice(ranges[0].start, ranges[0].end)).toBe(stripped);
    });

    it("still enumerates table-cell paragraphs (not nested in another w:p)", () => {
        const xml =
            `<w:p><w:r><w:t>before</w:t></w:r></w:p>` +
            `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
            `<w:p><w:r><w:t>after</w:t></w:r></w:p>`;
        const ranges = extractOutermostParagraphRanges(xml);
        expect(ranges).toHaveLength(3);
        expect(xml.slice(ranges[1].start, ranges[1].end)).toBe(
            "<w:p><w:r><w:t>cell</w:t></w:r></w:p>"
        );
    });
});

describe("extractBodyParagraphXmls", () => {
    it("does not duplicate text-box content stored in Choice and Fallback", () => {
        const doc = wrapBody(
            `<w:p><w:r><w:t>intro</w:t></w:r></w:p>${textBoxParagraph}<w:p><w:r><w:t>outro</w:t></w:r></w:p>`
        );
        const paragraphs = extractBodyParagraphXmls(doc);
        expect(paragraphs).toHaveLength(3);
        const all = paragraphs.join("");
        expect(all.match(/Box line one\./g)).toHaveLength(1);
        expect(all.match(/Box line two\./g)).toHaveLength(1);
        expect(all).not.toContain("mc:Fallback");
    });

    it("returns empty array when there is no body", () => {
        expect(extractBodyParagraphXmls("<w:document/>")).toEqual([]);
    });
});

describe("extractTableCellParagraphGroups (index alignment)", () => {
    it("assigns paragraph indices consistent with the outermost-paragraph scan", () => {
        const doc = wrapBody(
            // index 0: plain paragraph
            `<w:p><w:r><w:t>before</w:t></w:r></w:p>` +
            // index 1: text-box anchor (nested paragraphs must not consume indices)
            textBoxParagraph +
            // index 2 + 3: table cell with two paragraphs
            `<w:tbl><w:tr><w:tc>` +
            `<w:p><w:r><w:t>cell a</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>cell b</w:t></w:r></w:p>` +
            `</w:tc></w:tr></w:tbl>` +
            // index 4: plain paragraph
            `<w:p><w:r><w:t>after</w:t></w:r></w:p>`
        );

        const groups = extractTableCellParagraphGroups(doc);
        expect(groups).toHaveLength(1);
        expect(groups[0].paragraphIndices).toEqual([2, 3]);

        // Sanity: the paragraph enumeration agrees.
        const paragraphs = extractBodyParagraphXmls(doc);
        expect(paragraphs).toHaveLength(5);
        expect(paragraphs[2]).toContain("cell a");
        expect(paragraphs[3]).toContain("cell b");
        expect(paragraphs[4]).toContain("after");
    });
});
