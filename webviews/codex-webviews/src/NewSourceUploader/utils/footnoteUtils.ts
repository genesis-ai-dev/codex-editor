/**
 * Shared utilities for handling footnotes across different document formats
 * 
 * This module provides a consistent interface for processing footnotes from
 * DOCX, USFM, and Markdown files, converting them to the Codex editor format.
 */

export interface FootnoteReference {
    id: string;
    content: string;
    position?: number;
    originalMarkup?: string;
}

export interface ProcessedFootnote {
    id: string;
    content: string;
    marker: string;
    htmlContent: string;
}

/**
 * Converts footnote content to the Codex editor format
 * 
 * The Codex editor expects footnotes as:
 * <sup class="footnote-marker" data-footnote="[HTML_CONTENT]">[MARKER]</sup>
 */
export const createCodexFootnote = (footnote: FootnoteReference, marker?: string): string => {
    const footnoteMarker = marker || footnote.id;

    // Ensure the footnote content is properly escaped for HTML attribute
    const escapedContent = escapeHtmlAttribute(footnote.content);

    return `<sup class="footnote-marker" data-footnote="${escapedContent}">${footnoteMarker}</sup>`;
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
 * Processes footnote content to clean HTML
 * Removes unwanted formatting and ensures valid HTML structure
 */
export const processFootnoteContent = (content: string, format: 'docx' | 'usfm' | 'markdown' = 'docx'): string => {
    let processed = content.trim();

    switch (format) {
        case 'docx':
            // Clean up Word-specific formatting
            processed = processed
                .replace(/<w:.*?>/g, '') // Remove Word XML tags
                .replace(/<\/w:.*?>/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            break;

        case 'usfm':
            // Process USFM markers in footnote content
            processed = processUsfmFootnoteContent(processed);
            break;

        case 'markdown':
            // Markdown footnotes are usually already in plain text or HTML
            processed = processed
                .replace(/\n+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            break;
    }

    return processed;
};

/**
 * Processes USFM footnote content, handling internal markers
 */
const processUsfmFootnoteContent = (content: string): string => {
    return content
        // Handle footnote reference marker \fr
        .replace(/\\fr\s+([^\\]+)/g, '<span class="footnote-reference">$1</span>')
        // Handle footnote text \ft
        .replace(/\\ft\s+([^\\]+)/g, '$1')
        // Handle footnote keyword \fk
        .replace(/\\fk\s+([^\\]+)/g, '<strong>$1</strong>')
        // Handle footnote quotation \fq
        .replace(/\\fq\s+([^\\]+)/g, '<em>$1</em>')
        // Handle footnote alternate translation \fqa
        .replace(/\\fqa\s+([^\\]+)/g, '<span class="footnote-alt">$1</span>')
        // Clean up any remaining backslashes
        .replace(/\\/g, '')
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Extracts footnote references from content and replaces them with placeholders
 * Returns both the modified content and the extracted footnotes
 */
export const extractAndReplaceFootnotes = (
    content: string,
    footnotes: FootnoteReference[]
): { content: string; processedFootnotes: ProcessedFootnote[]; } => {
    let modifiedContent = content;
    const processedFootnotes: ProcessedFootnote[] = [];

    // Sort footnotes by position if available, or by order in array
    const sortedFootnotes = footnotes.sort((a, b) => {
        if (a.position !== undefined && b.position !== undefined) {
            return a.position - b.position;
        }
        return 0;
    });

    // Process each footnote
    sortedFootnotes.forEach((footnote, index) => {
        const marker = (index + 1).toString();
        const processedContent = processFootnoteContent(footnote.content);
        const htmlFootnote = createCodexFootnote(footnote, marker);

        processedFootnotes.push({
            id: footnote.id,
            content: processedContent,
            marker,
            htmlContent: htmlFootnote,
        });

        // If we have original markup, replace it
        if (footnote.originalMarkup) {
            modifiedContent = modifiedContent.replace(footnote.originalMarkup, htmlFootnote);
        }
    });

    return {
        content: modifiedContent,
        processedFootnotes,
    };
};

/**
 * Creates child cells for footnotes that couldn't be properly embedded
 * This ensures no footnote content is lost during import
 */
export const createFootnoteChildCells = (
    parentCellId: string,
    footnotes: ProcessedFootnote[]
): Array<{
    id: string;
    content: string;
    metadata: {
        type: 'footnote';
        parentCell: string;
        footnoteId: string;
        footnoteMarker: string;
    };
}> => {
    return footnotes.map((footnote, index) => ({
        id: `${parentCellId}-footnote-${index + 1}`,
        content: `<p><strong>Footnote ${footnote.marker}:</strong> ${footnote.content}</p>`,
        metadata: {
            type: 'footnote' as const,
            parentCell: parentCellId,
            footnoteId: footnote.id,
            footnoteMarker: footnote.marker,
        },
    }));
};

/**
 * Validates footnote structure and reports any issues
 */
export const validateFootnotes = (footnotes: FootnoteReference[]): {
    isValid: boolean;
    warnings: string[];
    errors: string[];
} => {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Check for duplicate IDs
    const ids = footnotes.map(f => f.id);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
        errors.push(`Duplicate footnote IDs found: ${duplicateIds.join(', ')}`);
    }

    // Check for empty content
    const emptyFootnotes = footnotes.filter(f => !f.content.trim());
    if (emptyFootnotes.length > 0) {
        warnings.push(`${emptyFootnotes.length} footnote(s) have empty content`);
    }

    // Check for very long footnotes (might indicate parsing errors)
    const longFootnotes = footnotes.filter(f => f.content.length > 1000);
    if (longFootnotes.length > 0) {
        warnings.push(`${longFootnotes.length} footnote(s) are unusually long (>1000 chars)`);
    }

    return {
        isValid: errors.length === 0,
        warnings,
        errors,
    };
};

/**
 * Renumbers footnotes sequentially starting from 1
 */
export const renumberFootnotes = (content: string): string => {
    let footnoteCount = 0;

    return content.replace(
        /<sup class="footnote-marker"[^>]*>([^<]+)<\/sup>/g,
        (match) => {
            footnoteCount++;
            return match.replace(/>([^<]+)<\/sup>/, `>${footnoteCount}</sup>`);
        }
    );
};
