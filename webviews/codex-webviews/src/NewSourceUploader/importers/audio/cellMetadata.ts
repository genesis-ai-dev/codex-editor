/**
 * Cell Metadata Builder for Audio Importer
 * 
 * This file centralizes all cell metadata structure creation for audio imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating audio cell metadata
 */
export interface AudioCellMetadataParams {
    startTime: number; // Start time in seconds
    endTime: number; // End time in seconds
    segmentIndex: number; // Segment index for milestone detection
    attachmentId: string; // Attachment ID for the audio file
    fileName: string; // Audio file name
    url: string; // URL path to the audio file
    documentId: string; // Document ID
    cellLabel?: string; // Optional cell label
}

/**
 * Determines chapter number based on segment index or time
 * Groups segments into chapters for milestone detection
 */
function getChapterNumber(segmentIndex: number, startTime: number): string {
    // Group every 50 segments into a chapter, or every 5 minutes (300 seconds)
    const segmentBasedChapter = Math.floor(segmentIndex / 50) + 1;
    const timeBasedChapter = Math.floor(startTime / 300) + 1;
    // Use the larger of the two to ensure milestones are frequent enough
    return String(Math.max(segmentBasedChapter, timeBasedChapter));
}

/**
 * Creates metadata for an audio cell
 * Generates a UUID for the cell ID
 */
export function createAudioCellMetadata(params: AudioCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    // Determine chapter number for milestone detection
    const chapterNumber = getChapterNumber(params.segmentIndex, params.startTime);

    // Determine cell label
    const cellLabel = params.cellLabel || `${params.segmentIndex + 1}`;

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            chapterNumber: chapterNumber, // Chapter number for milestone detection
            cellLabel: cellLabel,
            data: {
                startTime: params.startTime,
                endTime: params.endTime,
                globalReferences: [], // Empty for audio files (no verse references)
                sourceFile: params.fileName,
            },
            attachments: {
                [params.attachmentId]: {
                    url: params.url,
                    type: "audio",
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    isDeleted: false,
                },
            },
            selectedAudioId: params.attachmentId,
            selectionTimestamp: Date.now(),
            documentContext: {
                importerType: 'audio',
                fileName: params.fileName,
            }
        }
    };
}
