/**
 * Bible Swap Compatibility (host-side)
 * ====================================
 *
 * Parses a selected Bible IDML file and each selected Study Bible `.codex`
 * notebook's original IDML and produces a compatibility report (book /
 * chapter / verse overlap). Used by the export webview to show the user
 * how well the chosen Bible file aligns with their Study Bibles before
 * they commit to a Bible Swap export.
 *
 * Performance: Story XML is loaded in parallel, compat indexing and
 * versification planning run in parallel worker threads.
 */

import * as vscode from "vscode";
import JSZip from "jszip";
import { basename } from "path";

type LoadedIdmlZip = Awaited<ReturnType<typeof JSZip.loadAsync>>;

import { PSA_BOOK_CODE } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap";
import type { CompatVerseIndex } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/compatVerseIndex";
import { compatIndexHasPsalmSubheaderV1 } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/compatVerseIndex";
import {
    mergeVersificationChanges,
    type BibleSwapStructureInsert,
    type BibleSwapVerseChange,
    type BibleSwapVerseRedirect,
    type BibleSwapVersificationChanges,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/versificationPlan";
import { readCodexNotebookFromUri } from "../../exportHandler/exportHandlerUtils";
import { resolveOriginalFileUri } from "../../providers/NewSourceUploader/originalFileUtils";
import {
    buildCompatVerseIndexesWithProgress,
    buildSerializedBibleVerseIndex,
    buildVersificationPlansParallel,
    type BibleSwapAnalysisProgress,
    type BibleSwapProgressCallback,
} from "./bibleSwapAnalysisPool";

export type {
    BibleSwapAnalysisProgress,
    BibleSwapProgressCallback,
};

export interface BibleSwapVersificationPlanSummary {
    versesMapped: number;
    versesRemoved: number;
    versesInserted: number;
    psalmChapterShifts: number;
    projectedVerseMatchPercent: number;
}

export type {
    BibleSwapVerseChange,
    BibleSwapVerseRedirect,
    BibleSwapStructureInsert,
    BibleSwapVersificationChanges,
};

export interface BibleSwapCompatibilityReport {
    bibleFileName: string;
    booksFound: number;
    booksExpected: number;
    chaptersFound: number;
    chaptersExpected: number;
    versesMatched: number;
    versesExpected: number;
    hasPsalms: boolean;
    /** @deprecated Use hasPsalms. */
    psaSkipped: boolean;
    perBookMismatches: Array<{ book: string; missing: number; extra: number }>;
    versificationPlan?: BibleSwapVersificationPlanSummary;
    versificationChanges?: BibleSwapVersificationChanges;
}

/**
 * Pull the largest XML file under `Stories/` from a loaded IDML ZIP and
 * return its contents as a UTF-8 string. Per the analysis doc, the main
 * Story XML is always the largest one in the folder.
 */
async function readLargestStoryXml(zip: LoadedIdmlZip): Promise<string | null> {
    let bestKey: string | null = null;
    let bestSize = -1;
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const file = zip.files[name];
        if (file.dir) continue;
        const size =
            (file as unknown as { _data?: { uncompressedSize?: number } })._data
                ?.uncompressedSize ?? -1;
        if (size > bestSize) {
            bestSize = size;
            bestKey = name;
        }
    }
    if (!bestKey) {
        let bestText: string | null = null;
        for (const name of Object.keys(zip.files)) {
            if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
            const file = zip.file(name);
            if (!file) continue;
            const text = await file.async("text");
            if (!bestText || text.length > bestText.length) {
                bestText = text;
            }
        }
        return bestText;
    }
    const file = zip.file(bestKey);
    if (!file) return null;
    return file.async("text");
}

async function loadStoryXmlFromIdmlBytes(data: Uint8Array): Promise<string> {
    if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
        throw new Error(
            "Selected file is not a valid IDML (ZIP) archive. Expected a .idml file."
        );
    }
    // `vscode.workspace.fs.readFile` returns a Node Buffer that is a *view* into
    // a larger pooled ArrayBuffer (non-zero byteOffset / underlying buffer bigger
    // than the file). This JSZip version reads the whole underlying buffer
    // instead of respecting the view bounds, so it misparses the central
    // directory and throws "End of data reached … Corrupted zip?". Copy into a
    // tight, zero-offset buffer first so JSZip only sees the file's bytes.
    // NOTE: must use `new Uint8Array(data)` (a real copy) — `Buffer.slice()`
    // returns another view that shares the same oversized backing buffer.
    const bytes =
        data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
            ? data
            : new Uint8Array(data);
    const zip = await JSZip.loadAsync(bytes);
    const storyXml = await readLargestStoryXml(zip);
    if (!storyXml) {
        throw new Error(
            "No Stories/*.xml entries found inside the IDML. The file may be empty or corrupted."
        );
    }
    return storyXml;
}

async function loadStoryXmlFromIdmlUri(uri: vscode.Uri): Promise<string> {
    const data = await vscode.workspace.fs.readFile(uri);
    return loadStoryXmlFromIdmlBytes(data);
}

function mergeCompatIndexes(indexes: CompatVerseIndex[]): Map<string, Set<string>> {
    const merged = new Map<string, Set<string>>();
    for (const index of indexes) {
        for (const [book, verses] of index.byBook.entries()) {
            let set = merged.get(book);
            if (!set) {
                set = new Set();
                merged.set(book, set);
            }
            for (const cv of verses) {
                set.add(cv);
            }
        }
    }
    return merged;
}

/**
 * Load original Study IDML Story XML for one `.codex` file (I/O only).
 */
async function loadStudyStoryXmlFromCodexFile(
    filePath: string
): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return null;
    const workspaceFolder = workspaceFolders[0];

    try {
        const uri = vscode.Uri.file(filePath);
        const notebook = await readCodexNotebookFromUri(uri);
        const meta = notebook.metadata as unknown as Record<string, unknown> | undefined;
        const originalFileName =
            (meta?.originalFileName as string | undefined) ||
            (meta?.originalName as string | undefined) ||
            `${basename(filePath).split(".")[0]}.idml`;
        const originalUri = await resolveOriginalFileUri(
            workspaceFolder,
            originalFileName
        );
        const data = await vscode.workspace.fs.readFile(originalUri);
        if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) return null;
        return loadStoryXmlFromIdmlBytes(data);
    } catch (err) {
        console.warn(
            `[BibleSwapCompatibility] Could not read original IDML for ${filePath}:`,
            err
        );
        return null;
    }
}

/**
 * Compute a compatibility report between a chosen Bible IDML and the set of
 * `.codex` files the user has selected for export.
 */
export async function analyzeBibleSwapCompatibility(
    bibleIdmlPath: string,
    filesToExport: string[],
    onProgress?: BibleSwapProgressCallback
): Promise<BibleSwapCompatibilityReport> {
    const bibleUri = vscode.Uri.file(bibleIdmlPath);
    const bibleFileName = basename(bibleIdmlPath);

    onProgress?.({
        stage: "loading",
        percent: 5,
        message: "Reading Bible and study IDML files…",
    });

    const [bibleStoryXml, studyStoryXmls] = await Promise.all([
        loadStoryXmlFromIdmlUri(bibleUri),
        Promise.all(filesToExport.map(loadStudyStoryXmlFromCodexFile)),
    ]);

    const studyXmls = studyStoryXmls.filter((xml): xml is string => xml !== null);

    onProgress?.({
        stage: "loading",
        percent: 20,
        message: `Loaded Bible + ${studyXmls.length} study file(s)`,
    });

    const indexTasks = [
        { storyXml: bibleStoryXml, indexBibleSubheaders: true },
        ...studyXmls.map((storyXml) => ({ storyXml })),
    ];

    onProgress?.({
        stage: "indexing",
        percent: 25,
        message: "Indexing verses…",
        current: 0,
        total: indexTasks.length,
    });

    const [bibleIndexSerialized, compatResults] = await Promise.all([
        buildSerializedBibleVerseIndex(bibleStoryXml),
        buildCompatVerseIndexesWithProgress(indexTasks, onProgress),
    ]);

    const [bibleIndex, ...studyIndexes] = compatResults;

    onProgress?.({
        stage: "planning",
        percent: 50,
        message: "Building versification plan…",
        current: 0,
        total: Math.max(studyXmls.length, 1),
    });

    const planResults = await buildVersificationPlansParallel(
        studyXmls,
        bibleIndexSerialized,
        onProgress
    );

    onProgress?.({
        stage: "summarizing",
        percent: 92,
        message: "Summarizing compatibility…",
    });

    const studyByBook = mergeCompatIndexes(studyIndexes);
    const bibleByBook = bibleIndex.byBook;

    let booksExpected = 0;
    let booksFound = 0;
    const chapterSetExpected = new Set<string>();
    const chapterSetFound = new Set<string>();
    let versesExpected = 0;
    let versesMatched = 0;
    let hasPsalms = false;
    const perBookMismatches: Array<{ book: string; missing: number; extra: number }> = [];

    const studyVerseMatchesBible = (
        book: string,
        chapter: string,
        verse: string,
        bibleVerses: Set<string> | undefined
    ): boolean => {
        if (!bibleVerses) return false;
        if (book === PSA_BOOK_CODE) {
            const offset = compatIndexHasPsalmSubheaderV1(bibleIndex, chapter) ? 1 : 0;
            const targetVerse = String(parseInt(verse, 10) + offset);
            return bibleVerses.has(`${chapter}|${targetVerse}`);
        }
        return bibleVerses.has(`${chapter}|${verse}`);
    };

    for (const [book, studyVerses] of studyByBook.entries()) {
        booksExpected++;
        if (book === PSA_BOOK_CODE) hasPsalms = true;

        const bibleVerses = bibleByBook.get(book);
        if (bibleVerses && bibleVerses.size > 0) booksFound++;

        let missing = 0;
        for (const cv of studyVerses) {
            versesExpected++;
            const [chapter, verse] = cv.split("|");
            chapterSetExpected.add(`${book}|${chapter}`);
            if (studyVerseMatchesBible(book, chapter, verse, bibleVerses)) {
                versesMatched++;
                chapterSetFound.add(`${book}|${chapter}`);
            } else {
                missing++;
            }
        }
        let extra = 0;
        if (bibleVerses) {
            for (const cv of bibleVerses) {
                if (!studyVerses.has(cv)) extra++;
            }
        }
        if (missing > 0 || extra > 0) {
            perBookMismatches.push({ book, missing, extra });
        }
    }

    perBookMismatches.sort((a, b) => b.missing + b.extra - (a.missing + a.extra));

    let versificationPlan: BibleSwapVersificationPlanSummary | undefined;
    let versificationChanges: BibleSwapVersificationChanges | undefined;

    if (planResults.length > 0) {
        let planMapped = 0;
        let planRemoved = 0;
        let planInserted = 0;
        let planPsalmShifts = 0;
        let planExpected = 0;

        for (const result of planResults) {
            planExpected += result.studyVerseCount;
            planMapped += result.stats.versesMapped;
            planRemoved += result.stats.versesRemoved;
            planInserted += result.stats.versesInserted;
            planPsalmShifts = Math.max(planPsalmShifts, result.stats.psalmChapterShifts);
        }

        const projectedVerseMatchPercent =
            planExpected > 0
                ? Math.round((planMapped / planExpected) * 10000) / 100
                : 100;

        versificationPlan = {
            versesMapped: planMapped,
            versesRemoved: planRemoved,
            versesInserted: planInserted,
            psalmChapterShifts: planPsalmShifts,
            projectedVerseMatchPercent,
        };

        versificationChanges = mergeVersificationChanges(
            planResults.map((r) => r.changes)
        );
    }

    onProgress?.({
        stage: "summarizing",
        percent: 100,
        message: "Analysis complete",
    });

    return {
        bibleFileName,
        booksFound,
        booksExpected,
        chaptersFound: chapterSetFound.size,
        chaptersExpected: chapterSetExpected.size,
        versesMatched,
        versesExpected,
        hasPsalms,
        psaSkipped: hasPsalms,
        perBookMismatches,
        versificationPlan,
        versificationChanges,
    };
}
