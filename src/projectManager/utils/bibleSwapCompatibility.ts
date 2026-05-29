/**
 * Bible Swap Compatibility (host-side)
 * ====================================
 *
 * Parses a selected Bible IDML file and each selected Study Bible `.codex`
 * notebook's original IDML and produces a compatibility report (book /
 * chapter / verse overlap). Used by the export webview to show the user
 * how well the chosen Bible file aligns with their Study Bibles before
 * they commit to a Bible Swap export.
 */

import * as vscode from "vscode";
import JSZip from "jszip";
import { basename } from "path";

import {
    buildBibleVerseIndex,
    BibleVerseIndex,
    listVerseKeys,
    SKIPPED_BOOK_CODES,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bibleSwap";
import { readCodexNotebookFromUri } from "../../exportHandler/exportHandlerUtils";
import { resolveOriginalFileUri } from "../../providers/NewSourceUploader/originalFileUtils";

export interface BibleSwapCompatibilityReport {
    bibleFileName: string;
    booksFound: number; // books in both Bible and at least one Study notebook
    booksExpected: number; // distinct books across all Study notebooks
    chaptersFound: number; // (book,chapter) pairs in both
    chaptersExpected: number;
    versesMatched: number; // (book,chapter,verse) triples in both
    versesExpected: number;
    psaSkipped: boolean; // true if the selected Study notebooks reference PSA
    perBookMismatches: Array<{ book: string; missing: number; extra: number }>;
}

/**
 * Read a Bible IDML file's bytes, unzip it, find the largest `Stories/*.xml`,
 * and build a verse index.
 */
export async function buildBibleIndexFromUri(
    uri: vscode.Uri
): Promise<BibleVerseIndex> {
    const data = await vscode.workspace.fs.readFile(uri);
    return buildBibleIndexFromBytes(data);
}

export async function buildBibleIndexFromBytes(
    data: Uint8Array
): Promise<BibleVerseIndex> {
    if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
        throw new Error(
            "Selected file is not a valid IDML (ZIP) archive. Expected a .idml file."
        );
    }
    const zip = await JSZip.loadAsync(data);
    const storyXml = await readLargestStoryXml(zip);
    if (!storyXml) {
        throw new Error(
            "No Stories/*.xml entries found inside the IDML. The file may be empty or corrupted."
        );
    }
    return buildBibleVerseIndex(storyXml);
}

/**
 * Pull the largest XML file under `Stories/` from a loaded IDML ZIP and
 * return its contents as a UTF-8 string. Per the analysis doc, the main
 * Story XML is always the largest one in the folder.
 */
async function readLargestStoryXml(zip: JSZip): Promise<string | null> {
    let bestKey: string | null = null;
    let bestSize = -1;
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const file = zip.files[name];
        if (file.dir) continue;
        // `_data.uncompressedSize` isn't part of the public types but it's
        // available on the internal JSZip object. Fall back to reading the
        // file if not present.
        const size =
            (file as unknown as { _data?: { uncompressedSize?: number } })._data
                ?.uncompressedSize ?? -1;
        if (size > bestSize) {
            bestSize = size;
            bestKey = name;
        }
    }
    if (!bestKey) {
        // Slow fallback: read every Stories XML, take the longest text.
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

/**
 * Walk the selected `.codex` notebooks: load each one's original IDML and
 * extract its verse set. Returns the aggregated set as a verse-index-style
 * map (innerXml/shape are unused on the Study side here, just need the keys).
 */
async function buildStudyVerseSetFromCodexFiles(
    filesToExport: string[]
): Promise<Map<string, Set<string>>> {
    // Result: book -> set of "chapter|verse"
    const result = new Map<string, Set<string>>();
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return result;
    const workspaceFolder = workspaceFolders[0];

    for (const filePath of filesToExport) {
        try {
            const uri = vscode.Uri.file(filePath);
            const notebook = await readCodexNotebookFromUri(uri);
            const meta = notebook.metadata as unknown as
                | { originalFileName?: string; originalName?: string }
                | undefined;
            const originalFileName =
                meta?.originalFileName ||
                meta?.originalName ||
                `${basename(filePath).split(".")[0]}.idml`;
            const originalUri = await resolveOriginalFileUri(
                workspaceFolder,
                originalFileName
            );
            const data = await vscode.workspace.fs.readFile(originalUri);
            if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) continue;
            const zip = await JSZip.loadAsync(data);
            const storyXml = await readLargestStoryXml(zip);
            if (!storyXml) continue;
            const studyIndex = buildBibleVerseIndex(storyXml);
            for (const key of listVerseKeys(studyIndex)) {
                const [book, chapter, verse] = key.split("|");
                let set = result.get(book);
                if (!set) {
                    set = new Set();
                    result.set(book, set);
                }
                set.add(`${chapter}|${verse}`);
            }
        } catch (err) {
            console.warn(
                `[BibleSwapCompatibility] Could not read original IDML for ${filePath}:`,
                err
            );
        }
    }
    return result;
}

/**
 * Compute a compatibility report between a chosen Bible IDML and the set of
 * `.codex` files the user has selected for export.
 */
export async function analyzeBibleSwapCompatibility(
    bibleIdmlPath: string,
    filesToExport: string[]
): Promise<BibleSwapCompatibilityReport> {
    const bibleUri = vscode.Uri.file(bibleIdmlPath);
    const bibleFileName = basename(bibleIdmlPath);

    const [bibleIndex, studyByBook] = await Promise.all([
        buildBibleIndexFromUri(bibleUri),
        buildStudyVerseSetFromCodexFiles(filesToExport),
    ]);

    // Pre-bucket the Bible index by book for cheap lookups.
    const bibleByBook = new Map<string, Set<string>>(); // book -> "chapter|verse"
    for (const key of listVerseKeys(bibleIndex)) {
        const [book, chapter, verse] = key.split("|");
        let set = bibleByBook.get(book);
        if (!set) {
            set = new Set();
            bibleByBook.set(book, set);
        }
        set.add(`${chapter}|${verse}`);
    }

    let booksExpected = 0;
    let booksFound = 0;
    const chapterSetExpected = new Set<string>(); // "book|chapter"
    const chapterSetFound = new Set<string>();
    let versesExpected = 0;
    let versesMatched = 0;
    let psaSkipped = false;
    const perBookMismatches: Array<{ book: string; missing: number; extra: number }> = [];

    for (const [book, studyVerses] of studyByBook.entries()) {
        booksExpected++;
        if (SKIPPED_BOOK_CODES.has(book)) {
            psaSkipped = true;
            // PSA is excluded from the matched/expected totals so the
            // "% match" number isn't artificially dragged down by a book
            // we deliberately don't swap.
            booksExpected--;
            continue;
        }

        const bibleVerses = bibleByBook.get(book);
        if (bibleVerses && bibleVerses.size > 0) booksFound++;

        let missing = 0;
        for (const cv of studyVerses) {
            versesExpected++;
            const [chapter] = cv.split("|");
            chapterSetExpected.add(`${book}|${chapter}`);
            if (bibleVerses && bibleVerses.has(cv)) {
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

    return {
        bibleFileName,
        booksFound,
        booksExpected,
        chaptersFound: chapterSetFound.size,
        chaptersExpected: chapterSetExpected.size,
        versesMatched,
        versesExpected,
        psaSkipped,
        perBookMismatches,
    };
}
