/**
 * Cell Metadata Builder for OBS (Open Bible Stories) Importer
 * 
 * This file centralizes all cell metadata structure creation for OBS imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating text cell metadata
 */
export interface ObsTextCellMetadataParams {
    storyNumber: number;
    storyTitle: string;
    segmentIndex: number;
    originalText: string;
    fileName: string;
    documentId: string;
    sectionId: string;
    cellIndex: number;
    cellLabel: string;
    sourceReference?: string; // Bible reference like "Genesis 1-2" or "Matthew 5:1-10"
}

/**
 * Parameters for creating image cell metadata
 */
export interface ObsImageCellMetadataParams {
    storyNumber: number;
    storyTitle: string;
    segmentIndex: number;
    fileName: string;
    documentId: string;
    sectionId: string;
    cellIndex: number;
    cellLabel: string;
    imageAlt?: string;
    imageTitle?: string;
    originalImageSrc: string;
    sourceReference?: string; // Bible reference like "Genesis 1-2" or "Matthew 5:1-10"
}

/**
 * Parses Bible references from sourceReference string into globalReferences array
 * Handles formats like:
 * - "Genesis 1-2"
 * - "Matthew 5:1-10"
 * - "Genesis 1:1-2:3"
 * - "Matthew 5:1-6:2"
 */
function parseGlobalReferences(sourceReference?: string): string[] {
    if (!sourceReference || !sourceReference.trim()) {
        return [];
    }

    const references: string[] = [];
    const trimmed = sourceReference.trim();

    // Try to match patterns like "Genesis 1-2", "Matthew 5:1-10", etc.
    // Match book name, chapter, optional verse range
    const patterns = [
        // Format: "Book Chapter:VerseStart-VerseEnd" or "Book Chapter:VerseStart-ChapterEnd:VerseEnd"
        /^([A-Za-z]+)\s+(\d+):(\d+)-(\d+):(\d+)$/, // e.g., "Genesis 1:1-2:3"
        /^([A-Za-z]+)\s+(\d+):(\d+)-(\d+)$/, // e.g., "Matthew 5:1-10"
        /^([A-Za-z]+)\s+(\d+)-(\d+)$/, // e.g., "Genesis 1-2"
        /^([A-Za-z]+)\s+(\d+)$/, // e.g., "Genesis 1"
    ];

    for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (match) {
            const bookName = match[1];
            const bookCode = getBookCode(bookName);

            if (pattern === patterns[0]) {
                // "Book Chapter:VerseStart-ChapterEnd:VerseEnd"
                const startChapter = parseInt(match[2], 10);
                const startVerse = parseInt(match[3], 10);
                const endChapter = parseInt(match[4], 10);
                const endVerse = parseInt(match[5], 10);

                // Generate references for all verses in range
                for (let ch = startChapter; ch <= endChapter; ch++) {
                    const verseStart = ch === startChapter ? startVerse : 1;
                    const verseEnd = ch === endChapter ? endVerse : 999; // Assume max verse

                    for (let v = verseStart; v <= verseEnd && v <= 200; v++) { // Cap at 200 verses per chapter
                        references.push(`${bookCode} ${ch}:${v}`);
                    }
                }
            } else if (pattern === patterns[1]) {
                // "Book Chapter:VerseStart-VerseEnd"
                const chapter = parseInt(match[2], 10);
                const startVerse = parseInt(match[3], 10);
                const endVerse = parseInt(match[4], 10);

                for (let v = startVerse; v <= endVerse && v <= 200; v++) {
                    references.push(`${bookCode} ${chapter}:${v}`);
                }
            } else if (pattern === patterns[2]) {
                // "Book ChapterStart-ChapterEnd"
                const startChapter = parseInt(match[2], 10);
                const endChapter = parseInt(match[3], 10);

                for (let ch = startChapter; ch <= endChapter; ch++) {
                    references.push(`${bookCode} ${ch}:1`); // Just reference chapter start
                }
            } else if (pattern === patterns[3]) {
                // "Book Chapter"
                const chapter = parseInt(match[2], 10);
                references.push(`${bookCode} ${chapter}:1`); // Just reference chapter start
            }

            break;
        }
    }

    // If no pattern matched, try to extract at least book and chapter
    if (references.length === 0) {
        const simpleMatch = trimmed.match(/^([A-Za-z]+)\s+(\d+)/);
        if (simpleMatch) {
            const bookName = simpleMatch[1];
            const bookCode = getBookCode(bookName);
            const chapter = parseInt(simpleMatch[2], 10);
            references.push(`${bookCode} ${chapter}:1`);
        }
    }

    return references;
}

/**
 * Converts book name to book code (e.g., "Genesis" -> "GEN")
 */
function getBookCode(bookName: string): string {
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
 * Creates metadata for a text cell
 * Generates a UUID for the cell ID
 */
export function createObsTextCellMetadata(params: ObsTextCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    // Parse global references from sourceReference
    const globalReferences = parseGlobalReferences(params.sourceReference);

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            storyNumber: params.storyNumber,
            storyTitle: params.storyTitle,
            segmentType: 'text',
            segmentIndex: params.segmentIndex,
            originalText: params.originalText,
            fileName: params.fileName,
            documentId: params.documentId,
            sectionId: params.sectionId,
            cellIndex: params.cellIndex,
            cellLabel: params.cellLabel,
            chapterNumber: String(params.storyNumber), // Use story number as chapter number for milestone detection
            data: {
                originalText: params.originalText,
                globalReferences: globalReferences,
            },
        }
    };
}

/**
 * Creates metadata for an image cell
 * Generates a UUID for the cell ID
 */
export function createObsImageCellMetadata(params: ObsImageCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    // Parse global references from sourceReference
    const globalReferences = parseGlobalReferences(params.sourceReference);

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            storyNumber: params.storyNumber,
            storyTitle: params.storyTitle,
            segmentType: 'image',
            segmentIndex: params.segmentIndex,
            fileName: params.fileName,
            documentId: params.documentId,
            sectionId: params.sectionId,
            cellIndex: params.cellIndex,
            cellLabel: params.cellLabel,
            imageAlt: params.imageAlt,
            imageTitle: params.imageTitle,
            originalImageSrc: params.originalImageSrc,
            chapterNumber: String(params.storyNumber), // Use story number as chapter number for milestone detection
            data: {
                globalReferences: globalReferences,
            },
        }
    };
}
