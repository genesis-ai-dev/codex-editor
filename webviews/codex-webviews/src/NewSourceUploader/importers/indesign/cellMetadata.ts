/**
 * Cell Metadata Builder for InDesign Importer
 * 
 * This file centralizes all cell metadata structure creation for InDesign IDML imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';
import { IDMLParagraph, IDMLStory } from './types';

/**
 * Parameters for creating InDesign verse cell metadata
 */
export interface IndesignVerseCellMetadataParams {
    bookCode: string;
    chapter: string;
    verseNumber: string;
    originalContent: string;
    storyId: string;
    paragraphId: string;
    appliedParagraphStyle: string;
    paragraph: IDMLParagraph;
    fileName: string;
    originalHash: string;
}

/**
 * Parameters for creating InDesign regular paragraph cell metadata
 */
export interface IndesignParagraphCellMetadataParams {
    cellLabel: string;
    originalContent: string;
    storyId: string;
    paragraphId: string;
    appliedParagraphStyle: string;
    paragraph: IDMLParagraph;
    stories: IDMLStory[];
    paragraphIndex: number;
    fileName: string;
    originalHash: string;
}

/**
 * Creates metadata for an InDesign verse cell
 * Generates a UUID for the cell ID
 */
export function createIndesignVerseCellMetadata(params: IndesignVerseCellMetadataParams): { metadata: any; cellId: string; } {
    const { bookCode, chapter, verseNumber, originalContent, storyId, paragraphId, appliedParagraphStyle, paragraph, fileName, originalHash } = params;

    // Generate UUID for cell ID
    const cellId = uuidv4();
    const verseId = `${bookCode} ${chapter}:${verseNumber}`;

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            cellLabel: verseNumber,
            isBibleVerse: true,
            verseId,
            storyId,
            paragraphId,
            appliedParagraphStyle,
            chapterNumber: chapter, // Chapter number for milestone detection
            data: {
                originalContent,
                verseNumber,
                sourceFile: fileName,
                globalReferences: [], // Empty for now (can be populated later if verse references are detected)
                // Minimal structure needed for export
                idmlStructure: {
                    storyId,
                    paragraphId,
                    paragraphStyleRange: {
                        appliedParagraphStyle,
                        // Only keep dataAfter if present (for paragraph breaks)
                        ...((paragraph.paragraphStyleRange as any).dataAfter ? { dataAfter: (paragraph.paragraphStyleRange as any).dataAfter } : {}),
                    },
                    characterStyleRanges: paragraph.characterStyleRanges,
                },
                // Minimal relationships needed for export
                relationships: {
                    parentStory: storyId,
                    paragraphOrder: 0, // Will be set by importer if needed
                },
                // Minimal context - only what's needed for identification
                documentContext: {
                    originalHash,
                    importerType: 'indesign',
                    fileName,
                }
            }
        }
    };
}

/**
 * Creates metadata for an InDesign regular paragraph cell
 * Generates a UUID for the cell ID
 */
export function createIndesignParagraphCellMetadata(params: IndesignParagraphCellMetadataParams): { metadata: any; cellId: string; } {
    const { cellLabel, originalContent, storyId, paragraphId, appliedParagraphStyle, paragraph, stories, paragraphIndex, fileName, originalHash } = params;

    // Generate UUID for cell ID
    const cellId = uuidv4();

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            cellLabel,
            storyId,
            paragraphId,
            appliedParagraphStyle,
            data: {
                originalContent,
                sourceFile: fileName,
                globalReferences: [], // Empty for InDesign files (no verse references)
                // Minimal structure needed for export
                idmlStructure: {
                    storyId,
                    paragraphId,
                    paragraphStyleRange: {
                        appliedParagraphStyle,
                        // Only keep dataAfter if present (for paragraph breaks)
                        ...((paragraph.paragraphStyleRange as any).dataAfter ? { dataAfter: (paragraph.paragraphStyleRange as any).dataAfter } : {}),
                    },
                    characterStyleRanges: paragraph.characterStyleRanges,
                },
                // Minimal relationships needed for export
                relationships: {
                    parentStory: storyId,
                    storyOrder: stories.findIndex(s => s.id === storyId),
                    paragraphOrder: paragraphIndex,
                },
                // Minimal context - only what's needed for identification
                documentContext: {
                    originalHash,
                    importerType: 'indesign',
                    fileName,
                }
            }
        }
    };
}
