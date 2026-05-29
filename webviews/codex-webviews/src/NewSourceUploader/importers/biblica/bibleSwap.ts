/**
 * Bible Swap — replace Study Bible verse content with a translated Bible IDML.
 *
 * Hybrid strategy (per BIBLE_TEXT_REPLACEMENT_APPROACH.md):
 *   1. **Bible paragraph-layout swap** — when poetry verses use different
 *      paragraph counts (e.g. Study alternates text:q1/q2 but Bible keeps all
 *      lines in one text:q1 CSR), replace the Study verse's full paragraph span
 *      with the Bible's so tabs and `<Br />` line breaks stay intact.
 *   2. **Paragraph-aligned swap** — when a multi-paragraph verse uses the same
 *      paragraph-style sequence in Study and Bible (e.g. text:p → b_poetry →
 *      text:q1 → text:q2), map Bible text per paragraph so poetry tabs/indents
 *      stay correct instead of flattening the whole verse.
 *   3. **Structure-preserving swap** — when CSR skeletons match in a single block,
 *      replace only `<Content>` while keeping Study CharacterStyleRange tags.
 *   4. **Content-only fallback** — otherwise distribute Bible text across Study
 *      prose slots (nd, no-style, source serif, …).
 *
 * Always skips: intro/meta/title paragraphs, Psalms (PSA), footnote content.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type VerseKey = `${string}|${string}|${string}`;

/** Prose text grouped by paragraph within a cross-paragraph verse. */
export interface ParagraphChunkEntry {
    paragraphStyle: string;
    proseSegments: string[];
}

export interface VerseEntry {
    /** Concatenated plain text from `[No character style]` content nodes. */
    text: string;
    /**
     * One entry per `<Content>` inside `[No character style]` for this verse,
     * in document order. Preserves line breaks / poetry layout across paragraphs.
     */
    segments: string[];
    /**
     * Plain text from every prose CSR in the verse (nd, no-style, source serif, …),
     * in document order — used when structure signatures match.
     */
    proseSegments: string[];
    /** Structural fingerprint of the verse's CSR block (for block-swap matching). */
    structureSig: string;
    /** Raw XML: all top-level CSRs from opening `meta:v` through closing `meta:v`. */
    blockXml: string;
    /** True when the verse block lives entirely inside one ParagraphStyleRange. */
    singleParagraph: boolean;
    /** Ordered paragraph styles from opening through closing `meta:v`. */
    paragraphSig: string;
    /** Per-paragraph prose segments (for paragraph-aligned swap). */
    paragraphChunks: ParagraphChunkEntry[];
    /** All `ParagraphStyleRange` XML from first through last paragraph of this verse. */
    verseSpanXml: string;
}

export type BibleVerseIndex = Map<VerseKey, VerseEntry>;

export interface SwapStats {
    replacedCount: number;
    blockSwapCount: number;
    contentOnlyCount: number;
    skippedPsa: number;
    missingFromBible: Array<{ book: string; chapter: string; verse: string }>;
    extraInBibleAppended: Array<{ book: string; chapter: string; verse: string }>;
}

export const SKIPPED_BOOK_CODES: ReadonlySet<string> = new Set(["PSA"]);

const PSA_BOOK_CODE = "PSA";

const NO_STYLE_RE =
    /CharacterStyle\/\$ID\/\[No character style\]|CharacterStyle\/\$ID\/%5BNo character style%5D/;

// ---------------------------------------------------------------------------
// Keys & helpers
// ---------------------------------------------------------------------------

export const verseKey = (book: string, chapter: string, verse: string): VerseKey =>
    `${book}|${chapter}|${verse}`;

export const listVerseKeys = (index: BibleVerseIndex): VerseKey[] =>
    Array.from(index.keys());

const digitsOnly = (s: string): string => s.replace(/\D/g, "");

const xmlEscape = (s: string): string =>
    s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

// ---------------------------------------------------------------------------
// Depth-tracking XML iterators (no DOMParser — works in Node + webview)
// ---------------------------------------------------------------------------

interface TopLevelElement {
    fullStart: number;
    fullEnd: number;
    bodyStart: number;
    bodyEnd: number;
    appliedParagraphStyle?: string;
    appliedCharacterStyle?: string;
}

/**
 * Iterate top-level `<TagName>...</TagName>` elements inside a region,
 * correctly handling nesting (e.g. Footnote inside a CSR).
 */
function* iterateTopLevelElements(
    xml: string,
    regionStart: number,
    regionEnd: number,
    tagName: string
): IterableIterator<TopLevelElement> {
    const openRe = new RegExp(`<${tagName}\\b`, "g");
    openRe.lastIndex = regionStart;

    while (true) {
        const openMatch = openRe.exec(xml);
        if (!openMatch || openMatch.index >= regionEnd) break;

        const openStart = openMatch.index;
        const openTagEnd = xml.indexOf(">", openStart);
        if (openTagEnd === -1 || openTagEnd >= regionEnd) break;

        const closeTag = `</${tagName}>`;
        let depth = 1;
        let pos = openTagEnd + 1;

        while (depth > 0 && pos < regionEnd) {
            const nextOpen = xml.indexOf(`<${tagName}`, pos);
            const nextClose = xml.indexOf(closeTag, pos);
            if (nextClose === -1) break;

            if (nextOpen !== -1 && nextOpen < nextClose && nextOpen < regionEnd) {
                depth++;
                pos = nextOpen + tagName.length + 1;
            } else {
                depth--;
                if (depth === 0) {
                    const fullEnd = nextClose + closeTag.length;
                    const openTag = xml.slice(openStart, openTagEnd + 1);
                    const styleMatch =
                        openTag.match(/AppliedParagraphStyle="([^"]+)"/) ??
                        openTag.match(/AppliedCharacterStyle="([^"]+)"/);
                    yield {
                        fullStart: openStart,
                        fullEnd,
                        bodyStart: openTagEnd + 1,
                        bodyEnd: nextClose,
                        appliedParagraphStyle: openTag.includes("ParagraphStyleRange")
                            ? styleMatch?.[1]
                            : undefined,
                        appliedCharacterStyle: openTag.includes("CharacterStyleRange")
                            ? styleMatch?.[1]
                            : undefined,
                    };
                    openRe.lastIndex = fullEnd;
                    break;
                }
                pos = nextClose + closeTag.length;
            }
        }
        if (depth > 0) break;
    }
}

interface ParagraphInfo {
    fullStart: number;
    fullEnd: number;
    bodyStart: number;
    bodyEnd: number;
    appliedParagraphStyle: string;
}

function* iterateParagraphs(xml: string): IterableIterator<ParagraphInfo> {
    for (const el of iterateTopLevelElements(xml, 0, xml.length, "ParagraphStyleRange")) {
        if (el.appliedParagraphStyle) {
            yield {
                fullStart: el.fullStart,
                fullEnd: el.fullEnd,
                bodyStart: el.bodyStart,
                bodyEnd: el.bodyEnd,
                appliedParagraphStyle: el.appliedParagraphStyle,
            };
        }
    }
}

interface CsrInfo {
    fullStart: number;
    fullEnd: number;
    absBodyStart: number;
    absBodyEnd: number;
    appliedCharacterStyle: string;
    xml: string;
}

function* iterateCsrAbs(
    xml: string,
    regionStart: number,
    regionEnd: number
): IterableIterator<CsrInfo> {
    for (const el of iterateTopLevelElements(xml, regionStart, regionEnd, "CharacterStyleRange")) {
        if (!el.appliedCharacterStyle) continue;
        yield {
            fullStart: el.fullStart,
            fullEnd: el.fullEnd,
            absBodyStart: el.bodyStart,
            absBodyEnd: el.bodyEnd,
            appliedCharacterStyle: el.appliedCharacterStyle,
            xml: xml.slice(el.fullStart, el.fullEnd),
        };
    }
}

interface ContentMatch {
    absStart: number;
    absEnd: number;
    absInnerStart: number;
    absInnerEnd: number;
}

function* iterateContentAbs(
    xml: string,
    regionStart: number,
    regionEnd: number
): IterableIterator<ContentMatch> {
    const fnProbe = xml.indexOf("<Footnote", regionStart);
    const hasFootnote = fnProbe !== -1 && fnProbe < regionEnd;

    let footnoteRanges: Array<[number, number]> | null = null;
    if (hasFootnote) {
        footnoteRanges = [];
        for (const fn of iterateTopLevelElements(xml, regionStart, regionEnd, "Footnote")) {
            footnoteRanges.push([fn.fullStart, fn.fullEnd]);
        }
    }

    const re = /<Content>([\s\S]*?)<\/Content>/g;
    re.lastIndex = regionStart;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
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
        yield {
            absStart,
            absEnd,
            absInnerStart: absStart + "<Content>".length,
            absInnerEnd: absEnd - "</Content>".length,
        };
    }
}

// ---------------------------------------------------------------------------
// Style classification
// ---------------------------------------------------------------------------

function isBookMarkerParagraphStyle(style: string): boolean {
    return /(?:^|\/)meta%3abk(?:_|$|\b)/.test(style) || /(?:^|\/)meta:bk/.test(style);
}

/** Paragraph styles that may contain biblical verse text. */
function isReplaceableParagraphStyle(style: string): boolean {
    if (isBookMarkerParagraphStyle(style)) return false;
    if (/(?:^|\/)intro%3a|(?:^|\/)intro:/.test(style)) return false;
    if (/(?:^|\/)meta%3a|(?:^|\/)meta:/.test(style)) return false;
    if (/(?:^|\/)title%3a|(?:^|\/)title:/.test(style)) return false;
    if (/(?:^|\/)notes%3a|(?:^|\/)notes:/.test(style)) return false;
    return (
        /(?:^|\/)text%3a|(?:^|\/)text:/.test(style) ||
        /(?:^|\/)b(?:_|$|\b)/.test(style) ||
        /(?:^|\/)b_/.test(style)
    );
}

function isChapterMarkerStyle(style: string): boolean {
    return /meta%3ac|meta:c/.test(style);
}

function isVerseMarkerStyle(style: string): boolean {
    return /meta%3av|meta:v/.test(style);
}

/** Verse-number, spacing, drop-cap, notes, and hidden marker CSRs — never replace text. */
function isMarkerOrStructuralStyle(style: string): boolean {
    if (isChapterMarkerStyle(style) || isVerseMarkerStyle(style)) return true;
    if (/(?:^|\/)notes%3a|(?:^|\/)notes:/.test(style)) return true;
    if (/(?:^|\/)meta%3a|(?:^|\/)meta:/.test(style)) return true;
    return (
        /(?:^|\/)cv%3av(?:_|$|\b)/.test(style) ||
        /(?:^|\/)cv:v(?:_|$|\b)/.test(style) ||
        /(?:^|\/)cv%3av_sp/.test(style) ||
        /(?:^|\/)cv:v_sp/.test(style) ||
        /(?:^|\/)cv%3adc/.test(style) ||
        /(?:^|\/)cv:dc/.test(style) ||
        /(?:^|\/)#base\.hidden/.test(style)
    );
}

function isNoCharacterStyle(style: string): boolean {
    return NO_STYLE_RE.test(style);
}

function extractProseSegmentsFromCsrList(csrXmlList: string[]): string[] {
    const segments: string[] = [];
    for (const csrXml of csrXmlList) {
        const styleMatch = csrXml.match(/AppliedCharacterStyle="([^"]+)"/);
        if (isMarkerOrStructuralStyle(styleMatch?.[1] ?? "")) continue;
        const text = collectContentText(csrXml, 0, csrXml.length);
        segments.push(text);
    }
    return segments;
}

/**
 * Extract canonical SBL book code from `meta:bk` content. The notes export
 * pipeline may prefix translated text (e.g. "[PT] GEN"); we must still find GEN.
 */
function extractBookCode(rawText: string): string {
    if (!rawText) return "";
    const trimmed = rawText.replace(/\s+/g, " ").trim();
    const m = trimmed.match(/\b(?:[1-3][A-Z]{2}|[A-Z]{3})\b/);
    return m ? m[0] : trimmed;
}

function collectContentText(xml: string, start: number, end: number): string {
    let text = "";
    for (const c of iterateContentAbs(xml, start, end)) {
        text += xml.slice(c.absInnerStart, c.absInnerEnd);
    }
    return text;
}

// ---------------------------------------------------------------------------
// Verse block structure (for hybrid block swap)
// ---------------------------------------------------------------------------

/** Normalize a character style path for comparison. */
function normalizeCharStyle(style: string): string {
    return style
        .replace(/^CharacterStyle\//, "")
        .replace(/%3a/g, ":")
        .replace(/%5B/g, "[")
        .replace(/%5D/g, "]");
}

/** Token describing one CSR's role in a verse block (ignores actual prose). */
function csrStructureToken(csrXml: string): string {
    const styleMatch = csrXml.match(/AppliedCharacterStyle="([^"]+)"/);
    const style = normalizeCharStyle(styleMatch?.[1] ?? "?");

    if (isNoCharacterStyle(styleMatch?.[1] ?? "")) {
        if (/<\?ACE\s/.test(csrXml) || /<\?ACE\s*\?>/.test(csrXml)) return `${style}:ace`;
        const hasBr = /<Br\s*\/?>/.test(csrXml);
        const text = collectContentText(csrXml, 0, csrXml.length).replace(/\s+/g, " ").trim();
        if (hasBr && !text) return `${style}:br`;
        if (!text) return `${style}:empty`;
        return `${style}:text`;
    }
    const text = collectContentText(csrXml, 0, csrXml.length).replace(/\s+/g, " ").trim();
    return text ? `${style}:marker` : `${style}:empty`;
}

function buildStructureSig(csrXmlList: string[]): string {
    return csrXmlList.map(csrStructureToken).join("|");
}

function normalizeParagraphStyle(style: string): string {
    return style
        .replace(/^ParagraphStyle\//, "")
        .replace(/%3a/g, ":")
        .replace(/%5B/g, "[")
        .replace(/%5D/g, "]");
}

interface ParagraphChunkState {
    paragraphStyle: string;
    paragraphStart: number;
    proseContents: ContentMatch[];
    proseSegments: string[];
}

function buildParagraphSig(chunks: Array<{ paragraphStyle: string }>): string {
    return chunks.map((c) => normalizeParagraphStyle(c.paragraphStyle)).join("|");
}

function isPoetryParagraphSig(sig: string): boolean {
    return /text:q[12]/.test(sig);
}

function countProseLinesInChunks(chunks: Array<{ proseSegments: string[] }>): number {
    return chunks.reduce(
        (sum, c) => sum + c.proseSegments.filter((s) => s.trim().length > 0).length,
        0
    );
}

function maxProseLinesInOneChunk(chunks: Array<{ proseSegments: string[] }>): number {
    return chunks.reduce(
        (max, c) => Math.max(max, c.proseSegments.filter((s) => s.trim().length > 0).length),
        0
    );
}

/**
 * Study and Bible both have poetry (text:q1/q2) but different paragraph layouts —
 * e.g. GEN 8:22 Study uses many alternating q1/q2 paras while Bible keeps every
 * line in one q1 CSR with `<Br />` between `<Content>` nodes.
 */
function shouldUseBibleVerseSpanLayout(
    study: {
        paragraphSig: string;
        singleParagraph: boolean;
        paragraphChunks: ParagraphChunkState[];
    },
    bible: VerseEntry
): boolean {
    if (study.singleParagraph || bible.singleParagraph) return false;
    if (study.paragraphSig === bible.paragraphSig) return false;
    if (!isPoetryParagraphSig(study.paragraphSig) || !isPoetryParagraphSig(bible.paragraphSig)) {
        return false;
    }

    const studyParas = study.paragraphChunks.length;
    const bibleParas = bible.paragraphChunks.length;
    const bibleMaxLines = maxProseLinesInOneChunk(bible.paragraphChunks);
    const studyLines = countProseLinesInChunks(study.paragraphChunks);
    const bibleLines = countProseLinesInChunks(bible.paragraphChunks);

    if (bibleMaxLines < 2) return false;

    // Bible consolidated into fewer paragraphs than Study.
    if (bibleParas < studyParas) return true;

    // Same paragraph count but Bible packs many lines into one CSR (Br-separated).
    const bibleConsolidated = bible.paragraphChunks.some(
        (c) => c.proseSegments.filter((s) => s.trim().length > 0).length >= 3
    );
    const studySpread = study.paragraphChunks.every(
        (c) => c.proseSegments.filter((s) => s.trim().length > 0).length <= 2
    );
    if (bibleConsolidated && studySpread && bibleMaxLines >= 3) return true;

    // Line counts differ enough that weight-based splitting would break words.
    if (bibleParas !== studyParas && Math.abs(bibleLines - studyLines) >= 2) return true;

    return false;
}

/**
 * Poetry verses are often preceded by a `b_poetry` spacer paragraph before the
 * opening `meta:v`. Include it in the verse span so layout swap keeps the break.
 */
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

function ensureParagraphChunk(
    openVerse: OpenVerseState,
    para: ParagraphInfo
): ParagraphChunkState {
    const last = openVerse.paragraphChunks[openVerse.paragraphChunks.length - 1];
    if (!last || last.paragraphStart !== para.fullStart) {
        const chunk: ParagraphChunkState = {
            paragraphStyle: para.appliedParagraphStyle,
            paragraphStart: para.fullStart,
            proseContents: [],
            proseSegments: [],
        };
        openVerse.paragraphChunks.push(chunk);
        return chunk;
    }
    return last;
}

interface OpenVerseState {
    book: string;
    chapter: string;
    verse: string;
    csrXmlList: string[];
    blockStart: number;
    blockEnd: number;
    paragraphStart: number;
    paragraphEnd: number;
    noStyleContents: ContentMatch[];
    proseContents: ContentMatch[];
    paragraphChunks: ParagraphChunkState[];
}

interface WalkCallbacks {
    onBook?: (book: string) => void;
    onChapter?: (book: string, chapter: string) => void;
    onVerseOpen?: (v: { book: string; chapter: string; verse: string }) => void;
    /** Fired when entering the PSA book (verses are not swapped). */
    onEnterPsa?: () => void;
    onVerseClose?: (entry: {
        book: string;
        chapter: string;
        verse: string;
        text: string;
        segments: string[];
        structureSig: string;
        blockXml: string;
        singleParagraph: boolean;
        noStyleContents: ContentMatch[];
        proseContents: ContentMatch[];
        paragraphChunks: ParagraphChunkState[];
        paragraphStart: number;
        paragraphEnd: number;
        verseSpanXml: string;
        csrXmlList: string[];
        blockStart: number;
        blockEnd: number;
    }) => void;
}

/**
 * Stream through a Story XML, tracking book / chapter / verse state and
 * firing callbacks at verse boundaries.
 */
function walkStory(storyXml: string, callbacks: WalkCallbacks): void {
    let currentBook = "";
    let currentChapter = "";
    let openVerse: OpenVerseState | null = null;
    let inPsa = false;

    const closeVerse = () => {
        if (!openVerse) return;
        const {
            book,
            chapter,
            verse,
            csrXmlList,
            blockStart,
            blockEnd,
            paragraphStart,
            paragraphEnd,
        } = openVerse;
        if (!inPsa && book && chapter && verse) {
            const segments: string[] = [];
            const textParts: string[] = [];
            for (const c of openVerse.noStyleContents) {
                const t = storyXml.slice(c.absInnerStart, c.absInnerEnd);
                segments.push(t);
                if (t.trim()) textParts.push(t);
            }
            callbacks.onVerseClose?.({
                book,
                chapter,
                verse,
                text: textParts.join(" ").replace(/\s+/g, " ").trim(),
                segments,
                structureSig: buildStructureSig(csrXmlList),
                blockXml: storyXml.slice(blockStart, blockEnd),
                singleParagraph: paragraphStart === paragraphEnd,
                noStyleContents: [...openVerse.noStyleContents],
                proseContents: [...openVerse.proseContents],
                paragraphChunks: openVerse.paragraphChunks.map((c) => ({
                    paragraphStyle: c.paragraphStyle,
                    paragraphStart: c.paragraphStart,
                    proseContents: [...c.proseContents],
                    proseSegments: [...c.proseSegments],
                })),
                paragraphStart,
                paragraphEnd,
                verseSpanXml: storyXml.slice(paragraphStart, paragraphEnd),
                csrXmlList: [...csrXmlList],
                blockStart,
                blockEnd,
            });
        }
        openVerse = null;
    };

    for (const para of iterateParagraphs(storyXml)) {
        if (isBookMarkerParagraphStyle(para.appliedParagraphStyle)) {
            closeVerse();
            let bookRaw = "";
            for (const c of iterateContentAbs(storyXml, para.bodyStart, para.bodyEnd)) {
                bookRaw += storyXml.slice(c.absInnerStart, c.absInnerEnd);
            }
            const code = extractBookCode(bookRaw);
            if (code) {
                currentBook = code;
                currentChapter = "";
                inPsa = code === PSA_BOOK_CODE;
                if (inPsa) callbacks.onEnterPsa?.();
                callbacks.onBook?.(code);
            }
            continue;
        }

        if (!isReplaceableParagraphStyle(para.appliedParagraphStyle)) {
            continue;
        }

        for (const csr of iterateCsrAbs(storyXml, para.bodyStart, para.bodyEnd)) {
            if (isChapterMarkerStyle(csr.appliedCharacterStyle)) {
                const cnum = digitsOnly(collectContentText(storyXml, csr.absBodyStart, csr.absBodyEnd));
                if (cnum && cnum !== currentChapter) {
                    closeVerse();
                    currentChapter = cnum;
                    callbacks.onChapter?.(currentBook, currentChapter);
                }
                continue;
            }

            if (isVerseMarkerStyle(csr.appliedCharacterStyle)) {
                const vnum = collectContentText(storyXml, csr.absBodyStart, csr.absBodyEnd).trim();
                if (!/^\d+$/.test(vnum)) continue;

                if (!openVerse) {
                    // Opening marker
                    const paragraphStart = findPoetryLeadInStart(storyXml, para.fullStart);
                    openVerse = {
                        book: currentBook,
                        chapter: currentChapter,
                        verse: vnum,
                        csrXmlList: [csr.xml],
                        blockStart: csr.fullStart,
                        blockEnd: csr.fullEnd,
                        paragraphStart,
                        paragraphEnd: para.fullEnd,
                        noStyleContents: [],
                        proseContents: [],
                        paragraphChunks: [],
                    };
                    callbacks.onVerseOpen?.({
                        book: currentBook,
                        chapter: currentChapter,
                        verse: vnum,
                    });
                } else if (openVerse.verse === vnum) {
                    // Closing marker (same verse number)
                    openVerse.csrXmlList.push(csr.xml);
                    openVerse.blockEnd = csr.fullEnd;
                    closeVerse();
                } else {
                    // New verse opens before previous closed — force-close previous
                    closeVerse();
                    openVerse = {
                        book: currentBook,
                        chapter: currentChapter,
                        verse: vnum,
                        csrXmlList: [csr.xml],
                        blockStart: csr.fullStart,
                        blockEnd: csr.fullEnd,
                        paragraphStart: para.fullStart,
                        paragraphEnd: para.fullEnd,
                        noStyleContents: [],
                        proseContents: [],
                        paragraphChunks: [],
                    };
                    callbacks.onVerseOpen?.({
                        book: currentBook,
                        chapter: currentChapter,
                        verse: vnum,
                    });
                }
                continue;
            }

            if (openVerse) {
                const verseParagraphChunk = ensureParagraphChunk(openVerse, para);
                openVerse.csrXmlList.push(csr.xml);
                openVerse.blockEnd = csr.fullEnd;
                openVerse.paragraphEnd = para.fullEnd;

                if (!isMarkerOrStructuralStyle(csr.appliedCharacterStyle)) {
                    for (const c of iterateContentAbs(storyXml, csr.absBodyStart, csr.absBodyEnd)) {
                        if (isProseContentSlot(storyXml, c)) {
                            const text = storyXml.slice(c.absInnerStart, c.absInnerEnd);
                            openVerse.proseContents.push(c);
                            verseParagraphChunk.proseContents.push(c);
                            verseParagraphChunk.proseSegments.push(text);
                        }
                    }
                }

                if (isNoCharacterStyle(csr.appliedCharacterStyle)) {
                    for (const c of iterateContentAbs(storyXml, csr.absBodyStart, csr.absBodyEnd)) {
                        openVerse.noStyleContents.push(c);
                    }
                }
            }
        }
    }
    closeVerse();
}

// ---------------------------------------------------------------------------
// Build Bible verse index
// ---------------------------------------------------------------------------

export function buildBibleVerseIndex(bibleStoryXml: string): BibleVerseIndex {
    const index: BibleVerseIndex = new Map();

    walkStory(bibleStoryXml, {
        onVerseClose: (entry) => {
            if (!entry.book || !entry.chapter || !entry.verse || !entry.text) return;
            const key = verseKey(entry.book, entry.chapter, entry.verse);
            index.set(key, {
                text: entry.text,
                segments: entry.segments,
                proseSegments: extractProseSegmentsFromCsrList(entry.csrXmlList),
                structureSig: entry.structureSig,
                blockXml: entry.blockXml,
                singleParagraph: entry.singleParagraph,
                paragraphSig: buildParagraphSig(entry.paragraphChunks),
                paragraphChunks: entry.paragraphChunks.map((c) => ({
                    paragraphStyle: c.paragraphStyle,
                    proseSegments: c.proseSegments,
                })),
                verseSpanXml: entry.verseSpanXml,
            });
        },
    });

    return index;
}

// ---------------------------------------------------------------------------
// Apply swap to Study Bible
// ---------------------------------------------------------------------------

interface Splice {
    absStart: number;
    absEnd: number;
    replacement: string;
}

function upsertSplice(map: Map<number, Splice>, sp: Splice): void {
    map.set(sp.absStart, sp);
}

/** True when this `<Content>` carries verse prose (not ACE, not inter-verse spacing). */
function isProseContentSlot(storyXml: string, c: ContentMatch): boolean {
    const raw = storyXml.slice(c.absInnerStart, c.absInnerEnd);
    if (!raw.trim()) return false;
    if (/^<\?ACE/.test(raw.trim())) return false;
    // Single space between verses in the same paragraph — keep original.
    if (raw === " " || raw === "\u2009" || raw === "\u00A0") return false;
    return true;
}

function slotWhitespace(studyXml: string, slot: ContentMatch): { leading: string; trailing: string } {
    const orig = studyXml.slice(slot.absInnerStart, slot.absInnerEnd);
    return {
        leading: orig.match(/^(\s*)/)?.[1] ?? "",
        trailing: orig.match(/(\s*)$/)?.[1] ?? "",
    };
}

/**
 * Split one string across N slots using the Study's original line lengths as
 * weights (used when the Bible has one segment but Study has several lines).
 * Preserves each slot's leading/trailing whitespace (poetry tabs).
 */
function splitTextByStudyWeights(
    studyXml: string,
    proseSlots: ContentMatch[],
    text: string
): string[] {
    if (proseSlots.length === 0) return [];
    if (proseSlots.length === 1) {
        const { leading, trailing } = slotWhitespace(studyXml, proseSlots[0]);
        const body = /^\s/.test(text) ? text : text.trim();
        return [leading + body + trailing];
    }

    const weights = proseSlots.map((c) => {
        const len = studyXml.slice(c.absInnerStart, c.absInnerEnd).trim().length;
        return len > 0 ? len : 1;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const parts: string[] = [];
    let pos = 0;
    for (let i = 0; i < proseSlots.length; i++) {
        const { leading, trailing } = slotWhitespace(studyXml, proseSlots[i]);
        if (i === proseSlots.length - 1) {
            const body = text.slice(pos).trim();
            parts.push(leading + body + trailing);
            break;
        }
        const share = Math.max(1, Math.round((weights[i] / totalWeight) * text.length));
        let end = Math.min(text.length, pos + share);
        if (end < text.length) {
            const nextSpace = text.indexOf(" ", end);
            if (nextSpace !== -1 && nextSpace - pos < share * 1.5) {
                end = nextSpace + 1;
            }
        }
        const body = text.slice(pos, end).trim();
        parts.push(leading + body + trailing);
        pos = end;
    }
    return parts;
}

/**
 * Map Bible prose segments onto Study prose `<Content>` slots in order.
 */
function mapProseSegmentsToSlots(
    studyXml: string,
    proseSlots: ContentMatch[],
    bibleSegments: string[],
    bibleFullText: string
): string[] {
    const n = proseSlots.length;
    if (n === 0) return [];

    const prose = bibleSegments.filter((s) => s.trim().length > 0);
    const source = prose.length > 0 ? prose : [bibleFullText];
    const m = source.length;

    if (m === n) {
        return source.map((segment, i) => {
            if (/^\s/.test(segment)) return segment;
            const { leading, trailing } = slotWhitespace(studyXml, proseSlots[i]);
            return leading + segment.trim() + trailing;
        });
    }
    if (m === 1) return splitTextByStudyWeights(studyXml, proseSlots, source[0]);
    if (m > n) {
        const out = source.slice(0, n - 1);
        out.push(source.slice(n - 1).join(" "));
        return out;
    }
    // m > 1 && m < n — map available lines, leave extra Study slots empty only when
    // we cannot use Bible paragraph layout (caller should prefer span layout).
    const out = [...source];
    while (out.length < n) out.push("");
    return out;
}

/**
 * Replace the Study verse's full paragraph span with the Bible's paragraph XML
 * (used when poetry layout differs, e.g. consolidated q1 CSR vs alternating q1/q2).
 */
function applyBibleVerseSpanLayout(
    studyParagraphStart: number,
    studyParagraphEnd: number,
    bibleEntry: VerseEntry,
    splices: Map<number, Splice>
): void {
    if (!bibleEntry.verseSpanXml || bibleEntry.verseSpanXml.length === 0) return;
    upsertSplice(splices, {
        absStart: studyParagraphStart,
        absEnd: studyParagraphEnd,
        replacement: bibleEntry.verseSpanXml,
    });
}

/**
 * Replace `<Content>` in Study prose slots, keeping every CharacterStyleRange
 * wrapper and attribute from the Study file.
 */
function applyDistributedContentReplacement(
    studyXml: string,
    proseContents: ContentMatch[],
    bibleEntry: VerseEntry,
    splices: Map<number, Splice>,
    bibleSegmentSource?: string[]
): void {
    const proseSlots: ContentMatch[] = [];
    for (const c of proseContents) {
        if (isProseContentSlot(studyXml, c)) proseSlots.push(c);
    }
    if (proseSlots.length === 0) return;

    const bibleSegments =
        bibleSegmentSource ??
        (bibleEntry.proseSegments.length > 0 ? bibleEntry.proseSegments : bibleEntry.segments);

    const mapped = mapProseSegmentsToSlots(
        studyXml,
        proseSlots,
        bibleSegments,
        bibleEntry.text
    );

    for (let i = 0; i < proseSlots.length; i++) {
        upsertSplice(splices, {
            absStart: proseSlots[i].absInnerStart,
            absEnd: proseSlots[i].absInnerEnd,
            replacement: xmlEscape(mapped[i] ?? ""),
        });
    }
}

/**
 * Multi-paragraph verses (poetry): map Bible text per paragraph when the
 * paragraph-style sequence matches between Study and Bible.
 */
function applyParagraphAlignedReplacement(
    studyXml: string,
    studyChunks: ParagraphChunkState[],
    bibleEntry: VerseEntry,
    splices: Map<number, Splice>
): boolean {
    const bibleChunks = bibleEntry.paragraphChunks;
    if (studyChunks.length !== bibleChunks.length || studyChunks.length < 2) {
        return false;
    }

    for (let i = 0; i < studyChunks.length; i++) {
        if (
            normalizeParagraphStyle(studyChunks[i].paragraphStyle) !==
            normalizeParagraphStyle(bibleChunks[i].paragraphStyle)
        ) {
            return false;
        }
        applyDistributedContentReplacement(
            studyXml,
            studyChunks[i].proseContents,
            bibleEntry,
            splices,
            bibleChunks[i].proseSegments
        );
    }
    return true;
}

/**
 * When CSR skeletons match, map Bible prose onto Study prose slots 1:1 while
 * preserving Study CharacterStyleRange tags (Tracking, nd, source serif, etc.).
 */
function applyStructurePreservingReplacement(
    studyXml: string,
    studyProseContents: ContentMatch[],
    bibleEntry: VerseEntry,
    splices: Map<number, Splice>
): void {
    applyDistributedContentReplacement(
        studyXml,
        studyProseContents,
        bibleEntry,
        splices,
        bibleEntry.proseSegments
    );
}

export function applyBibleSwapToStudyXml(
    studyStoryXml: string,
    bibleIndex: BibleVerseIndex
): { xml: string; stats: SwapStats } {
    const stats: SwapStats = {
        replacedCount: 0,
        blockSwapCount: 0,
        contentOnlyCount: 0,
        skippedPsa: 0,
        missingFromBible: [],
        extraInBibleAppended: [],
    };

    const splicesByStart = new Map<number, Splice>();
    const studyVersesInChapter = new Map<string, Set<string>>();
    /** Last `[No character style]` Content in each chapter (for versification extras). */
    const lastNoStyleByChapter = new Map<string, ContentMatch>();

    const chapterKey = (book: string, chapter: string) => `${book}|${chapter}`;

    walkStory(studyStoryXml, {
        onBook: () => {
            /* chapter tracking resets on chapter marker */
        },
        onChapter: (book, chapter) => {
            if (!studyVersesInChapter.has(chapterKey(book, chapter))) {
                studyVersesInChapter.set(chapterKey(book, chapter), new Set());
            }
        },
        onEnterPsa: () => {
            stats.skippedPsa++;
        },
        onVerseClose: (studyVerse) => {
            const { book, chapter, verse } = studyVerse;
            if (!book || !chapter || !verse) return;

            if (book === PSA_BOOK_CODE) {
                stats.skippedPsa++;
                return;
            }

            const ck = chapterKey(book, chapter);
            if (!studyVersesInChapter.has(ck)) {
                studyVersesInChapter.set(ck, new Set());
            }
            studyVersesInChapter.get(ck)!.add(verse);

            if (studyVerse.noStyleContents.length > 0) {
                const last = studyVerse.noStyleContents[studyVerse.noStyleContents.length - 1];
                lastNoStyleByChapter.set(ck, last);
            }

            const bibleEntry = bibleIndex.get(verseKey(book, chapter, verse));
            if (!bibleEntry) {
                stats.missingFromBible.push({ book, chapter, verse });
                return;
            }

            const studyParaSig = buildParagraphSig(studyVerse.paragraphChunks);
            const useBibleSpanLayout = shouldUseBibleVerseSpanLayout(
                {
                    paragraphSig: studyParaSig,
                    singleParagraph: studyVerse.singleParagraph,
                    paragraphChunks: studyVerse.paragraphChunks,
                },
                bibleEntry
            );
            const canParagraphAlign =
                !studyVerse.singleParagraph &&
                studyParaSig.length > 0 &&
                studyParaSig === bibleEntry.paragraphSig &&
                studyVerse.paragraphChunks.length === bibleEntry.paragraphChunks.length;

            const canStructurePreserve =
                studyVerse.structureSig === bibleEntry.structureSig &&
                studyVerse.proseContents.length > 0;

            if (useBibleSpanLayout) {
                applyBibleVerseSpanLayout(
                    studyVerse.paragraphStart,
                    studyVerse.paragraphEnd,
                    bibleEntry,
                    splicesByStart
                );
                stats.blockSwapCount++;
            } else if (
                canParagraphAlign &&
                applyParagraphAlignedReplacement(
                    studyStoryXml,
                    studyVerse.paragraphChunks,
                    bibleEntry,
                    splicesByStart
                )
            ) {
                stats.blockSwapCount++;
            } else if (canStructurePreserve) {
                applyStructurePreservingReplacement(
                    studyStoryXml,
                    studyVerse.proseContents,
                    bibleEntry,
                    splicesByStart
                );
                stats.blockSwapCount++;
            } else {
                applyDistributedContentReplacement(
                    studyStoryXml,
                    studyVerse.proseContents.length > 0
                        ? studyVerse.proseContents
                        : studyVerse.noStyleContents,
                    bibleEntry,
                    splicesByStart
                );
                stats.contentOnlyCount++;
            }
            stats.replacedCount++;
        },
    });

    // Append Bible verses not present in Study (versification extras).
    // The anchor may fall inside a block-swap splice; merge into that splice
    // instead of creating a nested splice (which would be skipped on apply).
    const findSpliceCovering = (innerPos: number): Splice | undefined => {
        for (const sp of splicesByStart.values()) {
            if (sp.absStart <= innerPos && innerPos < sp.absEnd) return sp;
        }
        return undefined;
    };

    for (const [key, bibleEntry] of bibleIndex.entries()) {
        const [book, chapter, verse] = key.split("|");
        if (book === PSA_BOOK_CODE) continue;
        const ck = chapterKey(book, chapter);
        const studySet = studyVersesInChapter.get(ck);
        if (studySet?.has(verse)) continue;

        const anchor = lastNoStyleByChapter.get(ck);
        if (!anchor) continue;

        const appendText = xmlEscape(bibleEntry.text);
        const covering = findSpliceCovering(anchor.absInnerStart);
        if (covering) {
            // Anchor sits inside a block-swap region — append into the last
            // <Content> node of the replacement XML, not after the block.
            const lastOpen = covering.replacement.lastIndexOf("<Content>");
            const lastClose = covering.replacement.lastIndexOf("</Content>");
            if (lastOpen !== -1 && lastClose > lastOpen) {
                const inner = covering.replacement.slice(lastOpen + "<Content>".length, lastClose);
                covering.replacement =
                    covering.replacement.slice(0, lastOpen + "<Content>".length) +
                    (inner.trim() ? `${inner} ${appendText}` : appendText) +
                    covering.replacement.slice(lastClose);
            } else {
                covering.replacement = `${covering.replacement} ${appendText}`;
            }
        } else {
            const existing = splicesByStart.get(anchor.absInnerStart);
            if (existing) {
                existing.replacement = `${existing.replacement} ${appendText}`;
            } else {
                const original = studyStoryXml.slice(anchor.absInnerStart, anchor.absInnerEnd);
                upsertSplice(splicesByStart, {
                    absStart: anchor.absInnerStart,
                    absEnd: anchor.absInnerEnd,
                    replacement: original.trim() ? `${original} ${appendText}` : appendText,
                });
            }
        }
        stats.extraInBibleAppended.push({ book, chapter, verse });
    }

    const splices = Array.from(splicesByStart.values()).sort((a, b) => a.absStart - b.absStart);
    const parts: string[] = [];
    let cursor = 0;
    for (const sp of splices) {
        if (sp.absStart < cursor) continue;
        if (sp.absStart > cursor) {
            parts.push(studyStoryXml.slice(cursor, sp.absStart));
        }
        parts.push(sp.replacement);
        cursor = sp.absEnd;
    }
    if (cursor < studyStoryXml.length) {
        parts.push(studyStoryXml.slice(cursor));
    }

    return { xml: parts.join(""), stats };
}
