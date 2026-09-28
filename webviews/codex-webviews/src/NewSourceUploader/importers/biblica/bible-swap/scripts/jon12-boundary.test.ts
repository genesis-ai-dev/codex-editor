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
} from "./boundaryTestHelpers";

describe("JON 1/2 p_dc1 boundary with poetry continuation", () => {
    it("preserves JON 2:2 poetry after boundary duplicate verse junction", () => {
        const study = bookStory(
            "JON",
            chapterVerse("1", "1", "English 1:1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("1", "17", "English 1:17.", "ParagraphStyle/text%3ap", false) +
                pDc1Boundary(
                    "1",
                    "17",
                    "English 1:17 tail.",
                    "2",
                    [
                        { verse: "1", text: "English 2:1." },
                        { verse: "2", text: "English 2:2 prose." },
                    ]
                ) +
                chapterVerse(
                    "2",
                    "2",
                    "English 2:2 poetry.",
                    "ParagraphStyle/text%3aq2",
                    false
                ) +
                chapterVerse("2", "3", "English 2:3.", "ParagraphStyle/text%3aq2", false)
        );

        const bible = bookStory(
            "JON",
            chapterVerse("1", "1", "Marathi 1:1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("1", "17", "Marathi 1:17.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "1", "Marathi 2:1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("2", "2", "Marathi 2:2 prose.", "ParagraphStyle/text%3ap", false) +
                chapterVerse(
                    "2",
                    "2",
                    "Marathi 2:2 poetry.",
                    "ParagraphStyle/text%3aq2",
                    false
                ) +
                chapterVerse("2", "3", "Marathi 2:3.", "ParagraphStyle/text%3aq2", false)
        );

        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("Marathi 2:2 prose.");
        expect(xml).toContain("Marathi 2:2 poetry.");
        expect(xml).toContain("Marathi 2:3.");
        expect(xml).not.toContain("English 2:2");
        expect(xml.split("Marathi 2:2 poetry.").length - 1).toBe(1);
    });
});
