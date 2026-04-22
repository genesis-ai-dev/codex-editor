/**
 * Engram analysis: given a target translation cell's text, find the
 * longest spans of tokens ("engrams") that also appear elsewhere in the
 * project's target corpus. Runs Smart Branched Search (SBS) restricted to
 * target-side matching and then locates each engram's character offsets in
 * the original plain text so the UI can highlight it.
 *
 * Spans that never appear anywhere else in the corpus surface as "no-match"
 * engrams — the feature's main purpose is to show translators which bits
 * of their own text are reinforcing (or contradicting) other translations.
 */

import { SQLiteIndexManager } from "./indexes/sqliteIndex";
import {
    ContextBranchingSearchAlgorithm,
    SBSEngramMatch,
} from "./searchAlgorithms/contextBranchingSearch";

export interface EngramHighlight {
    /** Plain-text span (token sequence joined by single spaces). */
    text: string;
    /** Character offsets inside the plain-text version of the target content. */
    startOffset: number;
    endOffset: number;
    /** Token count of the span. */
    tokenCount: number;
    /** Cell where the matched corpus engram was found, if any. */
    matchedCellId?: string;
    matchedCellLabel?: string;
    /** A short snippet from the matched cell for tooltip display. */
    matchedSnippet?: string;
    /** True when no other cell in the corpus contains this span. */
    isOrphan: boolean;
}

export interface EngramAnalysisResult {
    /** Plain-text version of the target content used for offset calculation. */
    plainText: string;
    engrams: EngramHighlight[];
}

const MAX_ENGRAMS = 24;

function stripHtmlToPlain(html: string): string {
    return (html || "")
        .replace(/<[^>]*?>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#34;/g, "'")
        .replace(/&[a-zA-Z]+;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenize(text: string): string[] {
    return (text || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * Find the earliest occurrence of a whitespace-separated token sequence in
 * a plain-text string, matching token-by-token (so punctuation between
 * words in the original text doesn't prevent a match). Returns null if not
 * found.
 */
function locateEngram(plainText: string, engramText: string): { start: number; end: number; } | null {
    const engramTokens = tokenize(engramText);
    if (engramTokens.length === 0) return null;

    // Walk through plain text finding token boundaries.
    const lowerText = plainText.toLowerCase();
    const tokenRe = /[\p{L}\p{N}\p{M}]+/gu;
    const positions: Array<{ token: string; start: number; end: number; }> = [];
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(lowerText)) !== null) {
        positions.push({ token: m[0], start: m.index, end: m.index + m[0].length });
    }

    for (let i = 0; i + engramTokens.length <= positions.length; i++) {
        let ok = true;
        for (let j = 0; j < engramTokens.length; j++) {
            if (positions[i + j].token !== engramTokens[j]) { ok = false; break; }
        }
        if (ok) {
            return {
                start: positions[i].start,
                end: positions[i + engramTokens.length - 1].end,
            };
        }
    }
    return null;
}

/**
 * Extract "leftover" spans from the target text — contiguous token runs
 * that weren't covered by any SBS engram. These are potential orphan
 * engrams: text that doesn't match anywhere else in the corpus.
 */
function findOrphanSpans(
    plainText: string,
    coveredRanges: Array<{ start: number; end: number; }>,
    minTokens: number
): EngramHighlight[] {
    const tokenRe = /[\p{L}\p{N}\p{M}]+/gu;
    const positions: Array<{ start: number; end: number; }> = [];
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(plainText)) !== null) {
        positions.push({ start: m.index, end: m.index + m[0].length });
    }
    if (positions.length === 0) return [];

    const isCovered = (pos: { start: number; end: number; }) =>
        coveredRanges.some(r => pos.start >= r.start && pos.end <= r.end);

    const orphans: EngramHighlight[] = [];
    let runStart = -1;
    let runFirstIdx = -1;
    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        if (!isCovered(pos)) {
            if (runStart === -1) {
                runStart = pos.start;
                runFirstIdx = i;
            }
        } else if (runStart !== -1) {
            const last = positions[i - 1];
            const tokenCount = i - runFirstIdx;
            if (tokenCount >= minTokens) {
                orphans.push({
                    text: plainText.slice(runStart, last.end),
                    startOffset: runStart,
                    endOffset: last.end,
                    tokenCount,
                    isOrphan: true,
                });
            }
            runStart = -1;
            runFirstIdx = -1;
        }
    }
    if (runStart !== -1) {
        const last = positions[positions.length - 1];
        const tokenCount = positions.length - runFirstIdx;
        if (tokenCount >= minTokens) {
            orphans.push({
                text: plainText.slice(runStart, last.end),
                startOffset: runStart,
                endOffset: last.end,
                tokenCount,
                isOrphan: true,
            });
        }
    }
    return orphans;
}

export async function analyzeCellEngrams(
    indexManager: SQLiteIndexManager,
    args: {
        cellId: string;
        targetContent: string;
        minTokens?: number;
        maxResults?: number;
    }
): Promise<EngramAnalysisResult> {
    const minTokens = Math.max(2, args.minTokens ?? 3);
    const maxResults = Math.max(1, args.maxResults ?? MAX_ENGRAMS);

    const plainText = stripHtmlToPlain(args.targetContent);
    if (!plainText || tokenize(plainText).length < minTokens) {
        return { plainText, engrams: [] };
    }

    const sbs = new ContextBranchingSearchAlgorithm(indexManager);
    let sbsResults: SBSEngramMatch[] = [];
    try {
        const { results } = await sbs.searchWithEngrams(plainText, {
            limit: maxResults,
            searchScope: "target",
            excludeCellIds: [args.cellId],
        });
        sbsResults = results;
    } catch (err) {
        console.error("[engramAnalysis] SBS search failed:", err);
        return { plainText, engrams: [] };
    }

    const engrams: EngramHighlight[] = [];
    const coveredRanges: Array<{ start: number; end: number; }> = [];

    for (const r of sbsResults) {
        const engramText = (r.engramText || "").trim();
        if (!engramText) continue;
        const tokens = tokenize(engramText);
        if (tokens.length < minTokens) continue;

        const loc = locateEngram(plainText, engramText);
        if (!loc) continue;

        // Skip overlaps with previously-placed engrams: SBS removes covered
        // substrings between iterations, but offsets can still overlap due
        // to repeated tokens.
        if (coveredRanges.some(c => loc.start < c.end && loc.end > c.start)) continue;

        const matchedTargetContent: string = r.pair.targetCell.content || "";
        const snippet = stripHtmlToPlain(matchedTargetContent).slice(0, 200);

        engrams.push({
            text: plainText.slice(loc.start, loc.end),
            startOffset: loc.start,
            endOffset: loc.end,
            tokenCount: tokens.length,
            matchedCellId: r.pair.cellId,
            matchedCellLabel: r.pair.cellLabel ?? undefined,
            matchedSnippet: snippet,
            isOrphan: false,
        });
        coveredRanges.push(loc);
    }

    // Surface runs of un-matched tokens as potential orphan engrams. These are
    // the spans worth looking at — translations that don't appear anywhere
    // else in the corpus.
    const orphans = findOrphanSpans(plainText, coveredRanges, minTokens);
    engrams.push(...orphans);

    engrams.sort((a, b) => a.startOffset - b.startOffset);
    return { plainText, engrams };
}
