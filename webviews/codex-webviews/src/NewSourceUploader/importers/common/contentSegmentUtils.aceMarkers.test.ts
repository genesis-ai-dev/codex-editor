import { describe, it, expect } from "vitest";
import {
    applySegmentTranslationToParagraphBlock,
    buildSegmentedParagraphHtml,
    extractContentSegmentStructureFromParagraphXml,
    extractContentSegmentsFromParagraphXml,
    extractSegmentStylesFromParagraphXml,
} from "./contentSegmentUtils";

/**
 * InDesign stores its special characters as processing instructions inside the text:
 * a table-of-contents line is <Content>Genesis<?ACE 8?>6</Content>, where <?ACE 8?> is a
 * right indent tab. They are markup, so they must never surface as literal text in a cell,
 * and export has to put them back exactly where they were no matter what the translator did.
 */
const tocParagraph = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/toc%3aTOC body text">
\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
\t\t<Content>Genesis<?ACE 8?>6</Content>
\t\t<Br />
\t\t<Content>Exodus<?ACE 8?>71</Content>
\t</CharacterStyleRange>
</ParagraphStyleRange>`;

const runningHead = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3arh">
\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
\t\t<Content>\t<?ACE 18?>\n</Content>
\t</CharacterStyleRange>
</ParagraphStyleRange>`;

describe("ACE marker segments", () => {
    it("gives each marker its own slot and never leaks the instruction as text", () => {
        const segments = extractContentSegmentsFromParagraphXml(tocParagraph);
        expect(segments).toEqual(["Genesis", "\t", "6", "Exodus", "\t", "71"]);
        expect(segments.some((segment) => segment.includes("ACE"))).toBe(false);
    });

    it("marks a break only on the first slot of a Content node", () => {
        const { segments, breakBefore } =
            extractContentSegmentStructureFromParagraphXml(tocParagraph);
        expect(segments).toHaveLength(6);
        expect(breakBefore).toEqual([false, false, false, true, false, false]);
    });

    it("keeps one character style per slot so style and segment arrays stay aligned", () => {
        const styles = extractSegmentStylesFromParagraphXml(tocParagraph);
        expect(styles).toHaveLength(
            extractContentSegmentsFromParagraphXml(tocParagraph).length
        );
    });

    it("renders the marker as a tab between the title and the page number", () => {
        const { segments, breakBefore } =
            extractContentSegmentStructureFromParagraphXml(tocParagraph);
        const html = buildSegmentedParagraphHtml(
            segments.slice(0, 3),
            "ParagraphStyle/toc%3aTOC body text",
            "story1",
            undefined,
            breakBefore.slice(0, 3)
        );
        const plain = html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        expect(plain).toBe("Genesis 6");
    });

    it("leaves the paragraph untouched when nothing was translated", () => {
        const { segments, breakBefore } =
            extractContentSegmentStructureFromParagraphXml(tocParagraph);
        const html = buildSegmentedParagraphHtml(
            segments,
            "ParagraphStyle/toc%3aTOC body text",
            "story1",
            undefined,
            breakBefore
        );
        expect(applySegmentTranslationToParagraphBlock(tocParagraph, html, segments)).toBe(
            tocParagraph
        );
    });

    it("restores the marker when the surrounding text is translated", () => {
        const originals = extractContentSegmentsFromParagraphXml(tocParagraph);
        const html = buildSegmentedParagraphHtml(
            ["Genèse", "\t", "6", "Exode", "\t", "71"],
            "ParagraphStyle/toc%3aTOC body text",
            "story1",
            undefined,
            [false, false, false, true, false, false]
        );
        const updated = applySegmentTranslationToParagraphBlock(tocParagraph, html, originals);

        expect(updated).toContain("<Content>Genèse<?ACE 8?>6</Content>");
        expect(updated).toContain("<Content>Exode<?ACE 8?>71</Content>");
    });

    it("restores the marker even if the translator wiped the slot holding it", () => {
        const originals = extractContentSegmentsFromParagraphXml(tocParagraph);
        const html = buildSegmentedParagraphHtml(
            ["Genèse", "", "6", "Exode", "", "71"],
            "ParagraphStyle/toc%3aTOC body text",
            "story1",
            undefined,
            [false, false, false, true, false, false]
        );
        const updated = applySegmentTranslationToParagraphBlock(tocParagraph, html, originals);

        expect((updated.match(/<\?ACE 8\?>/g) ?? [])).toHaveLength(2);
    });

    it("treats a marker-only running head as having no text", () => {
        const segments = extractContentSegmentsFromParagraphXml(runningHead);
        expect(segments.join("").trim()).toBe("");
        expect(segments.some((segment) => segment.includes("ACE"))).toBe(false);
    });

    it("still round-trips paragraphs that hold no markers", () => {
        const plainParagraph = `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aip">
\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
\t\t<Content>The Gospel of Mark</Content>
\t</CharacterStyleRange>
</ParagraphStyleRange>`;

        expect(extractContentSegmentsFromParagraphXml(plainParagraph)).toEqual([
            "The Gospel of Mark",
        ]);

        const html = buildSegmentedParagraphHtml(
            ["Het evangelie van Marcus"],
            "ParagraphStyle/intro%3aip",
            "story1"
        );
        expect(
            applySegmentTranslationToParagraphBlock(plainParagraph, html, [
                "The Gospel of Mark",
            ])
        ).toContain("<Content>Het evangelie van Marcus</Content>");
    });
});
