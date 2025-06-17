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
} from '../../utils/workflowHelpers';

// This is a special importer that doesn't use files but downloads from eBible repository
const SUPPORTED_EXTENSIONS: string[] = []; // No file extensions since this is download-based

interface EbibleMetadata {
    languageCode: string;
    translationId: string;
    description?: string;
}

interface VerseData {
    vref: string;
    text: string;
    book: string;
    chapter: number;
    verse: number;
}

/**
 * Validates eBible download metadata (not a file)
 */
const validateFile = async (file: File): Promise<FileValidationResult> => {
    // This importer doesn't validate files - it validates download metadata
    // We'll handle validation in the custom download function instead
    return {
        isValid: false,
        fileType: 'ebibleDownload',
        errors: ['This importer is for downloading eBible corpus, not file uploads'],
        warnings: [],
        metadata: {},
    };
};

/**
 * Downloads and parses eBible corpus from repository
 */
const downloadEbibleCorpus = async (
    metadata: EbibleMetadata,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Validation', 'Validating download parameters...', 'processing', 5));

        // Validate metadata
        if (!metadata.languageCode || !metadata.translationId) {
            throw new Error('Missing language code or translation ID');
        }

        onProgress?.(createProgress('Download', 'Downloading eBible corpus...', 'processing', 15));

        // Download verse content
        const verses = await downloadVerseContent(metadata, onProgress);

        if (verses.length === 0) {
            throw new Error('No verses found in downloaded content');
        }

        onProgress?.(createProgress('Processing', 'Processing verses into books...', 'processing', 70));

        // Group verses by book
        const bookGroups = groupVersesByBook(verses);

        onProgress?.(createProgress('Creating Notebooks', 'Creating notebook pairs...', 'processing', 85));

        // Create notebook pairs for each book
        const notebookPairs = createBookNotebooks(bookGroups, metadata);

        onProgress?.(createProgress('Complete', 'eBible download complete', 'complete', 100));

        // For now, return the first book as the main result
        // In a real implementation, you might want to handle multiple books differently
        const firstBook = Object.keys(bookGroups)[0];
        const mainNotebook = notebookPairs[firstBook];

        return {
            success: true,
            notebookPair: mainNotebook,
            metadata: {
                languageCode: metadata.languageCode,
                translationId: metadata.translationId,
                verseCount: verses.length,
                bookCount: Object.keys(bookGroups).length,
                books: Object.keys(bookGroups).sort(),
                allNotebooks: notebookPairs, // Include all book notebooks
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'eBible download failed', 'error', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

/**
 * Downloads verse content from eBible repository
 */
const downloadVerseContent = async (
    metadata: EbibleMetadata,
    onProgress?: ProgressCallback
): Promise<VerseData[]> => {
    const { languageCode, translationId } = metadata;

    let ebibleUrl: string;

    // Check for special Macula Bible
    const isMaculaBible =
        languageCode === 'original-greek-hebrew' && translationId === 'macula-greek-hebrew';

    if (isMaculaBible) {
        ebibleUrl = 'https://github.com/genesis-ai-dev/hebrew-greek-bible/raw/refs/heads/main/macula-ebible.txt';
    } else {
        ebibleUrl = `https://raw.githubusercontent.com/BibleNLP/ebible/0eed6f47ff555201874d5416bbfebba4ed743d4f/corpus/${languageCode}-${translationId}.txt`;
    }

    onProgress?.(createProgress('Download', `Fetching from ${ebibleUrl}...`, 'processing', 25));

    let response: Response;
    try {
        response = await fetch(ebibleUrl);
    } catch (error) {
        throw new Error(
            `Failed to fetch Bible text from ${ebibleUrl}. This could be due to network issues or the server being unavailable. Error: ${(error as any).message
            }`
        );
    }

    if (!response.ok) {
        throw new Error(
            `Failed to download Bible text: ${response.status} ${response.statusText}. It could be that this file no longer exists on the remote server. Try navigating to ${ebibleUrl}`
        );
    }

    const text = await response.text();
    if (!text.trim()) {
        throw new Error('Received empty response from the server.');
    }

    onProgress?.(createProgress('Parsing', 'Parsing downloaded content...', 'processing', 50));

    const lines = text.trim().split('\n');

    if (isMaculaBible) {
        // For Macula Bible, verse refs are embedded in the content
        return parseEmbeddedVerseRefs(lines);
    } else {
        // For regular eBible corpus, use standard verse references
        return parseStandardEbibleFormat(lines);
    }
};

/**
 * Parses Macula Bible format where verse refs are embedded
 */
const parseEmbeddedVerseRefs = (lines: string[]): VerseData[] => {
    const verses: VerseData[] = [];

    for (const line of lines) {
        const vref = extractVerseRefFromLine(line);
        if (vref) {
            // Extract the text after the verse reference
            const verseRefPattern = /^(\b[A-Z1-9]{3}\s\d+:\d+\b)/;
            const match = line.match(verseRefPattern);

            if (match) {
                const refLength = match[0].length;
                const text = line.substring(refLength).trim();

                // Parse the verse reference
                const [book, chapterVerse] = vref.split(' ');
                const [chapter, verse] = chapterVerse.split(':').map(Number);

                verses.push({
                    vref,
                    text,
                    book,
                    chapter,
                    verse,
                });
            }
        }
    }

    return verses;
};

/**
 * Parses standard eBible format (one verse per line, aligned with verse refs)
 */
const parseStandardEbibleFormat = (lines: string[]): VerseData[] => {
    // This would need the allORGBibleVerseRefs data
    // For now, we'll try to parse each line as a verse
    const verses: VerseData[] = [];

    // Try to detect if lines contain verse references
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Try to extract verse reference from the beginning of the line
        const vrefMatch = line.match(/^([A-Z1-9]{3}\s\d+:\d+)\s+(.+)$/);
        if (vrefMatch) {
            const vref = vrefMatch[1];
            const text = vrefMatch[2];
            const [book, chapterVerse] = vref.split(' ');
            const [chapter, verse] = chapterVerse.split(':').map(Number);

            verses.push({
                vref,
                text,
                book,
                chapter,
                verse,
            });
        } else {
            // If no verse reference detected, create a generic one
            // This is a fallback - in practice, you'd use allORGBibleVerseRefs
            verses.push({
                vref: `UNK 1:${i + 1}`,
                text: line,
                book: 'UNK',
                chapter: 1,
                verse: i + 1,
            });
        }
    }

    return verses;
};

/**
 * Extracts verse reference from a line (similar to backend function)
 */
const extractVerseRefFromLine = (line: string): string | null => {
    const match = line.match(/^([A-Z1-9]{3}\s\d+:\d+)/);
    return match ? match[1] : null;
};

/**
 * Groups verses by book
 */
const groupVersesByBook = (verses: VerseData[]): Record<string, VerseData[]> => {
    const groups: Record<string, VerseData[]> = {};

    for (const verse of verses) {
        if (!groups[verse.book]) {
            groups[verse.book] = [];
        }
        groups[verse.book].push(verse);
    }

    return groups;
};

/**
 * Creates notebook pairs for each book
 */
const createBookNotebooks = (
    bookGroups: Record<string, VerseData[]>,
    metadata: EbibleMetadata
): Record<string, any> => {
    const notebookPairs: Record<string, any> = {};

    for (const [bookName, verses] of Object.entries(bookGroups)) {
        // Create cells for this book
        const cells = verses.map((verse) => {
            return createProcessedCell(verse.vref, verse.text, {
                type: 'verse',
                book: verse.book,
                chapter: verse.chapter,
                verse: verse.verse,
                cellLabel: verse.verse.toString(),
                originalText: verse.text,
            });
        });

        // Create notebook pair for this book
        const notebookPair = createNotebookPair(
            `${metadata.languageCode}-${metadata.translationId}-${bookName}`,
            cells,
            'ebibleCorpus',
            {
                bookName,
                languageCode: metadata.languageCode,
                translationId: metadata.translationId,
                verseCount: verses.length,
                chapters: [...new Set(verses.map(v => v.chapter))].sort((a, b) => a - b),
            }
        );

        notebookPairs[bookName] = notebookPair;
    }

    return notebookPairs;
};

/**
 * This is a placeholder parseFile function since this importer handles downloads, not file uploads
 */
const parseFile = async (file: File, onProgress?: ProgressCallback): Promise<ImportResult> => {
    return {
        success: false,
        error: 'This importer is for downloading eBible corpus, not file uploads. Use downloadEbibleCorpus() instead.',
    };
};

export const ebibleDownloadImporter: ImporterPlugin = {
    name: 'eBible Corpus Downloader',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    description: 'Download Bible text from the eBible corpus repository',
    validateFile,
    parseFile,
};

// Export the download function for use by the UI
export { downloadEbibleCorpus, type EbibleMetadata }; 