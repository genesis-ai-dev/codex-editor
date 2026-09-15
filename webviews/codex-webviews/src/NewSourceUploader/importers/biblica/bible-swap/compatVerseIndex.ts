/**
 * Lightweight verse-key index for Bible Swap compatibility analysis.
 *
 * Skips prose text, span XML, and paragraph signatures — only records which
 * (book, chapter, verse) triples exist. Much faster than buildBibleVerseIndex
 * for pre-export overlap checks.
 */

import {
    PSA_BOOK_CODE,
    isPsalmSubheaderParagraphStyle,
} from "./psalmVersification";
import { parseVerseMarkerNumbers } from "./verseMarkers";
import {
    collectContentText,
    parseChapterMarkerContent,
    extractBookCode,
    isBookMarkerParagraphStyle,
    isChapterMarkerStyle,
    isVerseMarkerStyle,
    iterateContentAbs,
    iterateCsrAbs,
    iterateParagraphs,
} from "./surgicalSwap";
import { readChapterTransitionFromParagraph } from "./chapterBlocks";

export interface CompatVerseIndex {
    /** book code -> set of "chapter|verse" */
    byBook: Map<string, Set<string>>;
    /** Psalm chapters where Bible verse 1 is a superscription subheader. */
    psalmSubheaderChapters: Set<string>;
}

export interface CompatVerseIndexSerialized {
    byBook: Array<[string, string[]]>;
    psalmSubheaderChapters: string[];
}

export function serializeCompatVerseIndex(index: CompatVerseIndex): CompatVerseIndexSerialized {
    return {
        byBook: Array.from(index.byBook.entries()).map(([book, verses]) => [
            book,
            Array.from(verses),
        ]),
        psalmSubheaderChapters: Array.from(index.psalmSubheaderChapters),
    };
}

export function deserializeCompatVerseIndex(data: CompatVerseIndexSerialized): CompatVerseIndex {
    const byBook = new Map<string, Set<string>>();
    for (const [book, verses] of data.byBook) {
        byBook.set(book, new Set(verses));
    }
    return {
        byBook,
        psalmSubheaderChapters: new Set(data.psalmSubheaderChapters),
    };
}

interface CompatWalkOptions {
    /** Include Bible `head:d_h` superscription paragraphs that carry meta:v. */
    indexBibleSubheaders?: boolean;
}

function isCompatParagraphStyle(style: string, options?: CompatWalkOptions): boolean {
    if (/(?:^|\/)(?:intro|title|notes)%3a/.test(style)) return false;
    if (/(?:^|\/)(?:intro|title|notes):/.test(style)) return false;
    if (options?.indexBibleSubheaders && isPsalmSubheaderParagraphStyle(style)) {
        return true;
    }
    if (/(?:^|\/)head%3a/.test(style) || /(?:^|\/)head:/.test(style)) return false;
    if (/(?:^|\/)meta%3a/.test(style) || /(?:^|\/)meta:/.test(style)) return false;
    return true;
}

interface OpenVerseKey {
    book: string;
    chapter: string;
    verse: string;
    paragraphStyle: string;
}

/**
 * Build a verse-key-only index from Story XML (compatibility / overlap checks).
 */
export function buildCompatVerseIndex(
    storyXml: string,
    options?: CompatWalkOptions
): CompatVerseIndex {
    const byBook = new Map<string, Set<string>>();
    const psalmSubheaderChapters = new Set<string>();
    const seenKeys = new Set<string>();

    let currentBook = "";
    let currentChapter = "";
    let openVerse: OpenVerseKey | null = null;

    const addVerse = (book: string, chapter: string, verse: string, paragraphStyle: string) => {
        const dedupeKey = `${book}|${chapter}|${verse}`;
        if (seenKeys.has(dedupeKey)) return;
        seenKeys.add(dedupeKey);

        let set = byBook.get(book);
        if (!set) {
            set = new Set();
            byBook.set(book, set);
        }
        set.add(`${chapter}|${verse}`);

        if (
            book === PSA_BOOK_CODE &&
            verse === "1" &&
            isPsalmSubheaderParagraphStyle(paragraphStyle)
        ) {
            psalmSubheaderChapters.add(chapter);
        }
    };

    for (const para of iterateParagraphs(storyXml)) {
        if (isBookMarkerParagraphStyle(para.appliedParagraphStyle)) {
            let bookRaw = "";
            for (const c of iterateContentAbs(storyXml, para.bodyStart, para.bodyEnd)) {
                bookRaw += storyXml.slice(c.absInnerStart, c.absInnerEnd);
            }
            const code = extractBookCode(bookRaw);
            if (code) {
                currentBook = code;
                currentChapter = "";
                openVerse = null;
            }
            continue;
        }

        if (!isCompatParagraphStyle(para.appliedParagraphStyle, options)) {
            const chapterInPara = readChapterTransitionFromParagraph(
                storyXml,
                para.appliedParagraphStyle,
                para.bodyStart,
                para.bodyEnd,
                currentBook
            );
            if (chapterInPara && chapterInPara !== currentChapter) {
                currentChapter = chapterInPara;
                openVerse = null;
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
            currentChapter = chapterInPara;
            openVerse = null;
        }

        for (const csr of iterateCsrAbs(storyXml, para.bodyStart, para.bodyEnd)) {
            if (isChapterMarkerStyle(csr.appliedCharacterStyle)) {
                const cnum = parseChapterMarkerContent(
                    collectContentText(storyXml, csr.absBodyStart, csr.absBodyEnd)
                );
                if (cnum && cnum !== currentChapter) {
                    currentChapter = cnum;
                    openVerse = null;
                }
                continue;
            }

            if (isVerseMarkerStyle(csr.appliedCharacterStyle)) {
                const covered = parseVerseMarkerNumbers(
                    collectContentText(storyXml, csr.absBodyStart, csr.absBodyEnd)
                );
                if (covered.length === 0) continue;
                const vnum = String(covered[0]);

                if (openVerse && openVerse.verse === vnum) {
                    for (const verse of covered) {
                        addVerse(
                            openVerse.book,
                            openVerse.chapter,
                            String(verse),
                            openVerse.paragraphStyle
                        );
                    }
                    openVerse = null;
                } else if (currentBook) {
                    if (!currentChapter) {
                        currentChapter = "1";
                    }
                    openVerse = {
                        book: currentBook,
                        chapter: currentChapter,
                        verse: vnum,
                        paragraphStyle: para.appliedParagraphStyle,
                    };
                }
            }
        }
    }

    return { byBook, psalmSubheaderChapters };
}

export function compatIndexHasPsalmSubheaderV1(
    index: CompatVerseIndex,
    chapter: string
): boolean {
    return index.psalmSubheaderChapters.has(chapter);
}
