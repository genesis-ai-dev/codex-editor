/**
 * Chapter-level text block indexing for structure swap.
 *
 * Study Bibles often split a chapter's verse text with `intro:*` note blocks.
 * We index each contiguous text span separately and map it to the matching
 * verse range from the Bible chapter block.
 */

import { isPsalmSubheaderParagraphStyle, PSA_BOOK_CODE } from "./psalmVersification";
import type {
    ChapterBlockIndex,
    ChapterSpanIndex,
    ChapterTextBlock,
    ChapterTextSpan,
} from "./types";
import { chapterBlockKey } from "./types";
import {
    collectContentText,
    digitsOnly,
    parseChapterMarkerContent,
    extractBookCode,
    isAcrosticHeadingParagraphStyle,
    isBookMarkerParagraphStyle,
    isChapterMarkerStyle,
    isVerseMarkerStyle,
    iterateContentAbs,
    iterateCsrAbs,
    iterateParagraphs,
} from "./surgicalSwap";
import {
    firstParagraphEndingAfter,
    getParagraphIndex,
    paragraphsIntersecting,
} from "./paragraphIndex";

/** Bibles often omit meta:c for single-chapter books; default to chapter 1. */
export function chapterOneIfMissing(book: string, chapter: string): string {
    return book && !chapter ? "1" : chapter;
}

export interface BuildChapterBlockOptions {
    /**
     * Keep mid-chapter `head:s*`/`head:r*` section titles inside the chapter
     * block instead of flushing at them. Used for the Bible source so its
     * section headings travel into the swapped output.
     */
    retainSectionHeadings?: boolean;
    /**
     * Keep `head:sp` speaker labels inside the chapter block (Song of Songs).
     */
    retainSpeakerLabels?: boolean;
    /** Include acrostic `head:q*` headings that carry meta:v markers. */
    retainAcrosticHeadings?: boolean;
    /**
     * When a physical paragraph straddles two chapters (closing verse + next
     * `meta:c`), clip each chapter's span `blockXml` to only its side of the
     * marker instead of duplicating the whole paragraph. Required for Bible
     * chapter blocks used as extraction sources — otherwise the closing
     * chapter's merged block absorbs the next chapter's opening text (e.g.
     * Portuguese NEH 7 absorbing NEH 8 "Esdras"), and verse-range extraction
     * bleeds across the boundary. Study spans keep the whole paragraph so
     * structure-swap coalesce can rewrite it as one well-formed PSR.
     */
    clipChapterBoundarySpans?: boolean;
}

function isIntroNotesOrTitleStyle(style: string): boolean {
    return (
        /(?:^|\/)(?:intro|title|notes)%3a/.test(style) ||
        /(?:^|\/)(?:intro|title|notes):/.test(style)
    );
}

function isMetaParagraphStyle(style: string): boolean {
    return /(?:^|\/)meta%3a/.test(style) || /(?:^|\/)meta:/.test(style);
}

function isHeadParagraphStyle(style: string): boolean {
    return /(?:^|\/)head%3a/.test(style) || /(?:^|\/)head:/.test(style);
}

/**
 * Section titles (`head:s*`, `head:ms*`) and parallel-reference lines (`head:r*`).
 * Deliberately excludes Psalm superscriptions (`head:d_h`) and chapter labels
 * (`head:cl`) so those keep their existing dedicated handling.
 *
 * Russian SNG uses `head:ms1` between the superscription and the first poetry
 * line; treating it as a retained section heading keeps verse 1 contiguous.
 */
function isSectionHeadingParagraphStyle(style: string): boolean {
    const s = style.replace(/^ParagraphStyle\//, "");
    return (
        /(?:^|\/)head%3a(?:s|r|ms)/.test(s) ||
        /(?:^|\/)head:(?:s|r|ms)/.test(s)
    );
}

/**
 * Song of Songs speaker labels (`head:sp`, `head:sp_h`, …).
 * Underscore suffixes must match: `\b` does not break on `_`.
 */
export function isSpeakerLabelParagraphStyle(style: string): boolean {
    const s = style.replace(/^ParagraphStyle\//, "");
    return /(?:^|\/)head%3asp(?:$|_|[a-z])/.test(s) || /(?:^|\/)head:sp(?:$|_|[a-z])/.test(s);
}

function isBlankSpacerParagraphStyle(style: string): boolean {
    if (isTextBlockParagraphStyle(style)) return false;
    const s = style.replace(/^ParagraphStyle\//, "");
    return (
        /(?:^|\/)b(?:b)?_head/.test(s) ||
        /(?:^|\/)b(?:_$|\b)/.test(s)
    );
}

function isMidSliceParagraph(style: string): boolean {
    return (
        isSectionHeadingParagraphStyle(style) ||
        isSpeakerLabelParagraphStyle(style) ||
        isBlankSpacerParagraphStyle(style)
    );
}

function isSliceableNonTextParagraph(
    blockXml: string,
    style: string,
    bodyStart: number,
    bodyEnd: number
): boolean {
    const isSubheaderVerse =
        isPsalmSubheaderParagraphStyle(style) &&
        paragraphHasVerseMarker(blockXml, bodyStart, bodyEnd);
    const isAcrosticVerse =
        isAcrosticHeadingParagraphStyle(style) &&
        paragraphHasVerseMarker(blockXml, bodyStart, bodyEnd);
    return isSubheaderVerse || isAcrosticVerse;
}

function verseClosedInParagraph(
    blockXml: string,
    bodyStart: number,
    bodyEnd: number,
    verse: number
): boolean {
    let count = 0;
    for (const csr of iterateCsrAbs(blockXml, bodyStart, bodyEnd)) {
        if (!isVerseMarkerStyle(csr.appliedCharacterStyle)) continue;
        const vnum = digitsOnly(
            collectContentText(blockXml, csr.absBodyStart, csr.absBodyEnd)
        );
        if (vnum === String(verse)) count++;
    }
    return count >= 2;
}

function paragraphVerseCloseEnd(
    blockXml: string,
    bodyStart: number,
    bodyEnd: number,
    verse: number
): number | null {
    let count = 0;
    for (const csr of iterateCsrAbs(blockXml, bodyStart, bodyEnd)) {
        if (!isVerseMarkerStyle(csr.appliedCharacterStyle)) continue;
        const vnum = digitsOnly(
            collectContentText(blockXml, csr.absBodyStart, csr.absBodyEnd)
        );
        if (vnum === String(verse)) {
            count++;
            if (count >= 2) return csr.absFullEnd;
        }
    }
    return null;
}

/** End offset before a higher verse opens, or after the closing meta:v for `lastVerse`. */
function paragraphSliceEndForVerse(
    blockXml: string,
    bodyStart: number,
    bodyEnd: number,
    lastVerse: number
): number | null {
    const closeEnd = paragraphVerseCloseEnd(
        blockXml,
        bodyStart,
        bodyEnd,
        lastVerse
    );
    if (closeEnd !== null) return closeEnd;

    let afterLastVerseMarker: number | null = null;
    for (const csr of iterateCsrAbs(blockXml, bodyStart, bodyEnd)) {
        const isCv =
            /CharacterStyle\/cv%3av|CharacterStyle\/cv:v/.test(
                csr.appliedCharacterStyle
            );
        const isMetaV = isVerseMarkerStyle(csr.appliedCharacterStyle);
        if (!isCv && !isMetaV) continue;
        const vnum = parseInt(
            digitsOnly(
                collectContentText(
                    blockXml,
                    csr.absBodyStart,
                    csr.absBodyEnd
                )
            ),
            10
        );
        if (!Number.isFinite(vnum)) continue;
        if (vnum === lastVerse && isMetaV) {
            afterLastVerseMarker = csr.absFullEnd;
        }
        if (vnum > lastVerse) {
            return afterLastVerseMarker ?? csr.absFullStart;
        }
    }
    return null;
}

/**
 * Offset where `firstVerse` begins inside a paragraph that also carries earlier
 * verses. Genealogies pack a whole run of verses into one `text:li1` paragraph,
 * so a trailing-verse insert (RUT 4:22) would otherwise repeat the verses the
 * main replacement already placed — and a duplicate verse run flips the
 * open/close parity of every marker after it.
 *
 * The cut goes immediately after the preceding verse's closing marker rather
 * than at `firstVerse`'s own numeral, so footnote calls and spacing that sit
 * between the two verses stay with the verse they are printed in.
 */
function paragraphSliceStartForVerse(
    blockXml: string,
    bodyStart: number,
    bodyEnd: number,
    firstVerse: number
): number | null {
    let afterLowerVerse: number | null = null;
    for (const csr of iterateCsrAbs(blockXml, bodyStart, bodyEnd)) {
        if (!isAnyVerseMarkerStyle(csr.appliedCharacterStyle)) continue;
        const vnum = parseInt(
            digitsOnly(
                collectContentText(blockXml, csr.absBodyStart, csr.absBodyEnd)
            ),
            10
        );
        if (!Number.isFinite(vnum)) continue;
        if (vnum >= firstVerse) break;
        afterLowerVerse = csr.absFullEnd;
    }
    return afterLowerVerse;
}

/** Clip a slice so it does not include verse markers at or above `beforeVerse`. */
function clipSliceEndBeforeVerse(
    blockXml: string,
    sliceStart: number,
    sliceEnd: number,
    beforeVerse: number
): number {
    let clip = sliceEnd;
    for (const para of paragraphsIntersecting(blockXml, sliceStart, sliceEnd)) {
        for (const csr of iterateCsrAbs(blockXml, para.bodyStart, para.bodyEnd)) {
            if (!isAnyVerseMarkerStyle(csr.appliedCharacterStyle)) continue;
            const vnum = parseInt(
                digitsOnly(
                    collectContentText(
                        blockXml,
                        csr.absBodyStart,
                        csr.absBodyEnd
                    )
                ),
                10
            );
            if (!Number.isFinite(vnum) || vnum < beforeVerse) continue;
            if (csr.absFullStart > sliceStart && csr.absFullStart < clip) {
                clip = csr.absFullStart;
            }
        }
    }
    return clip;
}

function isRetainedHeadingParagraphStyle(
    style: string,
    options?: BuildChapterBlockOptions
): boolean {
    if (options?.retainSectionHeadings && isSectionHeadingParagraphStyle(style)) {
        return true;
    }
    if (options?.retainSpeakerLabels && isSpeakerLabelParagraphStyle(style)) {
        return true;
    }
    if (
        options?.retainAcrosticHeadings &&
        isAcrosticHeadingParagraphStyle(style)
    ) {
        return true;
    }
    return false;
}

function isTextBlockParagraphStyle(style: string): boolean {
    const s = style.replace(/^ParagraphStyle\//, "");
    if (isIntroNotesOrTitleStyle(s) || isMetaParagraphStyle(s)) return false;
    if (/(?:^|\/)text%3a/.test(s) || /(?:^|\/)text:/.test(s)) return true;
    if (/(?:^|\/)(?:b(?:_|$|\b)|b_poetry|b_embed|b_list|b_pc)/.test(s)) {
        return true;
    }
    return false;
}

function paragraphHasVerseMarker(
    storyXml: string,
    bodyStart: number,
    bodyEnd: number
): boolean {
    for (const csr of iterateCsrAbs(storyXml, bodyStart, bodyEnd)) {
        if (isAnyVerseMarkerStyle(csr.appliedCharacterStyle)) return true;
    }
    return false;
}

/** True when a paragraph carries no real prose (only `<Br/>`/whitespace) — a spacer. */
function paragraphHasProseText(
    storyXml: string,
    bodyStart: number,
    bodyEnd: number
): boolean {
    for (const c of iterateContentAbs(storyXml, bodyStart, bodyEnd)) {
        if (storyXml.slice(c.absInnerStart, c.absInnerEnd).trim()) return true;
    }
    return false;
}

export function readChapterFromParagraph(
    storyXml: string,
    bodyStart: number,
    bodyEnd: number
): string | null {
    for (const csr of iterateCsrAbs(storyXml, bodyStart, bodyEnd)) {
        if (!isChapterMarkerStyle(csr.appliedCharacterStyle)) continue;
        const cnum = parseChapterMarkerContent(
            collectContentText(storyXml, csr.absBodyStart, csr.absBodyEnd)
        );
        if (cnum) return cnum;
    }
    return null;
}

export interface ChapterMarkerHit {
    chapter: string;
    /** Absolute position of the opening tag of the `meta:c` CSR. */
    absPos: number;
}

/**
 * Yield every `meta:c` chapter marker inside a paragraph body, in document
 * order. A single study `p_dc1` / `p_dc2` boundary paragraph can carry the previous
 * chapter's closing marker AND the next chapter's opening marker, so callers
 * that need to split a paragraph at a mid-paragraph chapter transition must see
 * all markers, not just the first.
 */
export function* iterateChapterMarkersInParagraph(
    storyXml: string,
    bodyStart: number,
    bodyEnd: number
): IterableIterator<ChapterMarkerHit> {
    for (const csr of iterateCsrAbs(storyXml, bodyStart, bodyEnd)) {
        if (!isChapterMarkerStyle(csr.appliedCharacterStyle)) continue;
        const cnum = parseChapterMarkerContent(
            collectContentText(storyXml, csr.absBodyStart, csr.absBodyEnd)
        );
        if (cnum) yield { chapter: cnum, absPos: csr.absFullStart };
    }
}

/** Study Bibles often use `head:cl` ("Psalm 24") without a separate meta:c marker. */
export function isPsalmChapterHeadLabelStyle(style: string): boolean {
    return /(?:^|\/)head%3acl(?:$|\b)/.test(style) || /(?:^|\/)head:cl(?:$|\b)/.test(style);
}

export function readPsalmNumberFromHeadLabelParagraph(
    storyXml: string,
    bodyStart: number,
    bodyEnd: number
): string | null {
    let text = "";
    for (const c of iterateContentAbs(storyXml, bodyStart, bodyEnd)) {
        text += storyXml.slice(c.absInnerStart, c.absInnerEnd);
    }
    const normalized = text.replace(/\u00ad/g, "");
    const match = normalized.match(/(?:Psalm|Псалом\.?)\s+(\d{1,3})\b/i);
    return match ? match[1] : null;
}

/** Locate `head:cl` paragraph XML keyed by Psalm chapter number. */
export function collectPsalmChapterLabelXml(
    storyXml: string
): Map<string, { absStart: number; absEnd: number; xml: string }> {
    const out = new Map<string, { absStart: number; absEnd: number; xml: string }>();
    for (const para of getParagraphIndex(storyXml)) {
        if (!isPsalmChapterHeadLabelStyle(para.appliedParagraphStyle)) continue;
        const chapter = readPsalmNumberFromHeadLabelParagraph(
            storyXml,
            para.bodyStart,
            para.bodyEnd
        );
        if (!chapter || out.has(chapter)) continue;
        out.set(chapter, {
            absStart: para.fullStart,
            absEnd: para.fullEnd,
            xml: storyXml.slice(para.fullStart, para.fullEnd),
        });
    }
    return out;
}

/**
 * Resolve a chapter transition from meta:c markers or, in Psalms, head:cl labels.
 */
export function readChapterTransitionFromParagraph(
    storyXml: string,
    paragraphStyle: string,
    bodyStart: number,
    bodyEnd: number,
    currentBook: string
): string | null {
    const fromMeta = readChapterFromParagraph(storyXml, bodyStart, bodyEnd);
    if (fromMeta) return fromMeta;
    if (
        currentBook === PSA_BOOK_CODE &&
        isPsalmChapterHeadLabelStyle(paragraphStyle)
    ) {
        return readPsalmNumberFromHeadLabelParagraph(storyXml, bodyStart, bodyEnd);
    }
    return null;
}

function isCvVerseMarkerStyle(style: string): boolean {
    return (
        /(?:^|\/)cv%3av(?:$|\b)/.test(style) ||
        /(?:^|\/)cv:v(?:$|\b)/.test(style)
    );
}

function isAnyVerseMarkerStyle(style: string): boolean {
    return isVerseMarkerStyle(style) || isCvVerseMarkerStyle(style);
}

/** Collect verse numbers referenced by meta:v / cv:v markers in a region. */
export function getVerseNumbersInRegion(
    storyXml: string,
    regionStart: number,
    regionEnd: number
): number[] {
    const found = new Set<number>();
    for (const para of paragraphsIntersecting(storyXml, regionStart, regionEnd)) {
        const scanStart = Math.max(para.bodyStart, regionStart);
        const scanEnd = Math.min(para.bodyEnd, regionEnd);
        if (scanStart >= scanEnd) continue;
        for (const csr of iterateCsrAbs(storyXml, scanStart, scanEnd)) {
            if (csr.absFullStart < regionStart || csr.absFullStart >= regionEnd) continue;
            if (!isAnyVerseMarkerStyle(csr.appliedCharacterStyle)) continue;
            const vnum = digitsOnly(
                collectContentText(storyXml, csr.absBodyStart, csr.absBodyEnd)
            );
            const n = parseInt(vnum, 10);
            if (Number.isFinite(n)) found.add(n);
        }
    }
    return Array.from(found).sort((a, b) => a - b);
}

export function getVerseRangeFromBlockXml(blockXml: string): {
    firstVerse: number;
    lastVerse: number;
} | null {
    const nums = getVerseNumbersInRegion(blockXml, 0, blockXml.length);
    if (nums.length === 0) return null;
    return { firstVerse: nums[0], lastVerse: nums[nums.length - 1] };
}

function verseNumbersTouchingRange(
    verseNums: number[],
    firstVerse: number,
    lastVerse: number
): boolean {
    return verseNums.some((v) => v >= firstVerse && v <= lastVerse);
}

function nextVerseNumberAfter(
    blockXml: string,
    afterPos: number
): number | null {
    const paras = getParagraphIndex(blockXml);
    for (let i = firstParagraphEndingAfter(paras, afterPos); i < paras.length; i++) {
        const para = paras[i];
        if (
            !paragraphHasVerseMarker(
                blockXml,
                para.bodyStart,
                para.bodyEnd
            )
        ) {
            continue;
        }
        const nums = getVerseNumbersInRegion(
            blockXml,
            para.bodyStart,
            para.bodyEnd
        );
        if (nums.length > 0) return nums[0];
    }
    return null;
}

/**
 * True when text for `lastVerse` (or unmarked poetry continuation) still
 * follows `afterPos` before any higher verse opens. Used so mid-verse
 * `head:ms*` / `head:sp*` lines (Russian SNG 1:1) stay inside the slice.
 */
function hasOpenVerseContinuationAfter(
    blockXml: string,
    afterPos: number,
    lastVerse: number
): boolean {
    const paras = getParagraphIndex(blockXml);
    for (
        let i = firstParagraphEndingAfter(paras, afterPos);
        i < paras.length;
        i++
    ) {
        const para = paras[i];
        const style = para.appliedParagraphStyle;
        if (isMidSliceParagraph(style)) continue;
        if (
            !isTextBlockParagraphStyle(style) &&
            !isSliceableNonTextParagraph(
                blockXml,
                style,
                para.bodyStart,
                para.bodyEnd
            )
        ) {
            return false;
        }
        const nums = getVerseNumbersInRegion(
            blockXml,
            para.bodyStart,
            para.bodyEnd
        );
        if (nums.some((v) => v > lastVerse)) return false;
        return true;
    }
    return false;
}

/**
 * Extract the paragraph XML for verses `firstVerse`–`lastVerse` from a full
 * chapter block (used to align with a study span after a note interruption).
 */
function isNoStyleCsr(style: string): boolean {
    return (
        /\$ID\/\[No character style\]/.test(style) ||
        /\$ID\/%5BNo character style%5D/.test(style)
    );
}

function isProseContentText(text: string): boolean {
    if (!text.trim()) return false;
    if (/^<\?ACE/.test(text.trim())) return false;
    if (text === " " || text === "\u2009" || text === "\u00A0") return false;
    return true;
}

function normalizeProseText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/**
 * Structure swap pastes Bible paragraph XML verbatim. When a verse repeats the
 * same prose in multiple `<Content>` nodes, clear later duplicates so export
 * text is not doubled.
 */
export function collapseRedundantProseInBlockXml(blockXml: string): string {
    const toClear: Array<{ absInnerStart: number; absInnerEnd: number }> = [];

    for (const para of iterateParagraphs(blockXml)) {
        for (const csr of iterateCsrAbs(blockXml, para.bodyStart, para.bodyEnd)) {
            if (!isNoStyleCsr(csr.appliedCharacterStyle)) continue;
            // Only collapse a `<Content>` when it immediately repeats the prior
            // kept prose with NO `<Br/>` between them — that is the doubling
            // artifact. Identical lines separated by `<Br/>` are an intentional
            // refrain (e.g. French poetry) and must be preserved.
            let prevNorm: string | null = null;
            let prevEnd = -1;
            for (const content of iterateContentAbs(
                blockXml,
                csr.absBodyStart,
                csr.absBodyEnd
            )) {
                const text = blockXml.slice(
                    content.absInnerStart,
                    content.absInnerEnd
                );
                if (!isProseContentText(text)) continue;
                const norm = normalizeProseText(text);
                const gap =
                    prevEnd >= 0
                        ? blockXml.slice(prevEnd, content.absInnerStart)
                        : "";
                const separatedByBreak = /<Br\b/i.test(gap);
                if (prevNorm !== null && norm === prevNorm && !separatedByBreak) {
                    toClear.push({
                        absInnerStart: content.absInnerStart,
                        absInnerEnd: content.absInnerEnd,
                    });
                    continue;
                }
                prevNorm = norm;
                prevEnd = content.absInnerEnd;
            }
        }
    }

    if (toClear.length === 0) return blockXml;

    toClear.sort((a, b) => b.absInnerStart - a.absInnerStart);
    let result = blockXml;
    for (const span of toClear) {
        result =
            result.slice(0, span.absInnerStart) +
            result.slice(span.absInnerEnd);
    }
    return result;
}

/**
 * Portuguese (and some other) Bibles open a chapter in `p_dc2` with `cv:dc`
 * digits but no `meta:c`. walkStory only transitions on `meta:c`, so inject a
 * period-style marker after the matching `cv:dc` when verse 1 is pasted alone.
 */
export function injectMetaChapterMarkerIfMissing(
    sliceXml: string,
    chapter: string
): string {
    const chapterNum = digitsOnly(chapter);
    if (!chapterNum || !sliceXml) return sliceXml;

    const hasMetaC = new RegExp(
        `CharacterStyle/meta%3ac[\\s\\S]*?<Content>\\s*${chapterNum}\\s*[.:]`,
        "i"
    ).test(sliceXml);
    if (hasMetaC) return sliceXml;

    const cvMatch = sliceXml.match(
        /CharacterStyle\/cv%3adc[\s\S]*?<Content>\s*(\d+)\s*<\/Content>[\s\S]*?<\/CharacterStyleRange>/i
    );
    if (!cvMatch || digitsOnly(cvMatch[1]) !== chapterNum) return sliceXml;

    const insertAt = cvMatch.index! + cvMatch[0].length;
    const marker = `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapterNum}.</Content></CharacterStyleRange>`;
    return sliceXml.slice(0, insertAt) + marker + sliceXml.slice(insertAt);
}

/**
 * Re-add a chapter marker that the study span carried but the Bible
 * replacement does not, so replacing the span cannot orphan the chapter. This
 * happens when the study numbers a superscription as a verse the Bible has no
 * counterpart for: the marker rides on that paragraph and would vanish with it.
 */
export function preserveStudyChapterMarker(
    replacementXml: string,
    studySpanXml: string,
    chapter: string
): string {
    const carries = (xml: string): boolean =>
        [...iterateCsrAbs(xml, 0, xml.length)].some(
            (csr) =>
                isChapterMarkerStyle(csr.appliedCharacterStyle) &&
                digitsOnly(
                    collectContentText(xml, csr.absBodyStart, csr.absBodyEnd)
                ) === chapter
        );
    if (!replacementXml || carries(replacementXml)) return replacementXml;
    if (!carries(studySpanXml)) return replacementXml;

    const openEnd = replacementXml.indexOf(">");
    if (!replacementXml.startsWith("<ParagraphStyleRange") || openEnd === -1) {
        return replacementXml;
    }
    const marker = `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>${chapter}.</Content></CharacterStyleRange>`;
    return (
        replacementXml.slice(0, openEnd + 1) +
        marker +
        replacementXml.slice(openEnd + 1)
    );
}

export interface ExtractSliceOptions {
    /**
     * Start the slice at `firstVerse` even when it shares a paragraph with
     * earlier verses, instead of taking that paragraph whole. Only appended
     * inserts need this: a span replacement is anchored to the study span it
     * overwrites, but an insert is appended after text that already carries
     * those earlier verses, so repeating them duplicates the printed run and
     * flips the open/close parity of every verse marker that follows.
     */
    clipStartAtFirstVerse?: boolean;
}

export function extractSliceByVerseRange(
    blockXml: string,
    firstVerse: number,
    lastVerse: number,
    options?: ExtractSliceOptions
): string {
    let sliceStart = -1;
    let sliceEnd = -1;
    let inSlice = false;
    /** Paragraph open tag to re-add when the slice starts mid-paragraph. */
    let clippedOpenTag = "";
    // Track a contiguous run of section-heading (`head:s*`/`head:r*`) and blank
    // spacer paragraphs immediately preceding the next verse. A heading
    // introduces the section that follows it, so when that next verse opens the
    // slice the heading must travel with it (otherwise it is dropped at a span
    // boundary). Only absorb the run when it actually contains a heading.
    let pendingRunStart = -1;
    let pendingHasHeading = false;
    const resetPendingRun = () => {
        pendingRunStart = -1;
        pendingHasHeading = false;
    };

    for (const para of getParagraphIndex(blockXml)) {
        const style = para.appliedParagraphStyle;
        const isSubheaderVerse = isSliceableNonTextParagraph(
            blockXml,
            style,
            para.bodyStart,
            para.bodyEnd
        );
        if (!isTextBlockParagraphStyle(style) && !isSubheaderVerse) {
            if (inSlice) {
                // A `bb` break paragraph can carry nothing but the closing
                // meta:c/meta:v pair of the range's last verse (Portuguese
                // LAM 1:22). Leaving it out ends the slice with an unterminated
                // verse, and the verse then vanishes from the swapped output.
                const closingNums = getVerseNumbersInRegion(
                    blockXml,
                    para.bodyStart,
                    para.bodyEnd
                );
                if (
                    closingNums.length > 0 &&
                    closingNums.every(
                        (v) => v >= firstVerse && v <= lastVerse
                    )
                ) {
                    sliceEnd = para.fullEnd;
                    continue;
                }
                if (isMidSliceParagraph(style)) {
                    // Keep headings/spacers that sit *inside* the open verse
                    // (Russian SNG: head:ms1 / head:sp_h between poetry lines).
                    // Stop only when nothing for lastVerse remains after them.
                    if (
                        hasOpenVerseContinuationAfter(
                            blockXml,
                            para.fullEnd,
                            lastVerse
                        )
                    ) {
                        sliceEnd = para.fullEnd;
                        continue;
                    }
                    inSlice = false;
                    continue;
                }
                const isAcrosticInSlice =
                    isAcrosticHeadingParagraphStyle(style) &&
                    paragraphHasVerseMarker(
                        blockXml,
                        para.bodyStart,
                        para.bodyEnd
                    );
                if (isAcrosticInSlice) {
                    sliceEnd = para.fullEnd;
                    continue;
                }
            }
            if (!inSlice) {
                const isHeading =
                    isSectionHeadingParagraphStyle(style) ||
                    isSpeakerLabelParagraphStyle(style);
                const isSpacer = isBlankSpacerParagraphStyle(style);
                if (isHeading || isSpacer) {
                    if (pendingRunStart < 0) pendingRunStart = para.fullStart;
                    if (isHeading) pendingHasHeading = true;
                } else {
                    resetPendingRun();
                }
            }
            continue;
        }

        const verseNums = getVerseNumbersInRegion(
            blockXml,
            para.bodyStart,
            para.bodyEnd
        );
        const hasVerse = paragraphHasVerseMarker(
            blockXml,
            para.bodyStart,
            para.bodyEnd
        );
        const touches = verseNumbersTouchingRange(
            verseNums,
            firstVerse,
            lastVerse
        );

        if (inSlice) {
            if (hasVerse && verseNums.length > 0 && Math.min(...verseNums) > lastVerse) {
                inSlice = false;
                resetPendingRun();
                continue;
            }
            if (hasVerse && !touches) {
                inSlice = false;
                resetPendingRun();
                continue;
            }
            sliceEnd = para.fullEnd;
            const hasHigherVerse = verseNums.some((v) => v > lastVerse);
            if (hasHigherVerse) {
                const boundary = paragraphSliceEndForVerse(
                    blockXml,
                    para.bodyStart,
                    para.bodyEnd,
                    lastVerse
                );
                if (boundary !== null && boundary < sliceEnd) {
                    sliceEnd = boundary;
                }
                inSlice = false;
            }
            resetPendingRun();
            continue;
        }

        if (touches) {
            if (sliceStart < 0) {
                if (pendingRunStart >= 0 && pendingHasHeading) {
                    sliceStart = pendingRunStart;
                } else {
                    sliceStart = para.fullStart;
                    const clipped =
                        options?.clipStartAtFirstVerse &&
                        verseNums.some((v) => v < firstVerse)
                            ? paragraphSliceStartForVerse(
                                  blockXml,
                                  para.bodyStart,
                                  para.bodyEnd,
                                  firstVerse
                              )
                            : null;
                    if (clipped !== null && clipped > para.bodyStart) {
                        sliceStart = clipped;
                        clippedOpenTag = blockXml.slice(
                            para.fullStart,
                            para.bodyStart
                        );
                    }
                }
            }
            sliceEnd = para.fullEnd;
            inSlice = true;
        }
        resetPendingRun();
    }

    if (sliceStart < 0 || sliceEnd <= sliceStart) return "";
    sliceEnd = clipSliceEndBeforeVerse(
        blockXml,
        sliceStart,
        sliceEnd,
        lastVerse + 1
    );
    if (sliceEnd <= sliceStart) return "";
    return balanceParagraphStyleRanges(
        clippedOpenTag + blockXml.slice(sliceStart, sliceEnd)
    );
}

const PSR_CLOSE = "</ParagraphStyleRange>";

/** Ensure slice XML has matching ParagraphStyleRange open/close tags. */
export function balanceParagraphStyleRanges(xml: string): string {
    if (!xml) return xml;
    const open = (xml.match(/<ParagraphStyleRange/g) ?? []).length;
    const close = (xml.match(/<\/ParagraphStyleRange>/g) ?? []).length;
    if (open > close) {
        return xml + PSR_CLOSE.repeat(open - close);
    }
    return xml;
}

/** Strip outer ParagraphStyleRange wrapper(s), returning inner CSR markup. */
export function extractParagraphStyleRangeInner(xml: string): string {
    let inner = xml.trim();
    const openRe = /^<ParagraphStyleRange[^>]*>/;
    const openMatch = inner.match(openRe);
    if (openMatch) {
        inner = inner.slice(openMatch[0].length);
    }
    while (inner.endsWith(PSR_CLOSE)) {
        inner = inner.slice(0, -PSR_CLOSE.length).trimEnd();
    }
    return inner;
}

function isDecorativeChapterDigitStyle(style: string): boolean {
    return (
        /(?:^|\/)cv%3adc(?:$|\b)/.test(style) ||
        /(?:^|\/)cv:dc(?:$|\b)/.test(style)
    );
}

/**
 * Real verse prose inside a paragraph range, ignoring the decorations that
 * surround a chapter opening: the drop-cap chapter digit, chapter/verse markers,
 * footnote calls, `<?ACE n?>` anchors and spacing.
 */
function hasVerseProseBetween(
    storyXml: string,
    from: number,
    to: number
): boolean {
    if (to <= from) return false;
    for (const csr of iterateCsrAbs(storyXml, from, to)) {
        const style = csr.appliedCharacterStyle;
        if (
            isAnyVerseMarkerStyle(style) ||
            isChapterMarkerStyle(style) ||
            isDecorativeChapterDigitStyle(style)
        ) {
            continue;
        }
        // The anchor and the closing line often share one character range
        // (`<?ACE 3?>foi para o desfiladeiro de Micmás.`), so strip anchors
        // rather than dismissing the whole range as decoration.
        const text = collectContentText(
            storyXml,
            csr.absBodyStart,
            csr.absBodyEnd
        ).replace(/<\?ACE[^?]*\?>/g, "");
        if (isProseContentText(text)) return true;
    }
    return false;
}

function rewriteChapterMarkerText(
    original: string,
    studyChapter: string,
    bibleChapter: string
): string | null {
    const trimmed = original.trim();
    const parsed = parseChapterMarkerContent(trimmed);
    if (parsed !== studyChapter) return null;
    if (trimmed.endsWith(":")) return `${bibleChapter}:`;
    if (trimmed.endsWith(".")) return `${bibleChapter}.`;
    if (digitsOnly(trimmed) === studyChapter) return bibleChapter;
    return null;
}

interface ContentTextSplice {
    absInnerStart: number;
    absInnerEnd: number;
    newText: string;
}

function applyContentTextSplices(xml: string, splices: ContentTextSplice[]): string {
    if (splices.length === 0) return xml;
    const sorted = [...splices].sort((a, b) => b.absInnerStart - a.absInnerStart);
    let result = xml;
    for (const sp of sorted) {
        result =
            result.slice(0, sp.absInnerStart) +
            sp.newText +
            result.slice(sp.absInnerEnd);
    }
    return result;
}

/**
 * Study Bibles number some single-chapter books with non-standard chapter
 * numbers (PHM 3, 2JN 5, OBA 9) while the translation uses chapter 1. After
 * structure swap the prose is Portuguese/Russian but meta:c still reads the
 * study chapter, so validation misses bible-keyed verses. Rewrite markers to
 * the bible chapter inside each affected book region.
 */
export function rewriteRemappedChapterMarkersInStory(
    storyXml: string,
    chapterRemaps: Map<string, Map<string, string>>
): string {
    if (chapterRemaps.size === 0) return storyXml;

    const splices: ContentTextSplice[] = [];
    let currentBook = "";
    let currentRemaps: Map<string, string> | undefined;

    for (const para of iterateParagraphs(storyXml)) {
        if (isBookMarkerParagraphStyle(para.appliedParagraphStyle)) {
            let bookRaw = "";
            for (const c of iterateContentAbs(storyXml, para.bodyStart, para.bodyEnd)) {
                bookRaw += storyXml.slice(c.absInnerStart, c.absInnerEnd);
            }
            currentBook = extractBookCode(bookRaw) ?? "";
            currentRemaps = chapterRemaps.get(currentBook);
            continue;
        }

        if (!currentRemaps?.size) continue;

        for (const csr of iterateCsrAbs(storyXml, para.bodyStart, para.bodyEnd)) {
            const isChapterCsr =
                isChapterMarkerStyle(csr.appliedCharacterStyle) ||
                isDecorativeChapterDigitStyle(csr.appliedCharacterStyle);
            if (!isChapterCsr) continue;

            for (const content of iterateContentAbs(
                storyXml,
                csr.absBodyStart,
                csr.absBodyEnd
            )) {
                const original = storyXml.slice(
                    content.absInnerStart,
                    content.absInnerEnd
                );
                for (const [studyChapter, bibleChapter] of currentRemaps) {
                    const rewritten = rewriteChapterMarkerText(
                        original,
                        studyChapter,
                        bibleChapter
                    );
                    if (rewritten !== null && rewritten !== original) {
                        splices.push({
                            absInnerStart: content.absInnerStart,
                            absInnerEnd: content.absInnerEnd,
                            newText: rewritten,
                        });
                        break;
                    }
                }
            }
        }
    }

    return applyContentTextSplices(storyXml, splices);
}

/**
 * Index every contiguous verse text span per (book, chapter). Study files may
 * yield multiple spans when intro note blocks split the chapter.
 */
export function buildChapterSpanIndex(
    storyXml: string,
    options?: BuildChapterBlockOptions
): ChapterSpanIndex {
    const index: ChapterSpanIndex = new Map();
    let currentBook = "";
    let currentChapter = "";
    let blockStart = -1;
    let blockEnd = -1;

    const flushBlock = () => {
        if (!currentBook || !currentChapter || blockStart < 0 || blockEnd <= blockStart) {
            blockStart = -1;
            blockEnd = -1;
            return;
        }
        const blockXml = storyXml.slice(blockStart, blockEnd);
        const range = getVerseRangeFromBlockXml(blockXml);
        if (!range) {
            blockStart = -1;
            blockEnd = -1;
            return;
        }
        const key = chapterBlockKey(currentBook, currentChapter);
        const span: ChapterTextSpan = {
            book: currentBook,
            chapter: currentChapter,
            absStart: blockStart,
            absEnd: blockEnd,
            blockXml,
            firstVerse: range.firstVerse,
            lastVerse: range.lastVerse,
        };
        const list = index.get(key) ?? [];
        list.push(span);
        index.set(key, list);
        blockStart = -1;
        blockEnd = -1;
    };

    /**
     * The verse a chapter-boundary paragraph opened continues into the following
     * paragraphs, which may carry no verse marker of their own — the Bible sets
     * 1SA 14:1's speech line as a bare `text:p_sd` paragraph. A block normally
     * refuses to open on a verse-less paragraph, so the boundary handler records
     * that the chapter is still mid-verse and the next text paragraph may open it.
     */
    let reopenAfterBoundary = false;

    const extendBlock = (segStart: number, segEnd: number, allowOpen = false) => {
        if (segEnd <= segStart) return;
        if (blockStart >= 0) {
            blockEnd = segEnd;
            return;
        }
        if (allowOpen || paragraphHasVerseMarker(storyXml, segStart, segEnd)) {
            blockStart = segStart;
            blockEnd = segEnd;
        }
    };

    // Collect meta:v verse numbers between two absolute offsets. Used to split a
    // boundary paragraph's verses across the two chapters it straddles.
    const verseNumsInRange = (start: number, end: number): number[] =>
        getVerseNumbersInRegion(storyXml, start, end);

    /**
     * Verses before the next chapter's `meta:c` that belong to the closing
     * chapter. Study boundary paragraphs often place the opening chapter's
     * cv:v/meta:v lead-in *before* its `meta:c` marker (e.g. 1CO 10:33 then
     * 11:1 markers, then `meta:c` 11), so a naive byte-range scan would assign
     * the opening verse to the closing chapter.
     */
    const closingVersesBeforeChapterMarker = (
        segStart: number,
        markerPos: number,
        paraBodyEnd: number
    ): number[] => {
        const before = verseNumsInRange(segStart, markerPos);
        if (before.length === 0) return before;
        const after = verseNumsInRange(markerPos, paraBodyEnd);
        if (after.length === 0) return before;
        const openingLeadVerses = new Set(
            before.filter((v) => after.includes(v))
        );
        if (openingLeadVerses.size === 0) return before;
        return before.filter((v) => !openingLeadVerses.has(v));
    };

    // Emit a span over a WHOLE physical paragraph for an explicit verse range.
    // A study `p_dc1` / `p_dc2` boundary paragraph holds verses for two chapters
    // (e.g. the 35:35 tail and 36:1); each chapter gets a paragraph-aligned span over the
    // same paragraph so the XML stays well-formed, and structure swap's coalesce
    // step merges the two overlapping spans into one ordered replacement.
    //
    // When `clipChapterBoundarySpans` is set (Bible extraction blocks), each
    // chapter only receives the body slice on its side of the chapter marker so
    // merged blocks stay chapter-pure.
    const pushParagraphSpan = (
        book: string,
        chapter: string,
        fullStart: number,
        fullEnd: number,
        verseNums: number[],
        clippedBody?: { bodyFrom: number; bodyTo: number; paraFullStart: number; paraBodyStart: number; paraBodyEnd: number; paraFullEnd: number }
    ) => {
        if (!book || !chapter || verseNums.length === 0) return;
        const key = chapterBlockKey(book, chapter);
        const list = index.get(key) ?? [];
        let blockXml = storyXml.slice(fullStart, fullEnd);
        if (clippedBody) {
            const openTag = storyXml.slice(
                clippedBody.paraFullStart,
                clippedBody.paraBodyStart
            );
            const body = storyXml.slice(clippedBody.bodyFrom, clippedBody.bodyTo);
            const closeTag = storyXml.slice(
                clippedBody.paraBodyEnd,
                clippedBody.paraFullEnd
            );
            blockXml = `${openTag}${body}${closeTag}`;
        }
        list.push({
            book,
            chapter,
            absStart: fullStart,
            absEnd: fullEnd,
            blockXml,
            firstVerse: Math.min(...verseNums),
            lastVerse: Math.max(...verseNums),
        });
        index.set(key, list);
    };

    for (const para of getParagraphIndex(storyXml)) {
        const style = para.appliedParagraphStyle;

        if (isBookMarkerParagraphStyle(style)) {
            flushBlock();
            reopenAfterBoundary = false;
            let bookRaw = "";
            for (const c of iterateContentAbs(storyXml, para.bodyStart, para.bodyEnd)) {
                bookRaw += storyXml.slice(c.absInnerStart, c.absInnerEnd);
            }
            const code = extractBookCode(bookRaw);
            if (code) {
                currentBook = code;
                currentChapter = "";
            }
            continue;
        }

        const chapterInPara = readChapterTransitionFromParagraph(
            storyXml,
            para.appliedParagraphStyle,
            para.bodyStart,
            para.bodyEnd,
            currentBook
        );
        if (chapterInPara && chapterInPara !== currentChapter) {
            flushBlock();
            currentChapter = chapterInPara;
        }

        if (isIntroNotesOrTitleStyle(style) || isMetaParagraphStyle(style)) {
            flushBlock();
            reopenAfterBoundary = false;
            continue;
        }

        if (isHeadParagraphStyle(style)) {
            const includeSubheader =
                isPsalmSubheaderParagraphStyle(style) &&
                paragraphHasVerseMarker(storyXml, para.bodyStart, para.bodyEnd);
            if (includeSubheader) {
                // A superscription that carries a verse marker *is* a verse, in
                // the study file as much as in the Bible: Russian numbers Psalm
                // superscriptions as verse 1, and both HAB 3:1 files put the
                // prayer's heading in `head:d*`. It also carries the opening
                // chapter marker, so the block has to keep it either way.
                extendBlock(para.fullStart, para.fullEnd);
                continue;
            }
            // A mid-chapter section title (`head:s*`/`head:r*`) or speaker label
            // (`head:sp`) belongs to the chapter it sits in. Keep it inside the
            // open block so it travels with the verse text during a swap.
            if (
                blockStart >= 0 &&
                isRetainedHeadingParagraphStyle(style, options)
            ) {
                extendBlock(para.fullStart, para.fullEnd);
                continue;
            }
            const includeAcrostic =
                options?.retainAcrosticHeadings &&
                isAcrosticHeadingParagraphStyle(style) &&
                paragraphHasVerseMarker(storyXml, para.bodyStart, para.bodyEnd);
            if (includeAcrostic) {
                if (blockStart >= 0) {
                    extendBlock(para.fullStart, para.fullEnd);
                } else if (currentBook && currentChapter) {
                    blockStart = para.fullStart;
                    blockEnd = para.fullEnd;
                }
                continue;
            }
            flushBlock();
            continue;
        }

        if (!currentBook || !currentChapter || !isTextBlockParagraphStyle(style)) {
            if (
                currentBook &&
                !currentChapter &&
                isTextBlockParagraphStyle(style) &&
                paragraphHasVerseMarker(storyXml, para.bodyStart, para.bodyEnd)
            ) {
                currentChapter = "1";
            } else {
                continue;
            }
        }

        // A new chapter can OPEN partway through a text-block paragraph: study
        // `p_dc1` / `p_dc2` boundary paragraphs carry the previous chapter's closing
        // (and its tail verse, e.g. 35:35) followed by the next chapter's
        // opening meta:c and verse 1. The paragraph-start detection above only
        // sees the FIRST marker, so without this a mid-paragraph chapter start
        // would be missed and its verses mis-keyed to the prior chapter.
        const markers = [
            ...iterateChapterMarkersInParagraph(
                storyXml,
                para.bodyStart,
                para.bodyEnd
            ),
        ];
        const hasMidParagraphTransition = markers.some(
            (m) => m.chapter !== currentChapter
        );

        if (!hasMidParagraphTransition) {
            extendBlock(para.fullStart, para.fullEnd, reopenAfterBoundary);
            reopenAfterBoundary = false;
            continue;
        }

        // Boundary paragraph: close the block accumulated from prior paragraphs,
        // then split THIS paragraph's verses across the chapters it straddles.
        // Study mode keeps whole-paragraph spans for coalesce; Bible extraction
        // clips each side so merged chapter blocks stay pure.
        flushBlock();

        const clip = Boolean(options?.clipChapterBoundarySpans);
        let segBodyStart = para.bodyStart;
        let segChapter = currentChapter;
        for (const marker of markers) {
            if (marker.chapter === segChapter) {
                // `meta:c N` marks both where chapter N opens and where it
                // closes. When it opens the segment everything before it belongs
                // to the previous chapter, so the segment must start at the
                // marker. When it closes the segment the marker is preceded by
                // this chapter's own last line — the Portuguese Bible parks the
                // closing line of e.g. EXO 7:25 ahead of chapter 8's drop cap —
                // and advancing would drop that line from the chapter block.
                if (!hasVerseProseBetween(storyXml, segBodyStart, marker.absPos)) {
                    segBodyStart = marker.absPos;
                }
                continue;
            }
            const closingVerses = closingVersesBeforeChapterMarker(
                segBodyStart,
                marker.absPos,
                para.bodyEnd
            );
            pushParagraphSpan(
                currentBook,
                segChapter,
                para.fullStart,
                para.fullEnd,
                closingVerses,
                clip
                    ? {
                          bodyFrom: segBodyStart,
                          bodyTo: marker.absPos,
                          paraFullStart: para.fullStart,
                          paraBodyStart: para.bodyStart,
                          paraBodyEnd: para.bodyEnd,
                          paraFullEnd: para.fullEnd,
                      }
                    : undefined
            );
            segChapter = marker.chapter;
            segBodyStart = marker.absPos;
            currentChapter = marker.chapter;
        }
        const openingVerses = verseNumsInRange(segBodyStart, para.bodyEnd);
        pushParagraphSpan(
            currentBook,
            segChapter,
            para.fullStart,
            para.fullEnd,
            openingVerses,
            clip
                ? {
                      bodyFrom: segBodyStart,
                      bodyTo: para.bodyEnd,
                      paraFullStart: para.fullStart,
                      paraBodyStart: para.bodyStart,
                      paraBodyEnd: para.bodyEnd,
                      paraFullEnd: para.fullEnd,
                  }
                : undefined
        );
        reopenAfterBoundary = clip;
    }

    flushBlock();
    return index;
}

/** Merge all spans of a chapter into one block (Bible files are usually unsplit). */
export function mergeChapterSpans(spans: ChapterTextSpan[]): ChapterTextBlock {
    const range = getVerseRangeFromBlockXml(
        spans.map((s) => s.blockXml).join("")
    );
    return {
        book: spans[0].book,
        chapter: spans[0].chapter,
        absStart: spans[0].absStart,
        absEnd: spans[spans.length - 1].absEnd,
        blockXml: spans.map((s) => s.blockXml).join(""),
        firstVerse: range?.firstVerse,
        lastVerse: range?.lastVerse,
    };
}

/**
 * Build a single block per chapter (first span only — legacy).
 * @deprecated Prefer buildChapterSpanIndex for study files.
 */
export function buildChapterBlockIndex(
    storyXml: string,
    options?: BuildChapterBlockOptions
): ChapterBlockIndex {
    const spanIndex = buildChapterSpanIndex(storyXml, options);
    const index: ChapterBlockIndex = new Map();
    for (const [key, spans] of spanIndex) {
        if (spans.length === 0) continue;
        index.set(key, mergeChapterSpans(spans));
    }
    return index;
}

/** Last paragraph style in a block that carries a verse marker (for Psalm insertions). */
export function getLastVerseParagraphStyle(blockXml: string): string | undefined {
    let last: string | undefined;
    for (const para of iterateParagraphs(blockXml)) {
        if (paragraphHasVerseMarker(blockXml, para.bodyStart, para.bodyEnd)) {
            last = para.appliedParagraphStyle;
        }
    }
    return last;
}

/** True when the paragraph immediately before `blockStart` is a study `head:d_h`. */
export function studyHasEnglishSubheaderBefore(
    storyXml: string,
    blockStart: number
): boolean {
    const before = storyXml.lastIndexOf("<ParagraphStyleRange", blockStart - 1);
    if (before < 0) return false;
    const openEnd = storyXml.indexOf(">", before);
    if (openEnd === -1 || openEnd >= blockStart) return false;
    const openTag = storyXml.slice(before, openEnd + 1);
    if (!/head%3ad_h|head:d_h/.test(openTag)) return false;
    const close = storyXml.indexOf("</ParagraphStyleRange>", openEnd);
    if (close === -1 || close > blockStart) return false;
    const body = storyXml.slice(openEnd + 1, close);
    return !/CharacterStyle\/meta%3av|CharacterStyle\/meta:v/.test(body);
}

/** Remove a leading Bible `head:d_h` superscription PSR from a chapter block. */
export function stripLeadingBibleSubheaderPsr(blockXml: string): string {
    if (!blockXml.startsWith("<ParagraphStyleRange")) return blockXml;
    const openEnd = blockXml.indexOf(">");
    if (openEnd === -1) return blockXml;
    const openTag = blockXml.slice(0, openEnd + 1);
    if (!isPsalmSubheaderParagraphStyle(openTag)) return blockXml;
    const close = blockXml.indexOf("</ParagraphStyleRange>");
    if (close === -1) return blockXml;
    return blockXml.slice(close + "</ParagraphStyleRange>".length);
}
