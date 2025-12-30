/**
 * DOCX Importer with Round-Trip Export Support
 * Experimental version that preserves complete OOXML structure for export
 */

import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProcessedImage,
    ProgressCallback,
    // } from '../../types/common';
} from '../../../types/common';
import {
    createProgress,
    createStandardCellId,
    createProcessedCell,
    validateFileExtension,
    addMilestoneCellsToNotebookPair,
    // } from '../../utils/workflowHelpers';
} from '../../../utils/workflowHelpers';
import { DocxParser } from './docxParser';
import { DocxDocument, DocxParagraph } from './docxTypes';
import { createDocxCellMetadata } from './cellMetadata';

const SUPPORTED_EXTENSIONS = ['docx'];

/**
 * Validates a DOCX file
 */
export const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .docx extension');
    }

    // Check file size (warn if > 50MB)
    if (file.size > 50 * 1024 * 1024) {
        warnings.push('Large files may take longer to process');
    }

    // Check if file is actually a DOCX by reading the magic bytes
    try {
        const buffer = await file.slice(0, 4).arrayBuffer();
        const uint8Array = new Uint8Array(buffer);

        // DOCX files are ZIP files, check for ZIP signature
        const isZip = uint8Array[0] === 0x50 && uint8Array[1] === 0x4B &&
            (uint8Array[2] === 0x03 || uint8Array[2] === 0x05);

        if (!isZip) {
            errors.push('File does not appear to be a valid DOCX document');
        }
    } catch (error) {
        warnings.push('Could not verify file format');
    }

    return {
        isValid: errors.length === 0,
        fileType: 'docx',
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
        },
    };
};

/**
 * Parses a DOCX file with complete OOXML structure preservation for round-trip export
 */
export const parseFile = async (
    file: File,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading DOCX file...', 10));

        // Create parser instance
        const parser = new DocxParser({
            preserveAllFormatting: true,
            extractImages: true,
            extractFootnotes: true,
            segmentationStrategy: 'paragraph',
            validateStructure: true,
        });

        // Set up debug logging - pass through to progress callback
        parser.setDebugCallback((msg: string) => {
            console.log(`[DOCX Round-Trip Parser] ${msg}`);
            // Don't set progress % for debug messages, just send the message
            onProgress?.(createProgress('Parsing', msg, undefined));
        });

        onProgress?.(createProgress('Parsing OOXML', 'Extracting document structure from DOCX...', 30));

        // Parse the DOCX document
        const docxDoc: DocxDocument = await parser.parseDocx(file);

        onProgress?.(createProgress('Creating Cells', 'Converting paragraphs to cells...', 60));

        // Convert paragraphs to cells
        const cells = createCellsFromParagraphs(docxDoc, file.name);

        onProgress?.(createProgress('Creating Notebooks', 'Creating source and codex notebooks...', 80));

        // Read original file data for storage
        const arrayBuffer = await file.arrayBuffer();

        // Create notebook pair
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const sourceNotebook = {
            name: baseName,
            cells,
            metadata: {
                id: `source-${Date.now()}`,
                originalFileName: file.name,
                originalFileData: arrayBuffer, // Store original file for export
                corpusMarker: 'Docx',
                importerType: 'docx-roundtrip',
                createdAt: new Date().toISOString(),
                wordCount: countWordsInDocument(docxDoc),
                paragraphCount: docxDoc.paragraphs.length,
                // Store complete DOCX document structure for round-trip
                docxDocument: JSON.stringify(docxDoc),
                originalHash: docxDoc.originalHash,
            },
        };

        const codexCells = cells.map(sourceCell => ({
            id: sourceCell.id,
            content: '', // Empty for translation
            images: sourceCell.images || [],
            metadata: {
                ...sourceCell.metadata,
            },
        }));

        const codexNotebook = {
            name: baseName,
            cells: codexCells,
            metadata: {
                ...sourceNotebook.metadata,
                id: `codex-${Date.now()}`,
                importerType: 'docx-roundtrip', // Explicitly set again
                docxDocument: JSON.stringify(docxDoc), // Explicitly include docxDocument
                // Don't duplicate the original file data in codex
                originalFileData: undefined,
            },
        };

        const notebookPair = {
            source: sourceNotebook,
            codex: codexNotebook,
        };

        // Add milestone cells to the notebook pair
        const notebookPairWithMilestones = addMilestoneCellsToNotebookPair(notebookPair);

        // Log structure preservation info
        console.log(`[DOCX Round-Trip Importer] Created notebook pair for "${baseName}"`);
        console.log(`[DOCX Round-Trip Importer] - ${cells.length} cells processed`);
        console.log(`[DOCX Round-Trip Importer] - ${docxDoc.paragraphs.length} paragraphs preserved`);
        console.log(`[DOCX Round-Trip Importer] - Original hash: ${docxDoc.originalHash}`);
        console.log(`[DOCX Round-Trip Importer] - ImporterType: ${codexNotebook.metadata.importerType}`);
        console.log(`[DOCX Round-Trip Importer] - DocxDocument present: ${codexNotebook.metadata.docxDocument ? 'YES' : 'NO'}`);
        console.log(`[DOCX Round-Trip Importer] - DocxDocument size: ${codexNotebook.metadata.docxDocument?.length || 0} chars`);
        console.log(`[DOCX Round-Trip Importer] - Original file data: ${sourceNotebook.metadata.originalFileData ? 'preserved' : 'missing'}`);

        onProgress?.(createProgress('Complete', 'DOCX processing complete', 100));

        return {
            success: true,
            notebookPair: notebookPairWithMilestones,
            metadata: {
                wordCount: countWordsInDocument(docxDoc),
                segmentCount: cells.length,
                paragraphCount: docxDoc.paragraphs.length,
                imageCount: docxDoc.resources.images.length,
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Failed to process DOCX file', 0));
        console.error('[DOCX Round-Trip Importer] Error:', error);

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

/**
 * Convert DOCX paragraphs to Codex cells with complete metadata for round-trip
 */
const createCellsFromParagraphs = (docxDoc: DocxDocument, fileName: string): any[] => {
    const cells: any[] = [];

    for (const paragraph of docxDoc.paragraphs) {
        // Skip empty paragraphs
        const fullText = paragraph.runs.map(r => r.content).join('');
        if (!fullText.trim()) {
            continue;
        }

        // Convert runs to HTML for display
        const htmlContent = convertParagraphToHtml(paragraph);

        // Create cell metadata with complete structure for round-trip (generates UUID internally)
        const { cellId, metadata: cellMetadata } = createDocxCellMetadata({
            paragraphId: paragraph.id,
            paragraphIndex: paragraph.paragraphIndex,
            originalContent: fullText,
            paragraph,
            docxDoc,
            fileName,
        });

        // Create the cell
        const cell = createProcessedCell(cellId, htmlContent, {
            ...cellMetadata,
            type: 'text',
        });

        cells.push(cell);
    }

    console.log(`[createCellsFromParagraphs] Created ${cells.length} cells from ${docxDoc.paragraphs.length} paragraphs`);

    return cells;
};

/**
 * Convert a DOCX paragraph to HTML for display in Codex
 */
const convertParagraphToHtml = (paragraph: DocxParagraph): string => {
    let html = '<p';

    // Add data attributes for paragraph properties
    if (paragraph.paragraphProperties.styleId) {
        html += ` data-style-id="${escapeHtml(paragraph.paragraphProperties.styleId)}"`;
    }
    if (paragraph.paragraphProperties.alignment) {
        html += ` data-alignment="${paragraph.paragraphProperties.alignment}"`;
    }

    // Add inline styles
    const styles: string[] = [];
    if (paragraph.paragraphProperties.alignment) {
        styles.push(`text-align: ${paragraph.paragraphProperties.alignment}`);
    }
    if (paragraph.paragraphProperties.indentation) {
        const ind = paragraph.paragraphProperties.indentation;
        if (ind.left) styles.push(`margin-left: ${ind.left / 20}pt`);
        if (ind.right) styles.push(`margin-right: ${ind.right / 20}pt`);
        if (ind.firstLine) styles.push(`text-indent: ${ind.firstLine / 20}pt`);
    }
    if (paragraph.paragraphProperties.spacing) {
        const spc = paragraph.paragraphProperties.spacing;
        if (spc.before) styles.push(`margin-top: ${spc.before / 20}pt`);
        if (spc.after) styles.push(`margin-bottom: ${spc.after / 20}pt`);
        if (spc.line) styles.push(`line-height: ${spc.line / 240}`);
    }

    if (styles.length > 0) {
        html += ` style="${styles.join('; ')}"`;
    }

    html += '>';

    // Add runs
    for (const run of paragraph.runs) {
        html += convertRunToHtml(run);
    }

    html += '</p>';

    return html;
};

/**
 * Convert a DOCX run to HTML
 */
const convertRunToHtml = (run: DocxRun): string => {
    let html = '';
    let content = escapeHtml(run.content);

    // Apply formatting
    if (run.runProperties.bold) {
        content = `<strong>${content}</strong>`;
    }
    if (run.runProperties.italic) {
        content = `<em>${content}</em>`;
    }
    if (run.runProperties.underline) {
        content = `<u>${content}</u>`;
    }
    if (run.runProperties.strike) {
        content = `<s>${content}</s>`;
    }
    if (run.runProperties.superscript) {
        content = `<sup>${content}</sup>`;
    }
    if (run.runProperties.subscript) {
        content = `<sub>${content}</sub>`;
    }

    // Wrap in span with inline styles if needed
    const styles: string[] = [];
    if (run.runProperties.fontSize) {
        styles.push(`font-size: ${run.runProperties.fontSize / 2}pt`);
    }
    if (run.runProperties.fontFamily) {
        styles.push(`font-family: ${run.runProperties.fontFamily}`);
    }
    if (run.runProperties.color) {
        styles.push(`color: #${run.runProperties.color}`);
    }
    if (run.runProperties.highlight) {
        styles.push(`background-color: ${run.runProperties.highlight}`);
    }

    if (styles.length > 0) {
        html = `<span style="${styles.join('; ')}">${content}</span>`;
    } else {
        html = content;
    }

    return html;
};

/**
 * Escape HTML special characters
 */
const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

/**
 * Count words in DOCX document
 */
const countWordsInDocument = (docxDoc: DocxDocument): number => {
    let wordCount = 0;

    for (const paragraph of docxDoc.paragraphs) {
        for (const run of paragraph.runs) {
            const words = run.content
                .trim()
                .split(/\s+/)
                .filter(word => word.length > 0);
            wordCount += words.length;
        }
    }

    return wordCount;
};

/**
 * DOCX Round-Trip Importer Plugin
 * Experimental version with complete OOXML structure preservation
 */
export const docxImporter: ImporterPlugin = {
    name: 'DOCX Round-Trip Importer (Experimental)',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    description: 'Imports Microsoft Word DOCX files with complete structure preservation for round-trip export',
    validateFile,
    parseFile,
}; 