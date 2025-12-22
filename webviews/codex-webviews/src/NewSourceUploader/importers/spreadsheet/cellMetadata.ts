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
    cellId: string; // Can be from spreadsheet ID column or generated UUID
    originalContent: string;
    rowIndex: number;
    originalRow: string[];
    fileName: string;
}

/**
 * Creates metadata for a Spreadsheet cell
 * Uses provided cellId (from spreadsheet ID column) or generates UUID if not provided
 */
export function createSpreadsheetCellMetadata(params: SpreadsheetCellMetadataParams): { metadata: any; cellId: string; } {
    const { cellId, originalContent, rowIndex, originalRow, fileName } = params;

    // Use provided cellId (from spreadsheet) or generate UUID
    // If cellId is empty string or undefined, generate UUID
    const finalCellId = cellId && cellId.trim() ? cellId.trim() : uuidv4();

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
                globalReferences: [], // Empty for Spreadsheet files (no verse references)
                sourceFile: fileName,
            },
            documentContext: {
                fileName,
                importerType: 'spreadsheet',
            }
        }
    };
}
