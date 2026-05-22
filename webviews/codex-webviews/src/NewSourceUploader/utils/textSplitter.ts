/**
 * Generic recursive text splitter for paragraph segmentation.
 *
 * Works on plain strings — no dependency on DOCX types, runs, or any importer.
 * Any importer (DOCX, PDF, plain text, etc.) can use this to break long
 * paragraphs into translator-friendly cell-sized chunks.
 *
 * Algorithm:
 *   Given an ideal cell length N, the splitter asks "is this segment too long?"
 *   and if so, finds the best boundary closest to the midpoint:
 *
 *   L1 (sentence boundaries)  — tried when length > N * THRESHOLD_SPLIT
 *   L2 (sub-sentence breaks)  — tried when there is no suitable L1 boundary and length > N * THRESHOLD_L2
 *   L3 (whitespace / word)    — tried when there is no suitable L1 or L2 boundary and length > N * THRESHOLD_L3
 *
 *   Each split is rejected if it would leave either side shorter than N * MIN_SIDE_RATIO.
 *   After a successful split, both halves are recursively re-evaluated.
 *
 * Locale-aware mode:
 *   When the caller passes a BCP-47 `locale` (e.g. "th", "ja", "fa") AND the
 *   runtime supports `Intl.Segmenter` for it, L1 sources its candidate
 *   boundaries from `Intl.Segmenter(locale, { granularity: 'sentence' })`
 *   and L3 from `granularity: 'word'`.  This handles abbreviations
 *   ("Mr. Smith") correctly at L1 and produces real word boundaries for
 *   scripts without word-spacing (Thai, Khmer, Lao, Myanmar, CJK) at L3.
 *   L2 has no Intl equivalent and always uses the regex below.
 *   If the locale is missing or unsupported, every tier falls back to regex
 *   and behavior is byte-identical to the locale-less call.
 */


/**
 * 160 seems to be a good default for English, but depending on the language and how it is encoded, it will surely vary.
 * Thus, I've made it adjustable to the user.
 */
export const DEFAULT_IDEAL_CELL_LENGTH = 160;

// ---------------------------------------------------------------------------
// Threshold multipliers (applied to idealLength)
// ---------------------------------------------------------------------------

const THRESHOLD_SPLIT = 1.1;  // a – minimum length to attempt any split
const THRESHOLD_L2 = 1.5;     // b – minimum length for L2 (sub-sentence) splits
const THRESHOLD_L3 = 2.4;     // c – minimum length for L3 (whitespace) splits
const MIN_SIDE_RATIO = 0.3;   // d – minimum side length as fraction of idealLength

// ---------------------------------------------------------------------------
// Boundary patterns (multilingual)
// ---------------------------------------------------------------------------

/**
 * L1 — Sentence-ending boundaries.
 *
 * Latin marks (. ! ?) require following whitespace or end-of-string to avoid
 * splitting numbers ("3.14") and abbreviations. A negative lookbehind excludes
 * digits immediately before ".".
 *
 * Script-specific marks (Devanagari, CJK, Arabic, Urdu, Ethiopic, Myanmar,
 * Khmer, Tibetan, Armenian, Balinese, full-width variants) match standalone
 * since they are unambiguous sentence terminators even without trailing space.
 */
const L1_RE = /(?:(?<!\d)[.．]+|[!?]+)(?=\s|$)|[।॥。！？؟۔።᭞᭟፧။។།༎։՞՜‽⁇⁈⁉｡]+/g;

/**
 * L2 — Sub-sentence boundaries: commas, semicolons, colons, non-hyphen dashes,
 * ellipsis, closing quotes / brackets.
 *
 * Latin marks require following whitespace. CJK / Arabic marks match standalone.
 */
const L2_RE = /(?:[,;:)\]—–…"'»›]+)(?=\s)|[،؛、，；：）〉》]+/g;

/**
 * L3 — Whitespace (last resort).
 */
const L3_RE = /\s+/g;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TextRange {
    start: number;
    end: number;
}

// ---------------------------------------------------------------------------
// Internal helpers (defined before use)
// ---------------------------------------------------------------------------

/**
 * Opaque handle for a constructed segmenter.  Typed loosely so this file
 * compiles under tsconfigs that lack `ES2022.Intl` (the root webpack build
 * pulls this module in via a test that cross-imports from the webview tree).
 */
type SegmenterHandle = {
    segment(input: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }>;
};

/**
 * Try to construct an `Intl.Segmenter` for the given locale and granularity.
 * Returns null when no locale was supplied, when the runtime lacks the API,
 * or when the locale is unrecognized (RangeError).
 */
function tryCreateSegmenter(
    locale: string | undefined,
    granularity: 'sentence' | 'word'
): SegmenterHandle | null {
    if (!locale) return null;
    const IntlAny = Intl as Record<string, unknown>;
    if (typeof IntlAny.Segmenter !== 'function') return null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return new (IntlAny.Segmenter as any)(locale, { granularity }) as SegmenterHandle;
    } catch {
        return null;
    }
}

/**
 * Boundary positions between sentences in `text`, derived from a locale-aware
 * sentence segmenter. Returns the start index of every sentence after the
 * first (each `seg.index` already accounts for trailing whitespace of the
 * previous sentence, matching the regex-based `findSplitPoints` semantics).
 */
function findSentenceSplitPointsIntl(text: string, segmenter: SegmenterHandle): number[] {
    const points: number[] = [];
    for (const seg of segmenter.segment(text)) {
        if (seg.index > 0 && seg.index < text.length) {
            points.push(seg.index);
        }
    }
    return points;
}

/**
 * Boundary positions between words in `text`, derived from a locale-aware
 * word segmenter. Returns the start index of every word-like segment after
 * position 0 — this is the locale-aware analogue of "split at whitespace"
 * and works for scripts (Thai, Khmer, Lao, Myanmar, CJK) where words are
 * not space-separated.
 */
function findWordSplitPointsIntl(text: string, segmenter: SegmenterHandle): number[] {
    const points: number[] = [];
    for (const seg of segmenter.segment(text)) {
        if (seg.isWordLike && seg.index > 0 && seg.index < text.length) {
            points.push(seg.index);
        }
    }
    return points;
}

/**
 * Find all character positions where a new segment could BEGIN after a
 * boundary match (i.e. right after the punctuation + any trailing spaces).
 */
function findSplitPoints(text: string, re: RegExp): number[] {
    const points: number[] = [];
    const localRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = localRe.exec(text)) !== null) {
        let nextWord = m.index + m[0].length;
        while (nextWord < text.length && text[nextWord] === ' ') nextWord++;
        if (nextWord > 0 && nextWord < text.length) {
            points.push(nextWord);
        }
    }
    return points;
}

/**
 * From a set of candidate split points, pick the one closest to `mid` that
 * keeps both resulting sides at least `minSide` characters long.
 * Returns the chosen point, or null if none qualifies.
 */
function pickBestPoint(
    points: number[],
    mid: number,
    textLength: number,
    minSide: number
): number | null {
    if (points.length === 0) return null;

    const sorted = [...points].sort(
        (a, b) => Math.abs(a - mid) - Math.abs(b - mid)
    );

    for (const p of sorted) {
        if (p >= minSide && textLength - p >= minSide) {
            return p;
        }
    }
    return null;
}

/**
 * Per-invocation context passed through recursion. The two segmenter slots
 * are constructed once at the public entry point so we don't re-construct
 * them at every recursive call.
 */
interface SplitContext {
    idealLength: number;
    sentenceSegmenter: SegmenterHandle | null;
    wordSegmenter: SegmenterHandle | null;
}

/**
 * Core recursive splitter.  Operates on character offsets within `fullText`.
 */
function splitRecursive(
    fullText: string,
    start: number,
    end: number,
    ctx: SplitContext
): TextRange[] {
    const { idealLength, sentenceSegmenter, wordSegmenter } = ctx;
    const length = end - start;
    const minSide = idealLength * MIN_SIDE_RATIO;

    // Below the split threshold — keep as-is
    if (length <= idealLength * THRESHOLD_SPLIT) {
        return [{ start, end }];
    }

    const segText = fullText.slice(start, end);
    const mid = Math.floor(segText.length / 2);

    // --- L1: sentence boundaries ---
    // Locale-aware when a sentence segmenter is available; regex otherwise.
    const l1Points = sentenceSegmenter
        ? findSentenceSplitPointsIntl(segText, sentenceSegmenter)
        : findSplitPoints(segText, L1_RE);
    const l1Pick = pickBestPoint(l1Points, mid, segText.length, minSide);
    if (l1Pick !== null) {
        const g = start + l1Pick;
        return [
            ...splitRecursive(fullText, start, g, ctx),
            ...splitRecursive(fullText, g, end, ctx),
        ];
    }

    // --- L2: sub-sentence boundaries (only if long enough) ---
    // No Intl equivalent for clause-level boundaries — regex always.
    if (length > idealLength * THRESHOLD_L2) {
        const l2Points = findSplitPoints(segText, L2_RE);
        const l2Pick = pickBestPoint(l2Points, mid, segText.length, minSide);
        if (l2Pick !== null) {
            const g = start + l2Pick;
            return [
                ...splitRecursive(fullText, start, g, ctx),
                ...splitRecursive(fullText, g, end, ctx),
            ];
        }
    }

    // --- L3: word boundaries (only if very long) ---
    // Locale-aware when a word segmenter is available — essential for
    // scripts without space-separated words. Falls back to whitespace regex.
    if (length > idealLength * THRESHOLD_L3) {
        const l3Points = wordSegmenter
            ? findWordSplitPointsIntl(segText, wordSegmenter)
            : findSplitPoints(segText, L3_RE);
        const l3Pick = pickBestPoint(l3Points, mid, segText.length, minSide);
        if (l3Pick !== null) {
            const g = start + l3Pick;
            return [
                ...splitRecursive(fullText, start, g, ctx),
                ...splitRecursive(fullText, g, end, ctx),
            ];
        }
    }

    // Cannot split further
    return [{ start, end }];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Split `text` into character ranges, each roughly `idealLength` characters.
 *
 * Returns a single-element array when no split is needed.
 * Set `idealLength` to 0 to disable splitting entirely.
 *
 * @param locale Optional BCP-47 tag (e.g. "th", "ja", "fa-IR"). When supplied
 *   and supported by the runtime's `Intl.Segmenter`, L1 (sentence) and L3
 *   (word) boundaries are derived from the segmenter instead of regex.
 *   Unknown or unsupported tags transparently fall back to regex.
 */
export function splitTextIntoRanges(
    text: string,
    idealLength: number = DEFAULT_IDEAL_CELL_LENGTH,
    locale?: string
): TextRange[] {
    if (!text || idealLength <= 0 || text.length <= idealLength * THRESHOLD_SPLIT) {
        return [{ start: 0, end: text.length }];
    }
    const ctx: SplitContext = {
        idealLength,
        sentenceSegmenter: tryCreateSegmenter(locale, 'sentence'),
        wordSegmenter: tryCreateSegmenter(locale, 'word'),
    };
    return splitRecursive(text, 0, text.length, ctx);
}

/**
 * Convenience wrapper that returns the actual substrings.
 */
export function splitText(
    text: string,
    idealLength: number = DEFAULT_IDEAL_CELL_LENGTH,
    locale?: string
): string[] {
    return splitTextIntoRanges(text, idealLength, locale)
        .map(r => text.slice(r.start, r.end));
}
