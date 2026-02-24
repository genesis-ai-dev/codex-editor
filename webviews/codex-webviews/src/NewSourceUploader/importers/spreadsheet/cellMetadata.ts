/**
 * Cell Metadata Builder for Spreadsheet Importer
 * 
 * This file centralizes all cell metadata structure creation for Spreadsheet imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating Spreadsheet cell metadata
 */
export interface SpreadsheetCellMetadataParams {
    originalContent: string;
    rowIndex: number;
    originalRow: string[];
    fileName: string;
    globalReferences?: string[];
}

/**
 * Creates metadata for a Spreadsheet cell
 * Always generates a UUID for the cell ID.
 */
export function createSpreadsheetCellMetadata(params: SpreadsheetCellMetadataParams): { metadata: any; cellId: string; } {
    const { originalContent, rowIndex, originalRow, fileName, globalReferences } = params;

    const finalCellId = uuidv4();

    return {
        cellId: finalCellId,
        metadata: {
            id: finalCellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            data: {
                rowIndex,
                originalRow,
                originalContent,
                globalReferences: (globalReferences || []).map((r) => String(r).trim()).filter(Boolean),
            },
        }
    };
}
