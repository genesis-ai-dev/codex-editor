import { describe, it, expect } from "vitest";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
} from "../index";

const NO_STYLE = "CharacterStyle/$ID/[No character style]";

const csr = (style: string, content: string) =>
    `<CharacterStyleRange AppliedCharacterStyle="${style}"><Content>${content}</Content></CharacterStyleRange>`;

const bookMarker = () =>
    `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">${csr(NO_STYLE, "PSA")}</ParagraphStyleRange>`;

const label = (n: number) =>
    `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3acl">${csr(NO_STYLE, `Psalm ${n}`)}</ParagraphStyleRange>`;

const engSubheader = (text: string) =>
    `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3ad_h">${csr(NO_STYLE, text)}</ParagraphStyleRange>`;

/** A normal numbered verse paragraph; verse 1 may carry the opening chapter marker. */
function verse(ch: string, v: number, text: string, withChapter = false): string {
    const chapterMarker = withChapter ? csr("CharacterStyle/meta%3ac", `${ch}:`) : "";
    return (
        `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3aq1">` +
        csr("CharacterStyle/cv%3av", String(v)) +
        chapterMarker +
        csr("CharacterStyle/meta%3av", String(v)) +
        csr(NO_STYLE, text) +
        csr("CharacterStyle/meta%3av", String(v)) +
        `</ParagraphStyleRange>`
    );
}

/** Translated superscription paragraph: numbered as verse 1, carries the chapter marker. */
function superscriptionV1(ch: string, text: string): string {
    return (
        `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3ad_h">` +
        csr("CharacterStyle/cv%3av", "1") +
        csr("CharacterStyle/meta%3ac", `${ch}:`) +
        csr("CharacterStyle/meta%3av", "1") +
        csr(NO_STYLE, text) +
        csr("CharacterStyle/meta%3av", "1") +
        `</ParagraphStyleRange>`
    );
}

function story(body: string): string {
    return `<?xml version="1.0"?><Story>${bookMarker()}${body}</Story>`;
}

function range(from: number, to: number): number[] {
    const out: number[] = [];
    for (let v = from; v <= to; v++) out.push(v);
    return out;
}

function verseNumbersInChapterRegion(xml: string, chapter: number): number[] {
    const start = xml.indexOf(`Psalm ${chapter}`);
    if (start < 0) return [];
    // End at the next "Psalm M" label (any), else end of doc.
    const next = xml.slice(start + 1).search(/Psalm \d+/);
    const end = next < 0 ? xml.length : start + 1 + next;
    const region = xml.slice(start, end);
    const nums = [
        ...region.matchAll(/meta%3av"><Content>(\d+)<\/Content>/g),
    ].map((m) => Number(m[1]));
    return [...new Set(nums)].sort((a, b) => a - b);
}

describe("Psalm direct same-number swap", () => {
    it("appends the translation's extra verses when it is longer", () => {
        const study = story(
            label(1) + range(1, 20).map((v) => verse("1", v, `EN 1:${v}`, v === 1)).join("")
        );
        const bible = story(
            label(1) + range(1, 22).map((v) => verse("1", v, `RU 1:${v}`, v === 1)).join("")
        );
        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(verseNumbersInChapterRegion(xml, 1)).toEqual(range(1, 22));
        expect(xml).toContain("RU 1:1");
        expect(xml).toContain("RU 1:22");
        expect(xml).not.toContain("EN 1:1");
    });

    it("removes study verses the translation lacks when it is shorter", () => {
        const study = story(
            label(2) + range(1, 8).map((v) => verse("2", v, `EN 2:${v}`, v === 1)).join("")
        );
        const bible = story(
            label(2) + range(1, 6).map((v) => verse("2", v, `RU 2:${v}`, v === 1)).join("")
        );
        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(verseNumbersInChapterRegion(xml, 2)).toEqual(range(1, 6));
        expect(xml).toContain("RU 2:6");
        expect(xml).not.toContain("EN 2:7");
        expect(xml).not.toContain("EN 2:8");
    });

    it("keeps the translation's verse-1 superscription and opening chapter marker", () => {
        const study = story(
            label(3) +
                engSubheader("A psalm of David.") +
                range(1, 8).map((v) => verse("3", v, `EN 3:${v}`, v === 1)).join("")
        );
        // Translated: superscription numbered v1, content verses 2..9.
        const bible = story(
            label(3) +
                superscriptionV1("3", "Russian superscription.") +
                range(2, 9).map((v) => verse("3", v, `RU 3:${v}`)).join("")
        );
        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        // Translated numbering preserved: verse 1 (superscription) .. verse 9.
        expect(verseNumbersInChapterRegion(xml, 3)).toEqual(range(1, 9));
        expect(xml).toContain("Russian superscription.");
        expect(xml).toContain("RU 3:9");
        expect(xml).not.toContain("EN 3:2");

        // The opening chapter marker survives (it rode in on the superscription).
        const region = xml.slice(xml.indexOf("Psalm 3"));
        const firstChapter = region.search(/meta%3ac"><Content>3:<\/Content>/);
        const firstVerse = region.search(/meta%3av"><Content>\d+<\/Content>/);
        expect(firstChapter).toBeGreaterThanOrEqual(0);
        expect(firstChapter).toBeLessThan(firstVerse);
    });
});
