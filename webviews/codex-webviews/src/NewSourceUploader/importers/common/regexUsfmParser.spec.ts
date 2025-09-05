import { describe, it, expect } from 'vitest';
import { countMarkersByTag, parseUsfmToJson, stringifyUsfmFromJson } from './regexUsfmParser';
import { createHash } from 'crypto';

// Seedable PRNG for deterministic tests
function mulberry32(seed: number) {
    return function () {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pick = <T,>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
const repeat = (n: number, f: (i: number) => void) => { for (let i = 0; i < n; i++) f(i); };

// Categories derived from usfmTags.md (subset but broad coverage). We will generate
// a document that uses many of these so the parser sees varied shapes.
const paragraphMarkers = ['p', 'm', 'pr', 'pc', 'pm', 'pmo', 'pmc', 'pmr', 'pi1', 'mi', 'nb', 'b'];
const titleMarkers = ['ms1', 's1', 'r', 'd'];
const poetryMarkers = ['q1', 'q2', 'qr', 'qc', 'qa', 'qm1', 'qd'];
const listMarkers = ['lh', 'li1', 'li2', 'lf', 'lim1'];
const tableMarkers = ['tr', 'th1', 'thr1', 'thc1', 'tc1', 'tcr1', 'tcc1'];
const breakMarkers = ['pb'];
// Inline paired character markers use closing *
const inlinePaired = ['add', 'bk', 'dc', 'em', 'k', 'nd', 'pn', 'png', 'rb', 'rq', 'sig', 'sls', 'tl', 'w', 'wa', 'wg', 'wh', 'wj', 'bd', 'it', 'bdit', 'no', 'sc', 'sup'];
// Milestones with -s/-e
const milestonePairs = ['qt', 'ts'];
// Notes paragraph-level (paired with *) placed inline in verse for simplicity here
const notePairs = ['f', 'fe', 'ef', 'x', 'ex'];

const makeHash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function buildRandomInline(rng: () => number, word: string): string {
    const form = Math.floor(rng() * 3);
    if (form === 0) {
        const m = pick(rng, inlinePaired);
        return `\\${m} ${word} \\${m}*`;
    } else if (form === 1) {
        const m = pick(rng, milestonePairs);
        return `\\${m}-s ${word} \\${m}-e`;
    } else {
        const m = pick(rng, notePairs);
        return `\\${m} ${word} \\${m}*`;
    }
}

function buildRandomParaMarkerLine(rng: () => number): string {
    const buckets = [paragraphMarkers, titleMarkers, poetryMarkers, listMarkers, tableMarkers, breakMarkers];
    const chosen = pick(rng, buckets);
    const tag = pick(rng, chosen);
    // Some para tags take text; others stand alone
    const hasText = !/^b$|^pb$|^tr$/.test(tag) ? ' Some paragraph text' : '';
    return `\\${tag}${hasText}`;
}

function buildUsfm(seed: number, options?: { chapters?: number; versesPerChapter?: number; extraParaPerChapter?: number; inlinePerVerse?: number; }): string {
    const rng = mulberry32(seed);
    const chapters = options?.chapters ?? (2 + Math.floor(rng() * 2));
    const versesPerChapter = options?.versesPerChapter ?? (3 + Math.floor(rng() * 3));
    const extraParaPerChapter = options?.extraParaPerChapter ?? (2 + Math.floor(rng() * 2));
    const inlinePerVerse = options?.inlinePerVerse ?? (2 + Math.floor(rng() * 3));

    const lines: string[] = [];
    lines.push('\\id GEN');
    lines.push('\\usfm 3.0');

    repeat(chapters, (c) => {
        lines.push(`\\c ${c + 1}`);
        // Sprinkle some paragraph-level markers within chapter scope
        repeat(extraParaPerChapter, () => {
            lines.push(buildRandomParaMarkerLine(rng));
        });

        repeat(versesPerChapter, (v) => {
            const words: string[] = [];
            repeat(3 + Math.floor(rng() * 5), (w) => {
                const base = `word${c + 1}_${v + 1}_${w + 1}`;
                if (rng() < 0.6) {
                    words.push(buildRandomInline(rng, base));
                } else {
                    words.push(base);
                }
            });
            // Additional enforced inline fragments
            repeat(inlinePerVerse, (i) => {
                words.push(buildRandomInline(rng, `extra${i + 1}`));
            });
            lines.push(`\\v ${v + 1} ${words.join(' ')}`);
        });
    });

    return lines.join('\n');
}

describe('regexUsfmParser - random generation, parse, count, round-trip', () => {
    it('parses, counts tags by base, and round-trips identically for a moderate doc', () => {
        const input = buildUsfm(42, { chapters: 2, versesPerChapter: 4 });
        const expectedCounts = countMarkersByTag(input);

        const parsed = parseUsfmToJson(input);
        expect(parsed.book.bookCode).toBe('GEN');
        expect(parsed.chapters.length).toBeGreaterThan(0);

        const output = stringifyUsfmFromJson(parsed);

        // Counts should match after round-trip
        const outputCounts = countMarkersByTag(output);
        expect(outputCounts).toEqual(expectedCounts);

        // Byte-for-byte equality for our generated shape
        expect(output).toBe(input);

        // Hash equality
        expect(makeHash(output)).toBe(makeHash(input));
    });

    it('handles a denser document with many markers and varied structures', () => {
        const input = buildUsfm(2025, { chapters: 3, versesPerChapter: 6, extraParaPerChapter: 4, inlinePerVerse: 4 });
        const expectedCounts = countMarkersByTag(input);
        const parsed = parseUsfmToJson(input);
        const output = stringifyUsfmFromJson(parsed);

        expect(countMarkersByTag(output)).toEqual(expectedCounts);
        expect(output).toBe(input);
        expect(makeHash(output)).toBe(makeHash(input));
    });
});


