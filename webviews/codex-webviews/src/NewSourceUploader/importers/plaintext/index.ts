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
    createNotebookPair,
    validateFileExtension,
    splitContentIntoSegments,
} from '../../utils/workflowHelpers';

const SUPPORTED_EXTENSIONS = ['txt'];

type SplitStrategy = 'paragraphs' | 'lines' | 'sections';

/**
 * Validates a plaintext file
 */
const validateFile = async (file: File): Promise<FileValidationResult> => {
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
const parseFile = async (file: File, onProgress?: ProgressCallback): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading text file...', 'processing', 10));

        const content = await file.text();

        if (content.trim().length === 0) {
            throw new Error('File is empty');
        }

        onProgress?.(createProgress('Analyzing Content', 'Analyzing text structure...', 'processing', 30));

        // Determine the best way to split the content
        const splitStrategy = determineSplitStrategy(content);

        onProgress?.(createProgress('Splitting Content', `Splitting by ${splitStrategy}...`, 'processing', 50));

        // Split content into segments
        const segments = splitContentIntoSegments(content, splitStrategy);

        if (segments.length === 0) {
            throw new Error('No content segments could be extracted from the file');
        }

        onProgress?.(createProgress('Creating Cells', 'Creating notebook cells...', 'processing', 70));

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

        // Create notebook pair
        const notebookPair = createNotebookPair(file.name, cells, 'plaintext', {
            splitStrategy,
            totalSegments: segments.length,
            originalLength: content.length,
            // Provide some basic statistics
            statistics: {
                characters: content.length,
                words: content.split(/\s+/).filter(w => w.length > 0).length,
                lines: content.split('\n').length,
                paragraphs: segments.length,
            },
        });

        onProgress?.(createProgress('Complete', 'Text processing complete', 'complete', 100));

        return {
            success: true,
            notebookPair,
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
        onProgress?.(createProgress('Error', 'Text processing failed', 'error', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

export const plaintextImporter: ImporterPlugin = {
    name: 'Enhanced Plaintext Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    description: 'Import plain text files with intelligent paragraph and section detection',
    validateFile,
    parseFile,
}; 