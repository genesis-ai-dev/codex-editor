/**
 * Psalm versification helpers for Bible Swap.
 *
 * Study Bibles (English NIRV) keep superscriptions in `head:d_h` paragraphs
 * without verse markers. Many Bible translations (French, Russian, etc.)
 * encode the same text as verse 1 with `head:d_h` styling inside meta:v
 * brackets. Portuguese typically has no subheader offset.
 *
 * See BIBLE_TEXT_REPLACEMENT_APPROACH.md sections 4.1 and 5.2–5.4.
 */

export const PSA_BOOK_CODE = "PSA";

export type PsalmVerseKey = `${string}|${string}|${string}`;

export interface PsalmVerseEntry {
    text: string;
    isSubheader: boolean;
}

export type PsalmVerseIndex = Map<PsalmVerseKey, PsalmVerseEntry>;

function psalmVerseKey(book: string, chapter: string, verse: string): PsalmVerseKey {
    return `${book}|${chapter}|${verse}` as PsalmVerseKey;
}

/**
 * Paragraph styles used for superscriptions: `head:d`, plus the `_h` heading
 * variant and the `_dc1`/`_dc2` chapter-boundary variants (the study puts
 * HAB 3:1 in `head:d_dc1`, the Bible in `title:d_h_dc1`).
 */
export function isPsalmSubheaderParagraphStyle(style: string): boolean {
    const normalized = style
        .replace(/^ParagraphStyle\//, "")
        .replace(/%3a/g, ":")
        .replace(/%5B/g, "[")
        .replace(/%5D/g, "]");
    return /(?:^|\/)head:d(?:$|[_/])/.test(normalized);
}

export function biblePsalmChapterHasSubheaderV1(
    index: PsalmVerseIndex,
    chapter: string
): boolean {
    return index.get(psalmVerseKey(PSA_BOOK_CODE, chapter, "1"))?.isSubheader ?? false;
}

/**
 * Map a Study Psalm verse number to the matching Bible verse key.
 * When the Bible chapter opens with a subheader verse 1, study vN maps to
 * bible v(N+1) so English superscriptions in head:d_h (no verse markers)
 * stay untouched while content replaces from study verse 1 onward.
 */
export function resolveBibleKeyForStudyVerse(
    book: string,
    chapter: string,
    studyVerse: string,
    index: PsalmVerseIndex,
    bibleHasSubheaderV1: boolean
): PsalmVerseKey | undefined {
    if (book !== PSA_BOOK_CODE) {
        const key = psalmVerseKey(book, chapter, studyVerse);
        return index.has(key) ? key : undefined;
    }

    const studyNum = parseInt(studyVerse, 10);
    if (!Number.isFinite(studyNum)) return undefined;

    const bibleNum = studyNum + (bibleHasSubheaderV1 ? 1 : 0);
    const key = psalmVerseKey(book, chapter, String(bibleNum));
    const entry = index.get(key);
    if (!entry || entry.isSubheader) return undefined;
    return key;
}

/** Sorted verse numbers present in the index for one chapter. */
export function listChapterVerseNumbers(
    index: PsalmVerseIndex,
    book: string,
    chapter: string
): string[] {
    const verses: string[] = [];
    for (const key of index.keys()) {
        const [b, c, v] = key.split("|");
        if (b === book && c === chapter) verses.push(v);
    }
    verses.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    return verses;
}

/** Content verses only (excludes Bible subheader slot at v1). */
export function listChapterContentVerseNumbers(
    index: PsalmVerseIndex,
    book: string,
    chapter: string
): string[] {
    return listChapterVerseNumbers(index, book, chapter).filter((v) => {
        const entry = index.get(psalmVerseKey(book, chapter, v));
        return entry && !entry.isSubheader;
    });
}

/**
 * Thin-space / nbsp used after visible verse numbers (`cv:v_sp`).
 * Falls back to thin space when the study file has no sample.
 */
export function detectVerseSpacingChar(storyXml: string): string {
    const match = storyXml.match(
        /AppliedCharacterStyle="CharacterStyle\/cv%3av_sp"[^>]*>[\s\S]*?<Content>([\s\S]*?)<\/Content>/
    );
    if (match && match[1]) return match[1];
    return "\u2009";
}

function escapeXml(s: string): string {
    return (s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function defaultPsalmParagraphStyle(paraStyle: string): string {
    if (paraStyle && /text%3a/.test(paraStyle)) return paraStyle;
    return "ParagraphStyle/text%3aq1";
}

/**
 * Build a self-contained ParagraphStyleRange for an extra Psalm verse
 * inserted at the end of a chapter (French/Russian subheader offset cases).
 */
export function buildInsertedVersePsrXml(
    verseNum: string,
    entry: PsalmVerseEntry,
    paraStyle: string,
    verseSpacingChar: string
): string {
    const style = defaultPsalmParagraphStyle(paraStyle);
    const text = escapeXml(entry.text);
    const sp = escapeXml(verseSpacingChar);

    return (
        `<ParagraphStyleRange AppliedParagraphStyle="${style}">` +
        `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av">` +
        `<Content>${verseNum}</Content></CharacterStyleRange>` +
        `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/cv%3av_sp">` +
        `<Content>${sp}</Content></CharacterStyleRange>` +
        `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">` +
        `<Content>${verseNum}</Content></CharacterStyleRange>` +
        `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">` +
        `<Content>${text}</Content></CharacterStyleRange>` +
        `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av">` +
        `<Content>${verseNum}</Content></CharacterStyleRange>` +
        `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">` +
        `<Br /></CharacterStyleRange>` +
        `</ParagraphStyleRange>`
    );
}
