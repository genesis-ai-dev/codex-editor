/**
 * Cell Metadata Builder for eBible Corpus Importer
 * 
 * This file centralizes all cell metadata structure creation for eBible corpus imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating verse cell metadata
 */
export interface EbibleVerseCellMetadataParams {
    book: string; // Book name or code (e.g., "GEN", "Genesis")
    chapter: number; // Chapter number
    verse: number; // Verse number
    text: string; // Verse text content
    reference?: string; // Optional verse reference string (e.g., "GEN 1:1")
    fileName?: string; // Optional file name
    cellLabel?: string; // Optional cell label (usually verse number)
}

/**
 * Converts book name to USFM book code
 * Handles both full names and codes
 */
function getBookCode(book: string): string {
    if (!book) return book;

    // If already a 3-letter code, return uppercase
    if (book.length === 3 && /^[A-Z0-9]{3}$/i.test(book)) {
        return book.toUpperCase();
    }

    // Map of common book names to USFM codes
    const bookMap: Record<string, string> = {
        'Genesis': 'GEN', 'Exodus': 'EXO', 'Leviticus': 'LEV', 'Numbers': 'NUM', 'Deuteronomy': 'DEU',
        'Joshua': 'JOS', 'Judges': 'JDG', 'Ruth': 'RUT', '1 Samuel': '1SA', '2 Samuel': '2SA',
        '1 Kings': '1KI', '2 Kings': '2KI', '1 Chronicles': '1CH', '2 Chronicles': '2CH', 'Ezra': 'EZR',
        'Nehemiah': 'NEH', 'Esther': 'EST', 'Job': 'JOB', 'Psalms': 'PSA', 'Psalm': 'PSA',
        'Proverbs': 'PRO', 'Ecclesiastes': 'ECC', 'Song of Songs': 'SNG', 'Isaiah': 'ISA',
        'Jeremiah': 'JER', 'Lamentations': 'LAM', 'Ezekiel': 'EZK', 'Daniel': 'DAN',
        'Hosea': 'HOS', 'Joel': 'JOL', 'Amos': 'AMO', 'Obadiah': 'OBA', 'Jonah': 'JON',
        'Micah': 'MIC', 'Nahum': 'NAH', 'Habakkuk': 'HAB', 'Zephaniah': 'ZEP', 'Haggai': 'HAG',
        'Zechariah': 'ZEC', 'Malachi': 'MAL',
        'Matthew': 'MAT', 'Mark': 'MRK', 'Luke': 'LUK', 'John': 'JHN', 'Acts': 'ACT',
        'Romans': 'ROM', '1 Corinthians': '1CO', '2 Corinthians': '2CO', 'Galatians': 'GAL',
        'Ephesians': 'EPH', 'Philippians': 'PHP', 'Colossians': 'COL', '1 Thessalonians': '1TH',
        '2 Thessalonians': '2TH', '1 Timothy': '1TI', '2 Timothy': '2TI', 'Titus': 'TIT',
        'Philemon': 'PHM', 'Hebrews': 'HEB', 'James': 'JAS', '1 Peter': '1PE', '2 Peter': '2PE',
        '1 John': '1JN', '2 John': '2JN', '3 John': '3JN', 'Jude': 'JUD', 'Revelation': 'REV',
    };

    // Try exact match first
    if (bookMap[book]) {
        return bookMap[book];
    }

    // Try case-insensitive match
    const lowerName = book.toLowerCase();
    for (const [key, value] of Object.entries(bookMap)) {
        if (key.toLowerCase() === lowerName) {
            return value;
        }
    }

    // Fallback: use first 3 uppercase letters
    return book.substring(0, 3).toUpperCase();
}

/**
 * Creates global references from verse data
 */
function createGlobalReferences(book: string, chapter: number, verse: number): string[] {
    const bookCode = getBookCode(book);
    return [`${bookCode} ${chapter}:${verse}`];
}

/**
 * Creates metadata for a verse cell
 * Generates a UUID for the cell ID
 */
export function createEbibleVerseCellMetadata(params: EbibleVerseCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    // Create global references
    const globalReferences = createGlobalReferences(params.book, params.chapter, params.verse);

    // Determine cell label
    const cellLabel = params.cellLabel || String(params.verse);

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            chapterNumber: String(params.chapter), // Chapter number for milestone detection
            verseReference: params.reference || `${params.book} ${params.chapter}:${params.verse}`,
            book: params.book,
            chapter: params.chapter,
            verse: params.verse,
            cellLabel: cellLabel,
            originalText: params.text,
            data: {
                originalText: params.text,
                globalReferences: globalReferences,
                sourceFile: params.fileName || '',
            },
        }
    };
}
