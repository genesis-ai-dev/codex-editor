/**
 * Character fixes applied to Bible text before it is spliced into a study Bible.
 *
 * The two documents are typeset with different fonts, so a codepoint that is
 * ordinary in the Bible can be missing from the study Bible's fonts and print
 * as a hollow box.
 */

/** Quotation dash (U+2015). Portuguese Bibles open dialogue with it. */
const QUOTATION_DASH = "\u2015";

/** Em dash (U+2014), the study Bible's own long dash. */
const EM_DASH = "\u2014";

const CONTENT_ELEMENT = /<Content>([\s\S]*?)<\/Content>/g;

/**
 * Swap the Bible's quotation dash for the em dash.
 *
 * The English study Bibles never use U+2015 — they set every long dash as
 * U+2013 or U+2014 — so their fonts were never exercised on that glyph and it
 * falls back to a hollow box. The Portuguese Bibles use it heavily for dialogue
 * (around 5,200 occurrences across the six volumes), and every one of them
 * reaches the export through the swap. U+2014 is the conventional codepoint for
 * the Portuguese travessão and is already in use on both sides, so the dash
 * reads the same and prints.
 *
 * Only `<Content>` text is touched, never markup or style names.
 */
export function normalizeBibleStoryXmlGlyphs(bibleStoryXml: string): string {
    if (!bibleStoryXml.includes(QUOTATION_DASH)) {
        return bibleStoryXml;
    }
    return bibleStoryXml.replace(CONTENT_ELEMENT, (match, text: string) =>
        text.includes(QUOTATION_DASH)
            ? `<Content>${text.split(QUOTATION_DASH).join(EM_DASH)}</Content>`
            : match
    );
}
