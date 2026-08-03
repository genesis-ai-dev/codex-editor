import { describe, it, expect } from "vitest";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildChapterBlockIndex,
    buildVersificationPlan,
} from "../index";
import {
    buildChapterSpanIndex,
    balanceParagraphStyleRanges,
    collapseRedundantProseInBlockXml,
    extractSliceByVerseRange,
} from "../chapterBlocks";
import { buildBibleVerseIndex } from "../surgicalSwap";
import { bookStory, chapterVerse, introNote, pDc1Boundary } from "./boundaryTestHelpers";

const NO_STYLE = "CharacterStyle/$ID/[No character style]";

function psalmStory(body: string): string {
    return `<?xml version="1.0"?><Story>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>PSA</Content></CharacterStyleRange>
</ParagraphStyleRange>${body}</Story>`;
}

function jobStory(body: string): string {
    return `<?xml version="1.0"?><Story>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>JOB</Content></CharacterStyleRange>
</ParagraphStyleRange>${body}</Story>`;
}

function introNote(text: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function englishSubheader(text: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3ad_h">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content><Br /></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function chapterVerse(
    chapter: string,
    verse: string,
    text: string,
    paraStyle = "ParagraphStyle/text%3aq1",
    includeChapterMarker = verse === "1"
): string {
    const chMarker = includeChapterMarker
        ? `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapter}:</Content></CharacterStyleRange>`
        : "";
    return `<ParagraphStyleRange AppliedParagraphStyle="${paraStyle}">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>${verse}</Content></CharacterStyleRange>
  ${chMarker}
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function standaloneChapterMarker(chapter: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3ac">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapter}:</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function headChapterLabel(text: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3acl">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function duplicateContentVerse(
    chapter: string,
    verse: string,
    text: string
): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapter}:</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}">
    <Content>${text}</Content>
    <Content>${text}</Content>
  </CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function biblePsalmSubheaderVerse(chapter: string, text: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3ad_h">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapter}:</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function sectionHeading(text: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3as1">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content><Br /></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function blankSpacer(): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/b_head">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Br /></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function refrainVerse(chapter: string, verse: string, line: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapter}:</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${line}</Content><Br /><Content>${line}</Content><Br /><Content>autre ligne</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function sngStory(body: string): string {
    return `<?xml version="1.0"?><Story>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>SNG</Content></CharacterStyleRange>
</ParagraphStyleRange>${body}</Story>`;
}

function speakerLabel(text: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3asp">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content><Br /></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function acrosticHeading(verse: string, letter: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3aqa">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${letter}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Br /></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function nehStory(body: string): string {
    return `<?xml version="1.0"?><Story>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>NEH</Content></CharacterStyleRange>
</ParagraphStyleRange>${body}</Story>`;
}

function saStory(body: string): string {
    return `<?xml version="1.0"?><Story>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>1SA</Content></CharacterStyleRange>
</ParagraphStyleRange>${body}</Story>`;
}

describe("structureSwap", () => {
    it("replaces a chapter text block with Bible paragraph XML", () => {
        const study = psalmStory(
            englishSubheader("A psalm of David.") +
                chapterVerse("1", "1", "English line one.") +
                chapterVerse("1", "2", "English line two.", "ParagraphStyle/text%3aq2")
        );
        const bible = psalmStory(
            chapterVerse("1", "1", "Linha portuguesa um.") +
                chapterVerse("1", "2", "Linha portuguesa dois.", "ParagraphStyle/text%3aq2")
        );

        const bibleIndex = buildBibleChapterBlockIndex(bible);
        expect(bibleIndex.get("PSA|1")).toBeDefined();

        const { xml, stats } = applyStructureSwapToStudyXml(study, bibleIndex);

        expect(stats.chaptersReplaced).toBe(1);
        expect(xml).toContain("A psalm of David.");
        expect(xml).toContain("Linha portuguesa um.");
        expect(xml).toContain("Linha portuguesa dois.");
        expect(xml).not.toContain("English line one.");
        expect(xml).not.toMatch(/Paragraph<Paragraph/);
    });

    it("indexes chapter when meta:c marker is in its own paragraph (PSA 2 pattern)", () => {
        const study = psalmStory(
            standaloneChapterMarker("2") +
                headChapterLabel("Psalm 2") +
                chapterVerse("2", "1", "Why do nations rage?", "ParagraphStyle/text%3aq1", false) +
                chapterVerse("2", "2", "Kings plot in vain.", "ParagraphStyle/text%3aq2", false)
        );
        const spans = buildChapterSpanIndex(study).get("PSA|2");
        expect(spans).toHaveLength(1);
        expect(spans?.[0].firstVerse).toBe(1);
        expect(spans?.[0].lastVerse).toBe(2);
    });

    it("keeps the translation's numbered superscription as verse 1 in structure mode", () => {
        const study = psalmStory(
            standaloneChapterMarker("2") +
                headChapterLabel("Psalm 2") +
                chapterVerse("2", "1", "English v1.", "ParagraphStyle/text%3aq1", false) +
                chapterVerse("2", "2", "English v2.", "ParagraphStyle/text%3aq2", false)
        );
        const bible = psalmStory(
            standaloneChapterMarker("2") +
                biblePsalmSubheaderVerse("2", "Russian subheader.") +
                chapterVerse("2", "2", "Russian v1.", "ParagraphStyle/text%3aq1", false) +
                chapterVerse("2", "3", "Russian v2.", "ParagraphStyle/text%3aq2", false)
        );

        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );
        // Direct same-number replacement keeps the translation's verse 1
        // (its superscription) and the translation's numbering.
        expect(xml).toContain("Psalm 2");
        expect(xml).toContain("Russian subheader.");
        expect(xml).toContain("Russian v1.");
        expect(xml).toContain("Russian v2.");
        expect(xml).not.toContain("English v1.");
        expect(xml).not.toContain("English v2.");
    });

    it("indexes study and bible chapter blocks with matching keys", () => {
        const study = psalmStory(chapterVerse("3", "1", "Study v1."));
        const bible = psalmStory(chapterVerse("3", "1", "Bible v1."));
        const studyBlocks = buildChapterBlockIndex(study);
        const bibleBlocks = buildBibleChapterBlockIndex(bible);
        expect(studyBlocks.has("PSA|3")).toBe(true);
        expect(bibleBlocks.has("PSA|3")).toBe(true);
    });

    it("indexes multiple text spans when intro notes split a chapter", () => {
        const study = jobStory(
            chapterVerse("1", "1", "English v1.") +
                chapterVerse("1", "2", "English v2.") +
                introNote("Study note between verses.") +
                chapterVerse("1", "7", "English v7.") +
                chapterVerse("1", "8", "English v8.")
        );
        const spans = buildChapterSpanIndex(study).get("JOB|1");
        expect(spans).toHaveLength(2);
        expect(spans?.[0].firstVerse).toBe(1);
        expect(spans?.[0].lastVerse).toBe(2);
        expect(spans?.[1].firstVerse).toBe(7);
        expect(spans?.[1].lastVerse).toBe(8);
    });

    it("extracts a verse-range slice without bleeding into the next verse", () => {
        const bibleBlock =
            chapterVerse("40", "1", "PT v1.") +
            chapterVerse("40", "2", "PT v2.") +
            chapterVerse("40", "3", "PT v3.") +
            chapterVerse("40", "4", "PT v4.") +
            chapterVerse("40", "5", "PT v5.") +
            chapterVerse("40", "6", "PT v6.");
        const slice = extractSliceByVerseRange(bibleBlock, 1, 5);
        expect(slice).toContain("PT v1.");
        expect(slice).toContain("PT v5.");
        expect(slice).not.toContain("PT v6.");
    });

    it("swaps each span after intro notes (Job 1 pattern)", () => {
        const study = jobStory(
            chapterVerse("1", "1", "English v1.") +
                chapterVerse("1", "2", "English v2.") +
                chapterVerse("1", "3", "English v3.") +
                chapterVerse("1", "4", "English v4.") +
                chapterVerse("1", "5", "English v5.") +
                chapterVerse("1", "6", "English v6.") +
                introNote("Job chapter 1 study note.") +
                chapterVerse("1", "7", "English v7.") +
                chapterVerse("1", "8", "English v8.")
        );
        const bible = jobStory(
            chapterVerse("1", "1", "PT v1.") +
                chapterVerse("1", "2", "PT v2.") +
                chapterVerse("1", "3", "PT v3.") +
                chapterVerse("1", "4", "PT v4.") +
                chapterVerse("1", "5", "PT v5.") +
                chapterVerse("1", "6", "PT v6.") +
                chapterVerse("1", "7", "PT v7.") +
                chapterVerse("1", "8", "PT v8.")
        );

        const { xml, stats } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible)
        );

        expect(stats.replacedCount).toBe(2);
        expect(xml).toContain("Job chapter 1 study note.");
        expect(xml).toContain("PT v1.");
        expect(xml).toContain("PT v6.");
        expect(xml).toContain("PT v7.");
        expect(xml).toContain("PT v8.");
        expect(xml).not.toContain("English v1.");
        expect(xml).not.toContain("English v6.");
        expect(xml).not.toContain("English v7.");

        const notePos = xml.indexOf("Job chapter 1 study note.");
        const pt6Pos = xml.indexOf("PT v6.");
        const pt7Pos = xml.indexOf("PT v7.");
        expect(pt6Pos).toBeLessThan(notePos);
        expect(pt7Pos).toBeGreaterThan(notePos);
    });

    it("does not duplicate prose when Bible paragraph has redundant Content nodes", () => {
        const verseText =
            "Ó cidade da Babilônia, destinada à destruição, bem-aventurado aquele que lhe retribuir o mal que você nos fez!";
        const study = psalmStory(
            standaloneChapterMarker("137") +
                chapterVerse("137", "8", "People of Babylon, you are sentenced to be destroyed.", "ParagraphStyle/text%3aq1", false)
        );
        const bible = psalmStory(
            duplicateContentVerse("137", "8", verseText)
        );

        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible)
        );

        expect(xml).toContain(verseText);
        expect(xml).not.toContain(`${verseText}${verseText}`);
        expect(xml.split(verseText).length - 1).toBe(1);
    });

    it("collapseRedundantProseInBlockXml clears duplicate Content in one CSR", () => {
        const verseText = "Linha duplicada.";
        const block = duplicateContentVerse("1", "1", verseText);
        const collapsed = collapseRedundantProseInBlockXml(block);
        expect(collapsed).toContain(verseText);
        expect(collapsed).not.toContain(`${verseText}${verseText}`);
        expect(collapsed.split(verseText).length - 1).toBe(1);
    });

    it("collapseRedundantProseInBlockXml preserves identical lines separated by <Br/> (refrain)", () => {
        const line = "des habits de couleur,";
        const block = refrainVerse("5", "30", line);
        const collapsed = collapseRedundantProseInBlockXml(block);
        // Both repeated refrain lines survive; the unique line stays too.
        expect(collapsed.split(line).length - 1).toBe(2);
        expect(collapsed).toContain("autre ligne");
    });

    it("extractSliceByVerseRange carries a preceding section heading into the next slice", () => {
        const block = jobStory(
            chapterVerse("5", "1", "PT v1.") +
                chapterVerse("5", "2", "PT v2.", "ParagraphStyle/text%3ap", false) +
                blankSpacer() +
                sectionHeading("Section title here") +
                chapterVerse("5", "3", "PT v3.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("5", "4", "PT v4.", "ParagraphStyle/text%3ap", false)
        );

        const sliceWith = extractSliceByVerseRange(block, 3, 4);
        expect(sliceWith).toContain("Section title here");
        expect(sliceWith).toContain("PT v3.");
        expect(sliceWith).toContain("PT v4.");
        expect(sliceWith).not.toContain("PT v2.");

        // The heading must not also leak into the previous verse's slice.
        const sliceBefore = extractSliceByVerseRange(block, 1, 2);
        expect(sliceBefore).toContain("PT v2.");
        expect(sliceBefore).not.toContain("Section title here");
    });

    it("swaps each span after intro notes (Job 40 pattern)", () => {
        const study = jobStory(
            chapterVerse("40", "1", "English v1.") +
                chapterVerse("40", "2", "English v2.") +
                chapterVerse("40", "3", "English v3.") +
                chapterVerse("40", "4", "English v4.") +
                chapterVerse("40", "5", "English v5.") +
                introNote("Job 40 study note.") +
                chapterVerse("40", "6", "English v6.") +
                chapterVerse("40", "7", "English v7.")
        );
        const bible = jobStory(
            chapterVerse("40", "1", "PT v1.") +
                chapterVerse("40", "2", "PT v2.") +
                chapterVerse("40", "3", "PT v3.") +
                chapterVerse("40", "4", "PT v4.") +
                chapterVerse("40", "5", "PT v5.") +
                chapterVerse("40", "6", "PT v6.") +
                chapterVerse("40", "7", "PT v7.")
        );

        const { xml, stats } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible)
        );

        expect(stats.replacedCount).toBe(2);
        expect(xml).toContain("Job 40 study note.");
        expect(xml).toContain("PT v1.");
        expect(xml).toContain("PT v5.");
        expect(xml).toContain("PT v6.");
        expect(xml).toContain("PT v7.");
        expect(xml).not.toContain("English v1.");
        expect(xml).not.toContain("English v6.");

        const notePos = xml.indexOf("Job 40 study note.");
        const pt5Pos = xml.indexOf("PT v5.");
        const pt6Pos = xml.indexOf("PT v6.");
        expect(pt5Pos).toBeLessThan(notePos);
        expect(pt6Pos).toBeGreaterThan(notePos);
    });

    it("indexes PSA 119 acrostic head:qa verses and preserves them in structure swap", () => {
        const bible = psalmStory(
            chapterVerse("119", "7", "Verse seven prose.", "ParagraphStyle/text%3aq2", true) +
                acrosticHeading("8", "B Beth") +
                chapterVerse("119", "9", "Verse nine prose.", "ParagraphStyle/text%3aq1", false)
        );

        const index = buildBibleVerseIndex(bible);
        expect(index.has("PSA|119|8")).toBe(true);
        expect(index.get("PSA|119|8")?.text).toContain("B Beth");

        const study = psalmStory(
            chapterVerse("119", "7", "English v7.", "ParagraphStyle/text%3aq2", true) +
                chapterVerse("119", "8", "English v8.", "ParagraphStyle/text%3aq1", false) +
                chapterVerse("119", "9", "English v9.", "ParagraphStyle/text%3aq1", false)
        );
        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("B Beth");
        expect(xml).toContain("Verse seven prose.");
        expect(xml).not.toContain("English v8.");
    });

    it("retains head:ms1 and head:sp_h inside SNG verse slices (Russian pattern)", () => {
        const bible = sngStory(
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap_dc1">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>1:</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Лучшая из песен.</Content></CharacterStyleRange>
</ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/b_head">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Br /></CharacterStyleRange>
</ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3ams1">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Первая встреча</Content><Br /></CharacterStyleRange>
</ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3asp_h">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Она</Content><Br /></CharacterStyleRange>
</ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Целуй меня, целуй устами своими,</Content><Br /></CharacterStyleRange>
</ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq2">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>ведь любовь твоя отрадней вина,</Content><Br /></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
</ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>2</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Verse two.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>2</Content></CharacterStyleRange>
</ParagraphStyleRange>`
        );
        const block = buildBibleChapterBlockIndex(bible).get("SNG|1");
        expect(block?.blockXml).toContain("Лучшая из песен.");
        expect(block?.blockXml).toContain("Первая встреча");
        expect(block?.blockXml).toContain("Она");
        expect(block?.blockXml).toContain("Целуй меня");
        expect(block?.blockXml).toContain("отрадней");
        const slice = extractSliceByVerseRange(block!.blockXml, 1, 1);
        expect(slice).toContain("Лучшая из песен.");
        expect(slice).toContain("Целуй меня");
        expect(slice).toContain("отрадней");
        expect(slice).toContain("Первая встреча");
        expect(slice).not.toContain("Verse two.");
    });

    it("replaces English speaker labels with Marathi head:sp in Song of Songs", () => {
        const study = sngStory(
            chapterVerse("1", "1", "English verse one.", "ParagraphStyle/text%3aq1", true) +
                speakerLabel("The woman says,") +
                chapterVerse("1", "2", "English verse two.", "ParagraphStyle/text%3aq1", false)
        );
        const bible = sngStory(
            chapterVerse("1", "1", "Marathi verse one.", "ParagraphStyle/text%3aq1", true) +
                speakerLabel("nayika") +
                chapterVerse("1", "2", "Marathi verse two.", "ParagraphStyle/text%3aq1", false)
        );

        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("Marathi verse one.");
        expect(xml).toContain("nayika");
        expect(xml).not.toContain("The woman says,");
        expect(xml).not.toContain("English verse");
    });

    it("extractSliceByVerseRange includes mid-verse section heading between parts of same verse", () => {
        const block = saStory(
            chapterVerse("7", "2", "Part one of v2.", "ParagraphStyle/text%3ap", true) +
                blankSpacer() +
                sectionHeading("Samuel at Mizpah") +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Part two of v2.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>2</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content> </Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>3</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>3</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Verse three.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>3</Content></CharacterStyleRange>
</ParagraphStyleRange>`
        );

        const slice = extractSliceByVerseRange(block, 2, 2);
        expect(slice).toContain("Part one of v2.");
        expect(slice).toContain("Samuel at Mizpah");
        expect(slice).toContain("Part two of v2.");
        expect(slice).not.toContain("Verse three.");
    });

    it("NEH 8 post-intro span gets law text not census when intro splits chapter", () => {
        const study = nehStory(
            chapterVerse("8", "1", "English law v1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("8", "2", "English law v2.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "3", "English law v3.", "ParagraphStyle/text%3ap", false) +
                introNote("Nehemiah study note.") +
                chapterVerse("8", "4", "English law v4.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "5", "English law v5.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "6", "English law v6.", "ParagraphStyle/text%3ap", false)
        );
        const bible = nehStory(
            chapterVerse("7", "4", "Census line four.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("7", "5", "Census line five.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "1", "Law line one.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("8", "2", "Law line two.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "3", "Law line three.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "4", "Law line four.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "5", "Law line five.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "6", "Law line six.", "ParagraphStyle/text%3ap", false)
        );

        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("Nehemiah study note.");
        expect(xml).toContain("Law line four.");
        expect(xml).toContain("Law line six.");
        expect(xml).not.toContain("Census line four.");
        expect(xml).not.toContain("English law");
    });

    it("NEH 7 census does not bleed into NEH 8 when intro note splits chapter 8", () => {
        const study = nehStory(
            chapterVerse("7", "1", "English census v1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("7", "4", "English census v4.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("7", "73", "English census v73.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "1", "English law v1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("8", "2", "English law v2.", "ParagraphStyle/text%3ap", false) +
                introNote("Nehemiah study note.") +
                chapterVerse("8", "4", "English law v4.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "6", "English law v6.", "ParagraphStyle/text%3ap", false)
        );
        const bible = nehStory(
            chapterVerse("7", "1", "Census line one.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("7", "4", "Census line four.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("7", "73", "Census line seventy-three.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "1", "Law line one.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("8", "2", "Law line two.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "4", "Law line four.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "6", "Law line six.", "ParagraphStyle/text%3ap", false)
        );

        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("Census line four.");
        expect(xml).toContain("Nehemiah study note.");
        expect(xml).toContain("Law line four.");
        expect(xml).toContain("Law line six.");
        const lawFourPos = xml.indexOf("Law line four.");
        const censusFourPos = xml.indexOf("Census line four.");
        expect(lawFourPos).toBeGreaterThan(censusFourPos);
        expect(xml.slice(lawFourPos)).not.toContain("Census line four.");
    });

    it("1SA 7 mid-verse heading survives structure swap across note-split spans", () => {
        const study = saStory(
            chapterVerse("7", "1", "English v1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("7", "2", "English v2 part one.", "ParagraphStyle/text%3ap", false) +
                introNote("Samuel study note.") +
                chapterVerse("7", "2", "English v2 part two.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("7", "3", "English v3.", "ParagraphStyle/text%3ap", false)
        );
        const bible = saStory(
            chapterVerse("7", "1", "Marathi v1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("7", "2", "Marathi v2 part one.", "ParagraphStyle/text%3ap", false) +
                sectionHeading("Samuel at Mizpah") +
                chapterVerse("7", "2", "Marathi v2 part two.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("7", "3", "Marathi v3.", "ParagraphStyle/text%3ap", false)
        );

        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("Samuel study note.");
        expect(xml).toContain("Samuel at Mizpah");
        expect(xml).toContain("Marathi v2 part one.");
        expect(xml).toContain("Marathi v2 part two.");
        expect(xml).not.toContain("English v2");
    });

    it("swaps PHM study chapter 3 from bible chapter 1 with ACE markers", () => {
        const NO_STYLE = "CharacterStyle/$ID/[No character style]";
        const study = bookStory(
            "PHM",
            chapterVerse("3", "1", "English 3:1.", "ParagraphStyle/text%3ap", true, "3:") +
                chapterVerse("3", "2", "English 3:2.", "ParagraphStyle/text%3ap", false)
        );
        const bible = bookStory(
            "PHM",
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content><?ACE 3?></Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Russian 1:1.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
</ParagraphStyleRange>` +
                chapterVerse("1", "2", "Russian 1:2.", "ParagraphStyle/text%3ap", false)
        );

        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("Russian 1:1.");
        expect(xml).toContain("Russian 1:2.");
        expect(xml).not.toContain("English 3:1.");

        const exportIdx = buildBibleVerseIndex(xml);
        expect(exportIdx.has("PHM|1|1")).toBe(true);
        expect(exportIdx.has("PHM|3|1")).toBe(false);
        expect(exportIdx.get("PHM|1|1")?.text).toContain("Russian 1:1");
    });

    it("extractSlice includes poetry verses opened with cv:v before meta:v body", () => {
        const block =
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>22</Content></CharacterStyleRange>` +
            `</ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq2">` +
            `<CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Portuguese 1:22 tail.</Content></CharacterStyleRange>` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>22</Content></CharacterStyleRange>` +
            `</ParagraphStyleRange>`;
        const slice = extractSliceByVerseRange(block, 22, 22);
        expect(slice).toContain("Portuguese 1:22");
        expect(balanceParagraphStyleRanges(slice).match(/<ParagraphStyleRange/g)?.length).toBe(
            balanceParagraphStyleRanges(slice).match(/<\/ParagraphStyleRange>/g)?.length
        );
    });

    it("LAM 1:22 poetry cv:v opener is included in structure swap span", () => {
        const study = bookStory(
            "LAM",
            chapterVerse("1", "21", "English 1:21.", "ParagraphStyle/text%3aq2", true) +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">` +
                `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>22</Content></CharacterStyleRange>` +
                `</ParagraphStyleRange>` +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq2">` +
                `<CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>English 1:22 tail.</Content></CharacterStyleRange>` +
                `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>22</Content></CharacterStyleRange>` +
                `</ParagraphStyleRange>`
        );
        const bible = bookStory(
            "LAM",
            chapterVerse("1", "21", "Portuguese 1:21.", "ParagraphStyle/text%3aq2", true) +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">` +
                `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>22</Content></CharacterStyleRange>` +
                `</ParagraphStyleRange>` +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq2">` +
                `<CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Portuguese 1:22 tail.</Content></CharacterStyleRange>` +
                `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>22</Content></CharacterStyleRange>` +
                `</ParagraphStyleRange>`
        );
        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );
        expect(xml).toContain("Portuguese 1:22");
        const exportIdx = buildBibleVerseIndex(xml);
        expect(exportIdx.get("LAM|1|22")?.text).toContain("Portuguese 1:22");
        expect(xml).not.toContain("English 1:22");
    });

    it("extractSliceByVerseRange stops before the next verse marker", () => {
        const block =
            chapterVerse("10", "13", "Verse thirteen.", "ParagraphStyle/text%3ap", true) +
            chapterVerse("10", "14", "Verse fourteen bleed.", "ParagraphStyle/text%3ap", false);
        const slice = extractSliceByVerseRange(block, 1, 13);
        expect(slice).toContain("Verse thirteen");
        expect(slice).not.toContain("Verse fourteen");
        expect(slice).not.toMatch(/meta%3av"><Content>14/);
    });

    it("wipes study-only heading verses marked remove when no meta:c in paragraph", () => {
        const study = bookStory(
            "HAB",
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3ac">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>3:</Content></CharacterStyleRange>
</ParagraphStyleRange>` +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3as1">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>English prayer title.</Content></CharacterStyleRange>
</ParagraphStyleRange>` +
                chapterVerse("3", "2", "English 3:2.", "ParagraphStyle/text%3ap", false)
        );
        const bible = bookStory(
            "HAB",
            chapterVerse("3", "2", "Portuguese 3:2.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("3", "3", "Portuguese 3:3.", "ParagraphStyle/text%3ap", false)
        );
        const plan = buildVersificationPlan(study, bible);

        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).not.toContain("English prayer title.");
        expect(xml).toContain("Portuguese 3:2.");
    });

    it("preserves superscription paragraph when it carries meta:c (HAB 3 regression)", () => {
        const study = bookStory(
            "HAB",
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3ad_dc1">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>3.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>English prayer title.</Content></CharacterStyleRange>
</ParagraphStyleRange>` +
                chapterVerse("3", "2", "English 3:2.", "ParagraphStyle/text%3ap", false)
        );
        const bible = bookStory(
            "HAB",
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3ad">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>3.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Portuguese prayer title.</Content></CharacterStyleRange>
</ParagraphStyleRange>` +
                chapterVerse("3", "2", "Portuguese 3:2.", "ParagraphStyle/text%3ap", false)
        );
        const plan = buildVersificationPlan(study, bible);

        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("CharacterStyle/meta%3ac");
        expect(xml).toContain("Portuguese 3:2.");
        const exportIdx = buildBibleVerseIndex(xml);
        expect(exportIdx.has("HAB|3|2")).toBe(true);
    });

    it("indexes boundary paragraph verses per chapter segment, not whole paragraph", () => {
        const study = bookStory(
            "1CO",
            chapterVerse("10", "33", "English 10:33.", "ParagraphStyle/text%3ap", true) +
                introNote("Study note splits chapter 10.") +
                chapterVerse("10", "14", "English 10:14.", "ParagraphStyle/text%3ap", false) +
                pDc1Boundary("10", "33", "English boundary 33.", "11", [
                    { verse: "1", text: "English 11:1." },
                ])
        );
        const ch10 = buildChapterSpanIndex(study).get("1CO|10") ?? [];
        const ch11 = buildChapterSpanIndex(study).get("1CO|11") ?? [];
        const boundary10 = ch10.find((s) => s.absStart === ch11[0]?.absStart);
        const boundary11 = ch11.find((s) => s.absStart === ch11[0]?.absStart);
        expect(boundary10?.firstVerse).toBe(33);
        expect(boundary10?.lastVerse).toBe(33);
        expect(boundary11?.firstVerse).toBe(1);
        expect(boundary11?.lastVerse).toBe(1);
        expect(boundary10?.firstVerse).not.toBe(1);
    });

    it("appends bible-only trailing verses via chapterInserts (HAB 3:19)", () => {
        const study = bookStory(
            "HAB",
            chapterVerse("3", "2", "English 3:2.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("3", "18", "English 3:18.", "ParagraphStyle/text%3ap", false)
        );
        const bible = bookStory(
            "HAB",
            chapterVerse("3", "2", "Portuguese 3:2.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("3", "18", "Portuguese 3:18.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("3", "19", "Portuguese 3:19.", "ParagraphStyle/text%3ap", false)
        );
        const plan = buildVersificationPlan(study, bible);
        expect(plan.chapterInserts.get("HAB|3")?.some((r) => r.verse === "19")).toBe(
            true
        );

        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("Portuguese 3:19");
        expect(buildBibleVerseIndex(xml).get("HAB|3|19")?.text).toContain(
            "Portuguese 3:19"
        );
    });
});
