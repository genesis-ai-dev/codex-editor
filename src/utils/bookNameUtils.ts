import * as vscode from "vscode";
import * as path from "path";
import { CustomNotebookMetadata } from "@types";

interface BookInfo {
    name: string;
    abbr: string;
    ord: string;
    testament: string;
    osisId: string;
}

let booksLookup: BookInfo[] | null = null;

/**
 * Load the Bible books lookup data
 */
async function loadBooksLookup(): Promise<BookInfo[]> {
    if (booksLookup) {
        return booksLookup;
    }

    try {
        const extension = vscode.extensions.getExtension("project-accelerate.codex-editor-extension");
        if (!extension) {
            throw new Error("Could not find the Codex Editor extension.");
        }

        const booksLookupPath = path.join(
            extension.extensionPath,
            "webviews/codex-webviews/src/assets/bible-books-lookup.json"
        );

        const fs = await import("fs");
        const raw = fs.readFileSync(booksLookupPath, "utf8");
        booksLookup = JSON.parse(raw);
        return booksLookup!;
    } catch (error) {
        console.error("Error loading books lookup:", error);
        return [];
    }
}

/**
 * Get USFM code from book name (supports multiple languages via localized names)
 */
export async function getUsfmCodeFromBookName(bookName: string): Promise<string | null> {
    const books = await loadBooksLookup();

    // First check if the input is already a valid USFM code
    const upperBookName = bookName.toUpperCase().trim();
    if (/^[A-Z0-9]{3,4}$/.test(upperBookName)) {
        const directMatch = books.find(book => book.abbr === upperBookName);
        if (directMatch) {
            return upperBookName;
        }
    }

    // First try exact English name match
    const exactMatch = books.find(book => book.name === bookName);
    if (exactMatch) {
        return exactMatch.abbr;
    }

    // Fallback: try partial matching or common patterns
    const normalizedBookName = bookName.toLowerCase().trim();

    // Try to find by partial matches for common patterns
    const partialMatch = books.find(book => {
        const normalizedName = book.name.toLowerCase();
        return normalizedName.includes(normalizedBookName) ||
            normalizedBookName.includes(normalizedName);
    });

    if (partialMatch) {
        return partialMatch.abbr;
    }

    console.warn(`Could not find USFM code for book name: ${bookName}`);
    return null;
}

/**
 * Get book display name from USFM code (uses localized names if available)
 */
export async function getBookDisplayName(usfmCode: string): Promise<string> {
    // First check codex metadata for a saved display name
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            const rootUri = workspaceFolders[0].uri;
            const codexPattern = new vscode.RelativePattern(rootUri.fsPath, `files/target/**/${usfmCode}.codex`);
            const matches = await vscode.workspace.findFiles(codexPattern, undefined, 1);
            if (matches.length > 0) {
                const serializer = new (await import("../serializer")).CodexContentSerializer();
                const content = await vscode.workspace.fs.readFile(matches[0]);
                const notebookData = await serializer.deserializeNotebook(content, new vscode.CancellationTokenSource().token);
                const dn = (notebookData.metadata as CustomNotebookMetadata)?.fileDisplayName;
                if (typeof dn === "string" && dn.trim()) {
                    return dn.trim();
                }
            }
        }
    } catch (error) {
        console.warn("Error reading fileDisplayName from metadata:", error);
    }

    // Fallback to English name
    const books = await loadBooksLookup();
    const book = books.find(b => b.abbr === usfmCode);
    return book ? book.name : usfmCode;
}

/**
 * Determine if an importer type represents biblical content
 */
export function isBiblicalImporterType(importerType: string | undefined): boolean {
    if (!importerType) return false;
    const normalizedType = importerType.toLowerCase().trim();
    
    // Exact matches for biblical importers
    const bibleTypeImporters = [
        'usfm',
        'usfm-experimental',
        'paratext',
        'ebiblecorpus',
        'ebible',
        'ebible-download',
        'maculabible',
        'macula',
        'obs',
        // Note: 'pdf', 'docx', 'indesign', and 'biblica' are NOT included here
        // because they are generic document formats that should preserve
        // their original filenames rather than being converted to Bible book codes.
        // The importer type is stored in metadata, so filename suffixes are not needed.
    ];
    
    // Check exact match first
    if (bibleTypeImporters.includes(normalizedType)) {
        return true;
    }
    
    // Also check prefixes for variations (e.g., 'usfm-*' matches any USFM variant)
    const biblicalPrefixes = ['usfm', 'paratext', 'ebible', 'macula'];
    return biblicalPrefixes.some(prefix => normalizedType.startsWith(prefix));
}

/**
 * Create a standardized filename using USFM code
 */
export async function createStandardizedFilename(
    bookName: string,
    extension: ".source" | ".codex",
    isBiblicalContent: boolean = true
): Promise<string> {
    // Only attempt USFM code detection for biblical content
    if (isBiblicalContent) {
        const usfmCode = await getUsfmCodeFromBookName(bookName);
        if (usfmCode) {
            return `${usfmCode}${extension}`;
        }
    }

    // If not biblical content or no USFM code found, sanitize the book name for filename use
    const sanitized = bookName
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-')     // Replace spaces with hyphens
        .substring(0, 50);        // Limit length

    if (isBiblicalContent) {
        console.warn(`Using sanitized name ${sanitized} instead of USFM code for ${bookName}`);
    } else {
        console.log(`Using sanitized filename ${sanitized} for non-biblical content: ${bookName}`);
    }

    return `${sanitized}${extension}`;
}

/**
 * Extract USFM code from filename
 */
export function extractUsfmCodeFromFilename(filename: string): string | null {
    const baseName = path.basename(filename, path.extname(filename));
    // Remove .source or .codex extensions if present
    const cleanName = baseName.replace(/\.(source|codex)$/, '');

    // Check if it looks like a USFM code (3-4 characters, uppercase)
    if (/^[A-Z0-9]{3,4}$/.test(cleanName)) {
        return cleanName;
    }

    return null;
}

/**
 * Get all available USFM codes
 */
export async function getAllUsfmCodes(): Promise<string[]> {
    const books = await loadBooksLookup();
    return books.map(book => book.abbr);
}

/**
 * Check if a string is a valid USFM code
 */
export async function isValidUsfmCode(code: string): Promise<boolean> {
    const validCodes = await getAllUsfmCodes();
    return validCodes.includes(code);
}

/**
 * Determines the corpus marker for a given book code
 * Returns standardized "NT" or "OT" markers that match navigation expectations
 * 
 * This is a wrapper around the shared utility that returns a Promise for consistency
 * with other async functions in this file.
 * 
 * @param bookCode - 3-letter USFM book code (e.g., "GEN", "MAT") or book name
 * @returns Promise<"NT" | "OT" | null>
 */
export async function getCorpusMarkerForBook(bookCode: string): Promise<string | null> {
    // Import the shared utility
    const { getCorpusMarkerForBook: sharedGetCorpusMarkerForBook } = await import("../../sharedUtils/corpusUtils");
    return sharedGetCorpusMarkerForBook(bookCode);
}