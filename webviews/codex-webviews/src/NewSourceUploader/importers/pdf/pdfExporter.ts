/**
 * PDF Round-Trip Exporter
 * 
 * Rebuilds a PDF with translated content by:
 * 1. Loading the original PDF from stored data
 * 2. Extracting text positions and layout
 * 3. Replacing text with translations while preserving layout
 * 4. Generating a new PDF with updated content
 * 
 * Current Implementation: Basic text replacement
 * Future Enhancement: Preserve fonts, colors, positioning, images
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Sanitize text for WinAnsi encoding (StandardFonts limitation)
 * Replaces or removes characters not supported by WinAnsi
 */
function sanitizeForWinAnsi(text: string): string {
    // Map of common extended Latin characters to ASCII equivalents
    const charMap: Record<string, string> = {
        'á': 'a', 'à': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a', 'ā': 'a', 'ă': 'a', 'ą': 'a',
        'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e', 'ė': 'e', 'ę': 'e', 'ě': 'e',
        'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i', 'ī': 'i', 'į': 'i',
        'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o', 'ō': 'o', 'ő': 'o',
        'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ū': 'u', 'ů': 'u', 'ű': 'u', 'ų': 'u',
        'ý': 'y', 'ÿ': 'y',
        'ñ': 'n', 'ń': 'n', 'ň': 'n',
        'ç': 'c', 'ć': 'c', 'č': 'c',
        'š': 's', 'ś': 's',
        'ž': 'z', 'ź': 'z', 'ż': 'z',
        'ď': 'd', 'đ': 'd',
        'ř': 'r', 'ŕ': 'r',
        'ť': 't',
        'ł': 'l', 'ĺ': 'l', 'ľ': 'l',
        // Uppercase variants
        'Á': 'A', 'À': 'A', 'Â': 'A', 'Ä': 'A', 'Ã': 'A', 'Å': 'A', 'Ā': 'A', 'Ă': 'A', 'Ą': 'A',
        'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E', 'Ē': 'E', 'Ė': 'E', 'Ę': 'E', 'Ě': 'E',
        'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I', 'Ī': 'I', 'Į': 'I',
        'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Ö': 'O', 'Õ': 'O', 'Ō': 'O', 'Ő': 'O',
        'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U', 'Ū': 'U', 'Ů': 'U', 'Ű': 'U', 'Ų': 'U',
        'Ý': 'Y', 'Ÿ': 'Y',
        'Ñ': 'N', 'Ń': 'N', 'Ň': 'N',
        'Ç': 'C', 'Ć': 'C', 'Č': 'C',
        'Š': 'S', 'Ś': 'S',
        'Ž': 'Z', 'Ź': 'Z', 'Ż': 'Z',
        'Ď': 'D', 'Đ': 'D',
        'Ř': 'R', 'Ŕ': 'R',
        'Ť': 'T',
        'Ł': 'L', 'Ĺ': 'L', 'Ľ': 'L',
    };

    return text.split('').map(char => charMap[char] || char).join('');
}

/**
 * Export PDF with translations
 * 
 * @param originalFileData - Original PDF file as ArrayBuffer
 * @param codexCells - Array of Codex cells with translations
 * @returns Promise<ArrayBuffer> - Updated PDF file
 */
export async function exportPdfWithTranslations(
    originalFileData: ArrayBuffer,
    codexCells: Array<{
        kind: number;
        value: string;
        metadata: any;
    }>
): Promise<ArrayBuffer> {
    try {
        console.log('[PDF Exporter] Starting PDF export...');
        console.log(`[PDF Exporter] Cells to process: ${codexCells.length}`);

        // Load the original PDF
        const pdfDoc = await PDFDocument.load(originalFileData);
        console.log(`[PDF Exporter] Loaded original PDF with ${pdfDoc.getPageCount()} pages`);

        // Collect translations from cells
        const translations: Array<{
            index: number;
            original: string;
            translation: string;
        }> = [];

        codexCells.forEach((cell, index) => {
            const translation = cell.value?.trim();
            const originalContent = cell.metadata?.originalContent || cell.metadata?.data?.originalContent;

            if (translation && originalContent) {
                translations.push({
                    index,
                    original: originalContent,
                    translation: translation
                });
            }
        });

        console.log(`[PDF Exporter] Found ${translations.length} translations`);

        // Create a new PDF with translations
        // Note: This is a simplified implementation that creates a new document
        // A more advanced implementation would:
        // 1. Extract exact text positions from original PDF
        // 2. Replace text in place preserving fonts, sizes, colors
        // 3. Maintain all images, graphics, and layout

        const newPdf = await PDFDocument.create();
        const font = await newPdf.embedFont(StandardFonts.Helvetica);

        // Add pages with translated content
        const pageSize = { width: 612, height: 792 }; // Letter size
        const margin = 50;
        const lineHeight = 14;
        const maxWidth = pageSize.width - 2 * margin;

        let currentPage = newPdf.addPage([pageSize.width, pageSize.height]);
        let yPosition = pageSize.height - margin;

        translations.forEach((item) => {
            // Sanitize text for WinAnsi encoding
            const text = sanitizeForWinAnsi(item.translation);

            // Simple word wrapping
            const words = text.split(' ');
            let line = '';

            words.forEach((word) => {
                const testLine = line + (line ? ' ' : '') + word;
                const textWidth = font.widthOfTextAtSize(testLine, 12);

                if (textWidth > maxWidth && line) {
                    // Draw current line
                    if (yPosition < margin) {
                        // Start new page
                        currentPage = newPdf.addPage([pageSize.width, pageSize.height]);
                        yPosition = pageSize.height - margin;
                    }

                    currentPage.drawText(line, {
                        x: margin,
                        y: yPosition,
                        size: 12,
                        font: font,
                        color: rgb(0, 0, 0),
                    });

                    yPosition -= lineHeight;
                    line = word;
                } else {
                    line = testLine;
                }
            });

            // Draw remaining text
            if (line) {
                if (yPosition < margin) {
                    currentPage = newPdf.addPage([pageSize.width, pageSize.height]);
                    yPosition = pageSize.height - margin;
                }

                currentPage.drawText(line, {
                    x: margin,
                    y: yPosition,
                    size: 12,
                    font: font,
                    color: rgb(0, 0, 0),
                });

                yPosition -= lineHeight * 1.5; // Extra space between sentences
            }
        });

        // Serialize the PDF
        const pdfBytes = await newPdf.save();
        console.log(`[PDF Exporter] ✓ Generated new PDF with ${newPdf.getPageCount()} pages`);

        // Convert Uint8Array to ArrayBuffer properly
        return pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;

    } catch (error) {
        console.error('[PDF Exporter] Error during export:', error);
        throw new Error(`PDF export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Exporter class for consistency with other exporters
 */
export class PdfExporter {
    async export(
        originalFileData: ArrayBuffer,
        codexCells: any[]
    ): Promise<ArrayBuffer> {
        return exportPdfWithTranslations(originalFileData, codexCells);
    }
}

export default PdfExporter;

