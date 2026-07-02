/**
 * Cell Metadata Builder for DOCX Experimental Importer
 * 
 * This file centralizes all cell metadata structure creation for DOCX imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import type { DocxParagraph, DocxDocument } from './docxTypes';
import { v4 as uuidv4 } from 'uuid';

/**
 * Parameters for creating DOCX cell metadata
 */
export interface DocxCellMetadataParams {
    paragraphId: string;
    paragraphIndex: number;
    originalContent: string;
    paragraph: DocxParagraph;
    docxDoc: DocxDocument;
    fileName: string;
    /**
     * When a paragraph is split into multiple cells, this is the 0-based index
     * of this cell within that paragraph.  Undefined for unsplit paragraphs.
     */
    segmentIndex?: number;
    /**
     * Total number of cells this paragraph was split into.
     * Undefined for unsplit paragraphs.
     */
    segmentCount?: number;
}

/**
 * Creates metadata for a DOCX paragraph cell
 * Generates a UUID for the cell ID
 */
export function createDocxCellMetadata(params: DocxCellMetadataParams): { metadata: any; cellId: string; } {
    const { paragraphId, paragraphIndex, originalContent, segmentIndex, segmentCount } = params;

    // Generate UUID for cell ID
    const cellId = uuidv4();

    /**
     * IMPORTANT: Keep DOCX cell metadata minimal.
     *
     * Round-trip export uses the original DOCX template stored under:
     *   `.project/attachments/originals/<originalFileName>`
     *
     * To keep `.source`/`.codex` small, we only persist what we need to map a Codex cell
     * back to a paragraph in `word/document.xml`.
     *
     * For split paragraphs, segmentIndex/segmentCount allow the exporter to
     * recombine the translated segments in order before writing them back to
     * the original <w:p>.
     */
    const cellMetadata = {
        id: cellId,
        type: CodexCellTypes.TEXT,
        edits: [],
        paragraphId,
        paragraphIndex,

        // Present only when the paragraph was split into multiple cells
        ...(segmentIndex !== undefined && { segmentIndex }),
        ...(segmentCount !== undefined && { segmentCount }),

        // Data object for consistency with other importers
        data: {
            originalText: originalContent,
            globalReferences: [], // Empty for DOCX files (no verse references)
        },

        cellLabel: undefined,
    };

    return {
        cellId,
        metadata: cellMetadata
    };
}

export interface DocxTableCellMetadataParams {
    /** Paragraph indices inside this table cell (global within <w:body>). */
    paragraphIndices: number[];
    /** Concatenated text content of the table cell. */
    originalContent: string;
}

/**
 * Creates metadata for a DOCX table cell.
 *
 * IMPORTANT: For round-trip export we only need to map back to document.xml paragraph indices.
 * For table cells, that can be multiple paragraphs; we store the list as `paragraphIndices`.
 */
export function createDocxTableCellMetadata(
    params: DocxTableCellMetadataParams
): { metadata: any; cellId: string } {
    const { paragraphIndices, originalContent } = params;

    const cellId = uuidv4();
    const firstParagraphIndex = paragraphIndices[0] ?? -1;

    const cellMetadata = {
        id: cellId,
        type: CodexCellTypes.TEXT,
        edits: [],

        // Keep `paragraphIndex` for backward compatibility and simple exporters,
        // but prefer `paragraphIndices` when present.
        paragraphIndex: firstParagraphIndex,
        paragraphIndices,

        data: {
            originalText: originalContent,
            globalReferences: [],
        },

        cellLabel: undefined,
    };

    return { cellId, metadata: cellMetadata };
}
