import { describe, it, expect } from "vitest";
import {
    applySegmentTranslationToParagraphBlock,
    extractContentSegmentStructureFromParagraphXml,
    extractContentSegmentsFromParagraphXml,
    extractSegmentStylesFromParagraphXml,
    findParagraphBlockInStoryXml,
} from "./contentSegmentUtils";

/**
 * InDesign anchors a table inside a host paragraph's CharacterStyleRange, and every table
 * cell carries its own ParagraphStyleRange. Biblica paragraphs have no Self attribute, so a
 * paragraph is addressed purely by its document-order index — the same order the parser gets
 * from getElementsByTagName. These tests pin that agreement down; without it the paragraphs
 * after a table are addressed off-by-N and translations land in the wrong place.
 */
const storyXml = `<?xml version="1.0" encoding="UTF-8"?>
<Story Self="u1">
\t<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aimt2">
\t\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
\t\t\t<Content>Table of weights and measures</Content>
\t\t\t<Br />
\t\t</CharacterStyleRange>
\t</ParagraphStyleRange>
\t<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Paragraphs%3aRegular paragraphs%3am-b">
\t\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
\t\t\t<Table Self="t1" BodyRowCount="1" ColumnCount="2">
\t\t\t\t<Cell Self="t1c1">
\t\t\t\t\t<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3apc">
\t\t\t\t\t\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/bd">
\t\t\t\t\t\t\t<Content>Biblical unit</Content>
\t\t\t\t\t\t</CharacterStyleRange>
\t\t\t\t\t</ParagraphStyleRange>
\t\t\t\t</Cell>
\t\t\t\t<Cell Self="t1c2">
\t\t\t\t\t<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3apc">
\t\t\t\t\t\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
\t\t\t\t\t\t\t<Content>Metric equivalent</Content>
\t\t\t\t\t\t</CharacterStyleRange>
\t\t\t\t\t</ParagraphStyleRange>
\t\t\t\t</Cell>
\t\t\t</Table>
\t\t</CharacterStyleRange>
\t</ParagraphStyleRange>
\t<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3am">
\t\t<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
\t\t\t<Content>After the table.</Content>
\t\t\t<Br />
\t\t</CharacterStyleRange>
\t</ParagraphStyleRange>
</Story>`;

const styleOf = (block: string) =>
    (block.match(/AppliedParagraphStyle="([^"]*)"/) || [])[1] ?? "";

describe("paragraph addressing around nested table paragraphs", () => {
    it("numbers nested table-cell paragraphs in document order", () => {
        const orders = [0, 1, 2, 3, 4].map((paragraphOrder) => {
            const located = findParagraphBlockInStoryXml(storyXml, { paragraphOrder });
            return located ? styleOf(located.block) : null;
        });

        expect(orders).toEqual([
            "ParagraphStyle/intro%3aimt2",
            "ParagraphStyle/Paragraphs%3aRegular paragraphs%3am-b",
            "ParagraphStyle/text%3apc",
            "ParagraphStyle/text%3apc",
            "ParagraphStyle/text%3am",
        ]);
    });

    it("gives the host paragraph none of the table's content", () => {
        const host = findParagraphBlockInStoryXml(storyXml, { paragraphOrder: 1 })!;

        expect(extractContentSegmentsFromParagraphXml(host.block)).toEqual([]);
        expect(extractContentSegmentStructureFromParagraphXml(host.block).segments).toEqual([]);
        expect(extractSegmentStylesFromParagraphXml(host.block)).toEqual([]);
    });

    it("reads each table cell as its own paragraph", () => {
        const first = findParagraphBlockInStoryXml(storyXml, { paragraphOrder: 2 })!;
        const second = findParagraphBlockInStoryXml(storyXml, { paragraphOrder: 3 })!;

        expect(extractContentSegmentsFromParagraphXml(first.block)).toEqual(["Biblical unit"]);
        expect(extractSegmentStylesFromParagraphXml(first.block)).toEqual([
            "CharacterStyle/bd",
        ]);
        expect(extractContentSegmentsFromParagraphXml(second.block)).toEqual([
            "Metric equivalent",
        ]);
    });

    it("writes a translation into the addressed table cell only", () => {
        const cell = findParagraphBlockInStoryXml(storyXml, { paragraphOrder: 3 })!;
        const updated = applySegmentTranslationToParagraphBlock(
            cell.block,
            '<span data-segment-index="0">Metrisch equivalent</span>',
            ["Metric equivalent"]
        );
        const story = storyXml.slice(0, cell.start) + updated + storyXml.slice(cell.end);

        expect(story).toContain("<Content>Metrisch equivalent</Content>");
        expect(story).toContain("<Content>Biblical unit</Content>");
        expect(story).toContain("<Content>After the table.</Content>");
        expect(story).toContain("<Content>Table of weights and measures</Content>");
    });

    it("leaves nested cells untouched when the host paragraph is updated", () => {
        const host = findParagraphBlockInStoryXml(storyXml, { paragraphOrder: 1 })!;
        const updated = applySegmentTranslationToParagraphBlock(
            host.block,
            '<span data-segment-index="0">ignored</span>',
            []
        );

        expect(updated).toBe(host.block);
    });

    it("still addresses paragraphs by order when no table is present", () => {
        const flat = `<Story Self="u2">
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/a"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/x"><Content>one</Content></CharacterStyleRange></ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/b"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/x"><Content>two</Content></CharacterStyleRange></ParagraphStyleRange>
</Story>`;

        expect(
            extractContentSegmentsFromParagraphXml(
                findParagraphBlockInStoryXml(flat, { paragraphOrder: 1 })!.block
            )
        ).toEqual(["two"]);
    });
});
