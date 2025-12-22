/**
 * Cell Metadata Builder for TMS Importer
 * 
 * This file centralizes all cell metadata structure creation for TMS (TMX/XLIFF) imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating TMS translation unit cell metadata
 */
export interface TmsCellMetadataParams {
    unitId: string;
    sourceLanguage: string;
    targetLanguage: string;
    originalText: string;
    targetText?: string;
    note?: string;
    fileName: string;
    cellIndex: number;
}

/**
 * Creates metadata for a TMS translation unit cell
 * Generates a UUID for the cell ID
 */
export function createTmsCellMetadata(params: TmsCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            unitId: params.unitId,
            sourceLanguage: params.sourceLanguage,
            targetLanguage: params.targetLanguage,
            targetText: params.targetText,
            note: params.note,
            cellIndex: params.cellIndex,
            data: {
                originalText: params.originalText,
                globalReferences: [], // Empty for TMS files (no verse references)
            },
            documentContext: {
                fileName: params.fileName,
                importerType: 'tms',
            }
        }
    };
}
