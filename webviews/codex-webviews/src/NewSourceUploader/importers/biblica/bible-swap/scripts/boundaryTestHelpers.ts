/** Shared XML builders for p_dc1 / p_dc2 boundary structure-swap tests. */

export const NO_STYLE = "CharacterStyle/$ID/[No character style]";

export function bookStory(book: string, body: string): string {
    return `<?xml version="1.0"?><Story>
<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abk">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${book}</Content></CharacterStyleRange>
</ParagraphStyleRange>${body}</Story>`;
}

export function introNote(text: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/intro%3aipi">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content></CharacterStyleRange>
</ParagraphStyleRange>`;
}

export function sectionHeading(text: string): string {
    return `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/head%3as1">
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content><Br /></CharacterStyleRange>
</ParagraphStyleRange>`;
}

export function chapterVerse(
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

/** Two-chapter boundary packed into one `p_dc1` paragraph (real study convention). */
export function pDc1Boundary(
    closeChapter: string,
    closeVerse: string,
    closeText: string,
    openChapter: string,
    openParts: Array<{ verse: string; text: string }>,
    paraStyle = "ParagraphStyle/text%3ap_dc1"
): string {
    const openMarkers = openParts
        .map(
            ({ verse, text }) =>
                `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${text}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${verse}</Content></CharacterStyleRange>`
        )
        .join("\n  ");
    return `<ParagraphStyleRange AppliedParagraphStyle="${paraStyle}">
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${closeChapter}:</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av"><Content>${closeVerse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${closeVerse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="${NO_STYLE}"><Content>${closeText}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>${closeVerse}</Content></CharacterStyleRange>
  <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${openChapter}:</Content></CharacterStyleRange>
  ${openMarkers}
</ParagraphStyleRange>`;
}
