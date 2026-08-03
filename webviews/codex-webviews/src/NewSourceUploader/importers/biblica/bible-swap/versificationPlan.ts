/**
 * Bible Swap versification plan.
 *
 * Aligns Study Bible verse slots to the translated Bible by chapter AND verse
 * number (every book, Psalms included). For each study chapter N: verses that
 * exist in both are replaced with the translation's text, verses the
 * translation has beyond the study are appended, and study verses the
 * translation lacks are removed. The translation's own numbering is preserved
 * (e.g. a Psalm superscription it counts as verse 1 stays verse 1).
 */

import type { ChapterBlockIndex, ChapterBlockKey, VerseKey } from "./types";
import { chapterBlockKey, verseKey } from "./types";
import type { ExtractSliceOptions } from "./chapterBlocks";
import {
    collapseRedundantProseInBlockXml,
    extractSliceByVerseRange,
    injectMetaChapterMarkerIfMissing,
    readChapterTransitionFromParagraph,
    stripLeadingBibleSubheaderPsr,
} from "./chapterBlocks";
import { PSA_BOOK_CODE } from "./psalmVersification";
import { getParagraphIndex } from "./paragraphIndex";
import {
    buildBibleVerseIndex,
    collectContentText,
    extractBookCode,
    isBookMarkerParagraphStyle,
    iterateCsrAbs,
    listVerseKeys,
    type BibleVerseIndex,
} from "./surgicalSwap";

export interface BibleVerseRef {
    book: string;
    chapter: string;
    verse: string;
}

export interface BibleVerseSlice {
    chapter: string;
    firstVerse: number;
    lastVerse: number;
}

export interface StructureChapterPlan {
    studyBook: string;
    studyChapter: string;
    studyVerseStart: number;
    studyVerseEnd: number;
    bibleSlices: BibleVerseSlice[];
    /** Study chapter has headings but no verse markers — insert Bible block only. */
    insertOnly: boolean;
}

export type VersePlanAction =
    | { action: "replace"; bible: BibleVerseRef }
    | { action: "remove" };

export interface VersificationPlanStats {
    versesMapped: number;
    versesRemoved: number;
    versesInserted: number;
    psalmChapterSlots: number;
    psalmChapterShifts: number;
}

export interface VersificationPlanSummary {
    versesMapped: number;
    versesRemoved: number;
    versesInserted: number;
    psalmChapterShifts: number;
    projectedVerseMatchPercent: number;
}

export interface VersificationPlan {
    verseMap: Map<VerseKey, VersePlanAction>;
    structureChapters: Map<ChapterBlockKey, StructureChapterPlan>;
    chapterInserts: Map<ChapterBlockKey, BibleVerseRef[]>;
    trailingInserts: BibleVerseRef[];
    /** Per book: study chapter → bible chapter when they differ (e.g. PHM 3→1). */
    chapterRemaps: Map<string, Map<string, string>>;
    stats: VersificationPlanStats;
}

export interface BibleSwapVerseRef {
    book: string;
    chapter: string;
    verse: string;
}

export interface BibleSwapVerseChange extends BibleSwapVerseRef {
    textPreview: string;
    /** Bible paragraph structure signature (structure mode). */
    structure?: string;
}

export interface BibleSwapVerseRedirect {
    studyBook: string;
    studyChapter: string;
    studyVerse: string;
    bibleBook: string;
    bibleChapter: string;
    bibleVerse: string;
    studyTextPreview: string;
    bibleTextPreview: string;
    bibleStructure?: string;
}

export interface BibleSwapStructureInsert {
    studyBook: string;
    studyChapter: string;
    bibleBook: string;
    bibleChapter: string;
    verseStart: number;
    verseEnd: number;
    verseCount: number;
    textPreview: string;
    structure?: string;
}

export interface BibleSwapVersificationChanges {
    removed: BibleSwapVerseChange[];
    inserted: BibleSwapVerseChange[];
    redirected: BibleSwapVerseRedirect[];
    structureInserts: BibleSwapStructureInsert[];
    totalRemoved: number;
    totalInserted: number;
    totalRedirected: number;
    totalStructureInserts: number;
    truncated: boolean;
}

const TEXT_PREVIEW_LEN = 96;
const DEFAULT_MAX_CHANGES = 400;

function truncatePreview(text: string | undefined, max = TEXT_PREVIEW_LEN): string {
    const normalized = (text ?? "").replace(/\s+/g, " ").trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1)}…`;
}

function createEmptyVersificationPlan(): VersificationPlan {
    return {
        verseMap: new Map(),
        structureChapters: new Map(),
        chapterInserts: new Map(),
        trailingInserts: [],
        chapterRemaps: new Map(),
        stats: {
            versesMapped: 0,
            versesRemoved: 0,
            versesInserted: 0,
            psalmChapterSlots: 0,
            psalmChapterShifts: 0,
        },
    };
}

function parseVerseNum(verse: string): number {
    const n = parseInt(verse, 10);
    return Number.isFinite(n) ? n : 0;
}

/** Ordered Psalm chapter numbers from meta:c markers in the study story. */
export function listPsalmChapterNumbersFromStory(storyXml: string): string[] {
    const chapters: string[] = [];
    let inPsa = false;
    let seen = new Set<string>();

    for (const para of getParagraphIndex(storyXml)) {
        if (isBookMarkerParagraphStyle(para.appliedParagraphStyle)) {
            let bookRaw = "";
            for (const csr of iterateCsrAbs(storyXml, para.bodyStart, para.bodyEnd)) {
                bookRaw += collectContentText(
                    storyXml,
                    csr.absBodyStart,
                    csr.absBodyEnd
                );
            }
            const code = extractBookCode(bookRaw);
            inPsa = code === PSA_BOOK_CODE;
            if (!inPsa) seen = new Set();
            continue;
        }
        if (!inPsa) continue;

        const chapterInPara = readChapterTransitionFromParagraph(
            storyXml,
            para.appliedParagraphStyle,
            para.bodyStart,
            para.bodyEnd,
            PSA_BOOK_CODE
        );
        if (chapterInPara && !seen.has(chapterInPara)) {
            seen.add(chapterInPara);
            chapters.push(chapterInPara);
        }
    }
    return chapters;
}

/** Psalm chapter numbers in numeric order (study markers, index, and Bible). */
export function sortedPsalmChapterNumbers(
    studyStoryXml: string,
    studyIndex: BibleVerseIndex,
    bibleIndex: BibleVerseIndex
): string[] {
    const chapters = new Set<string>();
    for (const ch of listPsalmChapterNumbersFromStory(studyStoryXml)) {
        chapters.add(ch);
    }
    for (const key of listVerseKeys(studyIndex)) {
        const [book, chapter] = key.split("|");
        if (book === PSA_BOOK_CODE) chapters.add(chapter);
    }
    for (const key of listVerseKeys(bibleIndex)) {
        const [book, chapter] = key.split("|");
        if (book === PSA_BOOK_CODE) chapters.add(chapter);
    }
    return Array.from(chapters).sort(
        (a, b) => parseInt(a, 10) - parseInt(b, 10)
    );
}

function collectChaptersForBook(
    index: BibleVerseIndex,
    book: string
): string[] {
    const chapters = new Set<string>();
    for (const key of listVerseKeys(index)) {
        const [b, chapter] = key.split("|");
        if (b === book) chapters.add(chapter);
    }
    return Array.from(chapters).sort(
        (a, b) => parseVerseNum(a) - parseVerseNum(b)
    );
}

/** Map study chapter numbers to the Bible's chapter numbers for the same book. */
function buildStudyToBibleChapterMap(
    book: string,
    studyIndex: BibleVerseIndex,
    bibleIndex: BibleVerseIndex
): Map<string, string> {
    const studyChapters = collectChaptersForBook(studyIndex, book);
    const bibleChapters = collectChaptersForBook(bibleIndex, book);
    const bibleSet = new Set(bibleChapters);
    const map = new Map<string, string>();

    for (const studyChapter of studyChapters) {
        if (bibleSet.has(studyChapter)) {
            map.set(studyChapter, studyChapter);
        }
    }

    const unmappedStudy = studyChapters.filter((ch) => !map.has(ch));
    const mappedBible = new Set(map.values());
    const unmappedBible = bibleChapters.filter((ch) => !mappedBible.has(ch));

    if (unmappedStudy.length === 1 && unmappedBible.length === 1) {
        map.set(unmappedStudy[0], unmappedBible[0]);
    }

    for (const studyChapter of unmappedStudy) {
        if (!map.has(studyChapter) && bibleSet.has(studyChapter)) {
            map.set(studyChapter, studyChapter);
        }
    }

    return map;
}

function buildBibleToStudyChapterMap(
    studyToBible: Map<string, string>
): Map<string, string> {
    const inverse = new Map<string, string>();
    for (const [studyChapter, bibleChapter] of studyToBible) {
        if (!inverse.has(bibleChapter)) {
            inverse.set(bibleChapter, studyChapter);
        }
    }
    return inverse;
}

function pushSlice(
    slices: BibleVerseSlice[],
    chapter: string,
    verse: number
): void {
    const last = slices[slices.length - 1];
    if (last && last.chapter === chapter && last.lastVerse + 1 === verse) {
        last.lastVerse = verse;
        return;
    }
    slices.push({ chapter, firstVerse: verse, lastVerse: verse });
}

function buildDirectBookPlan(
    book: string,
    studyIndex: BibleVerseIndex,
    bibleIndex: BibleVerseIndex,
    plan: VersificationPlan
): void {
    const studyKeys = listVerseKeys(studyIndex).filter((k) => k.startsWith(`${book}|`));
    const studyToBible = buildStudyToBibleChapterMap(book, studyIndex, bibleIndex);
    const bibleToStudy = buildBibleToStudyChapterMap(studyToBible);

    const remaps = new Map<string, string>();
    for (const [studyChapter, bibleChapter] of studyToBible) {
        if (studyChapter !== bibleChapter) {
            remaps.set(studyChapter, bibleChapter);
        }
    }
    if (remaps.size > 0) {
        plan.chapterRemaps.set(book, remaps);
    }

    for (const studyKey of studyKeys) {
        const [, chapter, verse] = studyKey.split("|");
        const bibleChapter = studyToBible.get(chapter) ?? chapter;
        const bibleKey = verseKey(book, bibleChapter, verse);
        if (bibleIndex.has(bibleKey)) {
            plan.verseMap.set(studyKey, {
                action: "replace",
                bible: { book, chapter: bibleChapter, verse },
            });
            plan.stats.versesMapped++;

            const chKey = chapterBlockKey(book, chapter);
            let chPlan = plan.structureChapters.get(chKey);
            if (!chPlan) {
                chPlan = {
                    studyBook: book,
                    studyChapter: chapter,
                    studyVerseStart: parseVerseNum(verse),
                    studyVerseEnd: parseVerseNum(verse),
                    bibleSlices: [],
                    insertOnly: false,
                };
                plan.structureChapters.set(chKey, chPlan);
            } else {
                chPlan.studyVerseStart = Math.min(
                    chPlan.studyVerseStart,
                    parseVerseNum(verse)
                );
                chPlan.studyVerseEnd = Math.max(
                    chPlan.studyVerseEnd,
                    parseVerseNum(verse)
                );
            }
            pushSlice(chPlan.bibleSlices, bibleChapter, parseVerseNum(verse));
        } else {
            plan.verseMap.set(studyKey, { action: "remove" });
            plan.stats.versesRemoved++;
        }
    }

    for (const bibleKey of listVerseKeys(bibleIndex)) {
        const [b, bibleChapter, v] = bibleKey.split("|");
        if (b !== book) continue;
        const studyChapter = bibleToStudy.get(bibleChapter) ?? bibleChapter;
        const studyKey = verseKey(book, studyChapter, v);
        if (!studyIndex.has(studyKey)) {
            const ref = { book, chapter: bibleChapter, verse: v };
            const chKey = chapterBlockKey(book, studyChapter);
            const list = plan.chapterInserts.get(chKey) ?? [];
            list.push(ref);
            plan.chapterInserts.set(chKey, list);
            plan.stats.versesInserted++;
        }
    }
}

/**
 * Build a versification plan from pre-built verse indexes (avoids re-parsing XML).
 */
export function buildVersificationPlanFromIndices(
    studyStoryXml: string,
    studyIndex: BibleVerseIndex,
    bibleIndex: BibleVerseIndex
): VersificationPlan {
    const plan = createEmptyVersificationPlan();

    const studyBooks = new Set<string>();
    for (const key of listVerseKeys(studyIndex)) {
        studyBooks.add(key.split("|")[0]);
    }

    // Every book — Psalms included — uses the same simple model: align study
    // chapter N to translated chapter N by verse number, replacing matching
    // verses, appending the translation's extra verses, and removing study
    // verses the translation lacks. The translation's own numbering (including
    // a superscription counted as verse 1) is preserved.
    for (const book of studyBooks) {
        buildDirectBookPlan(book, studyIndex, bibleIndex, plan);
    }

    return plan;
}

/**
 * Build a versification plan: Study slots → Bible content stream (Bible wins).
 */
export function buildVersificationPlan(
    studyStoryXml: string,
    bibleStoryXml: string
): VersificationPlan {
    const studyIndex = buildBibleVerseIndex(studyStoryXml);
    const bibleIndex = buildBibleVerseIndex(bibleStoryXml);
    return buildVersificationPlanFromIndices(studyStoryXml, studyIndex, bibleIndex);
}

function verseChangeFromRef(
    ref: BibleVerseRef,
    bibleIndex: BibleVerseIndex
): BibleSwapVerseChange {
    const entry = bibleIndex.get(verseKey(ref.book, ref.chapter, ref.verse));
    return {
        book: ref.book,
        chapter: ref.chapter,
        verse: ref.verse,
        textPreview: truncatePreview(entry?.text),
        structure: entry?.paragraphSig || undefined,
    };
}

function compareVerseRefs(a: BibleVerseRef, b: BibleVerseRef): number {
    if (a.book !== b.book) return a.book.localeCompare(b.book);
    const ac = parseInt(a.chapter, 10) || 0;
    const bc = parseInt(b.chapter, 10) || 0;
    if (ac !== bc) return ac - bc;
    const av = parseInt(a.verse, 10) || 0;
    const bv = parseInt(b.verse, 10) || 0;
    return av - bv;
}

/**
 * Collect human-readable change lists from a versification plan for the UI.
 */
export function collectVersificationChanges(
    plan: VersificationPlan,
    studyIndex: BibleVerseIndex,
    bibleIndex: BibleVerseIndex,
    options?: { maxPerCategory?: number }
): BibleSwapVersificationChanges {
    const maxPerCategory = options?.maxPerCategory ?? DEFAULT_MAX_CHANGES;

    const removedAll: BibleSwapVerseChange[] = [];
    const redirectedAll: BibleSwapVerseRedirect[] = [];

    for (const [studyKey, action] of plan.verseMap.entries()) {
        const [book, chapter, verse] = studyKey.split("|");
        if (action.action === "remove") {
            const studyEntry = studyIndex.get(studyKey);
            removedAll.push({
                book,
                chapter,
                verse,
                textPreview: truncatePreview(studyEntry?.text),
            });
            continue;
        }

        const { bible } = action;
        const isCrossChapterRedirect = bible.chapter !== chapter;
        if (isCrossChapterRedirect) {
            const studyEntry = studyIndex.get(studyKey);
            const bibleEntry = bibleIndex.get(
                verseKey(bible.book, bible.chapter, bible.verse)
            );
            redirectedAll.push({
                studyBook: book,
                studyChapter: chapter,
                studyVerse: verse,
                bibleBook: bible.book,
                bibleChapter: bible.chapter,
                bibleVerse: bible.verse,
                studyTextPreview: truncatePreview(studyEntry?.text),
                bibleTextPreview: truncatePreview(bibleEntry?.text),
                bibleStructure: bibleEntry?.paragraphSig || undefined,
            });
        }
    }

    const insertedKeySet = new Set<string>();
    const insertedAll: BibleSwapVerseChange[] = [];
    const pushInsert = (ref: BibleVerseRef) => {
        const key = verseKey(ref.book, ref.chapter, ref.verse);
        if (insertedKeySet.has(key)) return;
        insertedKeySet.add(key);
        insertedAll.push(verseChangeFromRef(ref, bibleIndex));
    };

    for (const refs of plan.chapterInserts.values()) {
        for (const ref of refs) pushInsert(ref);
    }
    for (const ref of plan.trailingInserts) pushInsert(ref);

    const structureInsertsAll: BibleSwapStructureInsert[] = [];
    for (const chPlan of plan.structureChapters.values()) {
        if (!chPlan.insertOnly || chPlan.bibleSlices.length === 0) continue;

        for (const slice of chPlan.bibleSlices) {
            const previews: string[] = [];
            const structures = new Set<string>();
            let count = 0;
            for (let v = slice.firstVerse; v <= slice.lastVerse; v++) {
                const entry = bibleIndex.get(
                    verseKey(chPlan.studyBook, slice.chapter, String(v))
                );
                if (!entry || entry.isSubheader) continue;
                count++;
                if (previews.length < 3) {
                    previews.push(truncatePreview(entry.text, 60));
                }
                if (entry.paragraphSig) structures.add(entry.paragraphSig);
            }
            if (count === 0) continue;

            structureInsertsAll.push({
                studyBook: chPlan.studyBook,
                studyChapter: chPlan.studyChapter,
                bibleBook: chPlan.studyBook,
                bibleChapter: slice.chapter,
                verseStart: slice.firstVerse,
                verseEnd: slice.lastVerse,
                verseCount: count,
                textPreview: previews.join(" · "),
                structure:
                    structures.size > 0
                        ? Array.from(structures).slice(0, 3).join(" | ")
                        : undefined,
            });
        }
    }

    removedAll.sort(compareVerseRefs);
    insertedAll.sort(compareVerseRefs);
    redirectedAll.sort((a, b) =>
        compareVerseRefs(
            {
                book: a.studyBook,
                chapter: a.studyChapter,
                verse: a.studyVerse,
            },
            { book: b.studyBook, chapter: b.studyChapter, verse: b.studyVerse }
        )
    );
    structureInsertsAll.sort((a, b) => {
        if (a.studyBook !== b.studyBook) return a.studyBook.localeCompare(b.studyBook);
        return (parseInt(a.studyChapter, 10) || 0) - (parseInt(b.studyChapter, 10) || 0);
    });

    const truncated =
        removedAll.length > maxPerCategory ||
        insertedAll.length > maxPerCategory ||
        redirectedAll.length > maxPerCategory ||
        structureInsertsAll.length > maxPerCategory;

    return {
        removed: removedAll.slice(0, maxPerCategory),
        inserted: insertedAll.slice(0, maxPerCategory),
        redirected: redirectedAll.slice(0, maxPerCategory),
        structureInserts: structureInsertsAll.slice(0, maxPerCategory),
        totalRemoved: removedAll.length,
        totalInserted: insertedAll.length,
        totalRedirected: redirectedAll.length,
        totalStructureInserts: structureInsertsAll.length,
        truncated,
    };
}

export function mergeVersificationChanges(
    lists: BibleSwapVersificationChanges[]
): BibleSwapVersificationChanges {
    if (lists.length === 0) {
        return {
            removed: [],
            inserted: [],
            redirected: [],
            structureInserts: [],
            totalRemoved: 0,
            totalInserted: 0,
            totalRedirected: 0,
            totalStructureInserts: 0,
            truncated: false,
        };
    }
    if (lists.length === 1) return lists[0];

    const dedupe = <T>(
        items: T[],
        keyFn: (item: T) => string
    ): T[] => {
        const seen = new Set<string>();
        const out: T[] = [];
        for (const item of items) {
            const key = keyFn(item);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(item);
        }
        return out;
    };

    const removed = dedupe(
        lists.flatMap((l) => l.removed),
        (v) => `${v.book}|${v.chapter}|${v.verse}`
    ).sort(compareVerseRefs);
    const inserted = dedupe(
        lists.flatMap((l) => l.inserted),
        (v) => `${v.book}|${v.chapter}|${v.verse}`
    ).sort(compareVerseRefs);
    const redirected = dedupe(
        lists.flatMap((l) => l.redirected),
        (v) => `${v.studyBook}|${v.studyChapter}|${v.studyVerse}`
    );
    const structureInserts = dedupe(
        lists.flatMap((l) => l.structureInserts),
        (v) =>
            `${v.studyBook}|${v.studyChapter}|${v.bibleChapter}|${v.verseStart}|${v.verseEnd}`
    );

    const maxPerCategory = DEFAULT_MAX_CHANGES;
    const truncated =
        removed.length > maxPerCategory ||
        inserted.length > maxPerCategory ||
        redirected.length > maxPerCategory ||
        structureInserts.length > maxPerCategory ||
        lists.some((l) => l.truncated);

    return {
        removed: removed.slice(0, maxPerCategory),
        inserted: inserted.slice(0, maxPerCategory),
        redirected: redirected.slice(0, maxPerCategory),
        structureInserts: structureInserts.slice(0, maxPerCategory),
        totalRemoved: removed.length,
        totalInserted: inserted.length,
        totalRedirected: redirected.length,
        totalStructureInserts: structureInserts.length,
        truncated,
    };
}

export function summarizeVersificationPlan(
    plan: VersificationPlan,
    studyVerseCount: number
): VersificationPlanSummary {
    const expected = studyVerseCount;
    const matched = plan.stats.versesMapped;
    const projectedVerseMatchPercent =
        expected > 0 ? Math.round((matched / expected) * 10000) / 100 : 100;

    return {
        versesMapped: plan.stats.versesMapped,
        versesRemoved: plan.stats.versesRemoved,
        versesInserted: plan.stats.versesInserted,
        psalmChapterShifts: plan.stats.psalmChapterShifts,
        projectedVerseMatchPercent,
    };
}

export function resolveVersePlan(
    plan: VersificationPlan | undefined,
    book: string,
    chapter: string,
    verse: string
): VersePlanAction | undefined {
    if (!plan) return undefined;
    return plan.verseMap.get(verseKey(book, chapter, verse));
}

export function bibleSlicesForStudyRange(
    plan: VersificationPlan,
    book: string,
    chapter: string,
    firstVerse: number,
    lastVerse: number
): BibleVerseSlice[] {
    const slices: BibleVerseSlice[] = [];
    for (let v = firstVerse; v <= lastVerse; v++) {
        const entry = plan.verseMap.get(
            verseKey(book, chapter, String(v))
        );
        if (!entry || entry.action !== "replace") continue;
        pushSlice(slices, entry.bible.chapter, parseVerseNum(entry.bible.verse));
    }
    return slices;
}

/** Merge consecutive chapterInserts refs into bible slice ranges for append. */
export function buildInsertSlicesFromRefs(
    refs: BibleVerseRef[]
): BibleVerseSlice[] {
    const slices: BibleVerseSlice[] = [];
    const sorted = [...refs].sort(
        (a, b) =>
            parseVerseNum(a.verse) - parseVerseNum(b.verse) ||
            parseVerseNum(a.chapter) - parseVerseNum(b.chapter)
    );
    for (const ref of sorted) {
        pushSlice(slices, ref.chapter, parseVerseNum(ref.verse));
    }
    return slices;
}

export function extractBibleXmlForSlices(
    bibleChapterIndex: ChapterBlockIndex,
    book: string,
    slices: BibleVerseSlice[],
    stripSubheaderForChapter?: (chapter: string) => boolean,
    sliceOptions?: ExtractSliceOptions
): string {
    let xml = "";
    for (const slice of slices) {
        const block = bibleChapterIndex.get(chapterBlockKey(book, slice.chapter));
        if (!block) continue;
        let blockXml = block.blockXml;
        if (stripSubheaderForChapter?.(slice.chapter)) {
            blockXml = stripLeadingBibleSubheaderPsr(blockXml);
        }
        const part = extractSliceByVerseRange(
            blockXml,
            slice.firstVerse,
            slice.lastVerse,
            sliceOptions
        );
        if (!part) continue;
        const withMarker =
            slice.firstVerse === 1
                ? injectMetaChapterMarkerIfMissing(part, slice.chapter)
                : part;
        xml += collapseRedundantProseInBlockXml(withMarker);
    }
    return xml;
}

/** Position after chapter heading paragraphs to insert Bible-only structure. */
export function findStudyChapterInsertPosition(
    storyXml: string,
    book: string,
    chapter: string
): number {
    let inBook = false;
    let insertAfter = -1;

    for (const para of getParagraphIndex(storyXml)) {
        if (isBookMarkerParagraphStyle(para.appliedParagraphStyle)) {
            let bookRaw = "";
            for (const csr of iterateCsrAbs(storyXml, para.bodyStart, para.bodyEnd)) {
                bookRaw += collectContentText(
                    storyXml,
                    csr.absBodyStart,
                    csr.absBodyEnd
                );
            }
            inBook = extractBookCode(bookRaw) === book;
            continue;
        }
        if (!inBook) continue;

        const chapterInPara = readChapterTransitionFromParagraph(
            storyXml,
            para.appliedParagraphStyle,
            para.bodyStart,
            para.bodyEnd,
            book
        );
        if (chapterInPara === chapter) {
            insertAfter = para.fullEnd;
        }

        if (insertAfter >= 0 && para.fullStart >= insertAfter) {
            const style = para.appliedParagraphStyle;
            if (/head%3a/.test(style)) {
                insertAfter = para.fullEnd;
                continue;
            }
            if (/text%3a/.test(style) || /(?:^|\/)b(?:_|$|\b)/.test(style)) {
                return para.fullStart;
            }
        }
    }

    return insertAfter >= 0 ? insertAfter : -1;
}
