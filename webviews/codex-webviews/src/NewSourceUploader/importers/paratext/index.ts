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
} from '../../utils/workflowHelpers';
import JSZip from 'jszip';

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

const SUPPORTED_EXTENSIONS = ['zip', 'ptx'];

interface BookNameMapping {
    [bookCode: string]: string;
}

interface ParatextFile {
    name: string;
    content: string;
    isUsfm: boolean;
    isBookNames: boolean;
    bookCode?: string;
}

interface ProcessedBook {
    bookCode: string;
    bookName?: string;
    fileName: string;
    cells: any[];
    verseCount: number;
    paratextCount: number;
    chapters: number[];
}

/**
 * Validates a Paratext project file (ZIP or folder)
 */
const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .zip or .ptx extension');
    }

    // Check file size (warn if > 100MB)
    if (file.size > 100 * 1024 * 1024) {
        warnings.push('Large Paratext projects may take longer to process');
    }

    // If it's a ZIP file, peek inside to validate structure
    if (file.name.toLowerCase().endsWith('.zip')) {
        try {
            const zip = new JSZip();
            const zipContent = await zip.loadAsync(file);

            let usfmFileCount = 0;
            let hasBookNames = false;

            zipContent.forEach((relativePath, file) => {
                if (!file.dir) {
                    const fileName = file.name.toLowerCase();

                    // Check for USFM files
                    if (fileName.endsWith('.usfm') || fileName.endsWith('.sfm')) {
                        usfmFileCount++;
                    }

                    // Check for book names file
                    if (fileName.includes('booknames') && fileName.endsWith('.xml')) {
                        hasBookNames = true;
                    }
                }
            });

            if (usfmFileCount === 0) {
                errors.push('ZIP file must contain at least one USFM (.usfm or .sfm) file');
            } else {
                warnings.push(`Found ${usfmFileCount} USFM files`);
            }

            if (hasBookNames) {
                warnings.push('Found book names XML file - will be used for localized book names');
            }

        } catch (error) {
            errors.push('Could not read ZIP file structure');
        }
    }

    return {
        isValid: errors.length === 0,
        fileType: 'paratext',
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
        },
    };
};

/**
 * Parses XML book names file to extract book name mappings
 */
const parseBookNamesXml = (xmlContent: string): BookNameMapping => {
    const bookNames: BookNameMapping = {};

    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

        // Check for parsing errors
        const errorNode = xmlDoc.getElementsByTagName('parsererror')[0];
        if (errorNode) {
            console.warn('XML parsing error in book names file:', errorNode.textContent);
            return bookNames;
        }

        // Look for book elements under BookNames root
        const bookElements = xmlDoc.getElementsByTagName('book');

        for (let i = 0; i < bookElements.length; i++) {
            const book = bookElements[i];
            const code = book.getAttribute('code');

            // Try different name attributes in order of preference
            const longName = book.getAttribute('long');
            const shortName = book.getAttribute('short');
            const abbrName = book.getAttribute('abbr');

            if (code && (longName || shortName || abbrName)) {
                // Prefer long name, fall back to short, then abbr
                bookNames[code] = longName || shortName || abbrName || code;
            }
        }

    } catch (error) {
        console.warn('Error parsing book names XML:', error);
    }

    return bookNames;
};

/**
 * Extracts and categorizes files from ZIP
 */
const extractFilesFromZip = async (file: File, onProgress?: ProgressCallback): Promise<ParatextFile[]> => {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(file);

    const files: ParatextFile[] = [];
    const filePromises: Promise<void>[] = [];

    zipContent.forEach((relativePath, file) => {
        if (!file.dir) {
            const fileName = file.name.toLowerCase();
            const isUsfm = fileName.endsWith('.usfm') || fileName.endsWith('.sfm');
            const isBookNames = fileName.includes('booknames') && fileName.endsWith('.xml');

            if (isUsfm || isBookNames) {
                const promise = file.async('text').then(content => {
                    let bookCode: string | undefined;

                    if (isUsfm) {
                        // Try to extract book code from USFM content
                        const idMatch = content.match(/\\id\s+([A-Z0-9]{3})/);
                        bookCode = idMatch?.[1];
                    }

                    files.push({
                        name: file.name,
                        content,
                        isUsfm,
                        isBookNames,
                        bookCode,
                    });
                });

                filePromises.push(promise);
            }
        }
    });

    await Promise.all(filePromises);
    return files;
};

/**
 * Processes a single USFM file into cells
 */
const processUsfmFile = async (
    usfmFile: ParatextFile,
    bookNames: BookNameMapping,
    onProgress?: ProgressCallback
): Promise<ProcessedBook | null> => {
    try {
        await initializeUsfmGrammar();

        // Parse USFM using relaxed mode
        const relaxedUsfmParser = new USFMParser(usfmFile.content, LEVEL.RELAXED);
        const jsonOutput = relaxedUsfmParser.toJSON();

        // Extract book information
        const bookCode = jsonOutput.book?.bookCode?.toUpperCase() || usfmFile.bookCode;
        if (!bookCode) {
            console.warn(`No book code found in ${usfmFile.name}`);
            return null;
        }

        const bookName = bookNames[bookCode] || bookCode;

        const cells: any[] = [];
        const chapters = new Set<number>();
        let verseCount = 0;
        let paratextCount = 0;

        // Process chapters and verses
        if (jsonOutput.chapters && jsonOutput.chapters.length > 0) {
            jsonOutput.chapters.forEach((chapter: any) => {
                const chapterNumber = chapter.chapterNumber;
                if (!chapterNumber) return;

                chapters.add(chapterNumber);

                chapter.contents.forEach((content: any) => {
                    if (content.verseNumber !== undefined && content.verseText !== undefined) {
                        // This is a verse
                        const verseId = `${bookCode} ${chapterNumber}:${content.verseNumber}`;
                        const cell = createProcessedCell(verseId, content.verseText.trim(), {
                            type: 'verse',
                            bookCode,
                            bookName,
                            chapter: chapterNumber,
                            verse: content.verseNumber,
                            cellLabel: content.verseNumber.toString(),
                            originalText: content.verseText.trim(),
                            fileName: usfmFile.name,
                        });
                        cells.push(cell);
                        verseCount++;
                    } else if (content.text && !content.marker) {
                        // This is paratext
                        const paratextId = createStandardCellId(usfmFile.name, chapterNumber, cells.length + 1);
                        const cell = createProcessedCell(paratextId, content.text.trim(), {
                            type: 'paratext',
                            bookCode,
                            bookName,
                            chapter: chapterNumber,
                            originalText: content.text.trim(),
                            fileName: usfmFile.name,
                        });
                        cells.push(cell);
                        paratextCount++;
                    }
                });
            });
        }

        return {
            bookCode,
            bookName,
            fileName: usfmFile.name,
            cells,
            verseCount,
            paratextCount,
            chapters: Array.from(chapters).sort((a, b) => a - b),
        };

    } catch (error) {
        console.warn(`Error processing USFM file ${usfmFile.name}:`, error);
        return null;
    }
};

/**
 * Parses a Paratext project (ZIP file with multiple USFM files)
 */
const parseFile = async (file: File, onProgress?: ProgressCallback): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Extracting Files', 'Extracting files from ZIP...', 'processing', 10));

        const extractedFiles = await extractFilesFromZip(file, onProgress);

        onProgress?.(createProgress('Reading Book Names', 'Processing book names...', 'processing', 20));

        // Find and parse book names XML
        let bookNames: BookNameMapping = {};
        const bookNamesFile = extractedFiles.find(f => f.isBookNames);
        if (bookNamesFile) {
            bookNames = parseBookNamesXml(bookNamesFile.content);
            onProgress?.(createProgress('Book Names', `Loaded ${Object.keys(bookNames).length} book names`, 'processing', 25));
        }

        // Process USFM files
        const usfmFiles = extractedFiles.filter(f => f.isUsfm);
        if (usfmFiles.length === 0) {
            throw new Error('No USFM files found in the Paratext project');
        }

        onProgress?.(createProgress('Processing Books', `Processing ${usfmFiles.length} USFM files...`, 'processing', 30));

        const processedBooks: ProcessedBook[] = [];
        const totalFiles = usfmFiles.length;

        for (let i = 0; i < usfmFiles.length; i++) {
            const usfmFile = usfmFiles[i];
            const progress = 30 + Math.round((i / totalFiles) * 50);

            onProgress?.(createProgress(
                'Processing Books',
                `Processing ${usfmFile.bookCode || usfmFile.name} (${i + 1}/${totalFiles})...`,
                'processing',
                progress
            ));

            const processedBook = await processUsfmFile(usfmFile, bookNames, onProgress);
            if (processedBook) {
                processedBooks.push(processedBook);
            }
        }

        if (processedBooks.length === 0) {
            throw new Error('No valid USFM books could be processed');
        }

        onProgress?.(createProgress('Creating Notebooks', 'Creating notebook pairs...', 'processing', 85));

        // For now, create a single combined notebook with all books
        // In the future, this could be enhanced to create separate notebooks per book
        const allCells = processedBooks.flatMap(book => book.cells);
        const projectName = file.name.replace(/\.(zip|ptx)$/i, '');

        const notebookPair = createNotebookPair(file.name, allCells, 'paratext', {
            projectName,
            totalBooks: processedBooks.length,
            totalVerses: processedBooks.reduce((sum, book) => sum + book.verseCount, 0),
            totalParatext: processedBooks.reduce((sum, book) => sum + book.paratextCount, 0),
            books: processedBooks.map(book => ({
                bookCode: book.bookCode,
                bookName: book.bookName,
                fileName: book.fileName,
                verseCount: book.verseCount,
                paratextCount: book.paratextCount,
                chapters: book.chapters,
            })),
            hasBookNames: Object.keys(bookNames).length > 0,
        });

        onProgress?.(createProgress('Complete', 'Paratext project processing complete', 'complete', 100));

        return {
            success: true,
            notebookPair,
            metadata: {
                projectName,
                segmentCount: allCells.length,
                bookCount: processedBooks.length,
                verseCount: processedBooks.reduce((sum, book) => sum + book.verseCount, 0),
                paratextCount: processedBooks.reduce((sum, book) => sum + book.paratextCount, 0),
                books: processedBooks.map(book => book.bookCode).sort(),
                hasBookNames: Object.keys(bookNames).length > 0,
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Paratext project processing failed', 'error', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

export const paratextImporter: ImporterPlugin = {
    name: 'Paratext Project Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    description: 'Import Paratext translation projects (ZIP files with multiple USFM files and book names)',
    validateFile,
    parseFile,
}; 