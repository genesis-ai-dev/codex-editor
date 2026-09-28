import { describe, it, expect } from "vitest";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
} from "../index";
import {
    bookStory,
    chapterVerse,
    pDc1Boundary,
    sectionHeading,
} from "./boundaryTestHelpers";

describe("1SA 6/7 p_dc1 boundary", () => {
    it("preserves mid-verse heading across boundary and duplicate v2 junction", () => {
        const study = bookStory(
            "1SA",
            chapterVerse("6", "1", "English 6:1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("6", "21", "English 6:21.", "ParagraphStyle/text%3ap", false) +
                pDc1Boundary(
                    "6",
                    "21",
                    "English 6:21 tail.",
                    "7",
                    [
                        { verse: "1", text: "English 7:1." },
                        { verse: "2", text: "English 7:2 part one." },
                    ]
                ) +
                chapterVerse("7", "2", "English 7:2 part two.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("7", "3", "English 7:3.", "ParagraphStyle/text%3ap", false)
        );

        const bible = bookStory(
            "1SA",
            chapterVerse("6", "1", "Marathi 6:1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("6", "21", "Marathi 6:21.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("7", "1", "Marathi 7:1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("7", "2", "Marathi 7:2 part one.", "ParagraphStyle/text%3ap", false) +
                sectionHeading("Samuel at Mizpah") +
                chapterVerse("7", "2", "Marathi 7:2 part two.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("7", "3", "Marathi 7:3.", "ParagraphStyle/text%3ap", false)
        );

        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("Samuel at Mizpah");
        expect(xml).toContain("Marathi 7:2 part one.");
        expect(xml).toContain("Marathi 7:2 part two.");
        expect(xml).not.toContain("English 7:2");
        expect(xml.split("Marathi 7:2 part one.").length - 1).toBe(1);
    });
});
