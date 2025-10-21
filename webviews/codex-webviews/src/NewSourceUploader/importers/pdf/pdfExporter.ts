/**
 * PDF Round-Trip Exporter
 * 
 * Creates a new PDF with translated content.
 * Note: Full layout preservation requires complex PDF parsing libraries that work in Node.js.
 * This version creates a clean, readable PDF with the translated text.
 * 
 * Implementation: Uses pdf-lib for PDF creation
 */

import { PDFDocument, StandardFonts, rgb, PDFPage } from 'pdf-lib';

/**
 * Strip HTML tags and decode HTML entities from text
 */
function stripHtml(html: string): string {
    if (!html) return '';

    // Remove HTML tags
    let text = html.replace(/<[^>]*>/g, '');

    // Decode common HTML entities
    const entityMap: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&nbsp;': ' ',
    };

    Object.keys(entityMap).forEach(entity => {
        text = text.replace(new RegExp(entity, 'g'), entityMap[entity]);
    });

    // Clean up extra whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
}

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
 * Wrap text to fit within a given width
 */
function wrapText(text: string, maxWidth: number, font: any, fontSize: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);

        if (testWidth > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines;
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

        // Create new PDF
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        // Page settings
        const pageWidth = 595; // A4 width in points
        const pageHeight = 842; // A4 height in points
        const margin = 50;
        const maxWidth = pageWidth - (2 * margin);
        const fontSize = 12;
        const lineHeight = fontSize * 1.5;

        let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        let yPosition = pageHeight - margin;

        // Collect and process translations
        const translations: Array<{
            index: number;
            text: string;
        }> = [];

        codexCells.forEach((cell, index) => {
            const rawTranslation = cell.value?.trim();

            if (rawTranslation) {
                // Strip HTML tags
                const translation = stripHtml(rawTranslation);

                if (translation) {
                    translations.push({
                        index: index + 1,
                        text: sanitizeForWinAnsi(translation)
                    });
                }
            }
        });

        console.log(`[PDF Exporter] Found ${translations.length} translations to render`);

        // Render each translation
        for (const translation of translations) {
            // Wrap text to fit page width
            const lines = wrapText(translation.text, maxWidth, font, fontSize);

            // Check if we need a new page
            const requiredHeight = lines.length * lineHeight + 10; // +10 for spacing
            if (yPosition - requiredHeight < margin) {
                currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
                yPosition = pageHeight - margin;
            }

            // Draw sentence number (optional, can be removed)
            // currentPage.drawText(`[${translation.index}]`, {
            //     x: margin,
            //     y: yPosition,
            //     size: fontSize - 2,
            //     font: font,
            //     color: rgb(0.5, 0.5, 0.5),
            // });
            // yPosition -= lineHeight;

            // Draw each line of text
            for (const line of lines) {
                try {
                    currentPage.drawText(line, {
                        x: margin,
                        y: yPosition,
                        size: fontSize,
                        font: font,
                        color: rgb(0, 0, 0),
                    });
                    yPosition -= lineHeight;
                } catch (error) {
                    console.warn(`[PDF Exporter] Could not draw text line:`, error);
                }
            }

            // Add spacing between sentences
            yPosition -= lineHeight * 0.5;
        }

        // Serialize the PDF
        const pdfBytes = await pdfDoc.save();
        console.log(`[PDF Exporter] ✓ Generated new PDF with ${pdfDoc.getPageCount()} pages`);

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

