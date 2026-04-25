/**
 * Utilities for converting ASCII digits (0-9) into their Unicode
 * superscript equivalents.
 *
 * Used by the cell editor's superscript toolbar button to support
 * languages like Saurashtra, where a superscript digit following a
 * consonant marks a phonetic distinction (e.g. தா²டும்).
 *
 * We deliberately use the Unicode characters rather than <sup> HTML
 * tags so the superscript survives any plain-text export, copy/paste,
 * or downstream processing without special handling.
 */

export const SUPERSCRIPT_DIGIT_MAP: Record<string, string> = {
    "0": "\u2070",
    "1": "\u00B9",
    "2": "\u00B2",
    "3": "\u00B3",
    "4": "\u2074",
    "5": "\u2075",
    "6": "\u2076",
    "7": "\u2077",
    "8": "\u2078",
    "9": "\u2079",
};

export const SUPERSCRIPT_DIGITS = new Set(Object.values(SUPERSCRIPT_DIGIT_MAP));

export const isSuperscriptibleDigit = (ch: string): boolean =>
    ch.length === 1 && ch >= "0" && ch <= "9";

export const isSuperscriptDigit = (ch: string): boolean =>
    ch.length === 1 && SUPERSCRIPT_DIGITS.has(ch);

export const toSuperscriptDigit = (digit: string): string =>
    SUPERSCRIPT_DIGIT_MAP[digit] ?? digit;

export const toSuperscriptDigits = (text: string): string =>
    text.replace(/[0-9]/g, (d) => SUPERSCRIPT_DIGIT_MAP[d]);

/**
 * For styling in the editor: ¹ ² ³ (Latin-1 Supplement) and ⁰ ⁴–⁹ (Unicode
 * “Superscripts and Subscripts” block) are drawn with inconsistent metrics in
 * most UI fonts, so we tag them for separate CSS. Returns null for any other
 * character.
 */
export function superscriptFontGroup(ch: string): "lat" | "phon" | null {
    if (ch.length !== 1) {
        return null;
    }
    if (ch === "\u00B9" || ch === "\u00B2" || ch === "\u00B3") {
        return "lat";
    }
    if (ch === "\u2070" || (ch >= "\u2074" && ch <= "\u2079")) {
        return "phon";
    }
    return null;
}
