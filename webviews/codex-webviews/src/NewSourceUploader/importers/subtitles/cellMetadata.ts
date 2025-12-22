/**
 * Cell Metadata Builder for Subtitles Importer
 * 
 * This file centralizes all cell metadata structure creation for subtitle imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating subtitle cell metadata
 */
export interface SubtitleCellMetadataParams {
    text: string; // Subtitle text content
    startTime: number | string; // Start time in seconds (number) or timestamp string
    endTime: number | string; // End time in seconds (number) or timestamp string
    format: string; // Subtitle format (e.g., "VTT", "SRT")
    fileName?: string; // Optional file name
    cellLabel?: string; // Optional cell label
    segmentIndex?: number; // Optional segment index for milestone detection
}

/**
 * Converts time to seconds if it's a string
 */
function convertToSeconds(time: number | string): number {
    if (typeof time === 'number') {
        return time;
    }
    // Handle timestamp strings like "00:01:23.456" or "01:23.456"
    const parts = time.split(':');
    if (parts.length === 3) {
        // HH:MM:SS.mmm format
        const [hours, minutes, seconds] = parts.map(Number);
        return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
        // MM:SS.mmm format
        const [minutes, seconds] = parts.map(Number);
        return minutes * 60 + seconds;
    }
    return 0;
}

/**
 * Determines chapter number based on segment index or time
 * Groups segments into chapters for milestone detection
 */
function getChapterNumber(segmentIndex: number | undefined, startTime: number | string): string {
    if (segmentIndex !== undefined) {
        // Group every 50 segments into a chapter
        return String(Math.floor(segmentIndex / 50) + 1);
    }
    // Group by time: every 5 minutes (300 seconds) is a chapter
    const timeInSeconds = convertToSeconds(startTime);
    return String(Math.floor(timeInSeconds / 300) + 1);
}

/**
 * Creates metadata for a subtitle cell
 * Generates a UUID for the cell ID
 */
export function createSubtitleCellMetadata(params: SubtitleCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    // Determine chapter number for milestone detection
    const chapterNumber = getChapterNumber(params.segmentIndex, params.startTime);

    // Determine cell label
    const cellLabel = params.cellLabel || `cue-${params.startTime}-${params.endTime}`;

    // Convert times to numbers for consistent storage
    const startTimeSeconds = convertToSeconds(params.startTime);
    const endTimeSeconds = convertToSeconds(params.endTime);

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            chapterNumber: chapterNumber, // Chapter number for milestone detection
            cellLabel: cellLabel,
            originalText: params.text,
            data: {
                startTime: startTimeSeconds,
                endTime: endTimeSeconds,
                format: params.format,
                originalText: params.text,
                globalReferences: [], // Empty for subtitle files (no verse references)
                sourceFile: params.fileName || '',
            },
            documentContext: {
                importerType: 'subtitles',
                fileName: params.fileName || '',
            }
        }
    };
}
