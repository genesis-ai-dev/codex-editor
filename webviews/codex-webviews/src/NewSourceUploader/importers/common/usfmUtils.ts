import {
    ProcessedCell,
    ProcessedNotebook,
    NotebookPair,
} from '../../types/common';
import {
    createProcessedCell,
} from '../../utils/workflowHelpers';
import { getCorpusMarkerForBook } from '../../utils/corpusUtils';
import {
    extractUsfmFootnotes,
    convertUsfmToHtmlWithFootnotes
} from '../../utils/usfmFootnoteExtractor';
import { parseUsfmToJson as parseUsfmWithRegex } from './regexUsfmParser';
import { convertUsfmInlineMarkersToHtml, usfmBlockToHtml, htmlInlineToUsfm, htmlBlockToUsfm } from './usfmHtmlMapper';
import { validateFootnotes } from '../../utils/footnoteUtils';
import { CodexCellTypes } from 'types/enums';

// Deprecated: dynamic import of usfm-grammar. Replaced by lightweight regex parser.
export const initializeUsfmGrammar = async () => { };

export interface UsfmContent {
    id: string;
    content: string;
    type: 'text' | 'paratext' | 'style';
    metadata: {
        bookCode?: string;
        bookName?: string;
        chapter?: number;
        verse?: number;
        originalText?: string;
        fileName?: string;
        hasFootnotes?: boolean;
        isChild?: boolean;
        parentId?: string;
    };
}

export interface ProcessedUsfmBook {
    bookCode: string;
    bookName?: string;
    fileName: string;
    cells: ProcessedCell[];
    verseCount: number;
    paratextCount: number;
    chapters: number[];
    usfmContent: UsfmContent[];
    footnoteCount: number;
    footnotes: any[];
    headerLines?: string[];
    rawHeader?: string;
}

/**
 * Validates basic USFM content structure
 */
export const validateUsfmContent = (content: string, fileName: string): { isValid: boolean; errors: string[]; warnings: string[]; } => {
    const errors: string[] = [];
    const warnings: string[] = [];

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

    return { isValid: errors.length === 0, errors, warnings };
};

/**
 * Processes a single USFM file into structured content
 */
export const processUsfmContent = async (
    content: string,
    fileName: string,
    bookNames: Record<string, string> = {}
): Promise<ProcessedUsfmBook> => {
    // Parse USFM using custom lightweight regex parser
    const jsonOutput = parseUsfmWithRegex(content);

    // Extract book information
    const bookCode = jsonOutput.book?.bookCode?.toUpperCase();
    if (!bookCode) {
        throw new Error(`No book code found in USFM file: ${fileName}`);
    }

    if (!/^[A-Z0-9]{3}$/.test(bookCode)) {
        throw new Error(`Invalid book code format: ${bookCode}. Expected a 3-character code like 'GEN' or 'MAT'`);
    }

    const bookName = bookNames[bookCode] || bookCode;
    const usfmContent: UsfmContent[] = [];
    const chapters = new Set<number>();
    const allFootnotes: any[] = [];

    // Extract footnotes from the raw content first
    const footnotes = extractUsfmFootnotes(content);

    // Validate footnotes
    const footnoteValidation = validateFootnotes(footnotes);
    if (!footnoteValidation.isValid) {
        console.warn('USFM footnote validation errors:', footnoteValidation.errors);
    }
    if (footnoteValidation.warnings.length > 0) {
        console.warn('USFM footnote validation warnings:', footnoteValidation.warnings);
    }

    // Process chapters and verses
    if (!jsonOutput.chapters || jsonOutput.chapters.length === 0) {
        throw new Error(`No chapters found in USFM file: ${fileName}`);
    }

    jsonOutput.chapters.forEach((chapter: any) => {
        const chapterNumber = chapter.chapterNumber;

        if (!chapterNumber) {
            throw new Error(`Invalid chapter format in ${fileName}: missing chapter number`);
        }

        chapters.add(chapterNumber);

        let seenFirstVerseInChapter = false;
        let paratextIndex = 0;
        chapter.contents.forEach((content: any) => {
            if (content.verseNumber !== undefined && content.verseText !== undefined) {
                // This is a verse - process it for footnotes
                const verseId = `${bookCode} ${chapterNumber}:${content.verseNumber}`;
                const verseText = content.verseText.trim();
                const htmlVerse = convertUsfmInlineMarkersToHtml(verseText);

                // Convert USFM to HTML with footnotes if needed
                const { html: processedText } = convertUsfmToHtmlWithFootnotes(verseText);

                usfmContent.push({
                    id: verseId,
                    content: processedText.replace(verseText, htmlVerse),
                    type: 'text',
                    metadata: {
                        bookCode,
                        bookName,
                        chapter: chapterNumber,
                        verse: content.verseNumber,
                        originalText: verseText,
                        fileName,
                        hasFootnotes: processedText.includes('footnote-marker'),
                    },
                });

                // Create child cells for milestone spans (e.g., qt, ts)
                try {
                    const milestoneTags = new Set(['qt', 'ts']);
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(`<div>${htmlVerse}</div>`, 'text/html');
                    const container = doc.body.firstElementChild as HTMLElement | null;
                    if (container) {
                        const walker = (node: Node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const el = node as HTMLElement;
                                const tag = el.getAttribute('data-tag');
                                if (tag && milestoneTags.has(tag)) {
                                    const childId = `${verseId}:${Math.random().toString(36).slice(2, 11)}`;
                                    const innerHtml = el.innerHTML;
                                    usfmContent.push({
                                        id: childId,
                                        content: innerHtml,
                                        type: 'text',
                                        metadata: {
                                            bookCode,
                                            bookName,
                                            chapter: chapterNumber,
                                            verse: content.verseNumber,
                                            originalText: innerHtml,
                                            fileName,
                                            hasFootnotes: false,
                                            isChild: true,
                                            parentId: verseId,
                                        },
                                    });
                                }
                                Array.from(el.childNodes).forEach(walker);
                            }
                        };
                        Array.from(container.childNodes).forEach(walker);
                    }
                } catch {
                    // ignore child extraction errors
                }

                seenFirstVerseInChapter = true;
            } else if (content.text && !content.marker) {
                // This is paratext (content without specific markers)
                const paratextId = `${bookCode} ${chapterNumber}:paratext-${paratextIndex++}`;
                const paratextContent = content.text.trim();
                const htmlParatext = paratextContent.length > 0 ? `<p data-tag="p">${convertUsfmInlineMarkersToHtml(paratextContent)}</p>` : paratextContent;

                // Convert USFM to HTML with footnotes if needed
                const { html: processedText } = convertUsfmToHtmlWithFootnotes(paratextContent);

                // Determine if this is a style-only cell (no text content)
                let cellType: UsfmContent['type'] = 'paratext';
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlParatext || '', 'text/html');
                    const el = doc.body.firstElementChild as HTMLElement | null;
                    const textOnly = el ? (el.textContent || '').trim() : (htmlParatext || '').trim();
                    if (!textOnly) cellType = 'style';
                } catch {
                    // ignore DOM parsing errors for style detection
                }

                usfmContent.push({
                    id: paratextId,
                    content: processedText.replace(paratextContent, htmlParatext),
                    type: cellType,
                    metadata: {
                        bookCode,
                        bookName,
                        chapter: chapterNumber,
                        originalText: paratextContent,
                        fileName,
                        hasFootnotes: processedText.includes('footnote-marker'),
                    },
                });
            } else if (content.marker) {
                // Preserve raw marker lines as paratext for round-trip fidelity
                const paratextId = `${bookCode} ${chapterNumber}:paratext-${paratextIndex++}`;
                const markerLine = String(content.marker).trim();
                const htmlBlock = usfmBlockToHtml(markerLine);
                // Determine if style-only (no inner text)
                let cellType: UsfmContent['type'] = 'paratext';
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlBlock, 'text/html');
                    const el = doc.body.firstElementChild as HTMLElement | null;
                    const textOnly = el ? (el.textContent || '').trim() : '';
                    if (!textOnly) cellType = 'style';
                } catch {
                    // ignore DOM parsing errors for style detection
                }

                usfmContent.push({
                    id: paratextId,
                    content: htmlBlock,
                    type: cellType,
                    metadata: {
                        bookCode,
                        bookName,
                        chapter: chapterNumber,
                        originalText: markerLine,
                        fileName,
                        hasFootnotes: false,
                    },
                });
            }
        });
    });

    if (usfmContent.length === 0) {
        throw new Error(`No verses or content found in USFM file: ${fileName}`);
    }

    // Convert to processed cells
    const cells = usfmContent.map((item) => {
        // Map string type to CodexCellTypes enum
        const cellType = item.type === 'text' ? CodexCellTypes.TEXT :
            item.type === 'paratext' ? CodexCellTypes.PARATEXT :
                CodexCellTypes.STYLE;
        return createProcessedCell(item.id, item.content, {
            type: cellType,
            bookCode: item.metadata.bookCode,
            bookName: item.metadata.bookName,
            chapter: item.metadata.chapter,
            verse: item.metadata.verse,
            cellLabel: item.metadata.verse !== undefined ? item.metadata.verse?.toString() : undefined,
            originalText: item.metadata.originalText,
            fileName: item.metadata.fileName,
        } as any);
    });

    return {
        bookCode,
        bookName,
        fileName,
        cells,
        verseCount: usfmContent.filter(c => c.metadata.verse !== undefined).length,
        paratextCount: usfmContent.filter(c => c.type === 'paratext').length,
        chapters: Array.from(chapters).sort((a, b) => a - b),
        usfmContent,
        footnoteCount: footnotes.length,
        footnotes,
        headerLines: jsonOutput.headerLines,
        rawHeader: (jsonOutput as any).rawHeader,
    };
};

/**
 * Reconstruct USFM text from processed content (codex notebook intermediate).
 * Preserves order, adds chapter markers where chapter changes, and preserves
 * marker lines that were captured as paratext content.
 */
export const exportToUSFM = (processed: ProcessedUsfmBook): string => {
    const lines: string[] = [];
    const bookCode = processed.bookCode.toUpperCase();
    if (processed.rawHeader && processed.rawHeader.length > 0) {
        lines.push(processed.rawHeader);
    } else if (processed.headerLines && processed.headerLines.length > 0) {
        for (const h of processed.headerLines) lines.push(h);
    } else {
        lines.push(`\\id ${bookCode}`);
        lines.push('\\usfm 3.0');
    }

    let currentChapter: number | null = null;
    for (const item of processed.usfmContent) {
        const ch = item.metadata.chapter;
        if (typeof ch === 'number' && ch !== currentChapter) {
            currentChapter = ch;
            lines.push(`\\c ${currentChapter}`);
        }

        if (item.type === 'text' && typeof item.metadata.verse !== 'undefined') {
            const verseNum = item.metadata.verse;
            // Convert HTML content back to USFM inline
            const htmlContent = item.content ?? '';
            const inlineUsfm = htmlInlineToUsfm(htmlContent);
            lines.push(`\\v ${verseNum} ${inlineUsfm}`);
        } else if (item.type === 'paratext' || item.type === 'text' || item.type === 'style') {
            const content = (item.content ?? '').trim();
            if (content.length === 0) continue;
            // If content is an HTML block with data-tag, convert to USFM paragraph line
            if (content.startsWith('<')) {
                lines.push(htmlBlockToUsfm(content));
            } else {
                // Fallback: treat as plain paragraph text
                const inlineUsfm = htmlInlineToUsfm(content);
                lines.push(`\\p ${inlineUsfm}`);
            }
        }
    }

    return lines.join('\n');
};

/**
 * Creates a notebook pair from processed USFM content
 */
export const createNotebookPair = (
    baseName: string,
    cells: ProcessedCell[],
    importerType: string,
    metadata: Record<string, any> = {}
): NotebookPair => {
    // Validate baseName to prevent empty filenames
    if (!baseName || baseName.trim() === '') {
        throw new Error('Notebook name cannot be empty');
    }

    const sourceNotebook: ProcessedNotebook = {
        name: baseName,
        cells,
        metadata: {
            ...metadata,
            id: `${importerType}-source-${Date.now()}`,
            originalFileName: baseName,
            importerType,
            createdAt: new Date().toISOString(),
            corpusMarker: getCorpusMarkerForBook(baseName) || metadata.corpusMarker,
        },
    };

    const codexCells = cells.map(sourceCell => {
        const isStyleCell = sourceCell.metadata?.type === 'style';
        return {
            id: sourceCell.id,
            content: isStyleCell ? sourceCell.content : '',
            images: sourceCell.images,
            metadata: sourceCell.metadata,
        };
    });

    const codexNotebook: ProcessedNotebook = {
        name: baseName,
        cells: codexCells,
        metadata: {
            ...sourceNotebook.metadata,
            id: `${importerType}-codex-${Date.now()}`,
        },
    };

    return {
        source: sourceNotebook,
        codex: codexNotebook,
    };
};

/**
 * Parses XML book names file to extract book name mappings
 */
export const parseBookNamesXml = (xmlContent: string): Record<string, string> => {
    const bookNames: Record<string, string> = {};

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
 * Extract project metadata from Paratext Settings.xml
 */
export const parseSettingsXml = (xmlContent: string): Partial<any> => {
    const metadata: any = {
        projectName: '',
        language: '',
        languageCode: '',
        projectType: 'standard',
        versification: 'Original',
        encoding: 'UTF-8',
        // Enhanced fields for file naming and project structure
        abbreviation: '',
        languageIsoCode: '',
        fileNamingPattern: null,
        bookOrderingScheme: null,
        versificationScheme: 'Original',
        projectSettings: {},
    };

    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

        // Check for parsing errors
        const errorNode = xmlDoc.getElementsByTagName('parsererror')[0];
        if (errorNode) {
            console.warn('XML parsing error in settings file:', errorNode.textContent);
            return metadata;
        }

        // Extract various settings
        const settings = xmlDoc.getElementsByTagName('ScriptureText')[0];
        if (settings) {
            // Get text from various settings elements
            const getElementText = (tagName: string) => {
                const element = settings.getElementsByTagName(tagName)[0];
                return element?.textContent?.trim() || '';
            };

            // Basic project information
            metadata.projectName = getElementText('Name') || getElementText('FullName');
            metadata.language = getElementText('Language');
            metadata.languageCode = getElementText('LanguageIsoCode');
            metadata.languageIsoCode = getElementText('LanguageIsoCode'); // Keep both for compatibility
            metadata.projectType = getElementText('TranslationType') || 'standard';
            metadata.versification = getElementText('Versification') || 'Original';
            metadata.versificationScheme = getElementText('Versification') || 'Original';
            metadata.encoding = getElementText('Encoding') || 'UTF-8';
            metadata.abbreviation = getElementText('Abbreviation');
            metadata.description = getElementText('Description');
            metadata.copyright = getElementText('Copyright');
            metadata.customVersification = getElementText('CustomVersification');

            // Additional project settings that might affect file naming
            metadata.projectSettings = {
                biblicalTermsListType: getElementText('BiblicalTermsListType'),
                transliteration: getElementText('Transliteration'),
                scriptDirection: getElementText('ScriptDirection'),
                guidID: getElementText('Guid'),
                baseTranslation: getElementText('BaseTranslation'),
                defaultFont: getElementText('DefaultFont'),
                defaultFontSize: getElementText('DefaultFontSize'),
                rightToLeft: getElementText('RightToLeft') === 'true',
                numberFormat: getElementText('NumberFormat'),
                punctuationRules: getElementText('PunctuationRules'),
            };

            // Try to extract or infer file naming pattern
            // Look for file naming related settings or patterns
            const fileNamingInfo = inferFileNamingPattern(metadata);
            metadata.fileNamingPattern = fileNamingInfo;
        }

    } catch (error) {
        console.warn('Error parsing settings XML:', error);
    }

    return metadata;
};

/**
 * Infer file naming pattern from project metadata
 */
const inferFileNamingPattern = (metadata: any): any => {
    const pattern = {
        hasOrder: true, // Most Paratext projects use 2-digit book order
        orderLength: 2,
        hasBookCode: true,
        bookCodeLength: 3,
        hasLanguageCode: true,
        languageCode: metadata.languageIsoCode || metadata.languageCode || '',
        hasProjectAbbrev: true,
        projectAbbrev: metadata.abbreviation || '',
        hasYear: false, // Will be detected from actual files
        year: null as number | null,
        prefix: '', // Any prefix before the pattern
        suffix: '', // Any suffix after the pattern
        extension: 'SFM', // Default, can be SFM or USFM
        predictedPattern: '' as string, // Added to fix type error
    };

    // If we have language code and abbreviation, we can predict the pattern
    if (metadata.languageIsoCode && metadata.abbreviation) {
        // Pattern likely: {order}{bookCode}{langCode}[prefix]{projectAbbrev}[year].{ext}
        // Example: 01GENarONAV12.SFM
        pattern.predictedPattern = `{order}{bookCode}{langCode}[O]{projectAbbrev}[year].{ext}`;
    }

    return pattern;
};

/**
 * Parse filename using project settings to extract book information
 */
export const parseParatextFilename = (filename: string, projectMetadata: any): any => {
    const result = {
        isValid: false,
        bookOrder: null as number | null,
        bookCode: null as string | null,
        languageCode: null as string | null,
        projectAbbrev: null as string | null,
        year: null as number | null,
        extension: null as string | null,
        originalFilename: filename,
    };

    try {
        // Remove path and get just the filename
        const baseFilename = filename.split('/').pop() || filename;

        // Split filename and extension
        const parts = baseFilename.split('.');
        if (parts.length < 2) return result;

        result.extension = parts[parts.length - 1].toUpperCase();
        const nameWithoutExt = parts.slice(0, -1).join('.');

        // Check if it's likely a USFM file
        if (!['SFM', 'USFM'].includes(result.extension)) {
            return result;
        }

        // Try to parse based on common Paratext patterns
        // Pattern 1: {order}{bookCode}{langCode}[prefix]{projectAbbrev}[year]
        // Example: 01GENarONAV12, 02EXOarONAV12

        const pattern1 = /^(\d{1,2})([A-Z0-9]{3})([a-z]{2,3})(.*)$/;
        const match1 = nameWithoutExt.match(pattern1);

        if (match1) {
            result.bookOrder = parseInt(match1[1], 10);
            result.bookCode = match1[2];
            result.languageCode = match1[3];

            // Parse the remaining part for project abbreviation and year
            const remaining = match1[4];

            // Look for project abbreviation and year in the remaining part
            if (projectMetadata?.abbreviation) {
                const abbrev = projectMetadata.abbreviation;
                const abbrevIndex = remaining.indexOf(abbrev);
                if (abbrevIndex >= 0) {
                    result.projectAbbrev = abbrev;

                    // Check for year after abbreviation
                    const afterAbbrev = remaining.substring(abbrevIndex + abbrev.length);
                    const yearMatch = afterAbbrev.match(/(\d{2,4})/);
                    if (yearMatch) {
                        result.year = parseInt(yearMatch[1], 10);
                        // Convert 2-digit years to 4-digit (assuming 2000s)
                        if (result.year && result.year < 100) {
                            result.year += 2000;
                        }
                    }
                }
            }

            result.isValid = true;
        }

        // Pattern 2: Simple pattern with just book code
        // Example: GEN.SFM, MAT.USFM
        if (!result.isValid) {
            const pattern2 = /^([A-Z0-9]{3})$/;
            const match2 = nameWithoutExt.match(pattern2);
            if (match2) {
                result.bookCode = match2[1];
                result.isValid = true;
            }
        }

    } catch (error) {
        console.warn('Error parsing Paratext filename:', filename, error);
    }

    return result;
};

/**
 * Get book order from book code using standard biblical order
 */
export const getBookOrder = (bookCode: string): number => {
    const bookOrder: Record<string, number> = {
        // Old Testament
        'GEN': 1, 'EXO': 2, 'LEV': 3, 'NUM': 4, 'DEU': 5, 'JOS': 6, 'JDG': 7, 'RUT': 8,
        '1SA': 9, '2SA': 10, '1KI': 11, '2KI': 12, '1CH': 13, '2CH': 14, 'EZR': 15, 'NEH': 16,
        'EST': 17, 'JOB': 18, 'PSA': 19, 'PRO': 20, 'ECC': 21, 'SNG': 22, 'ISA': 23, 'JER': 24,
        'LAM': 25, 'EZK': 26, 'DAN': 27, 'HOS': 28, 'JOL': 29, 'AMO': 30, 'OBA': 31, 'JON': 32,
        'MIC': 33, 'NAM': 34, 'HAB': 35, 'ZEP': 36, 'HAG': 37, 'ZEC': 38, 'MAL': 39,

        // New Testament
        'MAT': 40, 'MRK': 41, 'LUK': 42, 'JHN': 43, 'ACT': 44, 'ROM': 45, '1CO': 46, '2CO': 47,
        'GAL': 48, 'EPH': 49, 'PHP': 50, 'COL': 51, '1TH': 52, '2TH': 53, '1TI': 54, '2TI': 55,
        'TIT': 56, 'PHM': 57, 'HEB': 58, 'JAS': 59, '1PE': 60, '2PE': 61, '1JN': 62, '2JN': 63,
        '3JN': 64, 'JUD': 65, 'REV': 66,
    };

    return bookOrder[bookCode.toUpperCase()] || 999;
}; 