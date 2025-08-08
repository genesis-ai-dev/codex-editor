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

const SUPPORTED_EXTENSIONS = ['tsv', 'csv', 'txt'];

/**
 * Validates an eBible corpus file
 */
const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .tsv, .csv, or .txt extension');
    }

    // Check if file name contains eBible-like patterns
    const fileName = file.name.toLowerCase();
    if (!fileName.includes('bible') && !fileName.includes('scripture') && !fileName.includes('corpus')) {
        warnings.push('File name does not indicate a biblical corpus format');
    }

    // Check file size (warn if > 100MB)
    if (file.size > 100 * 1024 * 1024) {
        warnings.push('Large corpus files may take longer to process');
    }

    return {
        isValid: errors.length === 0,
        fileType: 'ebibleCorpus',
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
        },
    };
};

/**
 * Parses an eBible corpus file
 */
const parseFile = async (
    file: File,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading eBible corpus file...', 10));

        const text = await file.text();

        onProgress?.(createProgress('Parsing Structure', 'Parsing eBible corpus structure...', 30));

        // Detect format (TSV, CSV, or plain text)
        const format = detectCorpusFormat(text, file.name);

        onProgress?.(createProgress('Processing Verses', 'Processing verses and references...', 60));

        // Parse based on detected format
        const verses = parseCorpusData(text, format);

        onProgress?.(createProgress('Creating Cells', 'Creating notebook cells...', 80));

        // Convert verses to cells
        const cells = verses.map((verse, index) => {
            const cellId = createStandardCellId(file.name, verse.chapter, verse.verseNumber);
            const content = formatVerseContent(verse);
            return createProcessedCell(cellId, content, {
                verseReference: verse.reference,
                book: verse.book,
                chapter: verse.chapter,
                verse: verse.verseNumber,
                cellLabel: verse.verseNumber.toString(),
            });
        });

        // Create notebook pair manually
        const baseName = file.name.replace(/\.[^/.]+$/, '');

        const sourceNotebook = {
            name: baseName,
            cells,
            metadata: {
                id: `ebible-corpus-source-${Date.now()}`,
                originalFileName: file.name,
                importerType: 'ebibleCorpus',
                createdAt: new Date().toISOString(),
                format,
                verseCount: verses.length,
                books: Array.from(new Set(verses.map(v => v.book))),
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
                id: `ebible-corpus-codex-${Date.now()}`,
            },
        };

        const notebookPair = {
            source: sourceNotebook,
            codex: codexNotebook,
        };

        onProgress?.(createProgress('Complete', 'eBible corpus processing complete', 100));

        return {
            success: true,
            notebookPair,
            metadata: {
                format,
                verseCount: verses.length,
                bookCount: new Set(verses.map(v => v.book)).size,
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Failed to process eBible corpus file', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

/**
 * Detects the format of the corpus file
 */
const detectCorpusFormat = (text: string, fileName: string): 'tsv' | 'csv' | 'text' => {
    const lines = text.split('\n').slice(0, 5); // Check first 5 lines

    if (fileName.toLowerCase().endsWith('.tsv') || lines.some(line => line.split('\t').length > 3)) {
        return 'tsv';
    }

    if (fileName.toLowerCase().endsWith('.csv') || lines.some(line => line.split(',').length > 3)) {
        return 'csv';
    }

    return 'text';
};

/**
 * Parses corpus data based on format
 */
const parseCorpusData = (text: string, format: 'tsv' | 'csv' | 'text'): VerseData[] => {
    const lines = text.split('\n').filter(line => line.trim());

    switch (format) {
        case 'tsv':
            return lines.map(line => parseTsvLine(line)).filter(Boolean) as VerseData[];
        case 'csv':
            return lines.map(line => parseCsvLine(line)).filter(Boolean) as VerseData[];
        case 'text':
            return parseTextFormat(lines);
        default:
            return [];
    }
};

/**
 * Parses a TSV line (assumes: book\tchapter\tverse\ttext)
 */
const parseTsvLine = (line: string): VerseData | null => {
    const parts = line.split('\t');
    if (parts.length < 4) return null;

    return {
        book: parts[0],
        chapter: parseInt(parts[1]),
        verseNumber: parseInt(parts[2]),
        text: parts[3],
        reference: `${parts[0]} ${parts[1]}:${parts[2]}`,
    };
};

/**
 * Parses a CSV line (assumes: book,chapter,verse,text)
 */
const parseCsvLine = (line: string): VerseData | null => {
    const parts = line.split(',');
    if (parts.length < 4) return null;

    return {
        book: parts[0].replace(/"/g, ''),
        chapter: parseInt(parts[1]),
        verseNumber: parseInt(parts[2]),
        text: parts[3].replace(/"/g, ''),
        reference: `${parts[0]} ${parts[1]}:${parts[2]}`,
    };
};

/**
 * Parses plain text format (attempts to detect patterns)
 */
const parseTextFormat = (lines: string[]): VerseData[] => {
    const verses: VerseData[] = [];

    for (const line of lines) {
        // Try to match patterns like "Genesis 1:1 In the beginning..."
        const match = line.match(/^(\w+)\s+(\d+):(\d+)\s+(.+)$/);
        if (match) {
            verses.push({
                book: match[1],
                chapter: parseInt(match[2]),
                verseNumber: parseInt(match[3]),
                text: match[4],
                reference: `${match[1]} ${match[2]}:${match[3]}`,
            });
        }
    }

    return verses;
};

/**
 * Formats verse content for notebook cell
 */
const formatVerseContent = (verse: VerseData): string => {
    return `<div class="verse" data-reference="${verse.reference}">
        <span class="verse-reference">${verse.reference}</span>
        <span class="verse-text">${verse.text}</span>
    </div>`;
};

interface VerseData {
    book: string;
    chapter: number;
    verseNumber: number;
    text: string;
    reference: string;
}

/**
 * eBible Corpus Importer Plugin
 */
export const ebibleCorpusImporter: ImporterPlugin = {
    name: 'eBible Corpus Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: ['text/tab-separated-values', 'text/csv', 'text/plain'],
    description: 'Imports eBible corpus files in TSV, CSV, or text format',
    validateFile,
    parseFile,
}; 