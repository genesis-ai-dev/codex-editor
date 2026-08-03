/**
 * Surgical Bible Swap
 * ===================
 *
 * Content-only replacement: map translated text onto Study prose `<Content>`
 * slots while preserving Study CSR/paragraph structure.
 *
 * Designed to run in both the VS Code extension host and the browser webview
 * (no DOMParser dependency).
 *
 * See `BIBLE_TEXT_REPLACEMENT_APPROACH.md` for the algorithm overview.
 *
 * Key design points (matches the analysis doc):
 *  - Verses are bracketed by an OPENING `meta:v` marker and a CLOSING
 *    `meta:v` marker with the same verse number. The first occurrence of a
 *    verse number within the current chapter is the opening; the next
 *    occurrence is the closing.
 *  - A single verse may span MULTIPLE `<ParagraphStyleRange>` elements
 *    (e.g. a `text%3ap` paragraph, then a `text%3ap_sd` quoted-speech
 *    paragraph, then back to `text%3ap`). We collect all
 *    `$ID/[No character style]` `<Content>` text between the opening and
 *    closing markers, regardless of paragraph boundaries.
 *  - Replacement is content-only: map Bible text onto each prose `<Content>`
 *    slot in order (preserving tabs and line breaks). When Study and Bible
 *    use different paragraph layouts for poetry/lists (e.g. alternating q1/q2
 *    vs one consolidated paragraph), splice in the Bible's paragraph span.
 *    `<Br />` and styled CSRs (cv:v, nd, etc.) are never touched.
 *  - Psalms use versification mapping: English `head:d_h` superscriptions
 *    (no verse markers) are preserved; when the Bible encodes them as v1,
 *    study vN maps to bible v(N+1). Extra Bible verses are inserted at
 *    chapter end in matching paragraph style.
 */

import {
    PSA_BOOK_CODE,
    isPsalmSubheaderParagraphStyle,
    biblePsalmChapterHasSubheaderV1,
    resolveBibleKeyForStudyVerse,
    listChapterContentVerseNumbers,
    detectVerseSpacingChar,
    buildInsertedVersePsrXml,
} from "./psalmVersification";
import { readChapterTransitionFromParagraph } from "./chapterBlocks";
import { canonicalizeParagraphStyle } from "./paragraphStyleRoles";

import type {
    BibleVerseIndex,
    ParagraphChunkEntry,
    SwapStats,
    VerseEntry,
    VerseKey,
} from "./types";
import { verseKey, chapterBlockKey } from "./types";
import type { VersificationPlan } from "./versificationPlan";
import { resolveVersePlan } from "./versificationPlan";

export type { BibleVerseIndex, ParagraphChunkEntry, SwapStats, VerseEntry, VerseKey };
export { verseKey };

/** Strip everything except digits from a marker like "1:" / "1." / " 3 ". */
export function digitsOnly(s: string): string {
    return (s || "").replace(/[^0-9]/g, "");
}

/**
 * Parse a `meta:c` marker's `<Content>` text into a chapter number.
 * InDesign verse-range anchors (`<?ACE 3?>`) are not chapter transitions.
 */
export function parseChapterMarkerContent(text: string): string | null {
    const trimmed = (text || "").trim();
    if (!trimmed) return null;
    const decoded = trimmed
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&amp;/gi, "&");
    if (/^<\?ACE/i.test(decoded) || /^<\?ACE/i.test(trimmed)) return null;
    if (/ACE\s*\d/i.test(trimmed) && !/^\d+\s*:/.test(trimmed)) return null;
    const cnum = digitsOnly(trimmed);
    return cnum || null;
}

function escapeXml(s: string): string {
    return (s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Low-level walkers (regex-based, work in any JS env)
// ---------------------------------------------------------------------------

interface ElementMatch {
    fullStart: number;
    fullEnd: number;
    openTag: string;
    bodyStart: number;
    bodyEnd: number;
}

/**
 * Iterate top-level elements of `elementName` within `[regionStart, regionEnd)`.
 *
 * Critical: handles NESTED elements with the same name correctly. IDML
 * Footnotes embed a `<ParagraphStyleRange>` inside the parent paragraph's
 * `<CharacterStyleRange>`, and any plain regex walker that doesn't track
 * depth will get its boundaries wrong (matching the inner close before the
 * outer one). This walker uses depth counting and only yields elements at
 * the outermost level of the region.
 */
export function* iterateTopLevelElements(
    xml: string,
    regionStart: number,
    regionEnd: number,
    elementName: string
): IterableIterator<ElementMatch> {
    const openPrefix = `<${elementName}`;
    const closeTag = `</${elementName}>`;
    const isAfterPrefix = (ch: string) =>
        ch === " " || ch === ">" || ch === "/" || ch === "\t" || ch === "\n" || ch === "\r";

    const findNextOpen = (from: number): number => {
        let s = from;
        while (s < regionEnd) {
            const idx = xml.indexOf(openPrefix, s);
            if (idx === -1 || idx >= regionEnd) return -1;
            const next = xml[idx + openPrefix.length];
            if (isAfterPrefix(next)) return idx;
            s = idx + openPrefix.length;
        }
        return -1;
    };
    const findNextClose = (from: number): number => {
        const idx = xml.indexOf(closeTag, from);
        if (idx === -1 || idx >= regionEnd) return -1;
        return idx;
    };

    let i = regionStart;
    while (i < regionEnd) {
        const openIdx = findNextOpen(i);
        if (openIdx === -1) break;
        const openTagEnd = xml.indexOf(">", openIdx);
        if (openTagEnd === -1 || openTagEnd >= regionEnd) break;
        const openTag = xml.slice(openIdx, openTagEnd + 1);
        const isSelfClosing = xml[openTagEnd - 1] === "/";
        if (isSelfClosing) {
            yield {
                fullStart: openIdx,
                fullEnd: openTagEnd + 1,
                openTag,
                bodyStart: openTagEnd + 1,
                bodyEnd: openTagEnd,
            };
            i = openTagEnd + 1;
            continue;
        }
        // Walk forward, counting nested opens/closes of this element name,
        // until we find the matching close at depth 0.
        let depth = 1;
        let scan = openTagEnd + 1;
        let matchedClose = -1;
        while (depth > 0 && scan < regionEnd) {
            const nextOpen = findNextOpen(scan);
            const nextClose = findNextClose(scan);
            if (nextClose === -1) break;
            if (nextOpen !== -1 && nextOpen < nextClose) {
                const innerOpenEnd = xml.indexOf(">", nextOpen);
                if (innerOpenEnd === -1 || innerOpenEnd >= regionEnd) break;
                const innerSelf = xml[innerOpenEnd - 1] === "/";
                if (!innerSelf) depth++;
                scan = innerOpenEnd + 1;
            } else {
                depth--;
                if (depth === 0) {
                    matchedClose = nextClose;
                    break;
                }
                scan = nextClose + closeTag.length;
            }
        }
        if (matchedClose === -1) break;
        const bodyStart = openTagEnd + 1;
        const bodyEnd = matchedClose;
        const fullEnd = matchedClose + closeTag.length;
        yield { fullStart: openIdx, fullEnd, openTag, bodyStart, bodyEnd };
        i = fullEnd;
    }
}

interface ParagraphMatch extends ElementMatch {
    appliedParagraphStyle: string;
}

export function* iterateParagraphs(storyXml: string): IterableIterator<ParagraphMatch> {
    yield* iterateParagraphsInRange(storyXml, 0, storyXml.length);
}

/** Iterate top-level paragraphs whose `<ParagraphStyleRange>` starts before `regionEnd`. */
export function* iterateParagraphsInRange(
    storyXml: string,
    regionStart: number,
    regionEnd: number
): IterableIterator<ParagraphMatch> {
    for (const el of iterateTopLevelElements(
        storyXml,
        regionStart,
        regionEnd,
        "ParagraphStyleRange"
    )) {
        if (el.fullEnd <= regionStart || el.fullStart >= regionEnd) continue;
        const styleMatch = el.openTag.match(/AppliedParagraphStyle="([^"]+)"/);
        yield {
            ...el,
            appliedParagraphStyle: canonicalizeParagraphStyle(
                styleMatch ? styleMatch[1] : ""
            ),
        };
    }
}

interface CsrMatch {
    /** Absolute position in the full story XML. */
    absFullStart: number;
    absFullEnd: number;
    absBodyStart: number;
    absBodyEnd: number;
    appliedCharacterStyle: string;
}

/**
 * Iterate top-level CSRs inside a paragraph body. Skips any CSRs nested
 * inside a `<Footnote>` block (which carry their own meta:v markers and
 * would otherwise corrupt verse detection).
 */
export function* iterateCsrAbs(
    storyXml: string,
    bodyStart: number,
    bodyEnd: number
): IterableIterator<CsrMatch> {
    for (const el of iterateTopLevelElements(
        storyXml,
        bodyStart,
        bodyEnd,
        "CharacterStyleRange"
    )) {
        const styleMatch = el.openTag.match(/AppliedCharacterStyle="([^"]+)"/);
        yield {
            absFullStart: el.fullStart,
            absFullEnd: el.fullEnd,
            absBodyStart: el.bodyStart,
            absBodyEnd: el.bodyEnd,
            appliedCharacterStyle: styleMatch ? styleMatch[1] : "",
        };
    }
}

interface ContentMatch {
    /** Absolute position of the opening `<Content>` tag in the story XML. */
    absStart: number;
    /** Absolute position right after the closing `</Content>` tag. */
    absEnd: number;
    /** Position of the inner text start (right after `<Content>`). */
    absInnerStart: number;
    /** Position of the inner text end (right before `</Content>`). */
    absInnerEnd: number;
}

/**
 * Iterate `<Content>...</Content>` matches inside a region of the story XML.
 * Inline `<Footnote>...</Footnote>` regions are SKIPPED so footnote prose
 * does not pollute verse content. The Bible IDML occasionally embeds
 * footnotes inside a verse's `[No character style]` CSR.
 *
 * Hot path: most CSRs do NOT contain a footnote — we detect that with one
 * `indexOf` before doing the more expensive depth-tracking scan.
 */
export function* iterateContentAbs(
    storyXml: string,
    regionStart: number,
    regionEnd: number
): IterableIterator<ContentMatch> {
    // Quick check: does this region contain a Footnote at all?
    const fnProbe = storyXml.indexOf("<Footnote", regionStart);
    const hasFootnote = fnProbe !== -1 && fnProbe < regionEnd;

    let footnoteRanges: Array<[number, number]> | null = null;
    if (hasFootnote) {
        footnoteRanges = [];
        for (const fn of iterateTopLevelElements(
            storyXml,
            regionStart,
            regionEnd,
            "Footnote"
        )) {
            footnoteRanges.push([fn.fullStart, fn.fullEnd]);
        }
    }

    const re = /<Content>([\s\S]*?)<\/Content>/g;
    re.lastIndex = regionStart;
    let m: RegExpExecArray | null;
    while ((m = re.exec(storyXml)) !== null) {
        if (m.index >= regionEnd) break;
        const absStart = m.index;
        const absEnd = absStart + m[0].length;
        if (absEnd > regionEnd) break;
        if (footnoteRanges) {
            let inFootnote = false;
            for (const [s, e] of footnoteRanges) {
                if (absStart >= s && absEnd <= e) {
                    inFootnote = true;
                    break;
                }
            }
            if (inFootnote) continue;
        }
        const absInnerStart = absStart + "<Content>".length;
        const absInnerEnd = absEnd - "</Content>".length;
        yield { absStart, absEnd, absInnerStart, absInnerEnd };
    }
}

// ---------------------------------------------------------------------------
// Style classification
// ---------------------------------------------------------------------------

export function isBookMarkerParagraphStyle(style: string): boolean {
    return /(?:^|\/)meta%3abk(?:_|$|\b)/.test(style) || /(?:^|\/)meta:bk/.test(style);
}

/**
 * Extract a canonical SBL book code (e.g. "GEN", "EXO", "1KI", "PSA") from the
 * raw text of a `meta:bk` paragraph. The notes export pipeline can prefix or
 * suffix translated content onto the book paragraph (e.g. it may end up as
 * "[PT] GEN"), so we cannot blindly trust the whole content as the book code.
 *
 * Strategy:
 *   1. Look for a substring matching the standard SBL pattern: 3 uppercase
 *      ASCII letters, or 1-3 followed by 2 uppercase letters (numbered books
 *      like "1KI", "2CO"). Returns the FIRST match.
 *   2. Fall back to the whitespace-trimmed input when no match is found
 *      (preserves prior behaviour for malformed or unexpected formats).
 */
export function extractBookCode(rawText: string): string {
    if (!rawText) return "";
    const trimmed = rawText.replace(/\s+/g, " ").trim();
    // Match a standalone SBL-style code at a word boundary.
    const m = trimmed.match(/\b(?:[1-3][A-Z]{2}|[A-Z]{3})\b/);
    if (m) return m[0];
    return trimmed;
}

/**
 * Paragraphs whose verse content should be replaced. We deliberately exclude
 * `intro:*`, `meta:*`, `title:*`, `notes:*` paragraphs entirely (study notes
 * and structural metadata). Everything else (text paragraphs and blank
 * spacing paragraphs) is in scope.
 */
interface WalkStoryOptions {
    /**
     * When true (Bible index build), include `head:d_h` superscription paragraphs
     * that carry meta:v markers. Study apply pass keeps them excluded so English
     * subheaders without verse markers stay untouched.
     */
    indexBibleSubheaders?: boolean;
    /**
     * When true (Bible index build), include `head:qa` acrostic letter headings
     * that carry meta:v markers (e.g. Marathi PSA 119 Beth/Gimel lines).
     */
    indexAcrosticHeadings?: boolean;
    regionStart?: number;
    regionEnd?: number;
}

function cloneOpenVerse(closed: OpenVerse): OpenVerse {
    return {
        book: closed.book,
        chapter: closed.chapter,
        verse: closed.verse,
        parts: [...closed.parts],
        contentPositions: closed.contentPositions.map((p) => ({ ...p })),
        paragraphStart: closed.paragraphStart,
        paragraphEnd: closed.paragraphEnd,
        paragraphChunks: closed.paragraphChunks.map((c) => ({
            paragraphStyle: c.paragraphStyle,
            paragraphStart: c.paragraphStart,
            proseParts: [...c.proseParts],
            prosePositions: c.prosePositions.map((p) => ({ ...p })),
        })),
    };
}

export interface StudyBookRegion {
    book: string;
    start: number;
    end: number;
}

export interface StudyStoryScan {
    studyIndex: BibleVerseIndex;
    closedVerses: OpenVerse[];
    chapterTransitions: Array<{
        book: string;
        chapter: string;
        context: ChapterEndContext;
    }>;
}

/** Locate contiguous book regions in a multi-book Study story XML. */
export function findStudyBookRegions(storyXml: string): StudyBookRegion[] {
    const regions: StudyBookRegion[] = [];
    let pending: { book: string; start: number } | null = null;

    for (const para of iterateParagraphs(storyXml)) {
        if (!isBookMarkerParagraphStyle(para.appliedParagraphStyle)) continue;
        let bookRaw = "";
        for (const c of iterateContentAbs(storyXml, para.bodyStart, para.bodyEnd)) {
            bookRaw += storyXml.slice(c.absInnerStart, c.absInnerEnd);
        }
        const code = extractBookCode(bookRaw);
        if (!code) continue;
        if (pending) {
            regions.push({ book: pending.book, start: pending.start, end: para.fullStart });
        }
        pending = { book: code, start: para.fullStart };
    }
    if (pending) {
        regions.push({ book: pending.book, start: pending.start, end: storyXml.length });
    }
    return regions;
}

export function mergeStudyStoryScans(scans: StudyStoryScan[]): StudyStoryScan {
    const studyIndex: BibleVerseIndex = new Map();
    const closedVerses: OpenVerse[] = [];
    const chapterTransitions: StudyStoryScan["chapterTransitions"] = [];
    for (const scan of scans) {
        for (const [key, entry] of scan.studyIndex) {
            if (!studyIndex.has(key)) studyIndex.set(key, entry);
        }
        closedVerses.push(...scan.closedVerses);
        chapterTransitions.push(...scan.chapterTransitions);
    }
    return { studyIndex, closedVerses, chapterTransitions };
}

/**
 * Single-pass scan of Study story XML: build the verse index and capture closed
 * verses + chapter boundaries for surgical swap (avoids a second full walk).
 */
export function scanStudyStoryForSwap(
    storyXml: string,
    options?: { regionStart?: number; regionEnd?: number }
): StudyStoryScan {
    const studyIndex: BibleVerseIndex = new Map();
    const closedVerses: OpenVerse[] = [];
    const chapterTransitions: StudyStoryScan["chapterTransitions"] = [];

    walkStory(
        storyXml,
        (closed) => {
            const key = verseKey(closed.book, closed.chapter, closed.verse);
            if (!studyIndex.has(key)) {
                const proseParts = closed.parts.filter(isProseSegment);
                const openingStyle = closed.paragraphChunks[0]?.paragraphStyle ?? "";
                studyIndex.set(key, {
                    text: cleanWhitespace(proseParts.join(" ")),
                    segments: [...proseParts],
                    paragraphSig: buildParagraphSig(closed.paragraphChunks),
                    paragraphChunks: closed.paragraphChunks.map((c) => ({
                        paragraphStyle: c.paragraphStyle,
                        proseSegments: c.proseParts.filter(isProseSegment),
                    })),
                    verseSpanXml: "",
                    isSubheader:
                        isPsalmSubheaderParagraphStyle(openingStyle) ||
                        isAcrosticHeadingParagraphStyle(openingStyle),
                });
            }
            closedVerses.push(cloneOpenVerse(closed));
        },
        (book, chapter, context) => {
            chapterTransitions.push({
                book,
                chapter,
                context: {
                    lastContent: context.lastContent ? { ...context.lastContent } : null,
                    lastParagraphEnd: context.lastParagraphEnd,
                    lastVerseParagraphStyle: context.lastVerseParagraphStyle,
                },
            });
        },
        options
    );

    return { studyIndex, closedVerses, chapterTransitions };
}

/** Psalm acrostic section letter headings (`head:qa`, `head:qb`, …). */
export function isAcrosticHeadingParagraphStyle(style: string): boolean {
    const s = style.replace(/^ParagraphStyle\//, "");
    return (
        /(?:^|\/)head%3aq[a-z](?:$|\b)/.test(s) ||
        /(?:^|\/)head:q[a-z](?:$|\b)/.test(s)
    );
}

function isReplaceableParagraphStyle(
    style: string,
    options?: WalkStoryOptions
): boolean {
    // Direct exclusions
    if (/(?:^|\/)(?:intro|title|notes)%3a/.test(style)) return false;
    if (/(?:^|\/)(?:intro|title|notes):/.test(style)) return false;
    if (options?.indexBibleSubheaders && isPsalmSubheaderParagraphStyle(style)) {
        return true;
    }
    if (options?.indexAcrosticHeadings && isAcrosticHeadingParagraphStyle(style)) {
        return true;
    }
    // Psalm / section headings (head:cl, head:d_h) — preserve in Study apply.
    if (/(?:^|\/)head%3a/.test(style) || /(?:^|\/)head:/.test(style)) return false;
    // meta:* paragraphs are also excluded (including meta:bk, which is
    // handled separately by the caller before reaching this check).
    if (/(?:^|\/)meta%3a/.test(style) || /(?:^|\/)meta:/.test(style)) return false;
    return true;
}

export function isChapterMarkerStyle(style: string): boolean {
    return /(?:^|\/)meta%3ac(?:$|\b)/.test(style) || /(?:^|\/)meta:c(?:$|\b)/.test(style);
}

export function isVerseMarkerStyle(style: string): boolean {
    return /(?:^|\/)meta%3av(?:$|\b)/.test(style) || /(?:^|\/)meta:v(?:$|\b)/.test(style);
}

export function isCvVerseMarkerStyle(style: string): boolean {
    return (
        /(?:^|\/)cv%3av(?:$|\b)/.test(style) ||
        /(?:^|\/)cv:v(?:$|\b)/.test(style)
    );
}

function isNoStyleContentStyle(style: string): boolean {
    return /\$ID\/\[No character style\]/.test(style) || /\$ID\/%5BNo character style%5D/.test(style);
}

function isProseSegment(text: string): boolean {
    if (!text.trim()) return false;
    if (/^<\?ACE/.test(text.trim())) return false;
    if (text === " " || text === "\u2009" || text === "\u00A0") return false;
    return true;
}

function normalizeParagraphStyle(style: string): string {
    return style
        .replace(/^ParagraphStyle\//, "")
        .replace(/%3a/g, ":")
        .replace(/%5B/g, "[")
        .replace(/%5D/g, "]");
}

function buildParagraphSig(chunks: Array<{ paragraphStyle: string }>): string {
    return chunks.map((c) => normalizeParagraphStyle(c.paragraphStyle)).join("|");
}

function isPoetryParagraphSig(sig: string): boolean {
    return /text:q[12]|text:li[0-9]/.test(sig);
}

function findPoetryLeadInStart(storyXml: string, verseParagraphStart: number): number {
    const before = storyXml.lastIndexOf("<ParagraphStyleRange", verseParagraphStart - 1);
    if (before < 0) return verseParagraphStart;
    const openEnd = storyXml.indexOf(">", before);
    if (openEnd === -1 || openEnd >= verseParagraphStart) return verseParagraphStart;
    const openTag = storyXml.slice(before, openEnd + 1);
    const styleMatch = openTag.match(/AppliedParagraphStyle="([^"]+)"/);
    if (!styleMatch) return verseParagraphStart;
    const style = normalizeParagraphStyle(styleMatch[1]);
    if (/(?:^|\/)b_poetry(?:_|$|\b)/.test(style) || /(?:^|\/)b(?:_|$|\b)/.test(style)) {
        return before;
    }
    return verseParagraphStart;
}

// ---------------------------------------------------------------------------
// Streaming verse walker
// ---------------------------------------------------------------------------

interface ContentPosition {
    /** Position of the `<Content>` opening tag inside the story XML. */
    absStart: number;
    absEnd: number;
    absInnerStart: number;
    absInnerEnd: number;
    /** Original text inside this `<Content>` (for stats / append-extras). */
    originalText: string;
}

interface ParagraphChunkState {
    paragraphStyle: string;
    paragraphStart: number;
    proseParts: string[];
    prosePositions: ContentPosition[];
}

interface OpenVerse {
    book: string;
    chapter: string;
    verse: string;
    parts: string[];
    contentPositions: ContentPosition[];
    paragraphStart: number;
    paragraphEnd: number;
    paragraphChunks: ParagraphChunkState[];
}

function ensureParagraphChunk(openVerse: OpenVerse, para: ParagraphMatch): ParagraphChunkState {
    const last = openVerse.paragraphChunks[openVerse.paragraphChunks.length - 1];
    if (!last || last.paragraphStart !== para.fullStart) {
        const chunk: ParagraphChunkState = {
            paragraphStyle: para.appliedParagraphStyle,
            paragraphStart: para.fullStart,
            proseParts: [],
            prosePositions: [],
        };
        openVerse.paragraphChunks.push(chunk);
        return chunk;
    }
    return last;
}

/**
 * Acrostic headings (`head:qa`) place prose before a single meta:v marker.
 * Normal CSR order would open the verse only after that prose is skipped.
 */
function buildAcrosticVerseFromParagraph(
    storyXml: string,
    para: ParagraphMatch,
    book: string,
    chapter: string
): OpenVerse | null {
    let verseNum = "";
    const parts: string[] = [];
    const contentPositions: ContentPosition[] = [];
    const paragraphChunks: ParagraphChunkState[] = [];
    const chunk: ParagraphChunkState = {
        paragraphStyle: para.appliedParagraphStyle,
        paragraphStart: para.fullStart,
        proseParts: [],
        prosePositions: [],
    };
    paragraphChunks.push(chunk);

    for (const csr of iterateCsrAbs(storyXml, para.bodyStart, para.bodyEnd)) {
        if (isVerseMarkerStyle(csr.appliedCharacterStyle)) {
            const vnum = digitsOnly(
                collectContentText(storyXml, csr.absBodyStart, csr.absBodyEnd)
            );
            if (vnum && !verseNum) verseNum = vnum;
            continue;
        }
        if (!isNoStyleContentStyle(csr.appliedCharacterStyle)) continue;
        for (const content of iterateContentAbs(
            storyXml,
            csr.absBodyStart,
            csr.absBodyEnd
        )) {
            const originalText = storyXml.slice(
                content.absInnerStart,
                content.absInnerEnd
            );
            const pos: ContentPosition = {
                absStart: content.absStart,
                absEnd: content.absEnd,
                absInnerStart: content.absInnerStart,
                absInnerEnd: content.absInnerEnd,
                originalText,
            };
            parts.push(originalText);
            contentPositions.push(pos);
            if (isProseSegment(originalText)) {
                chunk.proseParts.push(originalText);
                chunk.prosePositions.push(pos);
            }
        }
    }

    if (!verseNum || !chunk.proseParts.some(isProseSegment)) return null;
    return {
        book,
        chapter,
        verse: verseNum,
        parts,
        contentPositions,
        paragraphStart: para.fullStart,
        paragraphEnd: para.fullEnd,
        paragraphChunks,
    };
}

export interface ChapterEndContext {
    lastContent: ContentPosition | null;
    lastParagraphEnd: number;
    lastVerseParagraphStyle: string;
}

type VerseHandler = (
    closed: OpenVerse,
    lastNoStyleContent: ContentPosition | null
) => void;

/**
 * Stream-scan the story XML one paragraph at a time. Maintain book/chapter
 * state. For every replaceable paragraph, walk its CSRs and emit verse
 * open/close events.
 *
 * The walker calls `onVerseClosed` whenever a verse is fully bracketed
 * (open + close seen). It also tracks "the last `[No character style]`
 * Content node seen in the current chapter" so callers can append extras.
 */
function walkStory(
    storyXml: string,
    onVerseClosed: VerseHandler,
    onChapterTransition?: (
        book: string,
        chapter: string,
        context: ChapterEndContext
    ) => void,
    options?: WalkStoryOptions
): void {
    const regionStart = options?.regionStart ?? 0;
    const regionEnd = options?.regionEnd ?? storyXml.length;
    let currentBook = "";
    let currentChapter = "";
    let openVerse: OpenVerse | null = null;
    let lastChapterNoStyle: ContentPosition | null = null;
    let lastParagraphEndForChapter = 0;
    let lastVerseParagraphStyle = "";

    const flushChapter = () => {
        if (currentBook && currentChapter && onChapterTransition) {
            onChapterTransition(currentBook, currentChapter, {
                lastContent: lastChapterNoStyle,
                lastParagraphEnd: lastParagraphEndForChapter,
                lastVerseParagraphStyle,
            });
        }
        lastChapterNoStyle = null;
        lastParagraphEndForChapter = 0;
        lastVerseParagraphStyle = "";
    };

    for (const para of iterateParagraphsInRange(storyXml, regionStart, regionEnd)) {
        if (isBookMarkerParagraphStyle(para.appliedParagraphStyle)) {
            // New book: emit any still-open verse, then flush chapter extras.
            if (openVerse?.parts.some(isProseSegment)) {
                onVerseClosed(openVerse, lastChapterNoStyle);
            }
            openVerse = null;
            flushChapter();
            // Concatenate ALL `<Content>` text inside the book paragraph, then
            // extract a canonical SBL code from it. The notes export pipeline
            // can prefix translated content onto this paragraph (e.g.
            // "[PT] GEN"), so we must not blindly use whatever string is there.
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
            // Poetry chapters often open the final verse with a single meta:v /
            // cv:v and never emit a closing marker (Portuguese LAM 1:22). Emit
            // the open verse before leaving the chapter so it is not dropped.
            if (openVerse?.parts.some(isProseSegment)) {
                onVerseClosed(openVerse, lastChapterNoStyle);
            }
            openVerse = null;
            flushChapter();
            currentChapter = chapterInPara;
        }

        if (!isReplaceableParagraphStyle(para.appliedParagraphStyle, options)) {
            // intro / title / notes / other meta — skip without touching state.
            continue;
        }

        if (
            options?.indexAcrosticHeadings &&
            isAcrosticHeadingParagraphStyle(para.appliedParagraphStyle) &&
            currentBook &&
            currentChapter
        ) {
            if (openVerse?.parts.some(isProseSegment)) {
                onVerseClosed(openVerse, lastChapterNoStyle);
            }
            openVerse = null;
            const acrosticVerse = buildAcrosticVerseFromParagraph(
                storyXml,
                para,
                currentBook,
                currentChapter
            );
            if (acrosticVerse) {
                onVerseClosed(acrosticVerse, lastChapterNoStyle);
                lastParagraphEndForChapter = para.fullEnd;
                lastVerseParagraphStyle = para.appliedParagraphStyle;
            }
            continue;
        }

        for (const csr of iterateCsrAbs(storyXml, para.bodyStart, para.bodyEnd)) {
            if (isChapterMarkerStyle(csr.appliedCharacterStyle)) {
                // A new chapter can OPEN partway through a paragraph: study
                // "dc2" boundary paragraphs hold the previous chapter's closing
                // meta:c AND the next chapter's opening meta:c (followed by that
                // chapter's verse 1). The paragraph-start detection above only
                // sees the FIRST marker, so handle a mid-paragraph chapter
                // start here. Verse content after this marker is keyed to the
                // new chapter; the fragment before it stays with the old one.
                const markerChapter = parseChapterMarkerContent(
                    collectContentText(storyXml, csr.absBodyStart, csr.absBodyEnd)
                );
                if (
                    markerChapter &&
                    currentBook &&
                    markerChapter !== currentChapter
                ) {
                    // The new chapter implicitly closes any open verse.
                    if (openVerse?.parts.some(isProseSegment)) {
                        onVerseClosed(openVerse, lastChapterNoStyle);
                    }
                    openVerse = null;
                    flushChapter();
                    currentChapter = markerChapter;
                }
                continue;
            }
            if (isCvVerseMarkerStyle(csr.appliedCharacterStyle)) {
                // Poetry lead-in paragraphs use cv:v alone; when meta:v is also
                // present in the same paragraph, meta:v owns open/close.
                let paraHasMetaV = false;
                for (const peer of iterateCsrAbs(
                    storyXml,
                    para.bodyStart,
                    para.bodyEnd
                )) {
                    if (isVerseMarkerStyle(peer.appliedCharacterStyle)) {
                        paraHasMetaV = true;
                        break;
                    }
                }
                if (paraHasMetaV) continue;

                const text = collectContentText(
                    storyXml,
                    csr.absBodyStart,
                    csr.absBodyEnd
                );
                const vnum = digitsOnly(text);
                if (!vnum) continue;
                if (!currentBook || !currentChapter) {
                    if (currentBook && !currentChapter) {
                        currentChapter = "1";
                    } else {
                        continue;
                    }
                }
                if (
                    openVerse &&
                    openVerse.chapter === currentChapter &&
                    openVerse.verse !== vnum &&
                    openVerse.parts.some(isProseSegment)
                ) {
                    onVerseClosed(openVerse, lastChapterNoStyle);
                }
                openVerse = {
                    book: currentBook,
                    chapter: currentChapter,
                    verse: vnum,
                    parts: [],
                    contentPositions: [],
                    paragraphStart: findPoetryLeadInStart(
                        storyXml,
                        para.fullStart
                    ),
                    paragraphEnd: para.fullEnd,
                    paragraphChunks: [],
                };
                continue;
            }
            if (isVerseMarkerStyle(csr.appliedCharacterStyle)) {
                const text = collectContentText(storyXml, csr.absBodyStart, csr.absBodyEnd);
                const vnum = digitsOnly(text);
                if (!vnum) continue;
                if (openVerse && openVerse.verse === vnum) {
                    // Closing marker: finalize the verse.
                    onVerseClosed(openVerse, lastChapterNoStyle);
                    openVerse = null;
                } else {
                    // Opening marker (either fresh, or implicit close of a
                    // previous unclosed verse). Per the Python analyzer's
                    // first-occurrence-wins behaviour, we discard any prior
                    // unclosed verse.
                    if (!currentBook || !currentChapter) {
                        // Single-chapter books often omit meta:c in the Bible.
                        if (currentBook && !currentChapter) {
                            currentChapter = "1";
                        } else {
                            continue;
                        }
                    }
                    // Recover a verse whose closing marker is missing. Some study
                    // layouts omit the second meta:v for a short one-line verse
                    // (e.g. PRO 1:7), so the verse stays open until the NEXT
                    // verse's marker arrives. If that marker is the following
                    // verse in sequence and the open verse gathered real prose,
                    // emit it instead of dropping it. A repeated or lower number
                    // is treated as a duplicate and still discarded (preserving
                    // first-occurrence-wins for pull-quotes / cross-references).
                    if (
                        openVerse &&
                        openVerse.chapter === currentChapter &&
                        Number(vnum) > Number(openVerse.verse) &&
                        openVerse.parts.some(isProseSegment)
                    ) {
                        onVerseClosed(openVerse, lastChapterNoStyle);
                    }
                    openVerse = {
                        book: currentBook,
                        chapter: currentChapter,
                        verse: vnum,
                        parts: [],
                        contentPositions: [],
                        paragraphStart: findPoetryLeadInStart(storyXml, para.fullStart),
                        paragraphEnd: para.fullEnd,
                        paragraphChunks: [],
                    };
                }
                continue;
            }
            if (isNoStyleContentStyle(csr.appliedCharacterStyle)) {
                // Track every <Content> node inside this CSR so the caller
                // can splice into it (or append extras at chapter end).
                for (const content of iterateContentAbs(
                    storyXml,
                    csr.absBodyStart,
                    csr.absBodyEnd
                )) {
                    const originalText = storyXml.slice(
                        content.absInnerStart,
                        content.absInnerEnd
                    );
                    const pos: ContentPosition = {
                        absStart: content.absStart,
                        absEnd: content.absEnd,
                        absInnerStart: content.absInnerStart,
                        absInnerEnd: content.absInnerEnd,
                        originalText,
                    };
                    lastChapterNoStyle = pos;
                    if (openVerse) {
                        const chunk = ensureParagraphChunk(openVerse, para);
                        openVerse.parts.push(originalText);
                        openVerse.contentPositions.push(pos);
                        if (isProseSegment(originalText)) {
                            chunk.proseParts.push(originalText);
                            chunk.prosePositions.push(pos);
                        }
                        lastParagraphEndForChapter = para.fullEnd;
                        lastVerseParagraphStyle = para.appliedParagraphStyle;
                    }
                }
                continue;
            }
            // Other styled CSRs (cv:v, cv:dc, etc.) are ignored.
        }
        if (openVerse) {
            openVerse.paragraphEnd = para.fullEnd;
            lastParagraphEndForChapter = para.fullEnd;
            lastVerseParagraphStyle = para.appliedParagraphStyle;
        }
    }

    // End of document: emit any still-open final verse, then flush chapter.
    if (openVerse?.parts.some(isProseSegment)) {
        onVerseClosed(openVerse, lastChapterNoStyle);
    }
    openVerse = null;
    flushChapter();
}

/** Collect the concatenated text inside every `<Content>` node in a region. */
export function collectContentText(storyXml: string, regionStart: number, regionEnd: number): string {
    let out = "";
    for (const c of iterateContentAbs(storyXml, regionStart, regionEnd)) {
        out += storyXml.slice(c.absInnerStart, c.absInnerEnd);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Verse text mapping (multi-line / poetry)
// ---------------------------------------------------------------------------

function getProsePositions(positions: ContentPosition[]): ContentPosition[] {
    return positions.filter((p) => isProseSegment(p.originalText));
}

function normalizeSegmentText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/**
 * Some Bible IDML verses repeat the same prose in multiple `<Content>` nodes
 * (e.g. poetry layout). Treat those as a single segment so we do not paste the
 * full verse into every Study slot.
 */
function collapseRedundantBibleSegments(segments: string[]): string[] {
    if (segments.length <= 1) return segments;
    const nonEmpty = segments.filter((s) => normalizeSegmentText(s).length > 0);
    if (nonEmpty.length <= 1) return nonEmpty.length === 1 ? [nonEmpty[0]] : segments;
    const first = normalizeSegmentText(nonEmpty[0]);
    if (nonEmpty.every((s) => normalizeSegmentText(s) === first)) {
        return [nonEmpty[0]];
    }
    return segments;
}

function preserveLeadingWhitespace(original: string, replacement: string): string {
    const lead = original.match(/^[\t\u2009\u00A0]*/)?.[0] ?? "";
    if (!lead) return replacement;
    const body = replacement.replace(/^[\t\u2009\u00A0]*/, "");
    return lead + body;
}

/**
 * Map Bible prose segments onto Study prose `<Content>` slots in order.
 * When counts differ, split or merge using Study line weights.
 */
function mapProseSegmentsToSlots(
    bibleSegments: string[],
    studyProsePositions: ContentPosition[]
): Map<number, string> {
    const out = new Map<number, string>();
    const nStudy = studyProsePositions.length;
    if (nStudy === 0) return out;

    const studyTexts = studyProsePositions.map((p) => p.originalText);
    const collapsedSegments = collapseRedundantBibleSegments(bibleSegments);
    const nBible = collapsedSegments.length;

    if (nBible === 0) {
        for (const p of studyProsePositions) {
            out.set(p.absInnerStart, "");
        }
        return out;
    }

    let mapped: string[];
    if (nStudy === nBible) {
        mapped = collapsedSegments;
    } else if (nBible === 1 && nStudy > 1) {
        mapped = splitTextByStudyWeights(collapsedSegments[0], studyTexts);
    } else if (nBible > nStudy) {
        mapped = collapsedSegments.slice(0, nStudy - 1);
        mapped.push(collapsedSegments.slice(nStudy - 1).join(" "));
    } else {
        mapped = [...collapsedSegments];
        while (mapped.length < nStudy) mapped.push("");
    }

    for (let i = 0; i < nStudy; i++) {
        const text = preserveLeadingWhitespace(
            studyTexts[i],
            mapped[i] ?? ""
        );
        out.set(studyProsePositions[i].absInnerStart, text);
    }
    return out;
}

function splitTextByStudyWeights(bibleText: string, studyOriginals: string[]): string[] {
    const weights = studyOriginals.map((s) => Math.max(s.trim().length, 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const words = bibleText.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return studyOriginals.map(() => "");
    }

    const parts: string[] = [];
    let wordIdx = 0;
    for (let i = 0; i < weights.length; i++) {
        const isLast = i === weights.length - 1;
        const share = isLast
            ? words.length - wordIdx
            : Math.max(1, Math.round((weights[i] / total) * words.length));
        const slice = words.slice(wordIdx, wordIdx + share);
        wordIdx += slice.length;
        parts.push(slice.join(" "));
    }
    return parts;
}

function shouldUseBibleVerseSpanLayout(
    studySig: string,
    bibleSig: string,
    studyChunks: ParagraphChunkState[],
    bibleChunks: ParagraphChunkEntry[]
): boolean {
    if (!studySig || !bibleSig || studySig === bibleSig) return false;
    if (!isPoetryParagraphSig(studySig) && !isPoetryParagraphSig(bibleSig)) {
        return false;
    }
    if (studyChunks.length > bibleChunks.length) return true;
    if (
        bibleChunks.length === 1 &&
        studyChunks.length > 1 &&
        bibleChunks[0].proseSegments.length > 1
    ) {
        return true;
    }
    return false;
}

function isInsideRange(pos: number, ranges: Array<[number, number]>): boolean {
    return ranges.some(([start, end]) => pos >= start && pos < end);
}

// ---------------------------------------------------------------------------
// Public API: index build + Study splice
// ---------------------------------------------------------------------------

/**
 * Build a verse index from a Bible IDML Story XML string. Verses that span
 * multiple paragraphs are concatenated correctly (per the analysis doc).
 *
 * The first occurrence of a verse number within the current chapter wins —
 * if a verse is "redefined" later in the file, the earlier text is kept.
 */
export function buildBibleVerseIndex(bibleStoryXml: string): BibleVerseIndex {
    const index: BibleVerseIndex = new Map();
    walkStory(bibleStoryXml, (closed) => {
        const key = verseKey(closed.book, closed.chapter, closed.verse);
        if (index.has(key)) return;
        const proseParts = closed.parts.filter(isProseSegment);
        const openingStyle =
            closed.paragraphChunks[0]?.paragraphStyle ?? "";
        index.set(key, {
            text: cleanWhitespace(proseParts.join(" ")),
            segments: [...proseParts],
            paragraphSig: buildParagraphSig(closed.paragraphChunks),
            paragraphChunks: closed.paragraphChunks.map((c) => ({
                paragraphStyle: c.paragraphStyle,
                proseSegments: c.proseParts.filter(isProseSegment),
            })),
            verseSpanXml: bibleStoryXml.slice(
                closed.paragraphStart,
                closed.paragraphEnd
            ),
            isSubheader:
                isPsalmSubheaderParagraphStyle(openingStyle) ||
                isAcrosticHeadingParagraphStyle(openingStyle),
        });
    }, undefined, { indexBibleSubheaders: true, indexAcrosticHeadings: true });
    return index;
}

/** Coarse list of (book, chapter, verse) keys. */
export function listVerseKeys(index: BibleVerseIndex): VerseKey[] {
    return Array.from(index.keys());
}

/**
 * Apply the Bible verse index to a Study Bible Story XML, replacing the
 * `[No character style]` `<Content>` text inside each verse with the
 * translated text from the Bible. Returns the modified XML + stats.
 */
export interface SurgicalSwapOptions {
    versificationPlan?: VersificationPlan;
    /** Pre-built study scan — skips an extra full XML walk when provided. */
    studyScan?: StudyStoryScan;
}

export function applySurgicalSwapToStudyXml(
    studyStoryXml: string,
    index: BibleVerseIndex,
    options?: SurgicalSwapOptions
): { xml: string; stats: SwapStats } {
    const plan = options?.versificationPlan;
    const studyScan = options?.studyScan ?? scanStudyStoryForSwap(studyStoryXml);
    const stats: SwapStats = {
        replacedCount: 0,
        skippedPsa: 0,
        psalmSubheaderOffsets: 0,
        psalmVersesInserted: 0,
        missingFromBible: [],
        extraInBibleAppended: [],
    };

    const verseSpacingChar = detectVerseSpacingChar(studyStoryXml);
    const psalmSubheaderByChapter = new Map<string, boolean>();
    const usedBibleByChapter = new Map<string, Set<string>>();
    const psalmOffsetChaptersLogged = new Set<string>();
    const insertionSplices: Array<{ pos: number; xml: string }> = [];

    // Splices to apply: each one targets exactly the inside of one <Content>
    // node (absStart..absEnd are the inner offsets). Keyed by absStart so we
    // can find-and-update if both a verse-replace and an extras-append want
    // to touch the same content node (which happens when the chapter's
    // "last content" IS the only verse's content).
    interface Splice {
        absStart: number;
        absEnd: number;
        replacement: string;
    }
    const splicesByStart = new Map<number, Splice>();
    const upsertSplice = (sp: Splice) => {
        splicesByStart.set(sp.absStart, sp);
    };
    const spanSplices: Splice[] = [];

    // Bible verses we've used (per book+chapter), so we can detect "extras"
    // the Bible has that the Study Bible never asked for.
    const usedByChapter = new Map<string, Set<string>>(); // key=book|chapter

    const getPsalmSubheaderFlag = (chapter: string): boolean => {
        let flag = psalmSubheaderByChapter.get(chapter);
        if (flag === undefined) {
            flag = biblePsalmChapterHasSubheaderV1(index, chapter);
            psalmSubheaderByChapter.set(chapter, flag);
        }
        return flag;
    };

    for (const closed of studyScan.closedVerses) {
            const chapterKey = `${closed.book}|${closed.chapter}`;
            const planned = resolveVersePlan(
                plan,
                closed.book,
                closed.chapter,
                closed.verse
            );

            if (planned?.action === "remove") {
                let used = usedByChapter.get(chapterKey);
                if (!used) {
                    used = new Set();
                    usedByChapter.set(chapterKey, used);
                }
                used.add(closed.verse);
                for (const cp of getProsePositions(closed.contentPositions)) {
                    upsertSplice({
                        absStart: cp.absInnerStart,
                        absEnd: cp.absInnerEnd,
                        replacement: "",
                    });
                }
                stats.replacedCount++;
                continue;
            }

            let bibleKey: VerseKey | undefined;
            if (planned?.action === "replace") {
                bibleKey = verseKey(
                    planned.bible.book,
                    planned.bible.chapter,
                    planned.bible.verse
                );
            } else {
                const bibleHasSubheader =
                    closed.book === PSA_BOOK_CODE
                        ? getPsalmSubheaderFlag(closed.chapter)
                        : false;
                bibleKey = resolveBibleKeyForStudyVerse(
                    closed.book,
                    closed.chapter,
                    closed.verse,
                    index,
                    bibleHasSubheader
                );
                if (
                    bibleHasSubheader &&
                    !psalmOffsetChaptersLogged.has(closed.chapter)
                ) {
                    psalmOffsetChaptersLogged.add(closed.chapter);
                    stats.psalmSubheaderOffsets++;
                }
            }

            const entry = bibleKey ? index.get(bibleKey) : undefined;

            if (!entry) {
                stats.missingFromBible.push({
                    book: closed.book,
                    chapter: closed.chapter,
                    verse: closed.verse,
                });
                continue;
            }

            if (!bibleKey) {
                continue;
            }

            let used = usedByChapter.get(chapterKey);
            if (!used) {
                used = new Set();
                usedByChapter.set(chapterKey, used);
            }
            used.add(closed.verse);

            const bibleVerseNum = bibleKey.split("|")[2];
            let usedBible = usedBibleByChapter.get(chapterKey);
            if (!usedBible) {
                usedBible = new Set();
                usedBibleByChapter.set(chapterKey, usedBible);
            }
            usedBible.add(bibleVerseNum);

            if (closed.contentPositions.length === 0) {
                continue;
            }

            const studySig = buildParagraphSig(closed.paragraphChunks);

            if (
                entry.verseSpanXml &&
                shouldUseBibleVerseSpanLayout(
                    studySig,
                    entry.paragraphSig,
                    closed.paragraphChunks,
                    entry.paragraphChunks
                )
            ) {
                spanSplices.push({
                    absStart: closed.paragraphStart,
                    absEnd: closed.paragraphEnd,
                    replacement: entry.verseSpanXml,
                });
                stats.replacedCount++;
                continue;
            }

            let replacements: Map<number, string>;
            if (
                studySig === entry.paragraphSig &&
                closed.paragraphChunks.length > 1 &&
                entry.paragraphChunks.length === closed.paragraphChunks.length
            ) {
                replacements = new Map();
                for (let i = 0; i < closed.paragraphChunks.length; i++) {
                    const studyChunk = closed.paragraphChunks[i];
                    const bibleChunk = entry.paragraphChunks[i];
                    const chunkMapped = mapProseSegmentsToSlots(
                        bibleChunk.proseSegments,
                        studyChunk.prosePositions
                    );
                    for (const [start, text] of chunkMapped) {
                        replacements.set(start, text);
                    }
                }
            } else {
                replacements = mapProseSegmentsToSlots(
                    entry.segments,
                    getProsePositions(closed.contentPositions)
                );
            }

            const contentPosByStart = new Map(
                closed.contentPositions.map((p) => [p.absInnerStart, p])
            );
            for (const [absInnerStart, text] of replacements) {
                const cp = contentPosByStart.get(absInnerStart);
                if (!cp) continue;
                upsertSplice({
                    absStart: cp.absInnerStart,
                    absEnd: cp.absInnerEnd,
                    replacement: escapeXml(text),
                });
            }
            stats.replacedCount++;
    }

    for (const { book, chapter, context } of studyScan.chapterTransitions) {
        const chapterKey = `${book}|${chapter}`;
        const usedStudy = usedByChapter.get(chapterKey);
        if (!usedStudy || usedStudy.size === 0) continue;

        if (plan) {
            const plannedInserts = plan.chapterInserts.get(chapterBlockKey(book, chapter)) ?? [];
            if (plannedInserts.length === 0 || !context.lastParagraphEnd) {
                continue;
            }
            let insertionXml = "";
            for (const ref of plannedInserts) {
                const extraEntry = index.get(
                    verseKey(ref.book, ref.chapter, ref.verse)
                );
                if (!extraEntry || extraEntry.isSubheader) continue;
                insertionXml += buildInsertedVersePsrXml(
                    ref.verse,
                    extraEntry,
                    context.lastVerseParagraphStyle,
                    verseSpacingChar
                );
                stats.psalmVersesInserted++;
                stats.extraInBibleAppended.push({
                    book: ref.book,
                    chapter: ref.chapter,
                    verse: ref.verse,
                });
            }
            if (insertionXml) {
                insertionSplices.push({
                    pos: context.lastParagraphEnd,
                    xml: insertionXml,
                });
            }
            continue;
        }

        if (book === PSA_BOOK_CODE) {
            if (!context.lastParagraphEnd) continue;
            const usedBible = usedBibleByChapter.get(chapterKey) ?? new Set();
            const contentVerses = listChapterContentVerseNumbers(
                index,
                book,
                chapter
            );
            const extras = contentVerses.filter((v) => !usedBible.has(v));
            if (extras.length === 0) continue;

            let insertionXml = "";
            for (const extraVerse of extras) {
                const extraEntry = index.get(
                    verseKey(book, chapter, extraVerse)
                );
                if (!extraEntry) continue;
                insertionXml += buildInsertedVersePsrXml(
                    extraVerse,
                    extraEntry,
                    context.lastVerseParagraphStyle,
                    verseSpacingChar
                );
                stats.psalmVersesInserted++;
                stats.extraInBibleAppended.push({
                    book,
                    chapter,
                    verse: extraVerse,
                });
            }
            if (insertionXml) {
                insertionSplices.push({
                    pos: context.lastParagraphEnd,
                    xml: insertionXml,
                });
            }
            continue;
        }

        if (!context.lastContent) continue;
        const studyMax = Math.max(
            0,
            ...Array.from(usedStudy).map((v) => parseInt(v, 10) || 0)
        );
        const extras: Array<{ verse: string; text: string }> = [];
        for (const [k, v] of index.entries()) {
            const [b, c, vn] = k.split("|");
            if (b !== book || c !== chapter) continue;
            if (usedStudy.has(vn)) continue;
            const vnum = parseInt(vn, 10);
            if (!Number.isFinite(vnum)) continue;
            if (vnum <= studyMax) continue;
            extras.push({ verse: vn, text: v.text });
        }
        if (extras.length === 0) continue;
        extras.sort((a, b) => parseInt(a.verse, 10) - parseInt(b.verse, 10));
        const appended = " " + extras.map((e) => e.text).join(" ");
        const existing = splicesByStart.get(
            context.lastContent.absInnerStart
        );
        if (existing) {
            existing.replacement = existing.replacement + escapeXml(appended);
        } else {
            upsertSplice({
                absStart: context.lastContent.absInnerStart,
                absEnd: context.lastContent.absInnerEnd,
                replacement: escapeXml(
                    context.lastContent.originalText + appended
                ),
            });
        }
        for (const e of extras) {
            stats.extraInBibleAppended.push({
                book,
                chapter,
                verse: e.verse,
            });
        }
    }

    const spanRanges = spanSplices.map(
        (s) => [s.absStart, s.absEnd] as [number, number]
    );
    const contentSplices = Array.from(splicesByStart.values()).filter(
        (sp) => !isInsideRange(sp.absStart, spanRanges)
    );
    // Psalm verse insertions must use the same single-pass builder as content
    // splices. Applying them afterward against modified XML used stale offsets
    // and split closing tags (e.g. </Paragraph<ParagraphStyleRange).
    const insertionAsSplices: Splice[] = insertionSplices
        .filter((ins) => !isInsideRange(ins.pos, spanRanges))
        .map((ins) => ({
            absStart: ins.pos,
            absEnd: ins.pos,
            replacement: ins.xml,
        }));
    const allSplices = [
        ...spanSplices,
        ...contentSplices,
        ...insertionAsSplices,
    ].sort((a, b) => a.absStart - b.absStart);
    const parts: string[] = [];
    let cursor = 0;
    for (const sp of allSplices) {
        if (sp.absStart < cursor) {
            // Defensive: skip overlapping splice (should not happen because
            // we dedupe by absStart and verse ranges never overlap).
            continue;
        }
        if (sp.absStart > cursor) {
            parts.push(studyStoryXml.slice(cursor, sp.absStart));
        }
        parts.push(sp.replacement);
        cursor = sp.absEnd;
    }
    if (cursor < studyStoryXml.length) {
        parts.push(studyStoryXml.slice(cursor));
    }
    const out = parts.join("");

    return { xml: out, stats };
}

/** Collapse runs of whitespace; trim. Verses can have stray newlines from raw XML. */
function cleanWhitespace(s: string): string {
    return s.replace(/\s+/g, " ").trim();
}

/** Books excluded from swap — empty now that Psalms are supported. */
export const SKIPPED_BOOK_CODES: ReadonlySet<string> = new Set();
