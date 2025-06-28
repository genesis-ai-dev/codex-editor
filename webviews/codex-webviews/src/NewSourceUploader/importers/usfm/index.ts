import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
} from '../../types/common';
import {
    createProgress,
    validateFileExtension,
} from '../../utils/workflowHelpers';
import {
    validateUsfmContent,
    processUsfmContent,
    createNotebookPair,
} from '../common/usfmUtils';
import './types'; // Import type declarations

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
        const validation = validateUsfmContent(content, file.name);
        errors.push(...validation.errors);
        warnings.push(...validation.warnings);
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
 * Parses a USFM file into notebook cells
 */
export const parseFile = async (file: File, onProgress?: ProgressCallback): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading USFM file...', 10));

        const content = await file.text();

        onProgress?.(createProgress('Parsing USFM', 'Parsing USFM content...', 30));

        // Process the USFM content using shared utilities
        const processedBook = await processUsfmContent(content, file.name);

        onProgress?.(createProgress('Creating Notebooks', 'Converting to notebook pairs...', 80));

        // Create notebook pair using shared utility
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const notebookPair = createNotebookPair(baseName, processedBook.cells, 'usfm', {
            bookCode: processedBook.bookCode,
            bookName: processedBook.bookName,
            totalVerses: processedBook.verseCount,
            totalParatext: processedBook.paratextCount,
            chapters: processedBook.chapters,
        });

        onProgress?.(createProgress('Complete', 'USFM processing complete', 100));

        return {
            success: true,
            notebookPair,
            metadata: {
                bookCode: processedBook.bookCode,
                bookName: processedBook.bookName,
                segmentCount: processedBook.cells.length,
                verseCount: processedBook.verseCount,
                paratextCount: processedBook.paratextCount,
                chapters: processedBook.chapters,
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

export const usfmImporter: ImporterPlugin = {
    name: 'USFM Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: SUPPORTED_MIME_TYPES,
    description: 'Import Unified Standard Format Marker (USFM) biblical text files',
    validateFile,
    parseFile,
}; 