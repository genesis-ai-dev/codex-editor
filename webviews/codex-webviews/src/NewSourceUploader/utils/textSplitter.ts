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
 *   L2 (sub-sentence breaks)  — tried when length > N * THRESHOLD_L2
 *   L3 (whitespace)           — tried when length > N * THRESHOLD_L3
 *
 *   Each split is rejected if it would leave either side shorter than N * MIN_SIDE_RATIO.
 *   After a successful split, both halves are recursively re-evaluated.
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
 * Core recursive splitter.  Operates on character offsets within `fullText`.
 */
function splitRecursive(
    fullText: string,
    start: number,
    end: number,
    idealLength: number
): TextRange[] {
    const length = end - start;
    const minSide = idealLength * MIN_SIDE_RATIO;

    // Below the split threshold — keep as-is
    if (length <= idealLength * THRESHOLD_SPLIT) {
        return [{ start, end }];
    }

    const segText = fullText.slice(start, end);
    const mid = Math.floor(segText.length / 2);

    // --- L1: sentence boundaries ---
    const l1Points = findSplitPoints(segText, L1_RE);
    const l1Pick = pickBestPoint(l1Points, mid, segText.length, minSide);
    if (l1Pick !== null) {
        const g = start + l1Pick;
        return [
            ...splitRecursive(fullText, start, g, idealLength),
            ...splitRecursive(fullText, g, end, idealLength),
        ];
    }

    // --- L2: sub-sentence boundaries (only if long enough) ---
    if (length > idealLength * THRESHOLD_L2) {
        const l2Points = findSplitPoints(segText, L2_RE);
        const l2Pick = pickBestPoint(l2Points, mid, segText.length, minSide);
        if (l2Pick !== null) {
            const g = start + l2Pick;
            return [
                ...splitRecursive(fullText, start, g, idealLength),
                ...splitRecursive(fullText, g, end, idealLength),
            ];
        }
    }

    // --- L3: whitespace (only if very long) ---
    if (length > idealLength * THRESHOLD_L3) {
        const l3Points = findSplitPoints(segText, L3_RE);
        const l3Pick = pickBestPoint(l3Points, mid, segText.length, minSide);
        if (l3Pick !== null) {
            const g = start + l3Pick;
            return [
                ...splitRecursive(fullText, start, g, idealLength),
                ...splitRecursive(fullText, g, end, idealLength),
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
 */
export function splitTextIntoRanges(
    text: string,
    idealLength: number = DEFAULT_IDEAL_CELL_LENGTH
): TextRange[] {
    if (!text || idealLength <= 0 || text.length <= idealLength * THRESHOLD_SPLIT) {
        return [{ start: 0, end: text.length }];
    }
    return splitRecursive(text, 0, text.length, idealLength);
}

/**
 * Convenience wrapper that returns the actual substrings.
 */
export function splitText(
    text: string,
    idealLength: number = DEFAULT_IDEAL_CELL_LENGTH
): string[] {
    return splitTextIntoRanges(text, idealLength)
        .map(r => text.slice(r.start, r.end));
}
