import { describe, it, expect } from "vitest";
import { buildCompatVerseIndex, deserializeCompatVerseIndex, serializeCompatVerseIndex } from "../compatVerseIndex";
import { buildBibleVerseIndex, listVerseKeys } from "../surgicalSwap";

const NO_STYLE = "CharacterStyle/$ID/[No character style]";

function chapterVerse(
    chapter: string,
    verse: string,
    text: string,
    book = "JOB"
): string {
    const chMarker =
        verse === "1"
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

function jobStory(body: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>JOB</Content></CharacterStyleRange>
</ParagraphStyleRange>${body}`;
}

describe("compatVerseIndex", () => {
    it("matches verse keys from the full Bible index", () => {
        const story = jobStory(
            chapterVerse("1", "1", "v1") +
                chapterVerse("1", "2", "v2") +
                chapterVerse("40", "5", "v5")
        );
        const full = new Set(listVerseKeys(buildBibleVerseIndex(story)));
        const compat = buildCompatVerseIndex(story);
        const compatKeys = new Set<string>();
        for (const [book, verses] of compat.byBook.entries()) {
            for (const cv of verses) {
                const [chapter, verse] = cv.split("|");
                compatKeys.add(`${book}|${chapter}|${verse}`);
            }
        }
        expect(compatKeys).toEqual(full);
    });

    it("round-trips serialize/deserialize", () => {
        const story = jobStory(chapterVerse("3", "1", "one"));
        const index = buildCompatVerseIndex(story);
        const restored = deserializeCompatVerseIndex(serializeCompatVerseIndex(index));
        expect(restored.byBook.get("JOB")).toEqual(index.byBook.get("JOB"));
    });
});
