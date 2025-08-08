/**
 * Mammoth.js Markdown-Based Footnote Extractor
 * 
 * Uses mammoth.js's Markdown conversion to properly extract footnote content,
 * then applies it to the HTML output for proper Codex formatting.
 */

import { FootnoteReference } from './footnoteUtils';
import * as mammoth from 'mammoth';

/**
 * Extracts footnotes from mammoth.js using both HTML and Markdown outputs
 */
export const extractFootnotesFromMammothMarkdown = async (
    file: File,
    mammothHtml: any,
    mammothMarkdown?: any
): Promise<{
    footnotes: FootnoteReference[];
    processedHtml: string;
}> => {
    console.log('Extracting footnotes using mammoth markdown approach...');

    const footnotes: FootnoteReference[] = [];
    let processedHtml = mammothHtml.value || '';

    try {
        // If markdown result wasn't provided, generate it
        let markdownResult = mammothMarkdown;
        if (!markdownResult) {
            console.log('Converting to markdown to extract footnotes...');
            const arrayBuffer = await file.arrayBuffer();
            markdownResult = await mammoth.convertToMarkdown({ arrayBuffer });
        }

        const markdownContent = markdownResult.value || '';
        console.log('Markdown content (first 500 chars):', markdownContent.substring(0, 500));

        // Extract footnotes from markdown
        const extractedFootnotes = parseMarkdownFootnotes(markdownContent);
        console.log('Extracted footnotes from markdown:', extractedFootnotes);

        // Apply footnotes to HTML
        processedHtml = applyFootnotesToHtml(processedHtml, extractedFootnotes);

        return {
            footnotes: extractedFootnotes,
            processedHtml,
        };

    } catch (error) {
        console.warn('Error extracting footnotes from mammoth markdown:', error);
        return {
            footnotes,
            processedHtml,
        };
    }
};

/**
 * Parses footnotes from mammoth.js markdown output
 */
const parseMarkdownFootnotes = (markdown: string): FootnoteReference[] => {
    const footnotes: FootnoteReference[] = [];

    try {
        // Pattern 1: Find footnote references in text: [[1]](#footnote-1)
        const referencePattern = /\[\[(\d+)\]\]\(#footnote-(\d+)\)/g;
        const references = new Map<string, number>();

        let match;
        while ((match = referencePattern.exec(markdown)) !== null) {
            const [, refNumber, footnoteId] = match;
            references.set(footnoteId, parseInt(refNumber, 10));
        }

        console.log('Found footnote references:', Array.from(references.entries()));

        // Pattern 2: Find footnote definitions: 1. Content [↑](#footnote-ref-1)
        const definitionPattern = /^(\d+)\.\s+(.+?)\s*\[↑\]\(#footnote-ref-\d+\)$/gm;

        while ((match = definitionPattern.exec(markdown)) !== null) {
            const [, number, content] = match;
            const footnoteNumber = parseInt(number, 10);

            console.log(`Found footnote ${footnoteNumber}: "${content}"`);

            footnotes.push({
                id: `footnote-${footnoteNumber}`,
                content: content.trim(),
                position: footnoteNumber,
            });
        }

        // Pattern 3: Alternative format - sometimes footnotes appear differently
        if (footnotes.length === 0) {
            console.log('Trying alternative footnote pattern...');

            // Look for numbered list items at the end that might be footnotes
            const lines = markdown.split('\n');
            let inFootnoteSection = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                // Check if this looks like a footnote definition
                const footnoteMatch = line.match(/^(\d+)\.\s+(.+)/);
                if (footnoteMatch) {
                    const [, number, content] = footnoteMatch;

                    // Check if there are footnote references earlier in the document
                    const hasReferences = markdown.includes(`[${number}]`) ||
                        markdown.includes(`[[${number}]]`);

                    if (hasReferences || inFootnoteSection) {
                        console.log(`Found alternative footnote ${number}: "${content}"`);
                        inFootnoteSection = true;

                        footnotes.push({
                            id: `footnote-${number}`,
                            content: content.trim(),
                            position: parseInt(number, 10),
                        });
                    }
                }
            }
        }

    } catch (error) {
        console.warn('Error parsing markdown footnotes:', error);
    }

    return footnotes.sort((a, b) => (a.position || 0) - (b.position || 0));
};

/**
 * Applies footnotes to HTML content, replacing broken footnote markers
 */
const applyFootnotesToHtml = (html: string, footnotes: FootnoteReference[]): string => {
    if (footnotes.length === 0) {
        console.log('No footnotes to apply to HTML');
        return html;
    }

    let processedHtml = html;
    console.log('Applying footnotes to HTML...', { originalHtml: html, footnotes });

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Create a footnote lookup map
        const footnoteMap = new Map<number, FootnoteReference>();
        footnotes.forEach(footnote => {
            if (footnote.position) {
                footnoteMap.set(footnote.position, footnote);
            }
        });

        console.log('Footnote map:', Array.from(footnoteMap.entries()));

        // Pattern 1: Handle complex nested structures like <sup><a><sup>1</sup></a></sup>
        const complexSupElements = doc.querySelectorAll('sup sup');
        console.log('Found complex nested sup elements:', complexSupElements.length);

        complexSupElements.forEach((innerSup) => {
            const text = innerSup.textContent?.trim();
            if (text && /^\d+$/.test(text)) {
                const footnoteNumber = parseInt(text, 10);
                const footnote = footnoteMap.get(footnoteNumber);

                if (footnote) {
                    console.log(`Replacing complex sup structure for footnote ${footnoteNumber}`);
                    const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnote.content)}">${footnoteNumber}</sup>`;

                    // Find the outermost sup element to replace
                    let outerSup = innerSup.parentElement;
                    while (outerSup && outerSup.tagName === 'A') {
                        outerSup = outerSup.parentElement;
                    }

                    if (outerSup && outerSup.tagName === 'SUP') {
                        processedHtml = processedHtml.replace(outerSup.outerHTML, codexFootnote);
                    }
                }
            }
        });

        // Pattern 2: Handle simple <sup>N</sup> elements that weren't caught above
        const simpleSupElements = doc.querySelectorAll('sup:not(.footnote-marker)');
        console.log('Found simple sup elements:', simpleSupElements.length);

        simpleSupElements.forEach((sup) => {
            // Skip if this is a nested sup we already processed
            if (sup.querySelector('sup') || sup.closest('sup sup')) {
                return;
            }

            const text = sup.textContent?.trim();
            if (text && /^\d+$/.test(text)) {
                const footnoteNumber = parseInt(text, 10);
                const footnote = footnoteMap.get(footnoteNumber);

                if (footnote) {
                    console.log(`Replacing simple sup ${footnoteNumber} with Codex footnote`);
                    const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnote.content)}">${footnoteNumber}</sup>`;
                    processedHtml = processedHtml.replace(sup.outerHTML, codexFootnote);
                }
            }
        });

        // Pattern 3: Handle [1] style references in text
        footnotes.forEach((footnote, index) => {
            const footnoteNumber = footnote.position || (index + 1);
            const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnote.content)}">${footnoteNumber}</sup>`;

            // Replace [N] patterns
            const bracketPattern = new RegExp(`\\[${footnoteNumber}\\]`, 'g');
            processedHtml = processedHtml.replace(bracketPattern, codexFootnote);
        });

        // Clean up artifacts and malformed structures
        processedHtml = processedHtml.replace(/<a><\/a>/g, '');
        processedHtml = processedHtml.replace(/<a\s*><\/a>/g, '');
        processedHtml = processedHtml.replace(/<a>\s*<\/a>/g, '');

        // Remove empty paragraphs that might be left behind
        processedHtml = processedHtml.replace(/<p>\s*<\/p>/g, '');
        processedHtml = processedHtml.replace(/<p><\/p>/g, '');

        console.log('HTML processing complete, result:', processedHtml);

    } catch (error) {
        console.warn('Error applying footnotes to HTML:', error);
    }

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

/**
 * Escapes string for use in regular expressions
 */
const escapeRegExp = (string: string): string => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};
