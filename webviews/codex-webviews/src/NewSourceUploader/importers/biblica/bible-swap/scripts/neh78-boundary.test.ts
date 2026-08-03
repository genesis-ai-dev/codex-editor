import { describe, it, expect } from "vitest";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
} from "../index";
import {
    bookStory,
    chapterVerse,
    introNote,
    pDc1Boundary,
} from "./boundaryTestHelpers";

describe("NEH 7/8 p_dc1 boundary with intro splits", () => {
    it("does not bleed census into NEH 8 after boundary coalesce", () => {
        const study = bookStory(
            "NEH",
            chapterVerse("7", "1", "English census v1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("7", "2", "English census v2.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("7", "3", "English census v3.", "ParagraphStyle/text%3ap", false) +
                introNote("Nehemiah 7 study note.") +
                chapterVerse("7", "4", "English census v4.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("7", "73", "English census v73.", "ParagraphStyle/text%3ap", false) +
                pDc1Boundary(
                    "7",
                    "73",
                    "English census v73 tail.",
                    "8",
                    [{ verse: "1", text: "English law v1." }]
                ) +
                chapterVerse("8", "2", "English law v2.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "3", "English law v3.", "ParagraphStyle/text%3ap", false) +
                introNote("Nehemiah 8 study note.") +
                chapterVerse("8", "4", "English law v4.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("8", "6", "English law v6.", "ParagraphStyle/text%3ap", false)
        );

        const bible = bookStory(
            "NEH",
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

        expect(xml).toContain("Nehemiah 7 study note.");
        expect(xml).toContain("Nehemiah 8 study note.");
        expect(xml).toContain("Census line four.");
        expect(xml).toContain("Law line four.");
        expect(xml).toContain("Law line six.");
        expect(xml).not.toContain("English census");
        expect(xml).not.toContain("English law");

        const lawFourPos = xml.indexOf("Law line four.");
        const censusFourPos = xml.indexOf("Census line four.");
        expect(lawFourPos).toBeGreaterThan(censusFourPos);
        expect(xml.slice(lawFourPos)).not.toContain("Census line four.");
        const census73Pos = xml.indexOf("Census line seventy-three.");
        expect(census73Pos).toBeGreaterThan(0);
        expect(census73Pos).toBeLessThan(lawFourPos);
    });
});
