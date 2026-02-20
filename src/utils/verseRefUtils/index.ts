import * as vscode from "vscode";
import { getLookupStringsForBook } from "./verseData";

export const findVerseRef = ({ verseRef, content }: { verseRef: string; content: string }) => {
    // Utilize expanded strings for lookup
    const lookupStrings = getLookupStringsForBook(verseRef.split(" ")[0]);
    let verseRefWasFound = false;
    let verseRefInContentFormat = "";

    // Check each lookup string to see if it's present in the content
    for (const lookupString of lookupStrings) {
        const tsvVerseRef = `${lookupString}\t${verseRef.split(" ")[1]}\t${verseRef.split(" ")[2]}`;
        if (content.includes(verseRef) || content.includes(tsvVerseRef)) {
            verseRefWasFound = true;
            verseRefInContentFormat = content.includes(verseRef) ? verseRef : tsvVerseRef;
            break;
        }
    }

    return {
        verseRefWasFound,
        verseRefInContentFormat,
    };
};

export async function findReferences({
    verseRef,
    fileType,
    usfmOnly,
}: {
    verseRef: string;
    fileType?: string;
    usfmOnly?: boolean;
}) {
    const filesWithReferences: string[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) {
        return filesWithReferences;
    }

    for (const folder of workspaceFolders) {
        const normalizedFileType = fileType?.startsWith(".") ? fileType.substring(1) : fileType;
        const pattern = normalizedFileType
            ? vscode.Uri.joinPath(
                  folder.uri,
                  ".project",
                  "resources",
                  "**",
                  `*.${normalizedFileType}`
              ).fsPath
            : vscode.Uri.joinPath(folder.uri, ".project", "resources", "**").fsPath;
        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern));

        console.log({ files });

        for (const file of files) {
            const fileUri = vscode.Uri.file(file.fsPath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            const content = document.getText();
            const { verseRefWasFound } = findVerseRef({ verseRef, content });
            if (verseRefWasFound) {
                filesWithReferences.push(file.fsPath);
            }
        }
    }

    return filesWithReferences;
}

export const verseRefRegex = /(\b[A-Z, 1-9]{3}\s\d+:\d+\b)/;

export function extractVerseRefFromLine(line: string): string | null {
    // Implement logic to extract the verse reference (e.g., 'MAT 1:1') from a line
    // Return the verse reference as a string, or null if not found
    const match = line.match(verseRefRegex);
    return match ? match[0] : null;
}

/** Pattern for "BOOK 1:1" style at end of string (used for metadata.id or globalReferences) */
const verseRefAtEndRegex = /\s\d+:\d+$/;

/** Single verse ref: "BOOK C:V" */
export type ParsedSingleVerseRef = {
    kind: "single";
    book: string;
    chapter: number;
    verse: number;
    cellLabel: string;
};

/** Verse range ref: "BOOK C:V1-V2" */
export type ParsedVerseRangeRef = {
    kind: "range";
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    cellLabel: string;
};

export type ParsedVerseRef = ParsedSingleVerseRef | ParsedVerseRangeRef;

/** Match "BOOK C:V1-V2" (verse range) */
const verseRangeRefRegex = /^\s*([^\s]+)\s+(\d+):(\d+)-(\d+)\s*$/;
/** Match "BOOK C:V" (single verse) */
const singleVerseRefRegex = /^\s*([^\s]+)\s+(\d+):(\d+)\s*$/;

/**
 * Parse a ref string into a single-verse or verse-range result.
 * Examples: "JHN 4:4" -> single; "JHN 4:1-3" -> range with cellLabel "1-3".
 */
export function parseVerseRef(ref: string): ParsedVerseRef | null {
    if (typeof ref !== "string" || !ref.trim()) return null;
    const rangeMatch = ref.match(verseRangeRefRegex);
    if (rangeMatch) {
        const [, book, chapter, verseStart, verseEnd] = rangeMatch;
        return {
            kind: "range",
            book: book!,
            chapter: parseInt(chapter!, 10),
            verseStart: parseInt(verseStart!, 10),
            verseEnd: parseInt(verseEnd!, 10),
            cellLabel: `${verseStart}-${verseEnd}`,
        };
    }
    const singleMatch = ref.match(singleVerseRefRegex);
    if (singleMatch) {
        const [, book, chapter, verse] = singleMatch;
        return {
            kind: "single",
            book: book!,
            chapter: parseInt(chapter!, 10),
            verse: parseInt(verse!, 10),
            cellLabel: verse!,
        };
    }
    return null;
}

/**
 * Sort key (book, chapter, verse) for ordering content cells.
 * For verse ranges, verse is the start of the range.
 */
export function getSortKeyFromParsedRef(parsed: ParsedVerseRef): { book: string; chapter: number; verse: number } {
    if (parsed.kind === "single") {
        return { book: parsed.book, chapter: parsed.chapter, verse: parsed.verse };
    }
    return { book: parsed.book, chapter: parsed.chapter, verse: parsed.verseStart };
}

/** Pattern that matches either single verse or verse range at end (for backward compatibility) */
const verseRefOrRangeAtEndRegex = /\s\d+:\d+(-\d+)?$/;

/**
 * Get verse reference string (e.g. "MAT 1:1" or "JHN 4:1-3") from cell metadata.
 * Supports legacy format (metadata.id = "BOOK 1:1") and New Source Uploader USFM
 * (metadata.id = UUID, reference in data.globalReferences or bookCode/chapter/verse).
 * Also recognizes verse-range refs in globalReferences (e.g. "JHN 4:1-3").
 */
export function getVerseRefFromCellMetadata(metadata: {
    id?: string;
    bookCode?: string;
    chapter?: number;
    verse?: number;
    data?: { globalReferences?: string[] };
}): string | null {
    if (!metadata) return null;
    const id = metadata.id;
    if (typeof id === "string" && verseRefOrRangeAtEndRegex.test(id)) return id;
    const ref = metadata.data?.globalReferences?.[0];
    if (typeof ref === "string" && verseRefOrRangeAtEndRegex.test(ref)) return ref;
    const { bookCode, chapter, verse } = metadata;
    if (bookCode != null && chapter != null && verse != null)
        return `${String(bookCode).trim()} ${chapter}:${verse}`;
    return null;
}
