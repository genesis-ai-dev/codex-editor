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

describe("HAG 2 intro splits with cross-chapter opener", () => {
    it("replaces HAG 2:12-14 inside the post-intro span", () => {
        const study = bookStory(
            "HAG",
            chapterVerse("1", "15", "English 1:15.", "ParagraphStyle/text%3ap", true) +
                pDc1Boundary(
                    "1",
                    "15",
                    "English 1:15 tail.",
                    "2",
                    [
                        { verse: "1", text: "English 2:1." },
                        { verse: "5", text: "English 2:5." },
                    ]
                ) +
                introNote("Haggai 2:1-9 note.") +
                chapterVerse("2", "6", "English 2:6.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "9", "English 2:9.", "ParagraphStyle/text%3ap", false) +
                introNote("Haggai 2:10-19 note.") +
                chapterVerse("2", "10", "English 2:10.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "12", "English 2:12.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "13", "English 2:13.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "14", "English 2:14.", "ParagraphStyle/text%3ap", false) +
                introNote("Haggai 2:20-23 note.") +
                chapterVerse("2", "20", "English 2:20.", "ParagraphStyle/text%3ap", false)
        );

        const bible = bookStory(
            "HAG",
            chapterVerse("1", "15", "Law 1:15.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("2", "1", "Law 2:1.", "ParagraphStyle/text%3ap", true) +
                chapterVerse("2", "5", "Law 2:5.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "6", "Law 2:6.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "9", "Law 2:9.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "10", "Law 2:10.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "12", "Law 2:12 target.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "13", "Law 2:13 target.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "14", "Law 2:14 target.", "ParagraphStyle/text%3ap", false) +
                chapterVerse("2", "20", "Law 2:20.", "ParagraphStyle/text%3ap", false)
        );

        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).toContain("Haggai 2:1-9 note.");
        expect(xml).toContain("Haggai 2:10-19 note.");
        expect(xml).toContain("Haggai 2:20-23 note.");
        expect(xml).toContain("Law 2:12 target.");
        expect(xml).toContain("Law 2:13 target.");
        expect(xml).toContain("Law 2:14 target.");
        expect(xml).not.toContain("English 2:12.");
        expect(xml).not.toContain("English 2:14.");
    });
});
