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
    addMilestoneCellsToNotebookPair,
} from '../../utils/workflowHelpers';
import { extractImagesFromHtml } from '../../utils/imageProcessor';
import { createPdfCellMetadata } from './cellMetadata';
// Extraction is delegated to the extension host to avoid webview worker/CSP issues

const SUPPORTED_EXTENSIONS = ['pdf'];

/**
 * Splits PDF text content into intelligently-sized chunks.
 * Uses paragraph breaks, line breaks, and sentence boundaries to create manageable segments.
 * Target chunk size: ~200-400 characters (adjustable via MAX_CHUNK_SIZE).
 */
function splitPdfContentIntoSegments(content: string): string[] {
    if (!content || content.trim().length === 0) {
        return [];
    }

    // Maximum chunk size in characters (chunks larger than this will be split further)
    const MAX_CHUNK_SIZE = 400;
    // Minimum chunk size - very short chunks will be merged with next chunk
    const MIN_CHUNK_SIZE = 50;

    // First, clean the content and remove HTML tags
    let cleanedContent = content.replace(/<[^>]*>/g, ' ');
    cleanedContent = cleanedContent.replace(/\s+/g, ' ').trim();

    // Split into initial segments using natural breaks
    let initialSegments: string[] = [];

    // Check for HTML paragraph/break tags first
    const htmlParagraphPattern = /<\/p>|<\/div>|<\/h[1-6]>|<\/li>/gi;
    const htmlLineBreakPattern = /<br\s*\/?>/gi;
    const hasHtmlParagraphs = htmlParagraphPattern.test(content);
    htmlParagraphPattern.lastIndex = 0;

    if (hasHtmlParagraphs) {
        // Split on HTML paragraph-level breaks
        initialSegments = content.split(htmlParagraphPattern);
    } else {
        // Check for newlines
        const hasNewlines = /[\r\n]/.test(content);

        if (hasNewlines) {
            // First try double newlines (paragraph breaks)
            const doubleNewlineParts = content.split(/\n\s*\n|\r\n\s*\r\n/);

            if (doubleNewlineParts.length > 1) {
                initialSegments = doubleNewlineParts;
            } else {
                // No double newlines - split on single newlines
                initialSegments = content.split(/[\r\n]+/);
            }
        } else {
            // Check for HTML line breaks
            const hasHtmlBreaks = htmlLineBreakPattern.test(content);
            htmlLineBreakPattern.lastIndex = 0;
            if (hasHtmlBreaks) {
                initialSegments = content.split(htmlLineBreakPattern);
            } else {
                // No breaks found - start with whole content
                initialSegments = [content];
            }
        }
    }

    // Clean initial segments
    let segments = initialSegments
        .map(part => {
            let cleaned = part.replace(/<[^>]*>/g, ' ');
            cleaned = cleaned.replace(/[\r\n]+/g, ' ');
            cleaned = cleaned.replace(/\s+/g, ' ');
            return cleaned.trim();
        })
        .filter(segment => segment.length > 0);

    // If no segments found, use cleaned content
    if (segments.length === 0) {
        if (cleanedContent.length > 0) {
            segments = [cleanedContent];
        } else {
            return [];
        }
    }

    // Now intelligently split large segments and merge small ones
    const finalSegments: string[] = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        // If segment is too large, split it into sentences
        if (segment.length > MAX_CHUNK_SIZE) {
            const sentenceSegments = splitIntoSentences(segment);

            // Further split sentences if they're still too large
            for (const sentence of sentenceSegments) {
                if (sentence.length > MAX_CHUNK_SIZE) {
                    // Split very long sentences at commas or semicolons
                    const subSegments = splitLongText(sentence, MAX_CHUNK_SIZE);
                    finalSegments.push(...subSegments);
                } else {
                    finalSegments.push(sentence);
                }
            }
        } else {
            // Check if we should merge with previous segment if it's too small
            if (segment.length < MIN_CHUNK_SIZE && finalSegments.length > 0) {
                const lastSegment = finalSegments[finalSegments.length - 1];
                // Merge if combined size is reasonable
                if (lastSegment.length + segment.length <= MAX_CHUNK_SIZE * 1.5) {
                    finalSegments[finalSegments.length - 1] = `${lastSegment} ${segment}`;
                } else {
                    finalSegments.push(segment);
                }
            } else {
                finalSegments.push(segment);
            }
        }
    }

    // Post-process: Merge single-letter abbreviations (like "O.", "T.") with adjacent segments
    const mergedSegments: string[] = [];
    for (let i = 0; i < finalSegments.length; i++) {
        const segment = finalSegments[i];
        const trimmed = segment.trim();

        // Check if this is a single letter followed by period (like "O.", "T.", "A.")
        const isSingleLetterAbbr = /^[A-Z]\.\s*$/.test(trimmed);

        if (isSingleLetterAbbr) {
            // Check if next segment is also a single-letter abbreviation (like "O. T.")
            const nextSegment = i + 1 < finalSegments.length ? finalSegments[i + 1].trim() : '';
            const nextIsSingleLetterAbbr = /^[A-Z]\.\s*$/.test(nextSegment);

            if (mergedSegments.length > 0) {
                // Merge with previous segment
                if (nextIsSingleLetterAbbr) {
                    // Merge both single-letter abbreviations with previous segment
                    mergedSegments[mergedSegments.length - 1] = `${mergedSegments[mergedSegments.length - 1]} ${trimmed} ${nextSegment}`;
                    i++; // Skip next segment since we merged it
                } else {
                    // Merge just this one with previous segment
                    mergedSegments[mergedSegments.length - 1] = `${mergedSegments[mergedSegments.length - 1]} ${trimmed}`;
                }
            } else if (nextIsSingleLetterAbbr) {
                // Both are single-letter abbreviations - merge them together
                mergedSegments.push(`${trimmed} ${nextSegment}`);
                i++; // Skip next segment since we merged it
            } else if (i + 1 < finalSegments.length) {
                // Merge with next segment
                mergedSegments.push(`${trimmed} ${finalSegments[i + 1]}`);
                i++; // Skip next segment since we merged it
            } else {
                // Last segment and it's a single letter - merge with previous if exists
                if (mergedSegments.length > 0) {
                    mergedSegments[mergedSegments.length - 1] = `${mergedSegments[mergedSegments.length - 1]} ${trimmed}`;
                } else {
                    // No previous segment, just add it (shouldn't happen but handle gracefully)
                    mergedSegments.push(segment);
                }
            }
        } else {
            mergedSegments.push(segment);
        }
    }

    return mergedSegments.filter(s => s.trim().length > 0);
}

/**
 * Splits very long text at natural break points (commas, semicolons, etc.)
 */
function splitLongText(text: string, maxSize: number): string[] {
    const segments: string[] = [];
    let currentSegment = '';

    // Split by commas, semicolons, or colons first
    const parts = text.split(/([,;:])\s+/);

    for (let i = 0; i < parts.length; i += 2) {
        const part = parts[i];
        const punctuation = i + 1 < parts.length ? parts[i + 1] : '';

        const testSegment = currentSegment
            ? `${currentSegment}${punctuation} ${part}`
            : part;

        if (testSegment.length > maxSize && currentSegment) {
            // Current segment is full, start a new one
            segments.push(currentSegment.trim());
            currentSegment = part;
        } else {
            currentSegment = testSegment;
        }
    }

    if (currentSegment.trim().length > 0) {
        segments.push(currentSegment.trim());
    }

    // If still too long, split by spaces (last resort)
    const finalSegments: string[] = [];
    for (const seg of segments) {
        if (seg.length > maxSize) {
            const words = seg.split(/\s+/);
            let current = '';
            for (const word of words) {
                if ((current + ' ' + word).length > maxSize && current) {
                    finalSegments.push(current.trim());
                    current = word;
                } else {
                    current = current ? `${current} ${word}` : word;
                }
            }
            if (current.trim().length > 0) {
                finalSegments.push(current.trim());
            }
        } else {
            finalSegments.push(seg);
        }
    }

    return finalSegments.length > 0 ? finalSegments : [text];
}

/**
 * Fallback: Splits text into sentences intelligently.
 * Only used when PDF has no newlines or HTML breaks.
 */
function splitIntoSentences(text: string): string[] {
    // Common abbreviations that shouldn't trigger sentence breaks
    const abbreviations = new Set([
        'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'sr', 'jr', 'fr',
        'vs', 'etc', 'viz', 'i.e', 'e.g', 'a.m', 'p.m', 'am', 'pm',
        'inc', 'ltd', 'corp', 'co', 'st', 'ave', 'blvd', 'rd', 'ct',
        'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
        'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
        'vol', 'no', 'pp', 'ch', 'sec', 'fig', 'p', 'pp',
        'ed', 'eds', 'trans', 'cf', 'ibid', 'op', 'cit',
    ]);

    /**
     * Checks if a punctuation mark is a real sentence ending
     */
    function isSentenceEnding(text: string, index: number): boolean {
        const char = text[index];
        if (char !== '.' && char !== '!' && char !== '?') {
            return false;
        }

        // Look at what comes before
        const beforeText = text.substring(Math.max(0, index - 20), index).trim();
        const lastWord = beforeText.split(/\s+/).pop() || '';
        const lastWordClean = lastWord.toLowerCase().replace(/[^\w]/g, '');

        // Check for decimal numbers (digit before period)
        if (/\d$/.test(beforeText)) {
            return false;
        }

        // Check for common abbreviations
        if (lastWordClean && abbreviations.has(lastWordClean)) {
            return false;
        }

        // Check for single letter initials (A. B. Smith, Heath A. Thomas, O. T., etc.)
        // Pattern: single capital letter followed by period
        if (/^[A-Z]\.$/.test(lastWord)) {
            return false;
        }

        // Check if the character immediately before the period is a single capital letter
        // This catches cases like "Heath A. Thomas" where "A." is an initial
        // Also catches standalone cases like "O." and "T." at start of line or after space
        if (index > 0 && text[index - 1]) {
            const charBefore = text[index - 1];
            // Check if it's a capital letter
            if (/[A-Z]/.test(charBefore)) {
                // Check the context: look at 2-3 characters before to see if there's a space
                // This helps identify standalone initials like "A." in "Heath A. Thomas"
                const contextStart = Math.max(0, index - 3);
                const contextBefore = text.substring(contextStart, index - 1);

                // If there's a space before the capital letter (or it's at start), it's likely an initial
                if (contextBefore === '' || /\s$/.test(contextBefore)) {
                    // Check what comes after the period
                    const afterText = text.substring(index + 1);
                    // If followed by space and another capital letter, it's likely "A. Thomas" pattern
                    const afterMatch = afterText.match(/^\s+([A-Z])/);
                    if (afterMatch) {
                        // This is an initial in a name - don't split
                        return false;
                    }
                    // Also check if it's followed by space and lowercase (like "O. Testament" -> "O.T.")
                    // or if it's at the end of text (standalone initial)
                    // In these cases, don't split - let the post-processing merge handle it
                    const afterSpaceMatch = afterText.match(/^\s+/);
                    if (afterSpaceMatch || index === text.length - 1) {
                        // Likely a standalone initial - don't split here
                        return false;
                    }
                }
            }
        }

        // Check for ellipsis (multiple periods)
        if (index + 1 < text.length && text[index + 1] === '.') {
            return false;
        }

        // Look at what comes after
        const afterMatch = text.substring(index + 1).match(/^\s*(\S)/);
        const nextChar = afterMatch ? afterMatch[1] : null;

        // Sentence ending if followed by capital letter or end of text
        return !nextChar || /[A-Z]/.test(nextChar) || index === text.length - 1;
    }

    const sentences: string[] = [];
    let currentSentence = '';
    let i = 0;

    while (i < text.length) {
        const char = text[i];
        currentSentence += char;

        if (isSentenceEnding(text, i)) {
            const sentence = currentSentence.trim();
            if (sentence.length > 0) {
                sentences.push(sentence);
            }
            currentSentence = '';
            i++;
            // Skip whitespace after punctuation
            while (i < text.length && /\s/.test(text[i])) {
                i++;
            }
            continue;
        }

        i++;
    }

    // Add remaining text
    if (currentSentence.trim().length > 0) {
        sentences.push(currentSentence.trim());
    }

    return sentences.length > 0 ? sentences : [text];
}

/**
 * Validates a PDF file
 */
export const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .pdf extension');
    }

    // Check file size (warn if > 50MB)
    if (file.size > 50 * 1024 * 1024) {
        warnings.push('Large files may take longer to process');
    }

    // Check if file is actually a PDF by reading the magic bytes
    try {
        const buffer = await file.slice(0, 4).arrayBuffer();
        const uint8Array = new Uint8Array(buffer);

        // PDF files start with %PDF
        const pdfSignature = new TextDecoder().decode(uint8Array);
        if (!pdfSignature.startsWith('%PDF')) {
            errors.push('File does not appear to be a valid PDF document');
        }
    } catch (error) {
        warnings.push('Could not verify file format');
    }

    return {
        isValid: errors.length === 0,
        fileType: 'pdf',
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
        },
    };
};

/**
 * Parses a PDF file for non-Bible text content
 */
export const parseFile = async (
    file: File,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading PDF file...', 10));

        // Read file as ArrayBuffer to store original for round-trip export
        const arrayBuffer = await file.arrayBuffer();

        onProgress?.(createProgress('Extracting Text', 'Extracting text from PDF...', 30));

        const textContent = await extractTextViaExtension(file);

        onProgress?.(createProgress('Processing Content', 'Processing extracted text...', 50));

        // Split content by paragraphs (double newlines) and HTML breaks
        // PDFs preserve paragraph breaks which represent natural text units
        // Falls back to sentence splitting only if no paragraph breaks are found
        const segments = splitPdfContentIntoSegments(textContent);

        // Validate that we have segments
        if (!segments || segments.length === 0) {
            throw new Error('No content segments found in PDF. The PDF may be empty or contain only images.');
        }

        // Log for debugging
        console.log(`[PDF Importer] Split PDF into ${segments.length} segments`);

        onProgress?.(createProgress('Creating Cells', 'Creating cells from text segments...', 70));

        // Filter out empty segments and create cells
        const validSegments = segments.filter(segment => segment && segment.trim().length > 0);

        if (validSegments.length === 0) {
            throw new Error('No valid content segments found in PDF after filtering.');
        }

        // Create cells for each segment
        const cells = await Promise.all(
            validSegments.map(async (segment, index) => {
                // Ensure we have valid content
                const cleanText = segment
                    .replace(/[\r\n]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (!cleanText || cleanText.length === 0) {
                    console.warn(`[PDF Importer] Skipping empty segment at index ${index}`);
                    return null;
                }

                // Create cell metadata (generates UUID internally)
                const { cellId, metadata: cellMetadata } = createPdfCellMetadata({
                    originalContent: segment,
                    cellLabel: (index + 1).toString(),
                    segmentIndex: index,
                    fileName: file.name,
                    fileSize: file.size,
                });

                // Get cleaned text from metadata
                const cleanedText = cellMetadata.originalText || cleanText;

                // Create HTML content with paragraph semantics
                const htmlContent = `<div class="pdf-paragraph" data-paragraph-index="${index + 1}">
                    <p>${escapeHtml(cleanedText)}</p>
                </div>`;

                const cell = createProcessedCell(cellId, htmlContent, {
                    type: 'text',
                    ...cellMetadata,
                } as any);

                // Extract and process images from this cell (if any)
                const images = await extractImagesFromHtml(htmlContent);
                cell.images = images;

                return cell;
            })
        );

        // Filter out any null cells (from empty segments)
        const validCells = cells.filter((cell): cell is NonNullable<typeof cell> => cell !== null);

        if (validCells.length === 0) {
            throw new Error('No valid cells created from PDF content. All segments were empty.');
        }

        onProgress?.(createProgress('Creating Notebooks', 'Creating source and codex notebooks...', 90));

        // Create source notebook
        const sourceNotebook = {
            name: sanitizeFileName(file.name),
            cells: validCells,
            metadata: {
                id: `pdf-${Date.now()}`,
                originalFileName: file.name,
                originalFileData: arrayBuffer, // Store original PDF for round-trip export
                corpusMarker: 'pdf',
                importerType: 'pdf', // Alias for corpusMarker (type requirement)
                createdAt: new Date().toISOString(),
                importContext: {
                    importerType: 'pdf',
                    fileName: file.name,
                    originalFileName: file.name,
                    fileSize: file.size,
                    importTimestamp: new Date().toISOString(),
                },
                sourceFile: file.name,
                totalCells: cells.length,
                fileType: 'pdf',
                importDate: new Date().toISOString(),

                // Segmentation info
                segmentationType: 'sentences',

                // Round-trip metadata
                pdfDocumentMetadata: {
                    originalFileName: file.name,
                    fileSize: file.size,
                    totalSentences: cells.length,
                    importerVersion: '1.0.0',

                    // Placeholder for future PDF metadata enhancements
                    totalPages: undefined, // Will be populated when available
                    pdfVersion: undefined,
                    author: undefined,
                    title: undefined,
                    creationDate: undefined,
                },
            }
        };

        // Create codex notebook (empty for translation)
        const codexNotebook = {
            name: `${sanitizeFileName(file.name)}`,
            cells: validCells.map(sourceCell =>
                createProcessedCell(sourceCell.id, '', {
                    ...sourceCell.metadata,
                    originalContent: sourceCell.content
                })
            ),
            metadata: {
                id: `pdf-codex-${Date.now()}`,
                originalFileName: file.name,
                // Don't duplicate the original file data in codex
                originalFileData: undefined,
                corpusMarker: 'pdf',
                importerType: 'pdf', // Alias for corpusMarker (type requirement)
                createdAt: new Date().toISOString(),
                importContext: {
                    importerType: 'pdf',
                    fileName: file.name,
                    originalFileName: file.name,
                    fileSize: file.size,
                    importTimestamp: new Date().toISOString(),
                },
                sourceFile: file.name,
                totalCells: cells.length,
                fileType: 'pdf',
                importDate: new Date().toISOString(),
                isCodex: true,

                // Segmentation info
                segmentationType: 'sentences',

                // Link to source metadata for round-trip
                sourceMetadata: sourceNotebook.metadata,
            }
        };

        // Add milestone cells to the notebook pair
        const notebookPairWithMilestones = addMilestoneCellsToNotebookPair({
            source: sourceNotebook,
            codex: codexNotebook,
        });

        onProgress?.(createProgress('Complete', 'PDF import completed successfully!', 100));

        return {
            success: true,
            notebookPair: notebookPairWithMilestones,
            metadata: {
                totalCells: validCells.length,
                fileType: 'pdf',
                importDate: new Date().toISOString(),
            }
        };

    } catch (error) {
        console.error('PDF parsing error:', error);
        throw new Error(`Failed to parse PDF file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
};

/**
 * Extract text from PDF using pdfjs-dist
 */
async function extractTextViaExtension(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        try {
            const requestId = `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            const cleanup = () => window.removeEventListener('message', onMessage as any);

            const onMessage = (event: MessageEvent) => {
                const data = (event && event.data) || {};
                if (data && data.command === 'extractPdfTextResult' && data.requestId === requestId) {
                    cleanup();
                    if (data.success) {
                        resolve((data.text as string) || '');
                    } else {
                        reject(new Error(data.error || 'Failed to extract PDF text'));
                    }
                }
            };

            // Ensure listener is set before starting file read
            window.addEventListener('message', onMessage as any);

            // Use FileReader to create a proper data URL (safe base64)
            const reader = new FileReader();
            reader.onerror = () => {
                cleanup();
                reject(new Error('Failed to read PDF file'));
            };
            reader.onload = () => {
                const dataUrl = (reader.result as string) || '';
                (window as any).vscodeApi?.postMessage({
                    command: 'extractPdfText',
                    requestId,
                    fileName: file.name,
                    dataBase64: dataUrl,
                });
            };
            // Small microtask delay to ensure message pump is ready
            setTimeout(() => reader.readAsDataURL(file), 0);

            // Safety timeout
            setTimeout(() => {
                cleanup();
                reject(new Error('PDF extraction timed out'));
            }, 60000);
        } catch (err) {
            reject(err instanceof Error ? err : new Error('Failed to request PDF extraction'));
        }
    });
}

/**
 * Escape HTML characters
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Sanitize filename for use as notebook name
 */
function sanitizeFileName(fileName: string): string {
    return fileName
        .replace(/\.[^/.]+$/, '') // Remove extension
        .replace(/[^a-zA-Z0-9-_]/g, '-') // Replace special chars with hyphens
        .replace(/-+/g, '-') // Collapse multiple hyphens
        .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

/**
 * PDF Importer Plugin definition
 */
export const pdfImporter: ImporterPlugin = {
    name: 'PDF Documents',
    description: 'Portable Document Format files with text content',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: ['application/pdf'],
    validateFile,
    parseFile,
};
