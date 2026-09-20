import { describe, it, expect } from "vitest";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
} from "../index";
import { buildBibleVerseIndex } from "../surgicalSwap";
import { extractSliceByVerseRange } from "../chapterBlocks";
import {
    bookStory,
    chapterVerse,
    introNote,
} from "./boundaryTestHelpers";

const NO_STYLE = "CharacterStyle/$ID/[No character style]";

function danStory(body: string): string {
    return bookStory("DAN", body);
}

function jonStory(body: string): string {
    return bookStory("JON", body);
}

describe("Russian chapterInserts trailing append", () => {
    it("indexes bible verses when meta:c is omitted (single-chapter book)", () => {
        const bible = bookStory(
            "OBA",
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Russian OBA 1:1.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
</ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>2</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>2</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Russian OBA 1:2.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>2</Content></CharacterStyleRange>
</ParagraphStyleRange>`
        );
        const idx = buildBibleVerseIndex(bible);
        expect(idx.has("OBA|1|1")).toBe(true);
        expect(idx.has("OBA|1|2")).toBe(true);
    });

    it("ignores InDesign <?ACE?> anchors as chapter markers (PHM / 2JN)", () => {
        const bible = bookStory(
            "PHM",
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content><?ACE 3?></Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Russian PHM 1:1.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
</ParagraphStyleRange>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>2</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>2</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Russian PHM 1:2.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>2</Content></CharacterStyleRange>
</ParagraphStyleRange>`
        );
        const idx = buildBibleVerseIndex(bible);
        expect(idx.has("PHM|1|1")).toBe(true);
        expect(idx.has("PHM|1|2")).toBe(true);
        expect(idx.has("PHM|3|1")).toBe(false);

        const blocks = buildBibleChapterBlockIndex(bible);
        expect(blocks.get("PHM|1")).toBeDefined();
        expect(blocks.get("PHM|3")).toBeUndefined();
    });

    it("does not include trailing section headings in a verse-range slice", () => {
        const block =
            chapterVerse("1", "20", "Russian 1:20.", "ParagraphStyle/text%3ap", true) +
            chapterVerse("1", "21", "Russian 1:21.", "ParagraphStyle/text%3ap", false) +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3as1">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Next section</Content><Br /></CharacterStyleRange>
</ParagraphStyleRange>`;
        const slice = extractSliceByVerseRange(block, 1, 21);
        expect(slice).toContain("Russian 1:21.");
        expect(slice).not.toContain("Next section");
    });

    it("appends DAN 3:31-33 when study ends at verse 30", () => {
        const studyVerses = Array.from({ length: 30 }, (_, i) =>
            chapterVerse("3", String(i + 1), `English 3:${i + 1}.`, "ParagraphStyle/text%3ap", i === 0)
        ).join("");
        const study = danStory(studyVerses);

        const bibleVerses =
            Array.from({ length: 33 }, (_, i) =>
                chapterVerse(
                    "3",
                    String(i + 1),
                    `Russian 3:${i + 1}.`,
                    "ParagraphStyle/text%3ap",
                    i === 0
                )
            ).join("");
        const bible = danStory(bibleVerses);

        const plan = buildVersificationPlan(study, bible);
        expect((plan.chapterInserts.get("DAN|3") ?? []).map((r) => r.verse)).toEqual([
            "31",
            "32",
            "33",
        ]);

        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("Russian 3:31.");
        expect(xml).toContain("Russian 3:33.");
        expect(xml).not.toContain("English 3:30.");
    });

    it("appends JON 2:11 when study ends at verse 10", () => {
        const study =
            jonStory(
                chapterVerse("2", "1", "English 2:1.", "ParagraphStyle/text%3ap", true) +
                    Array.from({ length: 9 }, (_, i) =>
                        chapterVerse(
                            "2",
                            String(i + 2),
                            `English 2:${i + 2}.`,
                            "ParagraphStyle/text%3ap",
                            false
                        )
                    ).join("")
            );
        const bible =
            jonStory(
                chapterVerse("2", "1", "Russian 2:1.", "ParagraphStyle/text%3ap", true) +
                    Array.from({ length: 10 }, (_, i) =>
                        chapterVerse(
                            "2",
                            String(i + 2),
                            `Russian 2:${i + 2}.`,
                            "ParagraphStyle/text%3ap",
                            false
                        )
                    ).join("")
            );

        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("Russian 2:11.");
        expect(xml).not.toContain("English 2:10.");
    });

    it("appends PSA 62:13 onto the chapter content before trailing study notes", () => {
        const study = bookStory(
            "PSA",
            chapterVerse("62", "1", "English 62:1.", "ParagraphStyle/text%3aq1", true) +
                Array.from({ length: 11 }, (_, i) =>
                    chapterVerse(
                        "62",
                        String(i + 2),
                        `English 62:${i + 2}.`,
                        "ParagraphStyle/text%3aq1",
                        false
                    )
                ).join("") +
                introNote("Psalm study note.")
        );
        const bible = bookStory(
            "PSA",
            chapterVerse("62", "1", "Russian 62:1.", "ParagraphStyle/text%3aq1", true) +
                Array.from({ length: 12 }, (_, i) =>
                    chapterVerse(
                        "62",
                        String(i + 2),
                        `Russian 62:${i + 2}.`,
                        "ParagraphStyle/text%3aq1",
                        false
                    )
                ).join("")
        );

        const plan = buildVersificationPlan(study, bible);
        const bibleIdx = buildBibleVerseIndex(bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );
        const exportIdx = buildBibleVerseIndex(xml);
        const expected = bibleIdx.get("PSA|62|13")?.text ?? "";

        expect(expected.length).toBeGreaterThan(0);
        expect(exportIdx.get("PSA|62|13")?.text).toBe(expected);
        expect(xml).toContain("Psalm study note.");
    });

    it("preserves SNG 1:1 superscription when study has English head:d_h", () => {
        const study = bookStory(
            "SNG",
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3ad_h">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>The Song of Songs.</Content><Br /></CharacterStyleRange>
</ParagraphStyleRange>` +
                chapterVerse("1", "1", "English 1:1 title.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("1", "2", "English 1:2.", "ParagraphStyle/text%3ap", false)
        );
        const bible = bookStory(
            "SNG",
            chapterVerse("1", "1", "Russian 1:1 full superscription.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("1", "2", "Russian 1:2.", "ParagraphStyle/text%3ap", false)
        );

        const plan = buildVersificationPlan(study, bible);
        const bibleIdx = buildBibleVerseIndex(bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );
        const exportIdx = buildBibleVerseIndex(xml);

        expect(xml).toContain("The Song of Songs.");
        expect(exportIdx.get("SNG|1|1")?.text).toBe(bibleIdx.get("SNG|1|1")?.text);
        expect(xml).not.toContain("English 1:1");
    });
});
