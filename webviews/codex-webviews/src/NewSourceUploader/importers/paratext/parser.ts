import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
} from '../../types/common';
import {
    createProgress,
    validateFileExtension,
    addMilestoneCellsToNotebookPair,
} from '../../utils/workflowHelpers';
import {
    processUsfmContent,
    parseBookNamesXml,
    parseSettingsXml,
    createNotebookPair,
    parseParatextFilename,
    getBookOrder,
    ProcessedUsfmBook,
} from '../common/usfmUtils';
import JSZip from 'jszip';

const SUPPORTED_EXTENSIONS = ['zip', 'folder'];
const SUPPORTED_MIME_TYPES = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'];

interface ParatextFile {
    name: string;
    content: string;
    isUsfm: boolean;
    isBookNames: boolean;
    isSettings: boolean;
    bookCode?: string;
    // Enhanced parsing information
    parseInfo?: any;
    bookOrder?: number;
    languageCode?: string;
    projectAbbrev?: string;
    year?: number;
}

interface ParatextProjectMetadata {
    projectName: string;
    language: string;
    languageCode: string;
    languageIsoCode: string;
    projectType: string;
    versification: string;
    encoding: string;
    abbreviation?: string;
    description?: string;
    copyright?: string;
    hasBookNames: boolean;
    hasSettings: boolean;
    // Enhanced project information
    projectSettings?: any;
    fileNamingPattern?: any;
    detectedYear?: number;
    booksFound?: string[];
}

/**
 * Validates a Paratext project file (ZIP or folder)
 */
const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .zip or .folder extension');
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
            let hasSettings = false;
            const sampleFilenames: string[] = [];

            zipContent.forEach((relativePath, file) => {
                if (!file.dir) {
                    const fileName = file.name.toLowerCase();

                    // Skip MacOS system files in validation too
                    if (file.name.includes('__MACOSX') || file.name.includes('/._') || file.name.startsWith('._')) {
                        return;
                    }

                    // Check for USFM files (more flexible patterns)
                    if (fileName.endsWith('.usfm') || fileName.endsWith('.sfm') ||
                        fileName.includes('.sfm') || fileName.includes('.usfm')) {
                        usfmFileCount++;
                        if (sampleFilenames.length < 3) {
                            sampleFilenames.push(file.name);
                        }
                    }

                    // Check for book names file
                    if (fileName.includes('booknames') && fileName.endsWith('.xml')) {
                        hasBookNames = true;
                    }

                    // Check for settings file
                    if (fileName.includes('settings') && fileName.endsWith('.xml')) {
                        hasSettings = true;
                    }
                }
            });

            if (usfmFileCount === 0) {
                errors.push('ZIP file must contain at least one USFM (.usfm or .sfm) file');
            } else {
                warnings.push(`Found ${usfmFileCount} USFM files - each will become a separate notebook`);
                if (sampleFilenames.length > 0) {
                    warnings.push(`Sample filenames: ${sampleFilenames.join(', ')}`);
                }
            }

            if (hasBookNames) {
                warnings.push('Found book names XML file - will be used for localized book names');
            }

            if (hasSettings) {
                warnings.push('Found settings XML file - will be used for project configuration');
            } else {
                warnings.push('No Settings.xml found - will use basic file detection');
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
 * Extracts and categorizes files from ZIP with intelligent USFM detection
 */
const extractFilesFromZip = async (
    file: File,
    onProgress?: ProgressCallback,
    projectMetadata?: ParatextProjectMetadata
): Promise<ParatextFile[]> => {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(file);

    const files: ParatextFile[] = [];
    const filePromises: Promise<void>[] = [];

    zipContent.forEach((relativePath, file) => {
        if (!file.dir) {
            // Filter out MacOS system files
            const filePath = file.name;
            if (filePath.includes('__MACOSX') || filePath.includes('/._') || filePath.startsWith('._')) {
                return; // Skip MacOS system files
            }

            const fileName = file.name.toLowerCase();
            const isBookNames = fileName.includes('booknames') && fileName.endsWith('.xml');
            const isSettings = fileName.includes('settings') && fileName.endsWith('.xml');

            // More intelligent USFM detection
            let isUsfm = false;

            // Standard extensions (exclude USX/PTX which are XML or Paratext project files)
            if (fileName.endsWith('.usfm') || fileName.endsWith('.sfm')) {
                isUsfm = true;
            }

            // If we have project metadata, use it to identify files by pattern
            if (!isUsfm && projectMetadata) {
                const parseInfo = parseParatextFilename(file.name, projectMetadata);
                if (parseInfo.isValid && parseInfo.bookCode) {
                    isUsfm = true;
                }
            }

            // Fallback: check if filename contains book codes
            if (!isUsfm) {
                // Expanded list of all biblical book codes
                const allBookCodes = [
                    // Old Testament
                    'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT',
                    '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH',
                    'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER',
                    'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON',
                    'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
                    // New Testament
                    'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO',
                    'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI',
                    'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN',
                    '3JN', 'JUD', 'REV'
                ];
                const upperFileName = file.name.toUpperCase();
                isUsfm = allBookCodes.some(code => upperFileName.includes(code));
            }

            console.log(`File ${file.name}: isUsfm=${isUsfm}, isBookNames=${isBookNames}, isSettings=${isSettings}`);

            if (isUsfm || isBookNames || isSettings) {
                const promise = file.async('text').then(content => {
                    let bookCode: string | undefined;
                    let parseInfo: any = null;
                    let bookOrder: number | undefined;
                    let languageCode: string | undefined;
                    let projectAbbrev: string | undefined;
                    let year: number | undefined;

                    if (isUsfm) {
                        // Try to extract book code from USFM content
                        const idMatch = content.match(/\\id\s+([A-Z0-9]{3})/);
                        bookCode = idMatch?.[1];

                        // If no book code found in content, try to extract from filename
                        if (!bookCode) {
                            // Try to extract book code from filename patterns
                            const filenameBookCodeMatch = file.name.match(/([A-Z0-9]{3})(?:[^A-Z]|$)/i);
                            if (filenameBookCodeMatch) {
                                const potentialCode = filenameBookCodeMatch[1].toUpperCase();
                                // Validate it's a real book code
                                const validBookCodes = [
                                    'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT',
                                    '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH',
                                    'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER',
                                    'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON',
                                    'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
                                    'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO',
                                    'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI',
                                    'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN',
                                    '3JN', 'JUD', 'REV'
                                ];
                                if (validBookCodes.includes(potentialCode)) {
                                    bookCode = potentialCode;
                                    console.warn(`No \\id marker found in ${file.name}, using book code from filename: ${bookCode}`);
                                }
                            }
                        }

                        console.log(`USFM file ${file.name}: extracted book code = ${bookCode}, content preview:`, content.substring(0, 100));

                        // Parse filename for additional metadata
                        if (projectMetadata) {
                            parseInfo = parseParatextFilename(file.name, projectMetadata);
                            if (parseInfo.isValid) {
                                bookCode = parseInfo.bookCode || bookCode;
                                bookOrder = parseInfo.bookOrder || getBookOrder(bookCode || '');
                                languageCode = parseInfo.languageCode;
                                projectAbbrev = parseInfo.projectAbbrev;
                                year = parseInfo.year;
                            }
                        }

                        // Fallback to canonical order if no order found
                        if (!bookOrder && bookCode) {
                            bookOrder = getBookOrder(bookCode);
                        }
                    }

                    files.push({
                        name: file.name,
                        content,
                        isUsfm,
                        isBookNames,
                        isSettings,
                        bookCode,
                        parseInfo,
                        bookOrder,
                        languageCode,
                        projectAbbrev,
                        year,
                    });
                });

                filePromises.push(promise);
            }
        }
    });

    await Promise.all(filePromises);

    // Sort USFM files by book order for better processing
    const usfmFiles = files.filter(f => f.isUsfm);
    usfmFiles.sort((a, b) => (a.bookOrder || 999) - (b.bookOrder || 999));

    return files;
};

/**
 * Parses a Paratext project (ZIP file with multiple USFM files)
 */
const parseFile = async (file: File, onProgress?: ProgressCallback): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Extracting Files', 'Extracting files from ZIP...', 10));

        // First pass: extract settings to understand project structure
        let projectMetadata: ParatextProjectMetadata = {
            projectName: file.name.replace(/\.(zip|folder)$/i, ''),
            language: '',
            languageCode: '',
            languageIsoCode: '',
            projectType: 'standard',
            versification: 'Original',
            encoding: 'UTF-8',
            hasBookNames: false,
            hasSettings: false,
        };

        // Quick extraction to get Settings.xml first
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(file);

        for (const [relativePath, zipFile] of Object.entries(zipContent.files)) {
            if (!zipFile.dir &&
                !zipFile.name.includes('__MACOSX') &&
                !zipFile.name.includes('/._') &&
                !zipFile.name.startsWith('._') &&
                zipFile.name.toLowerCase().includes('settings') &&
                zipFile.name.toLowerCase().endsWith('.xml')) {
                const settingsContent = await zipFile.async('text');
                const settingsData = parseSettingsXml(settingsContent);
                projectMetadata = { ...projectMetadata, ...settingsData, hasSettings: true };
                onProgress?.(createProgress('Project Settings', 'Loaded project configuration', 20));
                break;
            }
        }

        onProgress?.(createProgress('Analyzing Project', 'Analyzing project structure...', 25));

        // Second pass: extract all files with project context
        const extractedFiles = await extractFilesFromZip(file, onProgress, projectMetadata);

        console.log(`Total files extracted: ${extractedFiles.length}`);
        console.log(`Files breakdown:`, {
            usfm: extractedFiles.filter(f => f.isUsfm).length,
            bookNames: extractedFiles.filter(f => f.isBookNames).length,
            settings: extractedFiles.filter(f => f.isSettings).length,
        });

        // Find and parse book names XML
        let bookNames: Record<string, string> = {};
        let bookNamesXmlContent: string | null = null;
        const bookNamesFile = extractedFiles.find(f => f.isBookNames);
        if (bookNamesFile) {
            bookNamesXmlContent = bookNamesFile.content;
            bookNames = parseBookNamesXml(bookNamesFile.content);
            projectMetadata.hasBookNames = true;
            onProgress?.(createProgress('Book Names', `Loaded ${Object.keys(bookNames).length} book names`, 30));
        }

        // Process USFM files
        const usfmFiles = extractedFiles.filter(f => f.isUsfm);
        if (usfmFiles.length === 0) {
            throw new Error('No USFM files found in the Paratext project');
        }

        // Detect project year and other patterns from filenames
        const years = usfmFiles.map(f => f.year).filter(Boolean);
        if (years.length > 0) {
            projectMetadata.detectedYear = years[0]; // Take first detected year
        }

        const booksFound = usfmFiles.map(f => f.bookCode).filter(Boolean) as string[];
        projectMetadata.booksFound = [...new Set(booksFound)].sort();

        onProgress?.(createProgress('Processing Books', `Processing ${usfmFiles.length} USFM files...`, 35));

        const processedBooks: ProcessedUsfmBook[] = [];
        const totalFiles = usfmFiles.length;

        for (let i = 0; i < usfmFiles.length; i++) {
            const usfmFile = usfmFiles[i];
            const progress = 35 + Math.round((i / totalFiles) * 50);

            const bookLabel = usfmFile.bookCode || usfmFile.name.split('/').pop() || usfmFile.name;
            onProgress?.(createProgress(
                'Processing Books',
                `Processing ${bookLabel} (${i + 1}/${totalFiles})...`,
                progress
            ));

            try {
                console.log(`Processing USFM file: ${usfmFile.name}`);
                console.log(`File content preview (first 200 chars):`, usfmFile.content.substring(0, 200));

                const processedBook = await processUsfmContent(
                    usfmFile.content,
                    usfmFile.name,
                    bookNames
                );

                console.log(`Successfully processed book: ${processedBook.bookCode} (${processedBook.bookName})`);

                // Enhance book metadata with parsed information
                if (usfmFile.parseInfo) {
                    processedBook.fileName = usfmFile.name;
                    // Add any additional metadata from filename parsing
                }

                processedBooks.push(processedBook);
            } catch (error) {
                console.error(`Error processing USFM file ${usfmFile.name}:`, error);
                // Continue with other files rather than failing completely
            }
        }

        if (processedBooks.length === 0) {
            throw new Error('No valid USFM books could be processed');
        }

        // Validate that all processed books have valid book codes
        const invalidBooks = processedBooks.filter(book => !book.bookCode);
        if (invalidBooks.length > 0) {
            console.error('Books missing USFM codes:', invalidBooks);
            throw new Error(`${invalidBooks.length} books are missing valid USFM book codes`);
        }

        onProgress?.(createProgress('Creating Notebooks', 'Creating notebook pairs...', 90));

        // Create separate notebook pairs for each book instead of combining them
        const notebookPairs = processedBooks.map(book => {
            // CRITICAL: Use USFM code for filename, not the localized book name
            const notebookName = book.bookCode; // This should be the 3-letter USFM code like "GEN", "MAT", etc.

            if (!notebookName) {
                console.error(`Book missing USFM code:`, book);
                throw new Error(`Book "${book.bookName || book.fileName}" is missing a valid USFM book code`);
            }

            const notebookPair = createNotebookPair(notebookName, book.cells, 'paratext', {
                projectMetadata,
                bookCode: book.bookCode,
                bookName: book.bookName, // Keep localized name in metadata for display
                fileName: book.fileName,
                verseCount: book.verseCount,
                paratextCount: book.paratextCount,
                chapters: book.chapters,
                totalVerses: book.verseCount,
                totalParatext: book.paratextCount,
                hasBookNames: Object.keys(bookNames).length > 0,
                hasSettings: projectMetadata.hasSettings,
                detectedYear: projectMetadata.detectedYear,
                languageCode: projectMetadata.languageIsoCode || projectMetadata.languageCode,
                projectAbbreviation: projectMetadata.abbreviation,
            });

            // Add milestone cells to the notebook pair
            return addMilestoneCellsToNotebookPair(notebookPair);
        });

        onProgress?.(createProgress('Complete', 'Paratext project processing complete', 100));

        console.log(`Created ${notebookPairs.length} notebook pairs`);
        console.log(`Notebook names:`, notebookPairs.map(pair => pair.source.name));

        // Calculate summary statistics
        const totalCells = processedBooks.reduce((sum, book) => sum + book.cells.length, 0);
        const totalVerses = processedBooks.reduce((sum, book) => sum + book.verseCount, 0);
        const totalParatext = processedBooks.reduce((sum, book) => sum + book.paratextCount, 0);

        return {
            success: true,
            notebookPairs, // Return array of notebook pairs instead of single pair
            metadata: {
                projectName: projectMetadata.projectName,
                projectMetadata,
                segmentCount: totalCells,
                bookCount: processedBooks.length,
                verseCount: totalVerses,
                paratextCount: totalParatext,
                books: projectMetadata.booksFound || processedBooks.map(book => book.bookCode).sort(),
                hasBookNames: Object.keys(bookNames).length > 0,
                hasSettings: projectMetadata.hasSettings,
                detectedYear: projectMetadata.detectedYear,
                languageCode: projectMetadata.languageIsoCode || projectMetadata.languageCode,
                projectAbbreviation: projectMetadata.abbreviation,
                notebookPairCount: notebookPairs.length,
                bookNamesXmlContent, // Include the XML content for import
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Paratext project processing failed'));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

export const paratextImporter: ImporterPlugin = {
    name: 'Paratext Project Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: SUPPORTED_MIME_TYPES,
    description: 'Import Paratext translation projects (ZIP files with multiple USFM files and project settings)',
    validateFile,
    parseFile,
}; 