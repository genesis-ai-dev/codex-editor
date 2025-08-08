/**
 * DOCX Footnote Extractor
 * 
 * Extracts footnotes from DOCX files by working with mammoth.js output
 * and implementing heuristic-based footnote detection and integration.
 */

import { FootnoteReference } from './footnoteUtils';

export interface DocxFootnote {
    id: string;
    content: string;
    referenceText?: string;
}

/**
 * Extracts footnotes from mammoth.js conversion result
 * This is a heuristic approach since mammoth.js doesn't directly support footnotes
 */
export const extractDocxFootnotes = async (
    file: File,
    mammothResult: any
): Promise<FootnoteReference[]> => {
    try {
        const footnotes: FootnoteReference[] = [];

        // Check if mammoth.js provides any footnote-related information
        if (mammothResult.messages) {
            mammothResult.messages.forEach((message: any, index: number) => {
                if (message.message && message.message.toLowerCase().includes('footnote')) {
                    footnotes.push({
                        id: `footnote-${index + 1}`,
                        content: message.message,
                        position: index,
                    });
                }
            });
        }

        // Try to extract footnote-like content from the converted HTML
        const htmlFootnotes = extractFootnotesFromHtml(mammothResult.value || '');
        footnotes.push(...htmlFootnotes);

        return footnotes;

    } catch (error) {
        console.warn('Failed to extract footnotes from DOCX:', error);
        return [];
    }
};

/**
 * Extracts footnote-like content from HTML converted by mammoth.js
 */
const extractFootnotesFromHtml = (html: string): FootnoteReference[] => {
    const footnotes: FootnoteReference[] = [];

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Pattern 1: Look for mammoth.js footnote format: <sup><a>[number]</a></sup>
        const supElements = doc.querySelectorAll('sup');
        supElements.forEach((sup, index) => {
            // Check if this sup contains an <a> tag with footnote reference
            const linkElement = sup.querySelector('a');
            if (linkElement) {
                const linkText = linkElement.textContent?.trim();
                if (linkText && /^\[\d+\]$/.test(linkText)) {
                    // Extract the number from [2] format
                    const numberMatch = linkText.match(/^\[(\d+)\]$/);
                    if (numberMatch) {
                        const footnoteNumber = numberMatch[1];

                        // For now, create a placeholder footnote - we'll need to find the actual content
                        // This is a limitation of mammoth.js not providing footnote content directly
                        footnotes.push({
                            id: `footnote-${footnoteNumber}`,
                            content: `Footnote ${footnoteNumber} content (extracted from DOCX)`,
                            position: index,
                            originalMarkup: sup.outerHTML,
                        });
                    }
                }
            }

            // Also check for direct numeric superscripts (fallback pattern)
            const text = sup.textContent?.trim();
            if (text && /^\d+$/.test(text) && !sup.querySelector('a')) {
                // This looks like a footnote reference
                const nextElement = sup.nextSibling;
                if (nextElement && nextElement.nodeType === Node.TEXT_NODE) {
                    const content = nextElement.textContent?.trim();
                    if (content && content.length > 10) { // Reasonable footnote length
                        footnotes.push({
                            id: `footnote-${text}`,
                            content,
                            position: index,
                            originalMarkup: sup.outerHTML + content,
                        });
                    }
                }
            }
        });

        // Pattern 2: Look for footnote-style paragraphs (often at the end)
        const paragraphs = doc.querySelectorAll('p');
        paragraphs.forEach((p, index) => {
            const text = p.textContent?.trim();
            if (text) {
                // Check if paragraph starts with a number or footnote marker
                const footnoteMatch = text.match(/^(\d+)[\.\)\s]+(.+)/);
                if (footnoteMatch && footnoteMatch[2].length > 10) {
                    footnotes.push({
                        id: `footnote-${footnoteMatch[1]}`,
                        content: footnoteMatch[2],
                        position: paragraphs.length + index, // Position at end
                        originalMarkup: p.outerHTML,
                    });
                }
            }
        });

    } catch (error) {
        console.warn('Error extracting footnotes from HTML:', error);
    }

    return footnotes;
};

/**
 * Integrates footnotes into HTML content from mammoth.js
 * This function should be called after mammoth.js conversion to add footnotes
 */
export const integrateFootnotesIntoHtml = (
    html: string,
    footnotes: FootnoteReference[]
): string => {
    if (footnotes.length === 0) return html;

    let modifiedHtml = html;

    // Sort footnotes by position if available
    const sortedFootnotes = footnotes.sort((a, b) => {
        if (a.position !== undefined && b.position !== undefined) {
            return a.position - b.position;
        }
        return 0;
    });

    // For each footnote, try to find a good insertion point
    sortedFootnotes.forEach((footnote, index) => {
        const marker = (index + 1).toString();
        const footnoteHtml = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnote.content)}">${marker}</sup>`;

        // If we have original markup, replace it
        if (footnote.originalMarkup) {
            modifiedHtml = modifiedHtml.replace(footnote.originalMarkup, footnoteHtml);
        } else {
            // Try to find a good insertion point based on content similarity
            const insertionPoint = findBestInsertionPoint(modifiedHtml, footnote, index);

            if (insertionPoint !== -1) {
                modifiedHtml = modifiedHtml.slice(0, insertionPoint) + footnoteHtml + modifiedHtml.slice(insertionPoint);
            } else {
                // Fallback: append at the end of the paragraph or document
                const paragraphEnd = modifiedHtml.lastIndexOf('</p>');
                if (paragraphEnd !== -1) {
                    modifiedHtml = modifiedHtml.slice(0, paragraphEnd) + footnoteHtml + modifiedHtml.slice(paragraphEnd);
                } else {
                    modifiedHtml += footnoteHtml;
                }
            }
        }
    });

    return modifiedHtml;
};

/**
 * Finds the best insertion point for a footnote in HTML content
 */
const findBestInsertionPoint = (html: string, footnote: FootnoteReference, index: number): number => {
    // This is a simplified heuristic - in a real implementation, you might want
    // more sophisticated logic to match footnotes with their reference points

    // Try to find keywords from the footnote content in the main text
    const words = footnote.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    for (const word of words.slice(0, 3)) { // Check first few meaningful words
        const wordIndex = html.toLowerCase().indexOf(word);
        if (wordIndex !== -1) {
            // Find the end of the current word/sentence
            const nextSpace = html.indexOf(' ', wordIndex + word.length);
            return nextSpace !== -1 ? nextSpace : wordIndex + word.length;
        }
    }

    // Fallback: distribute footnotes evenly through the document
    const documentLength = html.length;
    const position = Math.floor((documentLength * (index + 1)) / 4); // Rough distribution

    // Find the nearest word boundary
    const nearestSpace = html.indexOf(' ', position);
    return nearestSpace !== -1 ? nearestSpace : position;
};

/**
 * Escapes HTML content for use in attributes
 */
const escapeHtmlAttribute = (content: string): string => {
    return content
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};