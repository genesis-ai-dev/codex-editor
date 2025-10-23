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
    splitContentIntoSegments,
} from '../../utils/workflowHelpers';
import { extractImagesFromHtml } from '../../utils/imageProcessor';
// Extraction is delegated to the extension host to avoid webview worker/CSP issues

const SUPPORTED_EXTENSIONS = ['pdf'];

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

        // Split content into sentences for better granularity
        const segments = splitContentIntoSegments(textContent, 'sentences');

        onProgress?.(createProgress('Creating Cells', 'Creating cells from text segments...', 70));

        // Create cells for each segment
        const cells = await Promise.all(
            segments.map(async (segment, index) => {
                const cellId = createStandardCellId(file.name, 1, index + 1);

                // Clean the text while preserving sentence structure
                const cleanText = segment
                    .replace(/[\r\n]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                // Create HTML content with sentence semantics
                const htmlContent = `<div class="pdf-sentence" data-sentence-index="${index + 1}">
                    <p>${escapeHtml(cleanText)}</p>
                </div>`;

                const cell = createProcessedCell(cellId, htmlContent, {
                    originalText: cleanText,
                    cellLabel: (index + 1).toString(),
                    data: {
                        // Core identification
                        segmentType: 'sentence',
                        sentenceIndex: index,
                        originalContent: cleanText,
                        sourceFile: file.name,

                        // Round-trip export metadata
                        pdfMetadata: {
                            segmentType: 'sentence',
                            originalLength: cleanText.length,
                            characterCount: cleanText.length,
                            wordCount: cleanText.split(/\s+/).length,

                            // Position tracking for future reconstruction
                            globalPosition: index,

                            // Placeholder for future enhancements
                            // These can be populated when pdf-parse provides more data
                            pageNumber: undefined, // Will be populated when available
                            boundingBox: undefined, // For precise positioning
                            fontSize: undefined, // Font size if available
                            fontFamily: undefined, // Font family if available
                            textAlign: undefined, // Alignment if available
                        },

                        // Import metadata
                        importTimestamp: new Date().toISOString(),
                        corpusMarker: 'pdf',
                        importerVersion: '1.0.0',
                    }
                });

                // Extract and process images from this cell (if any)
                const images = await extractImagesFromHtml(htmlContent);
                cell.images = images;

                return cell;
            })
        );

        onProgress?.(createProgress('Creating Notebooks', 'Creating source and codex notebooks...', 90));

        // Create source notebook
        const sourceNotebook = {
            name: sanitizeFileName(file.name),
            cells: cells,
            metadata: {
                id: `pdf-${Date.now()}`,
                originalFileName: file.name,
                originalFileData: arrayBuffer, // Store original PDF for round-trip export
                corpusMarker: 'pdf',
                importerType: 'pdf', // Alias for corpusMarker (type requirement)
                createdAt: new Date().toISOString(),
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
            cells: cells.map(sourceCell =>
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

        onProgress?.(createProgress('Complete', 'PDF import completed successfully!', 100));

        return {
            success: true,
            notebookPair: {
                source: sourceNotebook,
                codex: codexNotebook,
            },
            metadata: {
                totalCells: cells.length,
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
