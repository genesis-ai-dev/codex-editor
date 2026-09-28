import { describe, it, expect } from "vitest";
import type { BibleVerseIndex } from "../types";
import {
    applyBibleSwap,
    applySurgicalSwapToStudyXml,
    applyStructureSwapToStudyXml,
    bibleSlicesForStudyRange,
    buildBibleChapterBlockIndex,
    buildBibleVerseIndex,
    buildVersificationPlan,
    buildVersificationPlanFromIndices,
    collectVersificationChanges,
    extractBibleXmlForSlices,
    resolveVersePlan,
    verseKey,
} from "../index";

const NO_STYLE = "CharacterStyle/$ID/[No character style]";

function bookPara(book: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${book}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function psalmStory(body: string): string {
    return `<?xml version="1.0"?><Story>${bookPara("PSA")}${body}</Story>`;
}

function chapterMarker(chapter: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3ac">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapter}:</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function psalmVerse(
    chapter: string,
    verse: string,
    text: string,
    includeChapterMarker = verse === "1"
): string {
    const chMarker = includeChapterMarker
        ? `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapter}:</Content></CharacterStyleRange>`
        : "";
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>${verse}</Content></CharacterStyleRange>
  ${chMarker}
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function headChapterLabel(psalmNumber: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3acl">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Psalm ${psalmNumber}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

describe("versificationPlan", () => {
    it("maps study OBA chapter 3 to bible chapter 1 for inserts", () => {
        const studyIndex: BibleVerseIndex = new Map([
            [
                "OBA|3|1",
                {
                    text: "s1",
                    segments: ["s1"],
                    paragraphSig: "p",
                    paragraphChunks: [],
                    verseSpanXml: "",
                    isSubheader: false,
                },
            ],
            [
                "OBA|3|20",
                {
                    text: "s20",
                    segments: ["s20"],
                    paragraphSig: "p",
                    paragraphChunks: [],
                    verseSpanXml: "",
                    isSubheader: false,
                },
            ],
        ]);
        const bibleIndex: BibleVerseIndex = new Map([
            [
                "OBA|1|1",
                {
                    text: "b1",
                    segments: ["b1"],
                    paragraphSig: "p",
                    paragraphChunks: [],
                    verseSpanXml: "",
                    isSubheader: false,
                },
            ],
            [
                "OBA|1|21",
                {
                    text: "b21",
                    segments: ["b21"],
                    paragraphSig: "p",
                    paragraphChunks: [],
                    verseSpanXml: "",
                    isSubheader: false,
                },
            ],
        ]);
        const plan = buildVersificationPlanFromIndices("", studyIndex, bibleIndex);

        const replace = plan.verseMap.get("OBA|3|1");
        expect(replace?.action).toBe("replace");
        if (replace?.action === "replace") {
            expect(replace.bible).toEqual({
                book: "OBA",
                chapter: "1",
                verse: "1",
            });
        }
        expect((plan.chapterInserts.get("OBA|3") ?? []).map((r) => r.verse)).toEqual([
            "21",
        ]);
    });

    it("maps Psalm verses within the same chapter number", () => {
        const studyXml = psalmStory(
            chapterMarker("8") +
                psalmVerse("8", "1", "study-8-1") +
                psalmVerse("8", "2", "study-8-2") +
                psalmVerse("8", "3", "study-8-3") +
                chapterMarker("9") +
                psalmVerse("9", "1", "study-9-1") +
                psalmVerse("9", "2", "study-9-2")
        );

        const bibleXml = psalmStory(
            chapterMarker("8") +
                psalmVerse("8", "1", "bible-8-1") +
                psalmVerse("8", "2", "bible-8-2") +
                chapterMarker("9") +
                psalmVerse("9", "1", "bible-9-1") +
                psalmVerse("9", "2", "bible-9-2") +
                psalmVerse("9", "3", "bible-9-3")
        );

        const plan = buildVersificationPlan(studyXml, bibleXml);

        expect(resolveVersePlan(plan, "PSA", "8", "1")).toEqual({
            action: "replace",
            bible: { book: "PSA", chapter: "8", verse: "1" },
        });
        expect(resolveVersePlan(plan, "PSA", "8", "2")).toEqual({
            action: "replace",
            bible: { book: "PSA", chapter: "8", verse: "2" },
        });
        expect(resolveVersePlan(plan, "PSA", "8", "3")?.action).toBe("remove");
        expect(resolveVersePlan(plan, "PSA", "9", "1")).toEqual({
            action: "replace",
            bible: { book: "PSA", chapter: "9", verse: "1" },
        });
        expect(resolveVersePlan(plan, "PSA", "9", "2")).toEqual({
            action: "replace",
            bible: { book: "PSA", chapter: "9", verse: "2" },
        });

        const inserts = plan.chapterInserts.get("PSA|9") ?? [];
        expect(inserts.map((r) => r.verse)).toEqual(["3"]);
        expect(plan.stats.versesMapped).toBe(4);
        expect(plan.stats.versesRemoved).toBe(1);
        expect(plan.stats.versesInserted).toBe(1);
    });

    it("ignores out-of-order chapter markers and aligns PSA 1 to PSA 1", () => {
        const study42 = Array.from({ length: 11 }, (_, i) =>
            psalmVerse("42", String(i + 1), `study-42-${i + 1}`, i === 0)
        ).join("");
        const bible42 = Array.from({ length: 11 }, (_, i) =>
            psalmVerse("42", String(i + 1), `bible-42-${i + 1}`, i === 0)
        ).join("");

        const studyXml = psalmStory(
            chapterMarker("42") +
                study42 +
                chapterMarker("1") +
                psalmVerse("1", "1", "study-1-1") +
                psalmVerse("1", "2", "study-1-2")
        );

        const bibleXml = psalmStory(
            chapterMarker("1") +
                psalmVerse("1", "1", "bible-1-1") +
                psalmVerse("1", "2", "bible-1-2") +
                chapterMarker("42") +
                bible42
        );

        const plan = buildVersificationPlan(studyXml, bibleXml);

        expect(resolveVersePlan(plan, "PSA", "1", "1")).toEqual({
            action: "replace",
            bible: { book: "PSA", chapter: "1", verse: "1" },
        });
        expect(resolveVersePlan(plan, "PSA", "1", "2")).toEqual({
            action: "replace",
            bible: { book: "PSA", chapter: "1", verse: "2" },
        });
    });

    it("detects Psalm chapter boundaries from head:cl labels without meta:c", () => {
        const studyXml = psalmStory(
            chapterMarker("23") +
                psalmVerse("23", "1", "study-shepherd", false) +
                psalmVerse("23", "2", "study-shepherd-2", false) +
                headChapterLabel("24") +
                psalmVerse("24", "1", "study-earth", false) +
                psalmVerse("24", "2", "study-earth-2", false)
        );
        const bibleXml = psalmStory(
            chapterMarker("23") +
                psalmVerse("23", "1", "bible-pastor", false) +
                chapterMarker("24") +
                psalmVerse("24", "1", "bible-terra", false) +
                psalmVerse("24", "2", "bible-terra-2", false)
        );

        const plan = buildVersificationPlan(studyXml, bibleXml);
        const bibleBlocks = buildBibleChapterBlockIndex(bibleXml);
        const { xml } = applyStructureSwapToStudyXml(studyXml, bibleBlocks, {
            bibleStoryXml: bibleXml,
            versificationPlan: plan,
        });

        expect(resolveVersePlan(plan, "PSA", "23", "1")?.bible).toEqual({
            book: "PSA",
            chapter: "23",
            verse: "1",
        });
        expect(resolveVersePlan(plan, "PSA", "24", "1")?.bible).toEqual({
            book: "PSA",
            chapter: "24",
            verse: "1",
        });
        expect(xml).toContain("bible-pastor");
        expect(xml).toContain("bible-terra");
        expect(xml).not.toContain("study-earth");
    });

    it("queues the translation's verses for a study chapter with no verses", () => {
        const studyXml = psalmStory(
            chapterMarker("23") +
                psalmVerse("23", "1", "study-23-1") +
                chapterMarker("24") +
                chapterMarker("25") +
                psalmVerse("25", "1", "study-25-1")
        );

        const bibleXml = psalmStory(
            chapterMarker("23") +
                psalmVerse("23", "1", "bible-23-1") +
                chapterMarker("24") +
                psalmVerse("24", "1", "bible-24-1") +
                psalmVerse("24", "2", "bible-24-2") +
                chapterMarker("25") +
                psalmVerse("25", "1", "bible-25-1")
        );

        const plan = buildVersificationPlan(studyXml, bibleXml);

        // Direct same-number model: chapter 24's verses (which the study lacks)
        // are recorded as inserts; no special insert-only structure block.
        expect((plan.chapterInserts.get("PSA|24") ?? []).map((r) => r.verse)).toEqual([
            "1",
            "2",
        ]);
        expect(resolveVersePlan(plan, "PSA", "23", "1")?.bible).toEqual({
            book: "PSA",
            chapter: "23",
            verse: "1",
        });
        expect(resolveVersePlan(plan, "PSA", "25", "1")?.bible).toEqual({
            book: "PSA",
            chapter: "25",
            verse: "1",
        });
    });

    it("applies the plan during surgical swap so study slots get Bible text", () => {
        const studyXml = psalmStory(
            chapterMarker("8") +
                psalmVerse("8", "1", "OLD-1") +
                psalmVerse("8", "2", "OLD-2") +
                chapterMarker("9") +
                psalmVerse("9", "1", "OLD-9-1")
        );

        const bibleXml = psalmStory(
            chapterMarker("8") +
                psalmVerse("8", "1", "PORT-8-1") +
                chapterMarker("9") +
                psalmVerse("9", "1", "PORT-9-1") +
                psalmVerse("9", "2", "PORT-9-2")
        );

        const plan = buildVersificationPlan(studyXml, bibleXml);
        const index = buildBibleVerseIndex(bibleXml);
        const { xml } = applySurgicalSwapToStudyXml(studyXml, index, {
            versificationPlan: plan,
        });

        expect(xml).toContain("PORT-8-1");
        expect(xml).toContain("PORT-9-1");
        expect(xml).toContain("PORT-9-2");
        expect(xml).not.toContain("OLD-1");
        expect(xml).not.toContain("OLD-9-1");
    });

    it("marks study-only verses for removal when Bible has fewer verses", () => {
        const studyXml = psalmStory(
            chapterMarker("1") +
                psalmVerse("1", "1", "s1") +
                psalmVerse("1", "2", "s2") +
                psalmVerse("1", "3", "s3")
        );
        const bibleXml = psalmStory(
            chapterMarker("1") + psalmVerse("1", "1", "b1")
        );

        const plan = buildVersificationPlan(studyXml, bibleXml);

        expect(resolveVersePlan(plan, "PSA", "1", "1")?.action).toBe("replace");
        expect(resolveVersePlan(plan, "PSA", "1", "2")?.action).toBe("remove");
        expect(resolveVersePlan(plan, "PSA", "1", "3")?.action).toBe("remove");
        expect(plan.stats.versesRemoved).toBe(2);
    });

    it("collects removed and inserted verses for the analysis UI", () => {
        const studyXml = psalmStory(
            chapterMarker("1") +
                psalmVerse("1", "1", "english-1") +
                psalmVerse("1", "2", "english-2")
        );
        const bibleXml = psalmStory(
            chapterMarker("1") +
                psalmVerse("1", "1", "port-1") +
                psalmVerse("1", "2", "port-2") +
                psalmVerse("1", "3", "port-3")
        );

        const studyIndex = buildBibleVerseIndex(studyXml);
        const bibleIndex = buildBibleVerseIndex(bibleXml);
        const plan = buildVersificationPlan(studyXml, bibleXml);
        const changes = collectVersificationChanges(plan, studyIndex, bibleIndex);

        expect(changes.removed).toHaveLength(0);
        expect(changes.inserted).toHaveLength(1);
        expect(changes.inserted[0].verse).toBe("3");
        expect(changes.redirected).toHaveLength(0);
    });

    it("uses 1:1 mapping for non-Psalm books", () => {
        const studyXml = `<?xml version="1.0"?><Story>${bookPara("JOB")}${chapterMarker("1")}${psalmVerse("1", "1", "study")}</Story>`;
        const bibleXml = `<?xml version="1.0"?><Story>${bookPara("JOB")}${chapterMarker("1")}${psalmVerse("1", "1", "bible")}</Story>`;

        const plan = buildVersificationPlan(studyXml, bibleXml);

        expect(plan.verseMap.get(verseKey("JOB", "1", "1"))).toEqual({
            action: "replace",
            bible: { book: "JOB", chapter: "1", verse: "1" },
        });
    });

    it("keeps the translation's numbered superscription as verse 1 (no offset)", () => {
        const studyXml = psalmStory(
            chapterMarker("2") +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3acl">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Psalm 2</Content></CharacterStyleRange>
</ParagraphStyleRange>` +
                psalmVerse("2", "1", "English v1.", false) +
                psalmVerse("2", "2", "English v2.", false)
        );
        const bibleXml = psalmStory(
            chapterMarker("2") +
                `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3ad_h">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>2:</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Russian subheader.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
</ParagraphStyleRange>` +
                psalmVerse("2", "2", "Russian v1.", false) +
                psalmVerse("2", "3", "Russian v2.", false)
        );

        const plan = buildVersificationPlan(studyXml, bibleXml);
        // Direct same-number mapping: study 2:1 → bible 2:1 (the superscription).
        expect(resolveVersePlan(plan, "PSA", "2", "1")).toEqual({
            action: "replace",
            bible: { book: "PSA", chapter: "2", verse: "1" },
        });
        const slices = bibleSlicesForStudyRange(plan, "PSA", "2", 1, 2);
        const bibleIndex = buildBibleChapterBlockIndex(bibleXml);
        const sliceXml = extractBibleXmlForSlices(bibleIndex, "PSA", slices);

        // The superscription (verse 1) travels with the chapter, not stripped.
        expect(sliceXml).toContain("Russian subheader.");
        expect(sliceXml).toContain("Russian v1.");

        const { xml } = applyStructureSwapToStudyXml(studyXml, bibleIndex, {
            bibleStoryXml: bibleXml,
            versificationPlan: plan,
        });
        expect(xml).toContain("Russian subheader.");
        expect(xml).toContain("Russian v1.");
        expect(xml).not.toContain("English v1.");
        // The opening chapter marker rode in on the superscription.
        expect(xml).toContain(`meta%3ac"><Content>2:</Content>`);
    });

    it("builds plan automatically in applyBibleSwap", () => {
        const studyXml = psalmStory(
            chapterMarker("1") + psalmVerse("1", "1", "OLD")
        );
        const bibleXml = psalmStory(
            chapterMarker("1") + psalmVerse("1", "1", "NEW")
        );

        const { xml } = applyBibleSwap(studyXml, bibleXml, "surgical");
        expect(xml).toContain("NEW");
        expect(xml).not.toContain("OLD");
    });
});
