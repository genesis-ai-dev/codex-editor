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
import { IDMLParagraph, IDMLStory } from './types';
import {
    extractContentSegmentStructureFromParagraph,
    joinContentSegments,
} from '../common/contentSegmentUtils';

/**
 * Parameters for creating note/paragraph cell metadata
 */
export interface NoteCellMetadataParams {
    cellLabel?: string;
    storyId?: string;
    paragraphId?: string;
    appliedParagraphStyle: string;
    paragraph: IDMLParagraph;
    globalReferences: string[];
    sourceFileName: string;
    originalHash: string;
    stories: IDMLStory[];
    paragraphOrder: number;
    chapterNumber?: string;
    /** When a paragraph is split at line breaks, which slice this cell represents. */
    segmentIndex?: number;
    totalSegments?: number;
    isLastSegment?: boolean;
    /** Plain text for this cell slice (joined segment group). */
    cellOriginalContent?: string;
    /** Indexes of structural apostrophe <Content> slots (omitted from editor HTML). */
    structuralApostropheSegmentIndexes?: number[];
}

/**
 * Creates metadata for a note/paragraph cell (non-verse content)
 * Generates a UUID for the cell ID
 */
export function createNoteCellMetadata(params: NoteCellMetadataParams): { metadata: any; cellId: string; } {
    const cellId = uuidv4();
    const contentSegments = extractContentSegmentStructureFromParagraph(params.paragraph).segments;
    const { breakBefore: contentSegmentBreakBefore } =
        extractContentSegmentStructureFromParagraph(params.paragraph);
    const storyId = params.storyId ?? "";
    const cellOriginalContent =
        params.cellOriginalContent ?? joinContentSegments(contentSegments);

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            cellLabel: params.cellLabel,
            storyId: params.storyId,
            paragraphId: params.paragraphId,
            appliedParagraphStyle: params.appliedParagraphStyle,
            chapterNumber: params.chapterNumber,
            data: {
                originalContent: cellOriginalContent,
                originalText: cellOriginalContent,
                globalReferences: params.globalReferences,
                idmlStructure: {
                    storyId: params.storyId,
                    paragraphId: params.paragraphId,
                    contentSegments,
                    contentSegmentCount: contentSegments.length,
                    contentSegmentBreakBefore,
                    ...(params.structuralApostropheSegmentIndexes?.length
                        ? {
                              structuralApostropheSegmentIndexes:
                                  params.structuralApostropheSegmentIndexes,
                          }
                        : {}),
                    paragraphStyleRange: {
                        appliedParagraphStyle: params.appliedParagraphStyle,
                        ...((params.isLastSegment !== false &&
                            (params.paragraph.paragraphStyleRange as { dataAfter?: string[] }).dataAfter)
                            ? { dataAfter: (params.paragraph.paragraphStyleRange as { dataAfter?: string[] }).dataAfter }
                            : {}),
                    },
                    characterStyleRanges: params.paragraph.characterStyleRanges,
                },
                relationships: {
                    parentStory: params.storyId,
                    storyOrder: params.stories.findIndex((s) => s.id === storyId),
                    paragraphOrder: params.paragraphOrder,
                    ...(typeof params.segmentIndex === "number"
                        ? { segmentIndex: params.segmentIndex }
                        : {}),
                    ...(typeof params.totalSegments === "number"
                        ? { totalSegments: params.totalSegments }
                        : {}),
                },
            },
        },
    };
}
