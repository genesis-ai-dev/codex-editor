/**
 * Cell Metadata Builder for PDF Importer
 * 
 * This file centralizes all cell metadata structure creation for PDF imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating PDF cell metadata
 */
export interface PdfCellMetadataParams {
    originalContent: string;
    cellLabel: string;
    segmentIndex: number;
    fileName: string;
    fileSize: number;
}

/**
 * Creates metadata for a PDF segment cell
 * Generates a UUID for the cell ID
 */
export function createPdfCellMetadata(params: PdfCellMetadataParams): { metadata: any; cellId: string; } {
    const { originalContent, cellLabel, segmentIndex, fileName, fileSize } = params;

    // Generate UUID for cell ID
    const cellId = uuidv4();

    // Clean the text while preserving sentence structure
    const cleanText = originalContent
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        cellId,
        metadata: {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
            originalText: cleanText,
            cellLabel,
            data: {
                // Core identification
                segmentType: 'sentence',
                sentenceIndex: segmentIndex,
                originalContent: cleanText,
                globalReferences: [], // Empty for PDF files (no verse references)

                // Round-trip export metadata
                pdfMetadata: {
                    segmentType: 'sentence',
                    originalLength: cleanText.length,
                    characterCount: cleanText.length,
                    wordCount: cleanText.split(/\s+/).length,

                    // Position tracking for future reconstruction
                    globalPosition: segmentIndex,

                    // Placeholder for future enhancements
                    // These can be populated when pdf-parse provides more data
                    pageNumber: undefined, // Will be populated when available
                    boundingBox: undefined, // For precise positioning
                    fontSize: undefined, // Font size if available
                    fontFamily: undefined, // Font family if available
                    textAlign: undefined, // Alignment if available
                },

                // Import metadata
                importTimestamp: new Date().toISOString(),
                corpusMarker: 'pdf',
                importerVersion: '1.0.0',
            },
        }
    };
}
