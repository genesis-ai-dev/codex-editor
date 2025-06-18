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
} from '../../utils/workflowHelpers';
import './types'; // Import type declarations

// Dynamic import to handle usfm-grammar in browser environment
let USFMParser: any;
let LEVEL: any;

const initializeUsfmGrammar = async () => {
    if (!USFMParser) {
        try {
            const grammar = await import('usfm-grammar');
            USFMParser = grammar.USFMParser;
            LEVEL = grammar.LEVEL;
        } catch (error) {
            throw new Error('Failed to load USFM grammar library');
        }
    }
};

const SUPPORTED_EXTENSIONS = ['usfm', 'sfm', 'SFM', 'USFM'];

interface UsfmContent {
    id: string;
    content: string;
    type: 'verse' | 'paratext';
    metadata: {
        bookCode?: string;
        chapter?: number;
        verse?: number;
        originalText?: string;
    };
}

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

        // Check for basic USFM markers
        if (!content.includes('\\id')) {
            errors.push('USFM file must contain an \\id marker to identify the book');
        }

        if (!content.includes('\\c ')) {
            warnings.push('No chapter markers found - this may not be a complete USFM file');
        }

        if (!content.includes('\\v ')) {
            warnings.push('No verse markers found - this may not be a complete USFM file');
        }

        // Check for book code
        const idMatch = content.match(/\\id\s+([A-Z0-9]{3})/);
        if (!idMatch) {
            errors.push('Could not find a valid 3-character book code in \\id marker');
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
 * Parses a USFM file into notebook cells
 */
export const parseFile = async (file: File, onProgress?: ProgressCallback): Promise<ImportResult> => {
    try {
        await initializeUsfmGrammar();

        onProgress?.(createProgress('Reading File', 'Reading USFM file...', 10));

        const content = await file.text();

        onProgress?.(createProgress('Parsing USFM', 'Parsing USFM content...', 30));

        // Parse USFM using relaxed mode for better compatibility
        const relaxedUsfmParser = new USFMParser(content, LEVEL.RELAXED);
        const jsonOutput = relaxedUsfmParser.toJSON();

        // Extract book information
        const bookCode = jsonOutput.book?.bookCode?.toUpperCase();
        if (!bookCode) {
            throw new Error('No book code found in USFM file');
        }

        if (!/^[A-Z0-9]{3}$/.test(bookCode)) {
            throw new Error(`Invalid book code format: ${bookCode}. Expected a 3-character code like 'GEN' or 'MAT'`);
        }

        onProgress?.(createProgress('Processing Content', 'Converting to cells...', 60));

        const usfmContent: UsfmContent[] = [];

        // Process chapters and verses
        if (!jsonOutput.chapters || jsonOutput.chapters.length === 0) {
            throw new Error('No chapters found in USFM file');
        }

        jsonOutput.chapters.forEach((chapter: any) => {
            const chapterNumber = chapter.chapterNumber;

            if (!chapterNumber) {
                throw new Error('Invalid chapter format: missing chapter number');
            }

            chapter.contents.forEach((content: any) => {
                if (content.verseNumber !== undefined && content.verseText !== undefined) {
                    // This is a verse
                    const verseId = `${bookCode} ${chapterNumber}:${content.verseNumber}`;
                    usfmContent.push({
                        id: verseId,
                        content: content.verseText.trim(),
                        type: 'verse',
                        metadata: {
                            bookCode,
                            chapter: chapterNumber,
                            verse: content.verseNumber,
                            originalText: content.verseText.trim(),
                        },
                    });
                } else if (content.text && !content.marker) {
                    // This is paratext (content without specific markers)
                    const paratextId = createStandardCellId(file.name, chapterNumber, usfmContent.length + 1);
                    usfmContent.push({
                        id: paratextId,
                        content: content.text.trim(),
                        type: 'paratext',
                        metadata: {
                            bookCode,
                            chapter: chapterNumber,
                            originalText: content.text.trim(),
                        },
                    });
                }
            });
        });

        if (usfmContent.length === 0) {
            throw new Error('No verses or content found in USFM file');
        }

        onProgress?.(createProgress('Creating Cells', 'Creating notebook cells...', 80));

        // Convert to processed cells
        const cells = usfmContent.map((item) => {
            return createProcessedCell(item.id, item.content, {
                type: item.type,
                bookCode: item.metadata.bookCode,
                chapter: item.metadata.chapter,
                verse: item.metadata.verse,
                cellLabel: item.type === 'verse' ? item.metadata.verse?.toString() : undefined,
                originalText: item.metadata.originalText,
            });
        });

        // Create notebook pair manually
        const baseName = file.name.replace(/\.[^/.]+$/, '');

        const sourceNotebook = {
            name: baseName,
            cells,
            metadata: {
                id: `usfm-source-${Date.now()}`,
                originalFileName: file.name,
                importerType: 'usfm',
                createdAt: new Date().toISOString(),
                bookCode,
                totalVerses: usfmContent.filter(c => c.type === 'verse').length,
                totalParatext: usfmContent.filter(c => c.type === 'paratext').length,
                chapters: [...new Set(usfmContent.map(c => c.metadata.chapter).filter(Boolean))].sort((a, b) => a! - b!),
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
                id: `usfm-codex-${Date.now()}`,
            },
        };

        const notebookPair = {
            source: sourceNotebook,
            codex: codexNotebook,
        };

        onProgress?.(createProgress('Complete', 'USFM processing complete', 100));

        return {
            success: true,
            notebookPair,
            metadata: {
                bookCode,
                segmentCount: cells.length,
                verseCount: usfmContent.filter(c => c.type === 'verse').length,
                paratextCount: usfmContent.filter(c => c.type === 'paratext').length,
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'USFM processing failed', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

export const usfmImporter: ImporterPlugin = {
    name: 'USFM Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: ['text/plain', 'application/octet-stream'],
    description: 'Import Unified Standard Format Marker (USFM) biblical text files',
    validateFile,
    parseFile,
}; 