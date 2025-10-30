import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
} from '../../types/common';
import {
    createProgress,
    createProcessedCell,
    validateFileExtension,
} from '../../utils/workflowHelpers';
import { XMLParser } from 'fast-xml-parser';

const SUPPORTED_EXTENSIONS = ['tmx', 'xliff', 'xlf'];

/**
 * Interface for TMX/XLIFF translation unit
 */
interface TranslationUnit {
    id: string;
    source: string;
    target: string;
    sourceLanguage: string;
    targetLanguage: string;
    note?: string;
}

/**
 * Validates a TMX/XLIFF file
 */
export const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .tmx, .xliff, or .xlf extension');
    }

    // Check file size (warn if > 50MB)
    if (file.size > 50 * 1024 * 1024) {
        warnings.push('Large files may take longer to process');
    }

    // Check if file is actually XML by reading the content
    try {
        const text = await file.text();

        if (text.trim().length === 0) {
            errors.push('File appears to be empty');
        }

        // Check for XML declaration and root elements
        const hasXmlDeclaration = text.trim().startsWith('<?xml');
        const hasTmxRoot = text.includes('<tmx') || text.includes('<TMX');
        const hasXliffRoot = text.includes('<xliff') || text.includes('<XLIFF');

        if (!hasXmlDeclaration) {
            warnings.push('File does not appear to have XML declaration');
        }

        if (!hasTmxRoot && !hasXliffRoot) {
            errors.push('File does not appear to be a valid TMX or XLIFF document');
        }

        // Check for translation units
        const hasTmxUnits = text.includes('<tu ') || text.includes('<tu>');
        const hasXliffUnits = text.includes('<trans-unit') || text.includes('<trans-unit>');
        if (!hasTmxUnits && !hasXliffUnits) {
            warnings.push('No translation units found in the file');
        }

    } catch (error) {
        errors.push('Could not read file content');
    }

    // Determine file type
    const fileName = file.name.toLowerCase();
    let fileType = 'tmx';
    if (fileName.endsWith('.xliff') || fileName.endsWith('.xlf')) {
        fileType = 'xliff';
    }

    return {
        isValid: errors.length === 0,
        fileType: fileType,
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
        },
    };
};

/**
 * Parses TMX/XLIFF content and extracts translation units
 */
const parseTranslationContent = (text: string): TranslationUnit[] => {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
        parseAttributeValue: true,
        trimValues: true,
        preserveOrder: false,
        allowBooleanAttributes: true,
        parseTagValue: false,
        processEntities: true,
    });

    try {
        const parsed = parser.parse(text);
        const translationUnits: TranslationUnit[] = [];

        // Navigate through the TMX/XLIFF structure
        const findTranslationUnits = (obj: any): void => {
            if (Array.isArray(obj)) {
                obj.forEach(findTranslationUnits);
            } else if (obj && typeof obj === 'object') {
                for (const [key, value] of Object.entries(obj)) {
                    if (key === 'tu' || key === 'translation-unit' || key === 'trans-unit') {
                        if (Array.isArray(value)) {
                            value.forEach(unit => processTranslationUnit(unit, translationUnits));
                        } else {
                            processTranslationUnit(value, translationUnits);
                        }
                    } else {
                        findTranslationUnits(value);
                    }
                }
            }
        };

        findTranslationUnits(parsed);
        console.log(`TMS Importer: Found ${translationUnits.length} translation units`);

        return translationUnits;
    } catch (error) {
        console.error('Error parsing translation content:', error);
        throw new Error('Failed to parse translation content');
    }
};

/**
 * Processes a single TMX/XLIFF translation unit
 */
const processTranslationUnit = (unit: any, units: TranslationUnit[]): void => {
    if (!unit || typeof unit !== 'object') return;

    const id = unit['@_tuid'] || unit['@_id'] || `unit-${units.length + 1}`;

    let source = '';
    let target = '';
    let sourceLanguage = '';
    let targetLanguage = '';
    let note = '';

    // Extract note from unit level
    if (unit.note) {
        note = typeof unit.note === 'string' ? unit.note : unit.note['#text'] || '';
    }

    // Check if this is XLIFF format (has direct source/target elements)
    if (unit.source && unit.target) {
        source = typeof unit.source === 'string' ? unit.source : unit.source['#text'] || '';
        target = typeof unit.target === 'string' ? unit.target : unit.target['#text'] || '';

        sourceLanguage = unit['@_source-language'] || 'source';
        targetLanguage = unit['@_target-language'] || 'target';
    }
    // Otherwise, handle TMX format (has tuv elements)
    else if (unit.tuv) {
        const tuvs = Array.isArray(unit.tuv) ? unit.tuv : [unit.tuv];
        const tuvData: { lang: string; text: string; }[] = [];

        // Collect all tuv data
        for (const tuv of tuvs) {
            const lang = tuv['@_xml:lang'] || tuv['@_lang'] || 'unknown';

            if (tuv.seg) {
                const segText = typeof tuv.seg === 'string' ? tuv.seg : tuv.seg['#text'] || '';
                tuvData.push({ lang, text: segText });
            }
        }

        // Sort by language to ensure consistent source/target assignment
        tuvData.sort((a, b) => a.lang.localeCompare(b.lang));

        if (tuvData.length >= 1) {
            sourceLanguage = tuvData[0].lang;
            source = tuvData[0].text;
        }

        if (tuvData.length >= 2) {
            targetLanguage = tuvData[1].lang;
            target = tuvData[1].text;
        }
    }

    if (source.trim()) {
        units.push({
            id,
            source: source.trim(),
            target: target.trim(),
            sourceLanguage,
            targetLanguage,
            note: note.trim() || undefined,
        });
    }
};

/**
 * Escapes HTML special characters
 */
const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

/**
 * Converts TMX/XLIFF translation units to simple codex cells
 */
const convertTranslationUnitsToCells = (
    units: TranslationUnit[],
    extractTarget: boolean = false
) => {
    console.log(`Converting ${units.length} translation units to cells (extractTarget: ${extractTarget})`);

    const cells = units.map((unit, index) => {
        // Use standard cell ID format to ensure all cells appear on the same page
        const cellId = `tms 1:${index + 1}`;
        const text = extractTarget ? unit.target : unit.source;
        const targetText = extractTarget ? unit.source : unit.target;

        const cleanText = text.trim();
        const cleanTargetText = targetText.trim();

        // Create HTML markup
        const htmlContent = `<p class="translation-unit" data-unit-id="${escapeHtml(unit.id)}" data-source-language="${escapeHtml(unit.sourceLanguage)}" data-target-language="${escapeHtml(unit.targetLanguage)}">${escapeHtml(cleanText)}</p>`;

        const cell = createProcessedCell(cellId, htmlContent, {
            originalText: cleanText,
            targetText: cleanTargetText,
            sourceLanguage: unit.sourceLanguage,
            targetLanguage: unit.targetLanguage,
            unitId: unit.id,
            note: unit.note,
            cellLabel: (index + 1).toString(),
            data: {
                segmentIndex: index,
                originalContent: cleanText,
                isTranslationUnit: true
            }
        });

        return cell;
    });

    console.log(`Created ${cells.length} cells`);
    return cells;
};

/**
 * Parses a TMX/XLIFF file and converts it to codex cells
 */
export const parseFile = async (
    file: File,
    onProgress?: ProgressCallback,
    extractTarget: boolean = false
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading translation file...', 10));

        const text = await file.text();

        // Store original file data for round-trip export
        const arrayBuffer = await file.arrayBuffer();

        // Determine file type for corpusMarker
        const fileName = file.name.toLowerCase();
        let fileType: 'tmx' | 'xliff' = 'tmx';
        if (fileName.endsWith('.xliff') || fileName.endsWith('.xlf')) {
            fileType = 'xliff';
        }
        const corpusMarker = fileType === 'tmx' ? 'tms-tmx' : 'tms-xliff';

        // Parse the translation content
        const translationUnits = parseTranslationContent(text);

        if (translationUnits.length === 0) {
            throw new Error('No translation units found in the file');
        }

        onProgress?.(createProgress('Converting', 'Converting to codex cells...', 60));

        // Convert translation units to cells
        const cells = convertTranslationUnitsToCells(translationUnits, extractTarget);

        onProgress?.(createProgress('Creating Notebooks', 'Creating notebooks...', 80));

        // Create codex cells (empty for translation or with target text if extractTarget)
        const codexCells = cells.map(sourceCell => {
            let codexContent = '';

            if (extractTarget && sourceCell.metadata?.targetText) {
                const unitId = sourceCell.metadata?.unitId || 'unknown';
                const targetLanguage = sourceCell.metadata?.targetLanguage || 'target';
                codexContent = `<p class="translation-unit" data-unit-id="${escapeHtml(unitId)}" data-language="${escapeHtml(targetLanguage)}">${escapeHtml(sourceCell.metadata.targetText)}</p>`;
            }

            // Create notebooks for each book
            const notebooks = [];

            for (const book of bibleStructure.allBooks) {
                const bookVerses = versesByBook.get(book.name);
                if (!bookVerses || bookVerses.length === 0) continue;

                const bookAbbrev = getBookAbbreviation(book.name);
                const testamentName = book.testament === 'old' ? 'Old Testament' : 'New Testament';
                const corpusMarker = book.testament === 'old' ? 'OT' : 'NT';

                // Create cells for this book
                const cells = bookVerses.map(verse => {
                    const cellId = `${bookAbbrev} ${verse.chapter}:${verse.verse}`;

                    // Clean the text
                    const cleanText = verse.text
                        .replace(/[\r\n]+/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();

                    // Clean target text if available
                    const cleanTargetText = verse.targetText
                        ? verse.targetText
                            .replace(/[\r\n]+/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim()
                        : '';

                    // Create HTML content using inline structure to keep verse text on same line as number
                    const verseContent = `<span class="verse" data-reference="${bookAbbrev} ${verse.chapter}:${verse.verse}">${escapeHtml(cleanText)}</span>`;

                    return createProcessedCell(cellId, verseContent, {
                        type: 'verse',
                        bookName: book.name,
                        bookCode: bookAbbrev,
                        chapter: verse.chapter,
                        verse: verse.verse,
                        testament: verse.testament,
                        corpusMarker: corpusMarker,
                        cellLabel: verse.verse.toString(),
                        originalText: cleanText,
                        targetText: cleanTargetText,
                    });
                });

                // Create codex cells (empty for translation or with target text)
                const codexCells = cells.map(sourceCell => {
                    const codexContent = extractTarget && sourceCell.metadata?.targetText
                        ? `<span class="verse" data-reference="${sourceCell.metadata?.bookCode} ${sourceCell.metadata?.chapter}:${sourceCell.metadata?.verse}">${escapeHtml(sourceCell.metadata?.targetText)}</span>`
                        : '';

                    return createProcessedCell(sourceCell.id, codexContent, {
                        ...sourceCell.metadata,
                        originalContent: sourceCell.content
                    });
                });

                // Create source notebook
                const sourceNotebook = {
                    name: bookAbbrev,
                    cells: cells,
                    metadata: {
                        id: `translation-source-${bookAbbrev}-${Date.now()}`,
                        originalFileName: file.name,
                        originalFileData: arrayBuffer, // Store original file for round-trip export
                        corpusMarker: corpusMarker, // tms-tmx or tms-xliff for round-trip
                        importerType: 'translation',
                        createdAt: new Date().toISOString(),
                        bookName: book.name,
                        bookCode: bookAbbrev,
                        testament: book.testament,
                        testamentName: testamentName,
                        bookNumber: book.number,
                        chapters: book.chapters,
                        verses: book.verses,
                        verseCount: cells.length,
                        chapterCount: book.chapters,
                        fileType: fileType, // Store file type for export
                    },
                };

                // Create codex notebook
                const codexNotebook = {
                    name: bookAbbrev,
                    cells: codexCells,
                    metadata: {
                        ...sourceNotebook.metadata,
                        id: `translation-codex-${bookAbbrev}-${Date.now()}`,
                        // Don't duplicate the original file data in codex
                        originalFileData: undefined,
                    },
                };

                notebooks.push({
                    source: sourceNotebook,
                    codex: codexNotebook,
                });
            }

            return {
                success: true,
                notebookPairs: notebooks,
                metadata: {
                    translationUnitCount: translationUnits.length,
                    hasTargets: !extractTarget,
                    sourceLanguage: translationUnits[0]?.sourceLanguage || '',
                    targetLanguage: translationUnits[0]?.targetLanguage || '',
                    fileSize: file.size,
                    booksCreated: notebooks.length,
                    oldTestamentBooks: notebooks.filter(n => n.source.metadata.testament === 'old').length,
                    newTestamentBooks: notebooks.filter(n => n.source.metadata.testament === 'new').length,
                },
            };
        } else {
            // Non-Bible translation import - create a single notebook
            const cells = convertTranslationUnitsToSimpleCells(translationUnits, extractTarget);

            // Create codex cells (empty for translation or with target text)
            const codexCells = cells.map(sourceCell => {
                let codexContent = '';

                if (extractTarget && sourceCell.metadata?.targetText) {
                    // Create HTML structure for non-Bible target text (no book/chapter/verse references)
                    const unitId = sourceCell.metadata?.unitId || 'unknown';
                    const targetLanguage = sourceCell.metadata?.targetLanguage || 'target';
                    codexContent = `<p class="translation-paragraph" data-unit-id="${unitId}" data-language="${targetLanguage}">${escapeHtml(sourceCell.metadata.targetText)}</p>`;
                }

                return createProcessedCell(sourceCell.id, codexContent, {
                    ...sourceCell.metadata,
                    originalContent: sourceCell.content
                });
            });
        });

        // Create source notebook
        const sourceNotebook = {
            name: file.name.replace(/\.(tmx|xliff|xlf)$/, ''),
            cells: cells,
            metadata: {
                id: `translation-source-${Date.now()}`,
                originalFileName: file.name,
                originalFileData: arrayBuffer, // Store original file for round-trip export
                corpusMarker: 'tms', // Use 'tms' for UI grouping, fileType stores the specific format
                importerType: 'tms', // Set to 'tms' for consistent grouping
                createdAt: new Date().toISOString(),
                translationUnitCount: translationUnits.length,
                sourceLanguage: translationUnits[0]?.sourceLanguage || '',
                targetLanguage: translationUnits[0]?.targetLanguage || '',
                fileType: fileType, // Store file type for export (tmx or xliff)
                fileFormat: corpusMarker, // Store original corpus marker for round-trip (tms-tmx or tms-xliff)
            },
        };

        // Create codex notebook
        const codexNotebook = {
            name: file.name.replace(/\.(tmx|xliff|xlf)$/, ''),
            cells: codexCells,
            metadata: {
                ...sourceNotebook.metadata,
                id: `translation-codex-${Date.now()}`,
                // Don't duplicate the original file data in codex
                originalFileData: undefined,
            },
        };

        onProgress?.(createProgress('Complete', 'Import complete!', 100));

        console.log(`TMS import complete: ${sourceNotebook.cells.length} cells created`);

        return {
            success: true,
            notebookPair: {
                source: sourceNotebook,
                codex: codexNotebook,
            },
            metadata: {
                translationUnitCount: translationUnits.length,
                hasTargets: !extractTarget,
                sourceLanguage: translationUnits[0]?.sourceLanguage || 'unknown',
                targetLanguage: translationUnits[0]?.targetLanguage || 'unknown',
                fileSize: file.size,
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Failed to process translation file', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

/**
 * TMX/XLIFF Importer Plugin
 */
export const translationImporter: ImporterPlugin = {
    name: 'Translation Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: ['application/xml', 'text/xml'],
    description: 'Imports TMX and XLIFF translation files with source and target text pairs',
    validateFile,
    parseFile,
};
