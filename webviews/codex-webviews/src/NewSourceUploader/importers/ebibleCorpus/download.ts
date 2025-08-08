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
} from '../../utils/workflowHelpers';
import {
    createNotebookPair,
} from '../common/usfmUtils';
import { getCorpusMarkerForBook } from '../../utils/corpusUtils';

// This is a special importer that doesn't use files but downloads from eBible repository
const SUPPORTED_EXTENSIONS: string[] = []; // No file extensions since this is download-based

interface EbibleMetadata {
    languageCode: string;
    translationId: string;
    description?: string;
    title?: string;
    textDirection?: 'ltr' | 'rtl';
}

interface VerseData {
    vref: string;
    text: string;
    book: string;
    chapter: number;
    verse: number;
}

// Verse reference data (subset for initial implementation)
const VERSE_REFS: string[] = [
    "GEN 1:1", "GEN 1:2", "GEN 1:3", "GEN 1:4", "GEN 1:5",
    // In production, this would be loaded from a complete verse reference file
];

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
        onProgress?.(createProgress('Validation', 'Validating download parameters...', 5));

        // Validate metadata
        if (!metadata.languageCode || !metadata.translationId) {
            throw new Error('Missing language code or translation ID');
        }

        onProgress?.(createProgress('Download', 'Downloading eBible corpus...', 15));

        // Download verse content
        const verses = await downloadVerseContent(metadata, onProgress);

        if (verses.length === 0) {
            throw new Error('No verses found in downloaded content');
        }

        onProgress?.(createProgress('Processing', 'Processing verses into books...', 70));

        // Group verses by book
        const bookGroups = groupVersesByBook(verses);

        onProgress?.(createProgress('Creating Notebooks', 'Creating notebook pairs...', 85));

        // Create notebook pairs for each book
        const notebookPairs = createBookNotebooks(bookGroups, metadata);

        onProgress?.(createProgress('Complete', 'eBible download complete', 100));

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
        onProgress?.(createProgress('Error', 'eBible download failed', 0));

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

    // Step 1: Download verse references
    onProgress?.(createProgress('Download', 'Downloading verse references...', 10));

    let vrefResponse: Response;
    const vrefUrl = 'https://raw.githubusercontent.com/BibleNLP/ebible/main/metadata/vref.txt';

    try {
        vrefResponse = await fetch(vrefUrl);
        if (!vrefResponse.ok) {
            throw new Error(`Failed to download verse references: ${vrefResponse.status}`);
        }
    } catch (error) {
        throw new Error(`Failed to fetch verse references. Error: ${(error as any).message}`);
    }

    const vrefText = await vrefResponse.text();
    const verseRefs = vrefText.trim().split('\n').filter(line => line.trim());

    // Step 2: Download Bible text
    onProgress?.(createProgress('Download', `Downloading ${metadata.title || translationId} text...`, 30));

    let ebibleUrl: string;

    // Check for special Macula Bible
    const isMaculaBible =
        languageCode === 'original-greek-hebrew' && translationId === 'macula-greek-hebrew';

    if (isMaculaBible) {
        ebibleUrl = 'https://github.com/genesis-ai-dev/hebrew-greek-bible/raw/refs/heads/main/macula-ebible.txt';
    } else {
        // Use the correct eBible corpus URL format
        ebibleUrl = `https://raw.githubusercontent.com/BibleNLP/ebible/main/corpus/${languageCode}-${translationId}.txt`;
    }

    let response: Response;
    try {
        response = await fetch(ebibleUrl);
    } catch (error) {
        throw new Error(
            `Failed to fetch Bible text from ${ebibleUrl}. This could be due to network issues or the server being unavailable. Error: ${(error as any).message}`
        );
    }

    if (!response.ok) {
        throw new Error(
            `Failed to download Bible text: ${response.status} ${response.statusText}. This Bible translation may not be available in the eBible corpus.`
        );
    }

    const text = await response.text();
    if (!text.trim()) {
        throw new Error('Received empty response from the server.');
    }

    onProgress?.(createProgress('Parsing', 'Parsing downloaded content...', 50));

    const lines = text.trim().split('\n');

    if (isMaculaBible) {
        // For Macula Bible, verse refs are embedded in the content
        return parseEmbeddedVerseRefs(lines);
    } else {
        // For regular eBible corpus, align with verse references
        return parseWithVerseRefs(lines, verseRefs);
    }
};

/**
 * Parses Bible text lines with separate verse references
 */
const parseWithVerseRefs = (textLines: string[], verseRefs: string[]): VerseData[] => {
    const verses: VerseData[] = [];
    const minLength = Math.min(textLines.length, verseRefs.length);

    for (let i = 0; i < minLength; i++) {
        const text = textLines[i].trim();
        const vref = verseRefs[i].trim();

        if (!text || !vref) continue;

        // Parse the verse reference
        const refMatch = vref.match(/^([A-Z1-9]{3})\s+(\d+):(\d+)$/);
        if (!refMatch) continue;

        const [, book, chapter, verse] = refMatch;

        verses.push({
            vref,
            text,
            book,
            chapter: parseInt(chapter),
            verse: parseInt(verse),
        });
    }

    return verses;
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

    for (const [bookCode, verses] of Object.entries(bookGroups)) {
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

        // Use USFM book code for filename instead of full book name
        // bookCode should already be the 3-letter USFM code (e.g., "GEN", "EXO")
        const notebookPair = createNotebookPair(
            bookCode, // Use USFM code directly for filename
            cells,
            'ebibleCorpus',
            {
                bookName: bookCode, // Store the USFM code as bookName for filename consistency
                languageCode: metadata.languageCode,
                translationId: metadata.translationId,
                verseCount: verses.length,
                chapters: [...new Set(verses.map(v => v.chapter))].sort((a, b) => a - b),
                corpusMarker: getCorpusMarkerForBook(bookCode), // Ensure corpus marker is set
            }
        );

        notebookPairs[bookCode] = notebookPair;
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
    supportedMimeTypes: [], // No mime types since this is download-based
    description: 'Download Bible text from the eBible corpus repository',
    validateFile,
    parseFile,
};

// Export the download function for use by the UI
export { downloadEbibleCorpus, type EbibleMetadata }; 