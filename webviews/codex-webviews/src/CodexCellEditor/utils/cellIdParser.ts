/**
 * Utility functions for parsing cell IDs in both old and new formats
 * 
 * Old format: {documentId} {sectionId}:{cellId} (e.g., "GEN 1:1")
 * New format: {importerType}-{fileUniqueId}-{sequentialIndex} (e.g., "ebible-a3f9b2c1x7-000001")
 * 
 * For new format, chapter/verse info is stored in cell metadata
 */

export interface BookChapterVerse {
    book: string;
    chapter?: number;
    verse?: number;
}

/**
 * Extracts book, chapter, and verse from a cell ID (supports both old and new formats)
 * 
 * @param cellMarker - The cell ID string (from cellMarkers array)
 * @param cellMetadata - Optional metadata object that may contain book/chapter/verse for new format
 * @returns Object with book, chapter, verse, or null if unable to parse
 */
export function extractBookChapterVerse(
    cellMarker: string,
    cellMetadata?: any
): BookChapterVerse | null {
    if (!cellMarker) return null;

    // Try old format first: "GEN 1:1" or "DocumentName 1:2"
    const oldFormatMatch = cellMarker.match(/^(.+?)\s+(\d+):(\d+)$/);
    if (oldFormatMatch) {
        return {
            book: oldFormatMatch[1].trim().toUpperCase(),
            chapter: parseInt(oldFormatMatch[2], 10),
            verse: parseInt(oldFormatMatch[3], 10),
        };
    }

    // Try new format - check metadata for book/chapter/verse
    if (cellMetadata) {
        const book = cellMetadata.book || cellMetadata.bookCode || cellMetadata.bookName;
        const chapter = cellMetadata.chapter;
        const verse = cellMetadata.verse;

        if (book) {
            return {
                book: typeof book === 'string' ? book.toUpperCase() : String(book).toUpperCase(),
                chapter: typeof chapter === 'number' ? chapter : (chapter ? parseInt(String(chapter), 10) : undefined),
                verse: typeof verse === 'number' ? verse : (verse ? parseInt(String(verse), 10) : undefined),
            };
        }
    }

    return null;
}

/**
 * Gets the chapter number from a cell ID
 * 
 * @param cellMarker - The cell ID string
 * @param cellMetadata - Optional metadata object
 * @returns Chapter number or null if unable to determine
 */
export function getChapterFromCellId(
    cellMarker: string,
    cellMetadata?: any
): number | null {
    const parsed = extractBookChapterVerse(cellMarker, cellMetadata);
    return parsed?.chapter ?? null;
}

/**
 * Gets the book abbreviation from a cell ID
 * 
 * @param cellMarker - The cell ID string
 * @param cellMetadata - Optional metadata object
 * @returns Book abbreviation or null if unable to determine
 */
export function getBookFromCellId(
    cellMarker: string,
    cellMetadata?: any
): string | null {
    const parsed = extractBookChapterVerse(cellMarker, cellMetadata);
    return parsed?.book ?? null;
}

/**
 * Gets the verse number from a cell ID
 * 
 * @param cellMarker - The cell ID string
 * @param cellMetadata - Optional metadata object
 * @returns Verse number or null if unable to determine
 */
export function getVerseFromCellId(
    cellMarker: string,
    cellMetadata?: any
): number | null {
    const parsed = extractBookChapterVerse(cellMarker, cellMetadata);
    return parsed?.verse ?? null;
}

/**
 * Formats a cell ID for display purposes
 * Attempts to create a human-readable format like "GEN 1:1"
 * 
 * @param cellMarker - The cell ID string
 * @param cellMetadata - Optional metadata object
 * @returns Formatted string for display, or the original cellMarker if unable to format
 */
export function formatCellIdForDisplay(
    cellMarker: string,
    cellMetadata?: any
): string {
    const parsed = extractBookChapterVerse(cellMarker, cellMetadata);
    if (parsed) {
        if (parsed.chapter !== undefined && parsed.verse !== undefined) {
            return `${parsed.book} ${parsed.chapter}:${parsed.verse}`;
        } else if (parsed.chapter !== undefined) {
            return `${parsed.book} ${parsed.chapter}`;
        } else {
            return parsed.book;
        }
    }
    return cellMarker;
}

/**
 * Gets a chapter identifier string (e.g., "GEN 1") from a cell ID
 * Useful for grouping cells by chapter
 * 
 * @param cellMarker - The cell ID string
 * @param cellMetadata - Optional metadata object
 * @returns Chapter identifier string or null if unable to determine
 */
export function getChapterIdFromCellId(
    cellMarker: string,
    cellMetadata?: any
): string | null {
    const parsed = extractBookChapterVerse(cellMarker, cellMetadata);
    if (parsed && parsed.chapter !== undefined) {
        return `${parsed.book} ${parsed.chapter}`;
    }
    return null;
}

