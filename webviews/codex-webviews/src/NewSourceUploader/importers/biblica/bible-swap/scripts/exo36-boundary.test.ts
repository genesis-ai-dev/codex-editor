import { describe, it, expect } from "vitest";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
} from "../index";
import {
    buildChapterSpanIndex,
    injectMetaChapterMarkerIfMissing,
} from "../chapterBlocks";
import { buildBibleVerseIndex } from "../surgicalSwap";
import { mergeDuplicateVerseJunctionSpans, normalizeOverlappingSplices } from "../structureSwap";
import { bookStory, chapterVerse, pDc1Boundary } from "./boundaryTestHelpers";

const NO_STYLE = "CharacterStyle/$ID/[No character style]";

function exoStory(body: string): string {
    return `<?xml version="1.0"?><Story>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>EXO</Content></CharacterStyleRange>
</ParagraphStyleRange>${body}</Story>`;
}

function chapterVerse(
    chapter: string,
    verse: string,
    text: string,
    paraStyle = "ParagraphStyle/text%3ap",
    includeChapterMarker = verse === "1",
    chapterMarkerText = `${chapter}:`
): string {
    const chMarker = includeChapterMarker
        ? `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapterMarkerText}</Content></CharacterStyleRange>`
        : "";
    return `<ParagraphStyleRange AppliedParagraphStyle="${paraStyle}">
  ${chMarker}
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

/**
 * Real GEN-DEU packs the 35->36 transition into `p_dc2` with a leading
 * `cv:dc` chapter digit, an ACE anchor, the 35:35 tail, then 36:1.
 */
function genDeuDc2Boundary(): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap_dc2">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3adc"><Content>36</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3adc_sp"><Content> </Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content><?ACE 3?>skill to work in all kinds of crafts.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>35:</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>35</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content> </Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av_sp"><Content> </Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>36:</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>Bezalel and Oholiab must do the work.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function studyExodusGenDeuBoundary(): string {
    return exoStory(
        chapterVerse("35", "1", "English 35:1.") +
            chapterVerse("35", "34", "English 35:34.", "ParagraphStyle/text%3ap", false) +
            chapterVerse("35", "35", "English 35:35a.", "ParagraphStyle/text%3ap", false) +
            genDeuDc2Boundary() +
            chapterVerse("36", "2", "English 36:2.", "ParagraphStyle/text%3ap", false) +
            chapterVerse("36", "8", "English 36:8.", "ParagraphStyle/text%3ap", false)
    );
}

function dc2Boundary(): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap_dc2">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>35:</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>35</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>35</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>and skill to work in all kinds of crafts.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>35</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>36:</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>So Bezalel, Oholiab and every skilled person are to do the work.</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

function studyExodus(): string {
    return exoStory(
        chapterVerse("35", "1", "English 35:1.") +
            chapterVerse("35", "2", "English 35:2.", "ParagraphStyle/text%3ap", false) +
            dc2Boundary() +
            chapterVerse("36", "2", "English 36:2.", "ParagraphStyle/text%3ap", false) +
            chapterVerse("36", "8", "English 36:8.", "ParagraphStyle/text%3ap", false)
    );
}

function bibleVerse(
    chapter: string,
    verse: string,
    text: string,
    includeChapterMarker = verse === "1"
): string {
    return chapterVerse(
        chapter,
        verse,
        text,
        "ParagraphStyle/text%3ap",
        includeChapterMarker,
        `${chapter}.`
    );
}

// Translated Bible uses period-format chapter markers (e.g. "36.") and clean,
// separate chapter starts — never the study's combined dc2 paragraph.
function bibleExodus(): string {
    return exoStory(
        bibleVerse("35", "1", "PT 35:1.") +
            bibleVerse("35", "2", "PT 35:2.", false) +
            bibleVerse("35", "35", "PT 35:35.", false) +
            bibleVerse("36", "1", "PT 36:1.") +
            bibleVerse("36", "2", "PT 36:2.", false) +
            bibleVerse("36", "8", "PT 36:8.", false)
    );
}

function studyExodusWithExtra353637(): string {
    return exoStory(
        chapterVerse("35", "1", "English 35:1.") +
            chapterVerse("35", "2", "English 35:2.", "ParagraphStyle/text%3ap", false) +
            chapterVerse("35", "34", "English 35:34.", "ParagraphStyle/text%3ap", false) +
            dc2Boundary() +
            chapterVerse("36", "2", "English 36:2.", "ParagraphStyle/text%3ap", false) +
            chapterVerse("36", "3", "English 36:3.", "ParagraphStyle/text%3ap", false) +
            chapterVerse("36", "8", "English 36:8.", "ParagraphStyle/text%3ap", false)
    );
}

function bibleExodusWithExtra353637(): string {
    return exoStory(
        bibleVerse("35", "1", "PT 35:1.") +
            bibleVerse("35", "2", "PT 35:2.", false) +
            bibleVerse("35", "34", "PT 35:34.", false) +
            bibleVerse("35", "35", "PT 35:35.", false) +
            bibleVerse("35", "36", "PT 35:36.", false) +
            bibleVerse("35", "37", "PT 35:37.", false) +
            bibleVerse("36", "1", "PT 36:1.") +
            bibleVerse("36", "2", "PT 36:2.", false) +
            bibleVerse("36", "3", "PT 36:3.", false) +
            bibleVerse("36", "8", "PT 36:8.", false)
    );
}

const BIBLE_FIXTURE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Portuguese Full Bible/01GEN-05DEU_portuguese.idml";

async function loadFixtureStory(path: string): Promise<string | null> {
    if (typeof process === "undefined") return null;
    try {
        const fs = await import("fs");
        const JSZip = (await import("jszip")).default;
        if (!fs.existsSync(path)) return null;
        const zip = await JSZip.loadAsync(fs.readFileSync(path));
        let best = "";
        for (const name of Object.keys(zip.files)) {
            if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
            const t = await zip.file(name)!.async("string");
            if (t.length > best.length) best = t;
        }
        return best || null;
    } catch {
        return null;
    }
}

describe("exodus 36 chapter boundary", () => {
    it("splits the dc2 boundary paragraph into EXO|35 and EXO|36 spans", () => {
        const spans = buildChapterSpanIndex(studyExodus());

        const ch35 = spans.get("EXO|35");
        expect(ch35).toBeDefined();
        expect(ch35!.length).toBeGreaterThan(0);
        // Chapter 35's last span must still own the 35:35 tail fragment.
        expect(ch35![ch35!.length - 1].lastVerse).toBe(35);

        const ch36 = spans.get("EXO|36");
        expect(ch36).toBeDefined();
        expect(ch36!.length).toBeGreaterThan(0);
        // Chapter 36 must START at verse 1, not be swallowed into chapter 35.
        expect(ch36![0].firstVerse).toBe(1);
    });

    it("keys 36:1 to chapter 36 in the verse index (walkStory transition)", () => {
        const index = buildBibleVerseIndex(studyExodus());
        expect(index.has("EXO|36|1")).toBe(true);
        // The 35:35 fragment before the 36 marker stays in chapter 35.
        expect(index.has("EXO|35|35")).toBe(true);
        // It must NOT have been mis-keyed as 35:1 (the old first-marker bug).
        expect(index.has("EXO|35|1")).toBe(true);
    });

    it("structure-swaps Exodus 36 starting at verse 1 with its chapter marker", () => {
        const study = studyExodus();
        const bible = bibleExodus();
        const plan = buildVersificationPlan(study, bible);

        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("PT 36:1.");
        expect(xml).toContain("PT 36:8.");
        // The chapter-36 marker must survive the swap.
        expect(xml).toContain("36.");

        // 36:1 must appear once, in order, before 36:8.
        expect(xml.split("PT 36:1.").length - 1).toBe(1);
        const pos1 = xml.indexOf("PT 36:1.");
        const pos8 = xml.indexOf("PT 36:8.");
        const posMarker = xml.indexOf(">36.<");
        expect(pos1).toBeGreaterThan(0);
        expect(pos1).toBeLessThan(pos8);
        // The chapter-36 marker precedes 36:1.
        expect(posMarker).toBeGreaterThan(0);
        expect(posMarker).toBeLessThan(pos1);

        // English study verses for chapter 36 are gone.
        expect(xml).not.toContain("English 36:2.");
    });

    it("structure-swaps Exodus 36 with p_dc1 boundary paragraph style", () => {
        const study = exoStory(
            chapterVerse("35", "1", "English 35:1.") +
                chapterVerse("35", "2", "English 35:2.", "ParagraphStyle/text%3ap", false) +
                pDc1Boundary(
                    "35",
                    "35",
                    "and skill to work in all kinds of crafts.",
                    "36",
                    [{ verse: "1", text: "So Bezalel, Oholiab and every skilled person are to do the work." }]
                ) +
                chapterVerse("36", "2", "English 36:2.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("36", "8", "English 36:8.", "ParagraphStyle/text%3ap", false)
        );
        const bible = bibleExodus();
        const plan = buildVersificationPlan(study, bible);

        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("PT 36:1.");
        expect(xml).toContain("PT 36:8.");
        expect(xml).not.toContain("English 36:2.");
    });

    it("appends bible-only 35:36-37 and still swaps all of chapter 36", () => {
        const study = studyExodusWithExtra353637();
        const bible = bibleExodusWithExtra353637();
        const plan = buildVersificationPlan(study, bible);

        expect((plan.chapterInserts.get("EXO|35") ?? []).map((r) => r.verse)).toEqual([
            "36",
            "37",
        ]);

        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("PT 35:36.");
        expect(xml).toContain("PT 35:37.");
        expect(xml).toContain("PT 36:1.");
        expect(xml).toContain("PT 36:2.");
        expect(xml).toContain("PT 36:3.");
        expect(xml).toContain("PT 36:8.");
        expect(xml).not.toContain("English 36:2.");
        expect(xml).not.toContain("English 36:3.");

        const pos3536 = xml.indexOf("PT 35:36.");
        const pos3537 = xml.indexOf("PT 35:37.");
        const pos361 = xml.indexOf("PT 36:1.");
        const pos362 = xml.indexOf("PT 36:2.");
        expect(pos3536).toBeGreaterThan(0);
        expect(pos3537).toBeGreaterThan(pos3536);
        expect(pos361).toBeGreaterThan(pos3537);
        expect(pos362).toBeGreaterThan(pos361);
    });

    it("does not merge a duplicate-35 junction into a p_dc2 boundary span", () => {
        const study = exoStory(
            chapterVerse("35", "34", "English 35:34.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("35", "35", "English 35:35a.", "ParagraphStyle/text%3ap", false) +
                dc2Boundary() +
                chapterVerse("36", "2", "English 36:2.", "ParagraphStyle/text%3ap", false)
        );
        const spans = buildChapterSpanIndex(study).get("EXO|35") ?? [];
        expect(spans.length).toBeGreaterThan(1);
        const boundary = spans[spans.length - 1];
        const merged = mergeDuplicateVerseJunctionSpans(spans, study);
        expect(merged.some((s) => s.absStart === boundary.absStart)).toBe(true);
        expect(merged.some((s) => s.absStart < boundary.absStart && s.absEnd > boundary.absEnd)).toBe(
            false
        );
    });

    it("injects meta:c after cv:dc when Portuguese bible omits chapter meta marker", () => {
        const slice =
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap_dc2">` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3adc"><Content>36</Content></CharacterStyleRange>` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3adc_sp"><Content> </Content></CharacterStyleRange>` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>` +
            `</ParagraphStyleRange>`;
        const out = injectMetaChapterMarkerIfMissing(slice, "36");
        expect(out).toContain('meta%3ac"><Content>36.</Content>');
    });

    it("structure-swaps GEN-DEU boundary against real Portuguese bible XML", async () => {
        const bible = await loadFixtureStory(BIBLE_FIXTURE);
        if (!bible) return;

        const blocks = buildBibleChapterBlockIndex(bible);
        const study = studyExodusGenDeuBoundary();
        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            blocks,
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        const index = buildBibleVerseIndex(xml);
        expect(index.has("EXO|36|1")).toBe(true);
        expect(index.has("EXO|36|2")).toBe(true);
        expect(index.has("EXO|36|8")).toBe(true);
        expect(xml).toContain("Beza");
        expect(xml).not.toContain("English 36:2.");
    });

    it("structure-swaps GEN-DEU dc2 boundary with cv:dc prefix and duplicate-35 junction", () => {
        const study = studyExodusGenDeuBoundary();
        const bible = bibleExodus();
        const plan = buildVersificationPlan(study, bible);

        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        const index = buildBibleVerseIndex(xml);
        expect(index.has("EXO|36|1")).toBe(true);
        expect(index.has("EXO|36|2")).toBe(true);
        expect(index.has("EXO|36|8")).toBe(true);
        expect(xml).toContain("PT 36:1.");
        expect(xml).not.toContain("English 36:2.");
    });

    it("keeps the next-chapter boundary splice when a prior span overlaps it", () => {
        const out = normalizeOverlappingSplices([
            {
                absStart: 100,
                absEnd: 500,
                replacement: "ch35",
                studyChapter: "35",
            },
            {
                absStart: 400,
                absEnd: 500,
                replacement: "ch36open",
                studyChapter: "36",
            },
        ]);
        expect(out).toHaveLength(2);
        expect(out[0].absEnd).toBe(400);
        expect(out[1].replacement).toBe("ch36open");
    });
});
