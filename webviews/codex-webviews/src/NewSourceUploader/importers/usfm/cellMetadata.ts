/**
 * Cell Metadata Builder for USFM Importer
 * 
 * This file centralizes all cell metadata structure creation for USFM imports.
 * Makes it easy to find and modify metadata fields in one place.
 * 
 * Used by both the main USFM importer (index.ts / usfmParser.ts) and the
 * shared common/usfmUtils.ts (for ebibleCorpus, paratext importers).
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
    originalLine?: string;
    lineIndex?: number;
    breakTag?: string;
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
    marker?: string;
    originalLine?: string;
    lineIndex?: number;
    hasFootnotes?: boolean;
    isChild?: boolean;
    parentId?: string;
}

/**
 * Parameters for creating header cell metadata
 */
export interface HeaderCellMetadataParams {
    bookCode: string;
    bookName?: string;
    fileName: string;
    marker: string;
    originalText: string;
    index: number;
}

/**
 * Creates metadata for a verse cell
 * Generates a UUID for the cell ID
 */
export function createVerseCellMetadata(params: VerseCellMetadataParams): { metadata: any; cellId: string; } {
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
            hasFootnotes: params.hasFootnotes || false,
            chapterNumber: String(params.chapter),
            data: {
                originalText: params.originalText,
                globalReferences: [`${params.bookCode} ${params.chapter}:${params.verse}`],
            },
        }
    };
}

/**
 * Creates metadata for a paratext cell (headers, sections, paragraphs, etc.)
 * Generates a UUID for the cell ID
 */
export function createParatextCellMetadata(params: ParatextCellMetadataParams): { metadata: any; cellId: string; } {
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
            hasFootnotes: params.hasFootnotes || false,
            isChild: params.isChild || false,
            parentId: params.parentId,
            chapterNumber: chapterNumberForMetadata,
            data: {
                originalText: params.originalText,
                globalReferences: [],
            },
        }
    };
}

/**
 * Creates metadata for a header cell
 * Generates a UUID for the cell ID
 */
export function createHeaderCellMetadata(params: HeaderCellMetadataParams): { metadata: any; cellId: string; } {
    const cellId = uuidv4();

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            bookCode: params.bookCode,
            bookName: params.bookName,
            chapter: 1,
            marker: params.marker,
            originalText: params.originalText,
            fileName: params.fileName,
            hasFootnotes: false,
            chapterNumber: "1",
            data: {
                originalText: params.originalText,
                globalReferences: [],
            },
        }
    };
}
