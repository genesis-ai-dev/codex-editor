/**
 * Cell Metadata Builder for Biblica Importer
 * 
 * This file centralizes all cell metadata structure creation for Biblica imports.
 * Makes it easy to find and modify metadata fields in one place.
 * 
 * Note: Verse cells are not created - verses are detected and tracked for globalReferences
 * assignment to notes, but only note cells are actually created.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating note/paragraph cell metadata
 */
export interface NoteCellMetadataParams {
    cellLabel: string;
    storyId?: string;
    paragraphId?: string;
    appliedParagraphStyle: string;
    originalText: string;
    globalReferences: string[];
    sourceFileName: string;
    originalHash: string;
    paragraphDataAfter?: string[];
    storyOrder: number;
    paragraphOrder: number;
    segmentIndex: number;
    totalSegments: number;
    isLastSegment: boolean;
    chapterNumber?: string; // Chapter number for milestone detection
}

/**
 * Creates metadata for a note/paragraph cell (non-verse content)
 * Generates a UUID for the cell ID
 */
export function createNoteCellMetadata(params: NoteCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            cellLabel: params.cellLabel, // Use sequential number as label
            storyId: params.storyId,
            paragraphId: params.paragraphId,
            appliedParagraphStyle: params.appliedParagraphStyle,
            chapterNumber: params.chapterNumber, // Chapter number for milestone detection
            data: {
                originalText: params.originalText,
                globalReferences: params.globalReferences,
                sourceFile: params.sourceFileName,
                // Minimal structure needed for export
                idmlStructure: {
                    storyId: params.storyId,
                    paragraphId: params.paragraphId,
                    paragraphStyleRange: {
                        appliedParagraphStyle: params.appliedParagraphStyle,
                        // Only keep dataAfter if present and this is the last segment
                        dataAfter: (params.isLastSegment ? params.paragraphDataAfter : undefined)
                    }
                },
                // Minimal relationships needed for export
                relationships: {
                    parentStory: params.storyId,
                    storyOrder: params.storyOrder,
                    paragraphOrder: params.paragraphOrder,
                    segmentIndex: params.segmentIndex, // Track which segment this is within the paragraph
                    totalSegments: params.totalSegments, // Track total segments for this paragraph
                },
                // Minimal context - only what's needed for identification
                documentContext: {
                    originalHash: params.originalHash,
                    importerType: 'biblica-experimental',
                    fileName: params.sourceFileName,
                }
            }
        }
    };
}
