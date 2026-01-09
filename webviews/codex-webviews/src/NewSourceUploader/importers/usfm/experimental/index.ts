/**
 * Experimental USFM Importer with round-trip export support
 * Preserves original file structure and saves to attachments/originals
 * Standalone implementation - doesn't rely on common/usfmUtils.ts
 */

import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
} from '../../../types/common';
import {
    createProgress,
    validateFileExtension,
    addMilestoneCellsToNotebookPair,
} from '../../../utils/workflowHelpers';
import { parseUsfmFile } from './usfmParser';
import { ProcessedNotebook, NotebookPair } from '../../../types/common';
import { getCorpusMarkerForBook } from '../../../utils/corpusUtils';

const SUPPORTED_EXTENSIONS = ['usfm', 'sfm', 'SFM', 'USFM'];
const SUPPORTED_MIME_TYPES = ['text/plain', 'application/octet-stream'];

/**
 * Validates a USFM file
 */
export const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .usfm, .sfm, .SFM, or .USFM extension');
    }

    // Check file size (warn if > 10MB)
    if (file.size > 10 * 1024 * 1024) {
        warnings.push('Large USFM files may take longer to process');
    }

    // Basic content validation
    try {
        const content = await file.text();
        // Basic USFM validation
        if (!content.includes('\\')) {
            errors.push('File does not appear to contain USFM markers');
        }
        if (!content.match(/\\id\s+/i)) {
            warnings.push('No \\id marker found - some USFM files may not include this');
        }
    } catch (error) {
        errors.push('Could not read file content');
    }

    return {
        isValid: errors.length === 0,
        fileType: 'usfm',
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
        },
    };
};

/**
 * Parses a USFM file into notebook cells with round-trip support
 * @param file - The USFM file to parse
 * @param onProgress - Optional progress callback
 * @param versesOnly - If true, only parse verses (skip headers, sections, etc.) - used for target imports
 */
export const parseFile = async (
    file: File,
    onProgress?: ProgressCallback,
    versesOnly: boolean = false
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading USFM file...', 10));

        // Read original file as ArrayBuffer for saving to attachments
        const arrayBuffer = await file.arrayBuffer();

        onProgress?.(createProgress('Parsing USFM', versesOnly ? 'Parsing USFM verses only...' : 'Parsing USFM content...', 30));

        // Parse USFM file with structure preservation
        // If versesOnly is true, only parse verses (for target imports)
        const parsedDocument = await parseUsfmFile(file, versesOnly);

        onProgress?.(createProgress('Creating Notebooks', 'Converting to notebook pairs...', 80));

        // Create notebook pair with proper metadata
        const baseName = file.name.replace(/\.[^/.]+$/, '');

        const sourceNotebook: ProcessedNotebook = {
            name: baseName,
            cells: parsedDocument.cells,
            metadata: {
                id: `usfm-experimental-source-${Date.now()}`,
                originalFileName: file.name,
                sourceFile: file.name,
                // Store original file data as ArrayBuffer for saving to attachments/originals
                originalFileData: arrayBuffer,
                importerType: 'usfm-experimental',
                fileType: 'usfm',
                corpusMarker: getCorpusMarkerForBook(baseName) || 'usfm',
                createdAt: new Date().toISOString(),
                importContext: {
                    importerType: 'usfm-experimental',
                    fileName: file.name,
                    originalFileName: file.name,
                    fileSize: file.size,
                    importTimestamp: new Date().toISOString(),
                },
                bookCode: parsedDocument.bookCode,
                bookName: parsedDocument.bookName,
                totalVerses: parsedDocument.verseCount,
                totalParatext: parsedDocument.paratextCount,
                chapters: parsedDocument.chapters,
                footnoteCount: parsedDocument.footnoteCount,
                // Store structure metadata for export
                structureMetadata: {
                    originalUsfmContent: parsedDocument.originalUsfmContent,
                    lineMappings: parsedDocument.lineMappings, // Store line mappings for round-trip
                },
            },
        };

        // Create codex notebook (empty cells for translation)
        const codexCells = parsedDocument.cells.map(sourceCell => {
            const isStyleCell = sourceCell.metadata?.type === 'style';
            return {
                id: sourceCell.id,
                content: isStyleCell ? sourceCell.content : '', // Keep style cells, empty others
                images: sourceCell.images,
                metadata: sourceCell.metadata,
            };
        });

        const codexNotebook: ProcessedNotebook = {
            name: baseName,
            cells: codexCells,
            metadata: {
                ...sourceNotebook.metadata,
                id: `usfm-experimental-codex-${Date.now()}`,
                // Don't duplicate original file data in codex metadata
                originalFileData: undefined,
            },
        };

        const notebookPair: NotebookPair = {
            source: sourceNotebook,
            codex: codexNotebook,
        };

        // Add milestone cells to notebook pair
        const notebookPairWithMilestones = addMilestoneCellsToNotebookPair(notebookPair);

        onProgress?.(createProgress('Complete', 'USFM processing complete', 100));

        return {
            success: true,
            notebookPair: notebookPairWithMilestones,
            metadata: {
                bookCode: parsedDocument.bookCode,
                bookName: parsedDocument.bookName,
                segmentCount: parsedDocument.cells.length,
                verseCount: parsedDocument.verseCount,
                paratextCount: parsedDocument.paratextCount,
                chapters: parsedDocument.chapters,
                footnoteCount: parsedDocument.footnoteCount,
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'USFM processing failed'));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

export const usfmExperimentalImporter: ImporterPlugin = {
    name: 'USFM Importer (Experimental)',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: SUPPORTED_MIME_TYPES,
    description: 'Import Unified Standard Format Marker (USFM) biblical text files with round-trip export support. Headers are included in chapter 1.',
    validateFile,
    parseFile,
    exportFile: async (originalUsfmContent: string, codexCells: Array<{ kind: number; value: string; metadata: any; }>, metadata?: any) => {
        const { exportUsfmRoundtrip } = await import('./usfmExporter');
        const structureMetadata = metadata?.structureMetadata;
        const lineMappings = structureMetadata?.lineMappings;
        if (lineMappings) {
            return exportUsfmRoundtrip(originalUsfmContent, lineMappings, codexCells);
        } else {
            // Fallback for old imports without lineMappings
            return exportUsfmRoundtrip(originalUsfmContent, codexCells);
        }
    },
};

