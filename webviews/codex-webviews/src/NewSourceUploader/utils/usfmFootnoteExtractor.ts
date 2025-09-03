/**
 * USFM Footnote Extractor
 * 
 * Extracts footnotes from USFM content according to USFM 3.0+ specification
 * Handles various footnote markers and nested content properly.
 */

import { FootnoteReference } from './footnoteUtils';
import { convertUsfmInlineMarkersToHtml } from '../importers/common/usfmHtmlMapper';

export interface UsfmFootnote {
    id: string;
    content: string;
    reference?: string;
    originalText: string;
    position: number;
}

/**
 * Extracts footnotes from USFM content
 * 
 * USFM footnotes follow this pattern:
 * \f + \fr reference \ft footnote text\f*
 * 
 * Where:
 * - \f starts the footnote
 * - + indicates the footnote caller (can be +, -, or custom)
 * - \fr is the footnote reference (optional)
 * - \ft is the footnote text
 * - \f* ends the footnote
 */
export const extractUsfmFootnotes = (content: string): FootnoteReference[] => {
    const footnotes: FootnoteReference[] = [];

    try {
        // Match USFM footnote pattern
        // This regex captures the entire footnote structure
        const footnoteRegex = /\\f\s+([+\-*]|\w+)\s*(.*?)\\f\*/gs;

        let match;
        let footnoteIndex = 0;

        while ((match = footnoteRegex.exec(content)) !== null) {
            footnoteIndex++;
            const [fullMatch, caller, footnoteContent] = match;
            const position = match.index;

            // Parse the footnote content for different markers
            const parsedFootnote = parseUsfmFootnoteContent(footnoteContent, footnoteIndex);

            footnotes.push({
                id: `usfm-footnote-${footnoteIndex}`,
                content: parsedFootnote.processedContent,
                position,
                originalMarkup: fullMatch,
            });
        }

    } catch (error) {
        console.warn('Error extracting USFM footnotes:', error);
    }

    return footnotes;
};

/**
 * Parses USFM footnote content handling various internal markers
 */
const parseUsfmFootnoteContent = (content: string, index: number): {
    processedContent: string;
    reference?: string;
} => {
    let working = content.trim();
    let reference: string | undefined;

    // Extract \fr reference (optional), remove from working string
    const refMatch = working.match(/\\fr\s+([^\\]+)/);
    if (refMatch) {
        reference = refMatch[1].trim();
        working = working.replace(/\\fr\s+[^\\]+/g, '');
    }

    // Remove \ft tokens; remaining content becomes the footnote text body
    working = working.replace(/\\ft\s+/g, '');

    // Convert USFM inline markers within footnote to HTML with data-tag (supports + markers)
    const innerHtml = convertUsfmInlineMarkersToHtml(working);

    // Compose processed content with explicit data-tag wrappers for reference and text
    const refHtml = reference ? `<span data-tag="fr">${reference}</span> ` : '';
    const processedContent = `${refHtml}<span data-tag="ft">${innerHtml}</span>`;

    return {
        processedContent,
        reference,
    };
};

/**
 * Replaces USFM footnotes in content with Codex format footnotes
 */
export const replaceUsfmFootnotesInContent = (
    content: string,
    footnotes: FootnoteReference[]
): string => {
    let modifiedContent = content;

    // Sort footnotes by position (reverse order to avoid position shifts)
    const sortedFootnotes = footnotes.sort((a, b) => (b.position || 0) - (a.position || 0));

    sortedFootnotes.forEach((footnote, index) => {
        const reverseIndex = footnotes.length - index;
        const marker = reverseIndex.toString();

        // Create Codex footnote marker
        const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnote.content)}">${marker}</sup>`;

        // Replace the original USFM footnote with the Codex format
        if (footnote.originalMarkup) {
            modifiedContent = modifiedContent.replace(footnote.originalMarkup, codexFootnote);
        }
    });

    return modifiedContent;
};

/**
 * Converts USFM content to HTML while preserving footnotes
 */
export const convertUsfmToHtmlWithFootnotes = (content: string): {
    html: string;
    footnotes: FootnoteReference[];
} => {
    // First extract footnotes
    const footnotes = extractUsfmFootnotes(content);

    // Replace footnotes with Codex format
    let html = replaceUsfmFootnotesInContent(content, footnotes);

    // Basic USFM to HTML conversion for common markers
    html = html
        // Paragraph markers
        .replace(/\\p\s*/g, '<p>')
        .replace(/\\m\s*/g, '<p class="margin">')
        .replace(/\\pi\d?\s*/g, '<p class="indent">')
        .replace(/\\pc\s*/g, '<p class="center">')
        .replace(/\\pr\s*/g, '<p class="right">')

        // Character formatting
        .replace(/\\bd\s+([^\\]+?)(?=\\|\s*$)/g, '<strong>$1</strong>')
        .replace(/\\it\s+([^\\]+?)(?=\\|\s*$)/g, '<em>$1</em>')
        .replace(/\\sc\s+([^\\]+?)(?=\\|\s*$)/g, '<span class="small-caps">$1</span>')

        // Verse markers (keep them visible)
        .replace(/\\v\s+(\d+)\s*/g, '<sup class="verse-number">$1</sup> ')

        // Chapter markers
        .replace(/\\c\s+(\d+)\s*/g, '<h3 class="chapter">Chapter $1</h3>')

        // Clean up any remaining markers
        .replace(/\\[a-z]+\d*\*?\s*/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Add paragraph closing tags
    html = html.replace(/(<p[^>]*>)/g, '$1').replace(/$/g, '</p>');

    return {
        html,
        footnotes,
    };
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
