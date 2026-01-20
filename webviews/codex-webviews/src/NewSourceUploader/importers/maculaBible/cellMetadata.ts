/**
 * Cell Metadata Builder for Macula Bible Importer
 * 
 * This file centralizes all cell metadata structure creation for Macula Bible imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating verse cell metadata
 */
export interface MaculaVerseCellMetadataParams {
    vref: string; // Verse reference in format "GEN 1:1"
    text: string; // Verse text content
    fileName?: string; // Optional file name
}

/**
 * Parses a verse reference (vref) into its components
 * Format: "GEN 1:1" -> { bookCode: "GEN", chapter: 1, verse: 1 }
 */
function parseVref(vref: string): { bookCode: string; chapter: number; verse: number | string; } | null {
    // Format: "GEN 1:1" or "GEN 1:1a" (with verse suffix)
    const match = vref.match(/^([A-Z0-9]+)\s+(\d+):(\d+[a-z]*)$/);
    if (match) {
        return {
            bookCode: match[1],
            chapter: parseInt(match[2], 10),
            verse: match[3], // Keep as string to preserve suffixes like "1a"
        };
    }
    return null;
}

/**
 * Creates metadata for a verse cell
 * Generates a UUID for the cell ID
 */
export function createMaculaVerseCellMetadata(params: MaculaVerseCellMetadataParams): { metadata: any; cellId: string; } {
    // Generate UUID for cell ID
    const cellId = uuidv4();

    // Parse vref to extract book, chapter, verse
    const vrefParts = parseVref(params.vref);

    if (!vrefParts) {
        // Fallback if vref parsing fails
        return {
            cellId,
            metadata: {
                id: cellId,
                type: CodexCellTypes.TEXT,
                edits: [],
                vref: params.vref,
                originalText: params.text,
                cellLabel: params.vref.split(":")?.[1] || "1",
                fileName: params.fileName,
                chapterNumber: "0", // Default to 0 if parsing fails
                data: {
                    originalText: params.text,
                    globalReferences: [], // Empty if parsing fails
                },
            }
        };
    }

    const { bookCode, chapter, verse } = vrefParts;

    // Create global reference in format "GEN 1:1"
    // Remove verse suffix if present (e.g., "1a" -> "1") for global reference
    const verseForRef = typeof verse === 'string' ? verse.replace(/[a-z]+$/, '') : verse;
    const globalReferences = [`${bookCode} ${chapter}:${verseForRef}`];

    // Extract cell label (verse number with optional suffix)
    const cellLabel = typeof verse === 'string' ? verse : String(verse);

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            vref: params.vref,
            bookCode,
            chapter,
            verse,
            cellLabel,
            originalText: params.text,
            fileName: params.fileName,
            chapterNumber: String(chapter), // Chapter number for milestone detection
            data: {
                originalText: params.text,
                globalReferences: globalReferences,
            },
        }
    };
}
