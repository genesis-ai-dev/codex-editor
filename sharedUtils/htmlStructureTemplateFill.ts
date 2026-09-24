/**
 * Last-resort structure repair: rebuild a translation inside the source's own tags.
 *
 * The deterministic fixes in `htmlStructureUtils` only reshape the translation's
 * existing wrappers, so they give up whenever the source is a multi-slot IDML
 * paragraph and the translation is a single flat run (the common result of
 * migrating pre-rewrite Biblica notes). This module inverts the problem: it takes
 * the source HTML as a literal template, emits every source tag verbatim, and
 * only substitutes the text inside. A structure match is therefore guaranteed by
 * construction rather than attempted and verified.
 *
 * Two invariants hold for every value this returns:
 * - the tag skeleton equals the source's, and
 * - the translation's text is preserved in full and in order (slots are filled by
 *   slicing the translation, never by rewriting it).
 *
 * Where the translation is split across slots is best-effort. Slots are aligned by
 * IDML segment index when the translation still carries them, then by anchors that
 * survive translation (scripture references, chapter ranges, and the punctuation a
 * slot ends with), and only then by proportional length.
 */

import {
    compareHtmlStructure,
    extractPlainTextFromHtml,
    type HtmlStructureOptions,
} from "./htmlStructureUtils";

type Token =
    | { kind: "tag"; raw: string; }
    | { kind: "text"; raw: string; };

/** A text position inside the source template that can receive translated text. */
interface TemplateSlot {
    /** Index into the token list. */
    tokenIndex: number;
    /** The source text this slot holds, used for anchoring and proportioning. */
    sourceText: string;
    /** IDML segment index of the enclosing span, when present. */
    segmentIndex: number | null;
}

export type TemplateFillStrategy = "segmentIndex" | "anchored" | "singleSlot";

export interface TemplateFillResult {
    html: string;
    strategy: TemplateFillStrategy;
    /** Number of template slots that received text. */
    slotsFilled: number;
    slotsTotal: number;
}

const SOFT_HYPHEN = /\u00ad/g;

const tokenizeHtml = (html: string): Token[] => {
    const tokens: Token[] = [];
    const tagPattern = /<[^>]*>/g;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(html)) !== null) {
        if (match.index > cursor) {
            tokens.push({ kind: "text", raw: html.slice(cursor, match.index) });
        }
        tokens.push({ kind: "tag", raw: match[0] });
        cursor = match.index + match[0].length;
    }
    if (cursor < html.length) {
        tokens.push({ kind: "text", raw: html.slice(cursor) });
    }
    return tokens;
};

const escapeHtmlText = (text: string): string =>
    text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

const readSegmentIndex = (tag: string): number | null => {
    const match = tag.match(/\bdata-segment-index="(\d+)"/);
    return match ? Number(match[1]) : null;
};

const isClosingTag = (tag: string): boolean => tag.startsWith("</");

/**
 * Text tokens that carry actual content. Whitespace-only tokens are layout and
 * are emitted unchanged, so they never consume translated text.
 */
const collectSlots = (tokens: Token[]): TemplateSlot[] => {
    const slots: TemplateSlot[] = [];
    const openSegmentIndexes: Array<number | null> = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.kind === "tag") {
            if (isClosingTag(token.raw)) {
                openSegmentIndexes.pop();
            } else if (!token.raw.endsWith("/>")) {
                openSegmentIndexes.push(readSegmentIndex(token.raw));
            }
            continue;
        }
        if (!token.raw.trim()) continue;
        const enclosing = [...openSegmentIndexes].reverse().find((value) => value !== null);
        slots.push({
            tokenIndex: i,
            sourceText: token.raw,
            segmentIndex: enclosing ?? null,
        });
    }

    return slots;
};

/** Plain text of each `data-segment-index` span in a translation, by index. */
const collectTargetSegmentTexts = (html: string): Map<number, string> => {
    const byIndex = new Map<number, string>();
    const spanPattern = /<span\b[^>]*\bdata-segment-index="(\d+)"[^>]*>([\s\S]*?)<\/span>/g;
    let match: RegExpExecArray | null;
    while ((match = spanPattern.exec(html)) !== null) {
        const index = Number(match[1]);
        const text = extractPlainTextFromHtml(match[2]);
        const existing = byIndex.get(index);
        byIndex.set(index, existing ? `${existing} ${text}`.trim() : text);
    }
    return byIndex;
};

interface NormalizedText {
    value: string;
    /** `map[i]` is the offset in the original string of normalized character `i`. */
    map: number[];
}

/**
 * Fold the differences translation and typesetting introduce — soft hyphens,
 * repeated whitespace, and the several dash characters InDesign uses — so an
 * anchor found in the source can still be located in the translation.
 */
const normalizeForAnchorSearch = (text: string): NormalizedText => {
    const characters: string[] = [];
    const map: number[] = [];
    let lastWasSpace = false;

    for (let i = 0; i < text.length; i++) {
        const character = text[i];
        if (character === "\u00ad") continue;
        if (/\s/.test(character)) {
            if (lastWasSpace || characters.length === 0) continue;
            characters.push(" ");
            map.push(i);
            lastWasSpace = true;
            continue;
        }
        lastWasSpace = false;
        const folded = /[\u2010-\u2015\u2212-]/.test(character) ? "-" : character.toLowerCase();
        characters.push(folded);
        map.push(i);
    }

    while (characters.length > 0 && characters[characters.length - 1] === " ") {
        characters.pop();
        map.pop();
    }

    return { value: characters.join(""), map };
};

/**
 * Slots worth anchoring on: references, ranges and verse numbers are reproduced
 * near-verbatim by translators, so finding them in the translation pins down a
 * split point precisely.
 */
const isAnchorCandidate = (sourceText: string): boolean => {
    const trimmed = sourceText.replace(SOFT_HYPHEN, "").trim();
    if (trimmed.length === 0 || trimmed.length > 40) return false;
    return /\d/.test(trimmed);
};

/** Punctuation that reliably survives translation and ends a styled run. */
const trailingPunctuation = (sourceText: string): string | null => {
    const trimmed = sourceText.replace(SOFT_HYPHEN, "").trimEnd();
    const last = trimmed.slice(-1);
    return /[:;.,)\]]/.test(last) ? last : null;
};

const snapToWordBoundary = (text: string, position: number): number => {
    if (position <= 0 || position >= text.length) {
        return Math.max(0, Math.min(text.length, position));
    }
    for (let offset = 0; offset < 24; offset++) {
        const after = position + offset;
        if (after < text.length && /\s/.test(text[after])) return after;
        const before = position - offset;
        if (before > 0 && /\s/.test(text[before])) return before;
    }
    return position;
};

/**
 * Split `targetText` into one piece per slot. Always returns exactly
 * `slots.length` pieces whose concatenation is `targetText`, so no translated
 * text can be dropped or duplicated.
 */
export const splitTranslationAcrossSlots = (
    slotSourceTexts: string[],
    targetText: string
): string[] => {
    if (slotSourceTexts.length <= 1) return [targetText];

    const pieces: string[] = [];
    let remaining = targetText;

    for (let slot = 0; slot < slotSourceTexts.length - 1; slot++) {
        const remainingSourceLengths = slotSourceTexts
            .slice(slot)
            .map((text) => text.replace(SOFT_HYPHEN, "").length);
        const totalRemainingSource = remainingSourceLengths.reduce((sum, n) => sum + n, 0);
        const expected = totalRemainingSource > 0
            ? Math.round(remaining.length * (remainingSourceLengths[0] / totalRemainingSource))
            : 0;

        let cut: number | null = null;

        // The next slot is a reference or range: split immediately before it.
        const nextSource = slotSourceTexts[slot + 1];
        if (isAnchorCandidate(nextSource)) {
            const anchor = normalizeForAnchorSearch(nextSource);
            const haystack = normalizeForAnchorSearch(remaining);
            if (anchor.value.length > 0) {
                const found = haystack.value.indexOf(anchor.value);
                if (found > 0) {
                    cut = haystack.map[found];
                }
            }
        }

        // This slot ends with punctuation the translator will have kept. Only
        // trusted near the proportional estimate: a full stop occurs many times
        // in a long note, and the first one is rarely the right boundary.
        if (cut === null) {
            const punctuation = trailingPunctuation(slotSourceTexts[slot]);
            if (punctuation) {
                const found = remaining.indexOf(punctuation);
                const withinReach = found > 0 && found < remaining.length - 1;
                if (withinReach && found + 1 <= Math.max(expected * 2, expected + 24)) {
                    cut = found + 1;
                }
            }
        }

        // Nothing to anchor on: divide by how much of the source each slot holds.
        if (cut === null) {
            cut = snapToWordBoundary(remaining, expected);
        }

        // Keep the separating whitespace with the slot that precedes it, so a
        // styled run never starts with a stray space.
        let safeCut = Math.max(0, Math.min(remaining.length, cut));
        while (safeCut < remaining.length && /\s/.test(remaining[safeCut])) {
            safeCut++;
        }

        pieces.push(remaining.slice(0, safeCut));
        remaining = remaining.slice(safeCut);
    }

    pieces.push(remaining);
    return pieces;
};

/**
 * Rebuild `targetHtml`'s text inside `sourceHtml`'s tags.
 *
 * Returns null only when the source has no text slot to fill or the translation
 * has no text, since there is then nothing meaningful to produce.
 */
export const fillSourceTemplateWithTranslation = (
    sourceHtml: string,
    targetHtml: string
): TemplateFillResult | null => {
    if (!sourceHtml?.trim() || !targetHtml?.trim()) return null;

    const tokens = tokenizeHtml(sourceHtml);
    const slots = collectSlots(tokens);
    if (slots.length === 0) return null;

    const targetText = extractPlainTextFromHtml(targetHtml);
    if (!targetText) return null;

    const assigned = new Map<number, string>();
    let strategy: TemplateFillStrategy;

    // Preferred: the translation still carries IDML segment indexes, so each slot
    // keeps exactly the text the translator put in it. Only safe when every
    // translated segment has a home in the source, otherwise text would be lost.
    const targetSegments = collectTargetSegmentTexts(targetHtml);
    const sourceSegmentIndexes = new Set(
        slots.map((slot) => slot.segmentIndex).filter((value): value is number => value !== null)
    );
    // Whitespace-only segments are not slots, so they are excluded from the check;
    // they carry no translated text that could be lost.
    const translatedTargetSegments = [...targetSegments.entries()].filter(
        ([, text]) => text.trim().length > 0
    );
    const everyTargetSegmentHasSlot =
        translatedTargetSegments.length > 0 &&
        translatedTargetSegments.every(([index]) => sourceSegmentIndexes.has(index));

    if (everyTargetSegmentHasSlot) {
        strategy = "segmentIndex";
        for (const slot of slots) {
            const text = slot.segmentIndex === null
                ? ""
                : targetSegments.get(slot.segmentIndex) ?? "";
            assigned.set(slot.tokenIndex, text);
        }
    } else if (slots.length === 1) {
        strategy = "singleSlot";
        assigned.set(slots[0].tokenIndex, targetText);
    } else {
        strategy = "anchored";
        const pieces = splitTranslationAcrossSlots(
            slots.map((slot) => slot.sourceText),
            targetText
        );
        slots.forEach((slot, index) => assigned.set(slot.tokenIndex, pieces[index] ?? ""));
    }

    const html = tokens
        .map((token, index) => {
            if (token.kind === "tag") return token.raw;
            if (!assigned.has(index)) return token.raw;
            return escapeHtmlText(assigned.get(index) ?? "");
        })
        .join("");

    const slotsFilled = [...assigned.values()].filter((text) => text.trim().length > 0).length;
    return { html, strategy, slotsFilled, slotsTotal: slots.length };
};

/**
 * The gate a forced rewrite has to pass before it is written to a cell: the tags
 * must match the source and the translation's words must all still be there.
 * Whitespace is ignored because a slot boundary can move a single space from one
 * run to the next.
 */
export const isSafeForcedRewrite = (
    sourceHtml: string,
    originalHtml: string,
    rewrittenHtml: string,
    options?: HtmlStructureOptions
): boolean => {
    if (!compareHtmlStructure(sourceHtml, rewrittenHtml, options).isMatch) return false;
    const squash = (html: string) => extractPlainTextFromHtml(html).replace(/\s+/g, "");
    return squash(originalHtml) === squash(rewrittenHtml);
};
