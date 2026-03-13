/**
 * Cell Metadata Builder for USFM Experimental Importer
 * 
 * This file centralizes all cell metadata structure creation for USFM experimental imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating verse cell metadata
 */
export interface VerseCellMetadataParams {
    bookCode: string;
    bookName?: string;
    fileName: string;
    chapter: number;
    verse: number | string;
    originalLine: string;
    originalText: string;
    lineIndex: number;
    cellLabel: string;
    breakTag?: string; // Break tags for multi-line verses (e.g., "\\li1|\\q2")
}

/**
 * Parameters for creating paratext cell metadata (headers, sections, paragraphs)
 */
export interface ParatextCellMetadataParams {
    bookCode: string;
    bookName?: string;
    fileName: string;
    chapter: number;
    marker: string; // USFM marker (e.g., "\id", "\s1", "\p", "\c")
    originalLine: string;
    originalText: string;
    lineIndex: number;
}

/**
 * Creates metadata for a verse cell
 * Generates a UUID for the cell ID
 */
export function createVerseCellMetadata(params: VerseCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            bookCode: params.bookCode,
            bookName: params.bookName,
            fileName: params.fileName,
            chapter: params.chapter,
            marker: '\\v',
            originalLine: params.originalLine,
            originalText: params.originalText,
            lineIndex: params.lineIndex,
            verse: params.verse,
            cellLabel: params.cellLabel,
            breakTag: params.breakTag,
            chapterNumber: String(params.chapter), // Chapter number for milestone detection
            data: {
                originalText: params.originalText,
                globalReferences: [`${params.bookCode} ${params.chapter}:${params.verse}`], // Format: "GEN 1:1"
            },
        }
    };
}

/**
 * Creates metadata for a paratext cell (headers, sections, paragraphs, etc.)
 * Generates a UUID for the cell ID
 */
export function createParatextCellMetadata(params: ParatextCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    const chapterNumberForMetadata = params.chapter === 0
        ? "0"
        : String(params.chapter);

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            bookCode: params.bookCode,
            bookName: params.bookName,
            fileName: params.fileName,
            chapter: params.chapter,
            marker: params.marker,
            originalLine: params.originalLine,
            originalText: params.originalText,
            lineIndex: params.lineIndex,
            chapterNumber: chapterNumberForMetadata, // Chapter number for milestone detection
            data: {
                originalText: params.originalText,
                globalReferences: [], // Empty for USFM files (no global references)
            },
        }
    };
}
