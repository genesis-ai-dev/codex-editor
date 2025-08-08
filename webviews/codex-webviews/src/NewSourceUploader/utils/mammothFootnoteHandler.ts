/**
 * Mammoth.js Footnote Handler
 * 
 * Handles the specific footnote format that mammoth.js produces and converts
 * it to the Codex editor's expected format.
 */

import { FootnoteReference } from './footnoteUtils';

/**
 * Processes mammoth.js output to extract and convert footnotes
 */
export const processMammothFootnotes = (html: string, mammothResult: any): {
    processedHtml: string;
    footnotes: FootnoteReference[];
} => {
    console.log('Processing mammoth footnotes from HTML:', html.substring(0, 500));

    const footnotes: FootnoteReference[] = [];
    let processedHtml = html;

    try {
        // Step 1: Look for mammoth.js footnote patterns
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Pattern 1: Find footnote references (sup.footnote-ref elements)
        const footnoteRefs = doc.querySelectorAll('sup.footnote-ref');
        console.log('Found footnote references:', footnoteRefs.length);

        footnoteRefs.forEach((ref, index) => {
            const refText = ref.textContent?.trim();
            if (refText) {
                console.log(`Footnote ref ${index + 1}: "${refText}"`);
                footnotes.push({
                    id: `footnote-${index + 1}`,
                    content: `Footnote ${index + 1}: ${refText}`,
                    position: index,
                    originalMarkup: ref.outerHTML,
                });
            }
        });

        // Pattern 2: Find footnote content paragraphs (p.footnote elements)
        const footnoteContent = doc.querySelectorAll('p.footnote');
        console.log('Found footnote content paragraphs:', footnoteContent.length);

        footnoteContent.forEach((p, index) => {
            const content = p.textContent?.trim();
            if (content) {
                console.log(`Footnote content ${index + 1}: "${content}"`);

                // Try to match with existing footnote or create new one
                if (footnotes[index]) {
                    footnotes[index].content = content;
                } else {
                    footnotes.push({
                        id: `footnote-${index + 1}`,
                        content,
                        position: index,
                        originalMarkup: p.outerHTML,
                    });
                }
            }
        });

        // Pattern 3: Handle the broken format we're seeing: <sup>1</sup> with empty <a></a>
        const isolatedSups = doc.querySelectorAll('sup:not(.footnote-ref):not(.footnote-marker)');
        console.log('Found isolated sup elements:', isolatedSups.length);

        isolatedSups.forEach((sup, index) => {
            const text = sup.textContent?.trim();
            if (text && /^\d+$/.test(text)) {
                console.log(`Isolated sup ${index + 1}: "${text}"`);

                // Look for nearby content that might be the footnote
                let footnoteContent = '';

                // Check if there's a paragraph after this sup that might contain footnote content
                let nextElement = sup.parentElement?.nextElementSibling;
                while (nextElement && footnoteContent.length < 50) {
                    const textContent = nextElement.textContent?.trim();
                    if (textContent && textContent.length > 10) {
                        // This might be footnote content
                        footnoteContent = textContent;
                        break;
                    }
                    nextElement = nextElement.nextElementSibling;
                }

                if (!footnoteContent) {
                    footnoteContent = `Footnote ${text} content (extracted from DOCX)`;
                }

                footnotes.push({
                    id: `footnote-${text}`,
                    content: footnoteContent,
                    position: parseInt(text, 10),
                    originalMarkup: sup.outerHTML,
                });
            }
        });

        // Step 2: Convert footnotes to Codex format
        processedHtml = convertFootnotesToCodexFormat(html, footnotes);

    } catch (error) {
        console.warn('Error processing mammoth footnotes:', error);
    }

    console.log('Processed footnotes:', footnotes);
    return {
        processedHtml,
        footnotes,
    };
};

/**
 * Converts footnotes to Codex format in the HTML
 */
const convertFootnotesToCodexFormat = (html: string, footnotes: FootnoteReference[]): string => {
    let processedHtml = html;

    // Sort footnotes by position for consistent numbering
    const sortedFootnotes = footnotes.sort((a, b) => {
        const posA = a.position || 0;
        const posB = b.position || 0;
        return posA - posB;
    });

    sortedFootnotes.forEach((footnote, index) => {
        const footnoteNumber = index + 1;
        const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnote.content)}">${footnoteNumber}</sup>`;

        if (footnote.originalMarkup) {
            // Replace the original markup with Codex format
            processedHtml = processedHtml.replace(footnote.originalMarkup, codexFootnote);
        }
    });

    // Clean up empty anchor tags that mammoth.js sometimes leaves behind
    processedHtml = processedHtml.replace(/<a><\/a>/g, '');
    processedHtml = processedHtml.replace(/<a\s*><\/a>/g, '');

    // Remove footnote content paragraphs (they're now embedded in data-footnote attributes)
    processedHtml = processedHtml.replace(/<p class="footnote"[^>]*>.*?<\/p>/g, '');

    return processedHtml;
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
