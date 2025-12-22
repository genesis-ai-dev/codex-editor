/**
 * Cell Metadata Builder for USFM Importer
 * 
 * This file centralizes all cell metadata structure creation for USFM imports.
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
    originalText: string;
    cellLabel: string;
    hasFootnotes?: boolean;
}

/**
 * Parameters for creating paratext cell metadata (headers, sections, paragraphs)
 */
export interface ParatextCellMetadataParams {
    bookCode: string;
    bookName?: string;
    fileName: string;
    chapter: number;
    originalText: string;
    marker?: string; // USFM marker (e.g., "\id", "\s1", "\p", "\c")
    isChild?: boolean;
    parentId?: string;
    hasFootnotes?: boolean;
}

/**
 * Parameters for creating header cell metadata
 */
export interface HeaderCellMetadataParams {
    bookCode: string;
    bookName?: string;
    fileName: string;
    marker: string; // USFM marker (e.g., "\id", "\h", "\toc3")
    originalText: string;
    index: number;
}

/**
 * Creates metadata for a verse cell
 * Generates a UUID for the cell ID
 */
export function createVerseCellMetadata(params: VerseCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    // Create global reference in format "GEN 1:1"
    const globalReferences = [`${params.bookCode} ${params.chapter}:${params.verse}`];

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            bookCode: params.bookCode,
            bookName: params.bookName,
            chapter: params.chapter,
            verse: params.verse,
            cellLabel: params.cellLabel,
            originalText: params.originalText,
            fileName: params.fileName,
            hasFootnotes: params.hasFootnotes || false,
            chapterNumber: String(params.chapter), // Chapter number for milestone detection
            data: {
                originalText: params.originalText,
                globalReferences: globalReferences,
                sourceFile: params.fileName,
            },
            documentContext: {
                importerType: 'usfm',
                fileName: params.fileName,
            }
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

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            bookCode: params.bookCode,
            bookName: params.bookName,
            chapter: params.chapter,
            marker: params.marker,
            originalText: params.originalText,
            fileName: params.fileName,
            hasFootnotes: params.hasFootnotes || false,
            isChild: params.isChild || false,
            parentId: params.parentId,
            chapterNumber: params.chapter === 0 ? "0" : String(params.chapter), // Chapter number for milestone detection
            data: {
                originalText: params.originalText,
                globalReferences: [], // Empty for paratext cells (no verse references)
                sourceFile: params.fileName,
            },
            documentContext: {
                importerType: 'usfm',
                fileName: params.fileName,
            }
        }
    };
}

/**
 * Creates metadata for a header cell
 * Generates a UUID for the cell ID
 */
export function createHeaderCellMetadata(params: HeaderCellMetadataParams): { metadata: any; cellId: string; } {
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
            chapter: 1, // Headers are assigned to chapter 1
            marker: params.marker,
            originalText: params.originalText,
            fileName: params.fileName,
            hasFootnotes: false,
            chapterNumber: "1", // Chapter number for milestone detection (headers assigned to chapter 1)
            data: {
                originalText: params.originalText,
                globalReferences: [], // Empty for header cells (no verse references)
                sourceFile: params.fileName,
            },
            documentContext: {
                importerType: 'usfm',
                fileName: params.fileName,
            }
        }
    };
}
