import { v4 as uuidv4 } from 'uuid';
import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
} from '../../types/common';
import {
    createProgress,
    createStandardCellId,
    createProcessedCell,
    validateFileExtension,
    splitContentIntoSegments,
    addMilestoneCellsToNotebookPair,
} from '../../utils/workflowHelpers';

const SUPPORTED_EXTENSIONS = ['txt'];

type SplitStrategy = 'paragraphs' | 'lines' | 'sections';

/**
 * Validates a plaintext file
 */
export const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .txt extension');
    }

    // Check file size (warn if > 5MB)
    if (file.size > 5 * 1024 * 1024) {
        warnings.push('Large text files may take longer to process');
    }

    // Basic content validation
    try {
        const content = await file.text();

        if (content.trim().length === 0) {
            errors.push('File appears to be empty');
        }

        // Check for binary content (non-text files) by looking for null bytes
        const hasNullBytes = content.includes('\x00');
        if (hasNullBytes) {
            errors.push('File appears to contain binary data, not plain text');
        }

        // Provide helpful suggestions based on content
        if (content.includes('\\v ') || content.includes('\\c ')) {
            warnings.push('File appears to contain USFM markers - consider using the USFM importer instead');
        }

        if (content.includes('WEBVTT') || /^\d{2}:\d{2}:\d{2}/.test(content)) {
            warnings.push('File appears to contain subtitle/VTT format - consider using the subtitles importer instead');
        }

    } catch (error) {
        errors.push('Could not read file content');
    }

    return {
        isValid: errors.length === 0,
        fileType: 'plaintext',
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
        },
    };
};

/**
 * Determines the best split strategy based on content analysis
 */
const determineSplitStrategy = (content: string): SplitStrategy => {
    // Count different types of breaks
    const doubleLineBreaks = (content.match(/\n\s*\n/g) || []).length;
    const singleLineBreaks = (content.match(/\n/g) || []).length - doubleLineBreaks * 2;
    const headings = (content.match(/^#{1,6}\s/gm) || []).length;

    // If we have many headings, split by sections
    if (headings > 2) {
        return 'sections';
    }

    // If we have paragraph breaks, use them
    if (doubleLineBreaks > 2) {
        return 'paragraphs';
    }

    // If the file has many single line breaks, split by lines
    if (singleLineBreaks > doubleLineBreaks * 3) {
        return 'lines';
    }

    // Default to paragraphs
    return 'paragraphs';
};

/**
 * Parses a plaintext file into notebook cells
 */
export const parseFile = async (file: File, onProgress?: ProgressCallback, options?: any): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading text file...', 10));

        const content = await file.text();

        if (content.trim().length === 0) {
            throw new Error('File is empty');
        }

        onProgress?.(createProgress('Analyzing Content', 'Analyzing text structure...', 30));

        // Determine the best way to split the content
        const splitStrategy = determineSplitStrategy(content);

        onProgress?.(createProgress('Splitting Content', `Splitting by ${splitStrategy}...`, 50));

        // Split content into segments
        const segments = splitContentIntoSegments(content, splitStrategy);

        if (segments.length === 0) {
            throw new Error('No content segments could be extracted from the file');
        }

        onProgress?.(createProgress('Creating Cells', 'Creating notebook cells...', 70));

        // Convert segments to cells
        const cells = segments.map((segment, index) => {
            const cellId = createStandardCellId(file.name, 1, index + 1);
            return createProcessedCell(cellId, segment, {
                type: 'text',
                segmentIndex: index,
                splitStrategy,
                originalText: segment,
                // Add line numbers for reference
                lineNumbers: content.substring(0, content.indexOf(segment)).split('\n').length,
            });
        });

        // Create notebook pair manually
        const baseName = file.name.replace(/\.[^/.]+$/, '');

        const sourceNotebook = {
            name: baseName,
            cells,
            metadata: {
                id: uuidv4(),
                originalFileName: file.name,
                sourceFile: file.name,
                importerType: 'plaintext',
                createdAt: new Date().toISOString(),
                importContext: {
                    importerType: 'plaintext',
                    fileName: file.name,
                    originalFileName: file.name,
                    fileSize: file.size,
                    importTimestamp: new Date().toISOString(),
                },
                splitStrategy,
                totalSegments: segments.length,
                originalLength: content.length,
                statistics: {
                    characters: content.length,
                    words: content.split(/\s+/).filter(w => w.length > 0).length,
                    lines: content.split('\n').length,
                    paragraphs: segments.length,
                },
            },
        };

        const codexCells = cells.map(sourceCell => ({
            id: sourceCell.id,
            content: '', // Empty for translation
            images: sourceCell.images,
            metadata: sourceCell.metadata,
        }));

        const codexNotebook = {
            name: baseName,
            cells: codexCells,
            metadata: {
                ...sourceNotebook.metadata,
                id: uuidv4(),
            },
        };

        const notebookPair = {
            source: sourceNotebook,
            codex: codexNotebook,
        };

        // Add milestone cells to the notebook pair
        const notebookPairWithMilestones = addMilestoneCellsToNotebookPair(notebookPair);

        onProgress?.(createProgress('Complete', 'Text processing complete', 100));

        return {
            success: true,
            notebookPair: notebookPairWithMilestones,
            metadata: {
                segmentCount: cells.length,
                splitStrategy,
                fileSize: file.size,
                statistics: {
                    characters: content.length,
                    words: content.split(/\s+/).filter(w => w.length > 0).length,
                    lines: content.split('\n').length,
                },
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Text processing failed', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

export const plaintextImporter: ImporterPlugin = {
    name: 'Enhanced Plaintext Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: ['text/plain'],
    description: 'Import plain text files with intelligent paragraph and section detection',
    validateFile,
    parseFile,
}; 