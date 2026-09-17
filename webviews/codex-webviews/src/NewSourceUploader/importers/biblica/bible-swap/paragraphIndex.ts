/**
 * Cached top-level paragraph index with binary search.
 *
 * Several swap helpers (`getVerseNumbersInRegion`, `findParagraphAt`,
 * `hasIntroBetween`, ...) are called once per paragraph or per splice, and each
 * call used to re-walk the ENTIRE story XML with `iterateParagraphs`. On a
 * multi-megabyte study story that turns the structure swap into O(N²) string
 * scanning — the dominant cost of a Bible Swap export. This module walks each
 * distinct XML string once, caches the resulting paragraph array (small LRU),
 * and answers region queries with binary search over paragraph offsets.
 */

import { iterateParagraphs } from "./surgicalSwap";

export interface IndexedParagraph {
    fullStart: number;
    fullEnd: number;
    bodyStart: number;
    bodyEnd: number;
    appliedParagraphStyle: string;
}

/**
 * Hot keys during a swap are the study story XML plus the current Bible
 * chapter block, so a small LRU is enough; one-shot strings (freshly built
 * replacement slices) get evicted quickly without disturbing the hot entries.
 */
const MAX_CACHE_ENTRIES = 16;
const cache = new Map<string, IndexedParagraph[]>();

/** Walk `storyXml` once (or reuse the cached walk) and return its top-level paragraphs in document order. */
export function getParagraphIndex(storyXml: string): IndexedParagraph[] {
    const hit = cache.get(storyXml);
    if (hit) {
        // Refresh recency so hot entries survive one-shot strings.
        cache.delete(storyXml);
        cache.set(storyXml, hit);
        return hit;
    }

    const paras: IndexedParagraph[] = [];
    for (const p of iterateParagraphs(storyXml)) {
        paras.push({
            fullStart: p.fullStart,
            fullEnd: p.fullEnd,
            bodyStart: p.bodyStart,
            bodyEnd: p.bodyEnd,
            appliedParagraphStyle: p.appliedParagraphStyle,
        });
    }

    cache.set(storyXml, paras);
    if (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    return paras;
}

export function clearParagraphIndexCache(): void {
    cache.clear();
}

/** Index of the first paragraph whose `fullEnd > pos` (paragraphs are ordered and non-overlapping). */
export function firstParagraphEndingAfter(
    paras: readonly IndexedParagraph[],
    pos: number
): number {
    let lo = 0;
    let hi = paras.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (paras[mid].fullEnd > pos) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}

/** Paragraphs overlapping `[regionStart, regionEnd)` — same filter as the old full-walk `fullEnd <= regionStart || fullStart >= regionEnd` skip. */
export function* paragraphsIntersecting(
    storyXml: string,
    regionStart: number,
    regionEnd: number
): IterableIterator<IndexedParagraph> {
    const paras = getParagraphIndex(storyXml);
    for (let i = firstParagraphEndingAfter(paras, regionStart); i < paras.length; i++) {
        const p = paras[i];
        if (p.fullStart >= regionEnd) break;
        yield p;
    }
}

/** Paragraph containing `pos` (`fullStart <= pos < fullEnd`), or null. */
export function findParagraphAtPos(
    storyXml: string,
    pos: number
): IndexedParagraph | null {
    const paras = getParagraphIndex(storyXml);
    const p = paras[firstParagraphEndingAfter(paras, pos)];
    return p && pos >= p.fullStart && pos < p.fullEnd ? p : null;
}
