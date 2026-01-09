/**
 * Cell Metadata Builder for Markdown Importer
 * 
 * This file centralizes all cell metadata structure creation for Markdown imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating markdown cell metadata
 */
export interface MarkdownCellMetadataParams {
    fileName: string;
    segmentIndex: number;
    originalMarkdown: string;
    elementType: 'heading' | 'list-item' | 'paragraph' | 'code-block' | 'table' | 'other';
    headingLevel?: number;
    headingText?: string;
    cellLabel?: string;
}

/**
 * Attempts to extract Bible references from markdown text
 * Looks for patterns like "Genesis 1:1", "Matt 5:1-10", etc.
 */
function extractGlobalReferences(text: string): string[] {
    const references: string[] = [];

    // Common Bible book abbreviations and names
    const bookPatterns = [
        // Old Testament
        'Genesis', 'Gen', 'Exodus', 'Exod', 'Ex', 'Leviticus', 'Lev', 'Numbers', 'Num', 'Deuteronomy', 'Deut', 'Dt',
        'Joshua', 'Josh', 'Judges', 'Jdg', 'Ruth', '1 Samuel', '1 Sam', '1Sa', '2 Samuel', '2 Sam', '2Sa',
        '1 Kings', '1 Kgs', '1Ki', '2 Kings', '2 Kgs', '2Ki', '1 Chronicles', '1 Chr', '1Ch', '2 Chronicles', '2 Chr', '2Ch',
        'Ezra', 'Nehemiah', 'Neh', 'Esther', 'Est', 'Job', 'Psalms', 'Psalm', 'Ps', 'Proverbs', 'Prov', 'Pr',
        'Ecclesiastes', 'Eccl', 'Song of Songs', 'Song', 'Sng', 'Isaiah', 'Isa', 'Jeremiah', 'Jer', 'Lamentations', 'Lam',
        'Ezekiel', 'Ezek', 'Ezk', 'Daniel', 'Dan', 'Hosea', 'Hos', 'Joel', 'Jol', 'Amos', 'Obadiah', 'Oba', 'Jonah', 'Jon',
        'Micah', 'Mic', 'Nahum', 'Nah', 'Habakkuk', 'Hab', 'Zephaniah', 'Zep', 'Haggai', 'Hag', 'Zechariah', 'Zec', 'Malachi', 'Mal',
        // New Testament
        'Matthew', 'Matt', 'Mt', 'Mark', 'Mk', 'Luke', 'Lk', 'John', 'Jn', 'Acts', 'Romans', 'Rom', 'Ro',
        '1 Corinthians', '1 Cor', '1Co', '2 Corinthians', '2 Cor', '2Co', 'Galatians', 'Gal', 'Ephesians', 'Eph',
        'Philippians', 'Phil', 'Php', 'Colossians', 'Col', '1 Thessalonians', '1 Thess', '1Th', '2 Thessalonians', '2 Thess', '2Th',
        '1 Timothy', '1 Tim', '1Ti', '2 Timothy', '2 Tim', '2Ti', 'Titus', 'Tit', 'Philemon', 'Phm', 'Hebrews', 'Heb',
        'James', 'Jas', '1 Peter', '1 Pet', '1Pe', '2 Peter', '2 Pet', '2Pe', '1 John', '1 Jn', '1JN', '2 John', '2 Jn', '2JN',
        '3 John', '3 Jn', '3JN', 'Jude', 'Revelation', 'Rev', 'Rv',
    ];

    // Pattern to match Bible references: "Book Chapter:Verse" or "Book Chapter:Verse-Verse" or "Book Chapter-Chapter"
    const referencePatterns = [
        // Format: "Book Chapter:VerseStart-VerseEnd" or "Book Chapter:VerseStart-ChapterEnd:VerseEnd"
        /([A-Za-z0-9\s]+)\s+(\d+):(\d+)-(\d+):(\d+)/g, // e.g., "Genesis 1:1-2:3"
        /([A-Za-z0-9\s]+)\s+(\d+):(\d+)-(\d+)/g, // e.g., "Matthew 5:1-10"
        /([A-Za-z0-9\s]+)\s+(\d+)-(\d+)/g, // e.g., "Genesis 1-2"
        /([A-Za-z0-9\s]+)\s+(\d+):(\d+)/g, // e.g., "Genesis 1:1"
        /([A-Za-z0-9\s]+)\s+(\d+)/g, // e.g., "Genesis 1"
    ];

    for (const pattern of referencePatterns) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
            const bookName = match[1].trim();

            // Check if it matches a known book name
            const isBibleBook = bookPatterns.some(book =>
                bookName.toLowerCase().includes(book.toLowerCase()) ||
                book.toLowerCase().includes(bookName.toLowerCase())
            );

            if (isBibleBook) {
                // Convert book name to book code
                const bookCode = getBookCode(bookName);

                if (pattern === referencePatterns[0]) {
                    // "Book Chapter:VerseStart-ChapterEnd:VerseEnd"
                    const startChapter = parseInt(match[2], 10);
                    const startVerse = parseInt(match[3], 10);
                    const endChapter = parseInt(match[4], 10);
                    const endVerse = parseInt(match[5], 10);

                    // Just add the start reference
                    references.push(`${bookCode} ${startChapter}:${startVerse}`);
                } else if (pattern === referencePatterns[1]) {
                    // "Book Chapter:VerseStart-VerseEnd"
                    const chapter = parseInt(match[2], 10);
                    const startVerse = parseInt(match[3], 10);
                    references.push(`${bookCode} ${chapter}:${startVerse}`);
                } else if (pattern === referencePatterns[2]) {
                    // "Book ChapterStart-ChapterEnd"
                    const startChapter = parseInt(match[2], 10);
                    references.push(`${bookCode} ${startChapter}:1`);
                } else if (pattern === referencePatterns[3]) {
                    // "Book Chapter:Verse"
                    const chapter = parseInt(match[2], 10);
                    const verse = parseInt(match[3], 10);
                    references.push(`${bookCode} ${chapter}:${verse}`);
                } else if (pattern === referencePatterns[4]) {
                    // "Book Chapter"
                    const chapter = parseInt(match[2], 10);
                    references.push(`${bookCode} ${chapter}:1`);
                }
            }
        }
    }

    return [...new Set(references)]; // Remove duplicates
}

/**
 * Converts book name to book code (e.g., "Genesis" -> "GEN")
 */
function getBookCode(bookName: string): string {
    const bookMap: Record<string, string> = {
        'Genesis': 'GEN', 'Gen': 'GEN', 'Exodus': 'EXO', 'Exod': 'EXO', 'Ex': 'EXO',
        'Leviticus': 'LEV', 'Lev': 'LEV', 'Numbers': 'NUM', 'Num': 'NUM',
        'Deuteronomy': 'DEU', 'Deut': 'DEU', 'Dt': 'DEU',
        'Joshua': 'JOS', 'Josh': 'JOS', 'Judges': 'JDG', 'Jdg': 'JDG', 'Ruth': 'RUT',
        '1 Samuel': '1SA', '1 Sam': '1SA', '1Sa': '1SA', '2 Samuel': '2SA', '2 Sam': '2SA', '2Sa': '2SA',
        '1 Kings': '1KI', '1 Kgs': '1KI', '1Ki': '1KI', '2 Kings': '2KI', '2 Kgs': '2KI', '2Ki': '2KI',
        '1 Chronicles': '1CH', '1 Chr': '1CH', '1Ch': '1CH', '2 Chronicles': '2CH', '2 Chr': '2CH', '2Ch': '2CH',
        'Ezra': 'EZR', 'Nehemiah': 'NEH', 'Neh': 'NEH', 'Esther': 'EST', 'Est': 'EST',
        'Job': 'JOB', 'Psalms': 'PSA', 'Psalm': 'PSA', 'Ps': 'PSA',
        'Proverbs': 'PRO', 'Prov': 'PRO', 'Pr': 'PRO', 'Ecclesiastes': 'ECC', 'Eccl': 'ECC',
        'Song of Songs': 'SNG', 'Song': 'SNG', 'Sng': 'SNG', 'Isaiah': 'ISA', 'Isa': 'ISA',
        'Jeremiah': 'JER', 'Jer': 'JER', 'Lamentations': 'LAM', 'Lam': 'LAM',
        'Ezekiel': 'EZK', 'Ezek': 'EZK', 'Ezk': 'EZK', 'Daniel': 'DAN', 'Dan': 'DAN',
        'Hosea': 'HOS', 'Hos': 'HOS', 'Joel': 'JOL', 'Jol': 'JOL', 'Amos': 'AMO',
        'Obadiah': 'OBA', 'Oba': 'OBA', 'Jonah': 'JON', 'Jon': 'JON',
        'Micah': 'MIC', 'Mic': 'MIC', 'Nahum': 'NAH', 'Nah': 'NAH',
        'Habakkuk': 'HAB', 'Hab': 'HAB', 'Zephaniah': 'ZEP', 'Zep': 'ZEP',
        'Haggai': 'HAG', 'Hag': 'HAG', 'Zechariah': 'ZEC', 'Zec': 'ZEC', 'Malachi': 'MAL', 'Mal': 'MAL',
        'Matthew': 'MAT', 'Matt': 'MAT', 'Mt': 'MAT', 'Mark': 'MRK', 'Mk': 'MRK',
        'Luke': 'LUK', 'Lk': 'LUK', 'John': 'JHN', 'Jn': 'JHN', 'Acts': 'ACT',
        'Romans': 'ROM', 'Rom': 'ROM', 'Ro': 'ROM',
        '1 Corinthians': '1CO', '1 Cor': '1CO', '1Co': '1CO', '2 Corinthians': '2CO', '2 Cor': '2CO', '2Co': '2CO',
        'Galatians': 'GAL', 'Gal': 'GAL', 'Ephesians': 'EPH', 'Eph': 'EPH',
        'Philippians': 'PHP', 'Phil': 'PHP', 'Php': 'PHP', 'Colossians': 'COL', 'Col': 'COL',
        '1 Thessalonians': '1TH', '1 Thess': '1TH', '1Th': '1TH', '2 Thessalonians': '2TH', '2 Thess': '2TH', '2Th': '2TH',
        '1 Timothy': '1TI', '1 Tim': '1TI', '1Ti': '1TI', '2 Timothy': '2TI', '2 Tim': '2TI', '2Ti': '2TI',
        'Titus': 'TIT', 'Tit': 'TIT', 'Philemon': 'PHM', 'Phm': 'PHM',
        'Hebrews': 'HEB', 'Heb': 'HEB', 'James': 'JAS', 'Jas': 'JAS',
        '1 Peter': '1PE', '1 Pet': '1PE', '1Pe': '1PE', '2 Peter': '2PE', '2 Pet': '2PE', '2Pe': '2PE',
        '1 John': '1JN', '1 Jn': '1JN', '1JN': '1JN', '2 John': '2JN', '2 Jn': '2JN', '2JN': '2JN',
        '3 John': '3JN', '3 Jn': '3JN', '3JN': '3JN', 'Jude': 'JUD',
        'Revelation': 'REV', 'Rev': 'REV', 'Rv': 'REV',
    };

    // Try exact match first
    if (bookMap[bookName]) {
        return bookMap[bookName];
    }

    // Try case-insensitive match
    const lowerName = bookName.toLowerCase();
    for (const [key, value] of Object.entries(bookMap)) {
        if (key.toLowerCase() === lowerName) {
            return value;
        }
    }

    // Fallback: use first 3 uppercase letters
    return bookName.substring(0, 3).toUpperCase();
}

/**
 * Creates metadata for a markdown cell
 * Generates a UUID for the cell ID
 */
export function createMarkdownCellMetadata(params: MarkdownCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    // Extract global references from the markdown text
    const globalReferences = extractGlobalReferences(params.originalMarkdown);

    // Determine chapter number for milestone detection
    // Use heading level 1 as chapter markers, or sequential numbering
    // For headings, use the heading level as a pseudo-chapter indicator
    let chapterNumber: string;
    if (params.elementType === 'heading' && params.headingLevel === 1) {
        // Use a sequential number based on segment index for level 1 headings
        // This creates milestones at major section breaks
        chapterNumber = String(Math.floor(params.segmentIndex / 10) + 1);
    } else {
        // For other elements, use a sequential chapter number based on position
        chapterNumber = String(Math.floor(params.segmentIndex / 20) + 1);
    }

    // Generate cell label if not provided
    const cellLabel = params.cellLabel ||
        (params.elementType === 'heading' && params.headingText
            ? params.headingText.substring(0, 20)
            : String(params.segmentIndex + 1));

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            segmentIndex: params.segmentIndex,
            originalMarkdown: params.originalMarkdown,
            elementType: params.elementType,
            hasHeading: params.elementType === 'heading',
            headingText: params.headingText,
            headingLevel: params.headingLevel,
            cellLabel,
            fileName: params.fileName,
            chapterNumber, // Chapter number for milestone detection
            data: {
                originalText: params.originalMarkdown,
                globalReferences: globalReferences,
            },
        }
    };
}
