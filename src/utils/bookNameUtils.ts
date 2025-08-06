import * as vscode from "vscode";
import * as path from "path";

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

    // Try to match against localized book names if they exist
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const localizedPath = path.join(workspaceRoot, "localized-books.json");

            const fs = await import("fs");
            if (fs.existsSync(localizedPath)) {
                const localizedContent = fs.readFileSync(localizedPath, "utf8");
                const localizedBooks = JSON.parse(localizedContent);

                const localizedMatch = localizedBooks.find((book: any) => book.name === bookName);
                if (localizedMatch && localizedMatch.abbr) {
                    return localizedMatch.abbr;
                }
            }
        }
    } catch (error) {
        console.warn("Error reading localized book names:", error);
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
    // First check for localized names
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const localizedPath = path.join(workspaceRoot, "localized-books.json");

            const fs = await import("fs");
            if (fs.existsSync(localizedPath)) {
                const localizedContent = fs.readFileSync(localizedPath, "utf8");
                const localizedBooks = JSON.parse(localizedContent);

                const localizedBook = localizedBooks.find((book: any) => book.abbr === usfmCode);
                if (localizedBook && localizedBook.name) {
                    return localizedBook.name;
                }
            }
        }
    } catch (error) {
        console.warn("Error reading localized book names:", error);
    }

    // Fallback to English name
    const books = await loadBooksLookup();
    const book = books.find(b => b.abbr === usfmCode);
    return book ? book.name : usfmCode;
}

/**
 * Create a standardized filename using USFM code
 */
export async function createStandardizedFilename(bookName: string, extension: ".source" | ".codex"): Promise<string> {
    const usfmCode = await getUsfmCodeFromBookName(bookName);
    if (!usfmCode) {
        // If we can't find a USFM code, sanitize the book name for filename use
        const sanitized = bookName
            .replace(/[^\w\s-]/g, '') // Remove special characters
            .replace(/\s+/g, '-')     // Replace spaces with hyphens
            .substring(0, 50);        // Limit length
        console.warn(`Using sanitized name ${sanitized} instead of USFM code for ${bookName}`);
        return `${sanitized}${extension}`;
    }
    return `${usfmCode}${extension}`;
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