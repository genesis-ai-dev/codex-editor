/**
 * Cell Metadata Builder for DOCX Experimental Importer
 * 
 * This file centralizes all cell metadata structure creation for DOCX imports.
 * Makes it easy to find and modify metadata fields in one place.
 */

import { CodexCellTypes } from 'types/enums';
import { DocxParagraph, DocxDocument } from './docxTypes';
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
}

/**
 * Creates metadata for a DOCX paragraph cell
 * Generates a UUID for the cell ID
 */
export function createDocxCellMetadata(params: DocxCellMetadataParams): { metadata: any; cellId: string; } {
    const { paragraphId, paragraphIndex, originalContent, paragraph, docxDoc, fileName } = params;

    // Generate UUID for cell ID
    const cellId = uuidv4();

    // Create base cell metadata with complete structure for round-trip
    const cellMetadata: any = {
        id: cellId,
        type: CodexCellTypes.TEXT,
        edits: [],
        cellId,
        paragraphId,
        paragraphIndex,
        originalContent,

        // Data object for consistency with other importers
        data: {
            originalText: originalContent,
            globalReferences: [], // Empty for DOCX files (no verse references)
        },

        // Complete structure preservation
        docxStructure: {
            paragraphProperties: paragraph.paragraphProperties,
            beforeParagraphXml: paragraph.beforeParagraphXml,
            afterParagraphXml: paragraph.afterParagraphXml,
        },

        // Document context for export
        documentContext: {
            documentId: docxDoc.id,
            originalHash: docxDoc.originalHash,
            fileName: fileName,
            importerType: 'docx-roundtrip',
            importTimestamp: new Date().toISOString(),
        },

        // Cell label (paragraph number)
        cellLabel: `¶${paragraphIndex + 1}`,
    };

    // Store complete run information in metadata for reconstruction
    cellMetadata.runs = paragraph.runs.map(run => ({
        id: run.id,
        runIndex: run.runIndex,
        content: run.content,
        runProperties: run.runProperties,
        beforeRunXml: run.beforeRunXml,
        afterRunXml: run.afterRunXml,
        originalXml: run.metadata?.originalXml,
    }));

    // Store complete paragraph XML for perfect reconstruction
    cellMetadata.originalParagraphXml = paragraph.metadata?.originalXml;

    return {
        cellId,
        metadata: cellMetadata
    };
}
