/**
 * Verse-marker number parsing.
 *
 * A marker is usually a bare numeral ("12", "12:", " 3 "), but a translation
 * may print two or more verses as one merged unit — the Marathi Bible does this
 * for e.g. EST 8:9-10 and 1CO 10:3-4. Both the visible `cv:v` numeral and the
 * hidden `meta:v` bracket carry the merged label, spelled with an ASCII hyphen
 * in `meta:v` and a non-breaking hyphen in `cv:v`.
 *
 * Every consumer that reasons about verse numbers has to expand such a marker
 * into the verses it covers. Stripping non-digits instead turns "9-10" into
 * verse 910, which makes the chapter's verse numbering non-monotonic and
 * silently truncates every slice taken after the merged marker.
 */

/** Strip everything except digits from a marker like "1:" / "1." / " 3 ". */
export function digitsOnly(s: string): string {
    return (s || "").replace(/[^0-9]/g, "");
}

/** ASCII hyphen, Unicode hyphen, non-breaking hyphen, figure/en/em dash. */
const RANGE_SEPARATOR = /[-\u2010\u2011\u2012\u2013\u2014]/;

/**
 * Widest merged run we accept. Real merges span a handful of verses; a larger
 * gap means the separator was incidental punctuation, not a range.
 */
const MAX_MERGED_VERSES = 12;

/** Verse numbers a marker covers: "12" → [12], "9-10" → [9, 10], "" → []. */
export function parseVerseMarkerNumbers(text: string): number[] {
    const trimmed = (text || "").trim();
    if (!trimmed) return [];

    const parts = trimmed.split(RANGE_SEPARATOR);
    if (parts.length === 2) {
        const first = parseInt(digitsOnly(parts[0]), 10);
        const last = parseInt(digitsOnly(parts[1]), 10);
        if (
            Number.isFinite(first) &&
            Number.isFinite(last) &&
            last > first &&
            last - first < MAX_MERGED_VERSES
        ) {
            const covered: number[] = [];
            for (let v = first; v <= last; v++) covered.push(v);
            return covered;
        }
    }

    const single = parseInt(digitsOnly(trimmed), 10);
    return Number.isFinite(single) ? [single] : [];
}

/**
 * Canonical verse number for a marker — the first verse it covers. Opening and
 * closing markers of the same verse print the same label, so this also pairs
 * them.
 */
export function parseVerseMarkerNumber(text: string): string {
    const covered = parseVerseMarkerNumbers(text);
    return covered.length > 0 ? String(covered[0]) : "";
}
