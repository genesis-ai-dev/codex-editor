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
 * Converts PDF to DOCX via extension host
 */
async function convertPdfToDocxViaExtension(file: File): Promise<File> {
    return new Promise<File>((resolve, reject) => {
        try {
            const requestId = `pdf-to-docx-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            const cleanup = () => window.removeEventListener('message', onMessage as any);

            const onMessage = (event: MessageEvent) => {
                const data = (event && event.data) || {};
                if (data && data.command === 'convertPdfToDocxResult' && data.requestId === requestId) {
                    cleanup();
                    if (data.success) {
                        try {
                            // For large files, the extension host saves the file and sends the path
                            // For smaller files, it sends base64 data
                            if (data.isLargeFile && data.docxFilePath) {
                                // Request the file from extension host using file path
                                (window as any).vscodeApi?.postMessage({
                                    command: 'readFileFromPath',
                                    requestId: `read-docx-${requestId}`,
                                    filePath: data.docxFilePath
                                });
                                
                                // Set up listener for file data
                                const fileReaderCleanup = () => window.removeEventListener('message', fileReaderHandler as any);
                                const fileReaderHandler = (fileEvent: MessageEvent) => {
                                    const fileData = (fileEvent && fileEvent.data) || {};
                                    if (fileData.command === 'readFileFromPathResult' && fileData.requestId === `read-docx-${requestId}`) {
                                        fileReaderCleanup();
                                        if (fileData.success && fileData.fileData) {
                                            // Convert base64 to File object
                                            const base64 = fileData.fileData;
                                            const binaryString = atob(base64);
                                            const bytes = new Uint8Array(binaryString.length);
                                            for (let i = 0; i < binaryString.length; i++) {
                                                bytes[i] = binaryString.charCodeAt(i);
                                            }
                                            
                                            const docxFileName = file.name.replace(/\.pdf$/i, '.docx');
                                            const docxFile = new File([bytes], docxFileName, {
                                                type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                                lastModified: file.lastModified
                                            });
                                            
                                            resolve(docxFile);
                                        } else {
                                            reject(new Error(fileData.error || 'Failed to read DOCX file from path'));
                                        }
                                    }
                                };
                                
                                window.addEventListener('message', fileReaderHandler as any);
                                
                                // Timeout for file read
                                setTimeout(() => {
                                    fileReaderCleanup();
                                    reject(new Error('Timeout reading DOCX file from workspace'));
                                }, 60000);
                            } else {
                                // Standard base64 path for smaller files
                                const base64 = data.docxBase64;
                                
                                if (!base64 || typeof base64 !== 'string') {
                                    throw new Error('Invalid base64 data received from conversion');
                                }
                                
                                // Validate base64 string (basic check)
                                if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64.replace(/\s/g, ''))) {
                                    throw new Error('Invalid base64 encoding format');
                                }
                                
                                const binaryString = atob(base64);
                                const bytes = new Uint8Array(binaryString.length);
                                for (let i = 0; i < binaryString.length; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }
                                
                                // Create File object with .docx extension
                                const docxFileName = file.name.replace(/\.pdf$/i, '.docx');
                                const docxFile = new File([bytes], docxFileName, {
                                    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                    lastModified: file.lastModified
                                });
                                
                                resolve(docxFile);
                            }
                        } catch (decodeError) {
                            reject(new Error(`Failed to decode DOCX file: ${decodeError instanceof Error ? decodeError.message : 'Unknown error'}`));
                        }
                    } else {
                        reject(new Error(data.error || 'Failed to convert PDF to DOCX'));
                    }
                }
            };

            window.addEventListener('message', onMessage as any);

            // Read PDF as base64
            const reader = new FileReader();
            reader.onerror = () => {
                cleanup();
                reject(new Error('Failed to read PDF file'));
            };
            reader.onload = () => {
                const dataUrl = (reader.result as string) || '';
                const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
                
                (window as any).vscodeApi?.postMessage({
                    command: 'convertPdfToDocx',
                    requestId,
                    pdfBase64: base64,
                });
            };
            
            setTimeout(() => reader.readAsDataURL(file), 0);

            // Safety timeout - increased for large PDFs with CMYK conversion
            setTimeout(() => {
                cleanup();
                reject(new Error('PDF to DOCX conversion timed out after 10 minutes. Large PDFs with CMYK images may take longer. Please try again or use a smaller file.'));
            }, 600000); // 10 minutes timeout for large files with CMYK conversion
        } catch (err) {
            reject(err instanceof Error ? err : new Error('Failed to request PDF to DOCX conversion'));
        }
    });
}

/**
 * Parses a PDF file by converting it to DOCX first, then using DOCX importer
 * This approach provides better layout preservation and round-trip fidelity
 */
export const parseFile = async (
    file: File,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Converting PDF', 'Converting PDF to DOCX format...', 10));

        // Step 1: Convert PDF to DOCX using pdf2docx
        const docxFile = await convertPdfToDocxViaExtension(file);

        onProgress?.(createProgress('Importing DOCX', 'Importing converted DOCX file...', 30));

        // Step 2: Import the DOCX file using DOCX importer
        const { parseFile: parseDocxFile } = await import('../docx/index');
        const docxResult = await parseDocxFile(docxFile, (progress) => {
            // Map DOCX import progress (30-90%) to overall progress (30-90%)
            const mappedProgress = 30 + (progress.progress || 0) * 0.6;
            onProgress?.(createProgress(progress.stage || 'Importing DOCX', progress.message || '', mappedProgress));
        });

        if (!docxResult.success || !docxResult.notebookPair) {
            throw new Error('DOCX import failed after PDF conversion');
        }

        // Step 3: Override corpusMarker to "pdf" while keeping all DOCX structure
        const sourceNotebook = docxResult.notebookPair.source;
        const codexNotebook = docxResult.notebookPair.codex;

        // For large files, don't store ArrayBuffers in metadata to avoid memory issues
        // Instead, we'll save them during the write process
        // Only store ArrayBuffers for smaller files (< 50MB)
        const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB
        const shouldStoreBuffers = file.size < LARGE_FILE_THRESHOLD && docxFile.size < LARGE_FILE_THRESHOLD;
        
        let originalPdfArrayBuffer: ArrayBuffer | undefined;
        let convertedDocxArrayBuffer: ArrayBuffer | undefined;
        
        if (shouldStoreBuffers) {
            originalPdfArrayBuffer = await file.arrayBuffer();
            convertedDocxArrayBuffer = await docxFile.arrayBuffer();
        }

        // Override metadata to indicate PDF origin
        sourceNotebook.metadata = {
            ...sourceNotebook.metadata,
            corpusMarker: 'pdf',
            importerType: 'pdf',
            originalFileName: file.name, // Keep original PDF filename
            originalFileData: originalPdfArrayBuffer, // Store original PDF only if small (will be saved to attachments/originals)
            fileType: 'pdf',
            importContext: {
                ...sourceNotebook.metadata.importContext,
                importerType: 'pdf',
                fileName: file.name,
                originalFileName: file.name,
                fileSize: file.size,
            },
            // Preserve DOCX metadata but mark as PDF
            pdfDocumentMetadata: {
                originalFileName: file.name,
                fileSize: file.size,
                convertedFromPdf: true,
                convertedDocxFileName: docxFile.name,
                // Store converted DOCX data for export only if small (will be saved separately)
                convertedDocxData: convertedDocxArrayBuffer,
                isLargeFile: !shouldStoreBuffers, // Flag to indicate files need to be saved from temp location
            },
        };

        codexNotebook.metadata = {
            ...codexNotebook.metadata,
            corpusMarker: 'pdf',
            importerType: 'pdf',
            originalFileName: file.name,
            fileType: 'pdf',
            importContext: {
                ...codexNotebook.metadata.importContext,
                importerType: 'pdf',
                fileName: file.name,
                originalFileName: file.name,
                fileSize: file.size,
            },
        };

        // Note: corpusMarker is only set at notebook-level metadata, not in individual cells
        // This keeps the notebook structure clean and avoids duplication

        onProgress?.(createProgress('Complete', 'PDF import completed successfully!', 100));

        return {
            success: true,
            notebookPair: {
                source: sourceNotebook,
                codex: codexNotebook,
            },
            metadata: {
                ...docxResult.metadata,
                fileType: 'pdf',
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
