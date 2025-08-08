/**
 * Markdown Footnote Extractor
 * 
 * Extracts footnotes from Markdown content following GitHub Flavored Markdown
 * and other common footnote syntax patterns.
 */

import { FootnoteReference } from './footnoteUtils';

export interface MarkdownFootnote {
    id: string;
    content: string;
    referenceText: string;
    definitionLine: number;
    referencePositions: number[];
}

/**
 * Extracts footnotes from Markdown content
 * 
 * Supports various footnote syntaxes:
 * - [^1]: Footnote content (standard)
 * - [^label]: Footnote with custom label
 * - References: [^1] or [^label] in text
 */
export const extractMarkdownFootnotes = (content: string): FootnoteReference[] => {
    const footnotes: FootnoteReference[] = [];
    const lines = content.split('\n');

    try {
        // Find all footnote definitions
        const footnoteDefinitions = new Map<string, { content: string; line: number; }>();

        lines.forEach((line, index) => {
            // Match footnote definition pattern: [^id]: content
            const definitionMatch = line.match(/^\[(\^[^\]]+)\]:\s*(.+)$/);
            if (definitionMatch) {
                const [, id, content] = definitionMatch;
                footnoteDefinitions.set(id, { content: content.trim(), line: index });
            }
        });

        // Find all footnote references in the content
        const referenceRegex = /\[(\^[^\]]+)\]/g;
        let match;
        const referencePositions = new Map<string, number[]>();

        while ((match = referenceRegex.exec(content)) !== null) {
            const id = match[1];
            const position = match.index;

            if (!referencePositions.has(id)) {
                referencePositions.set(id, []);
            }
            referencePositions.get(id)!.push(position);
        }

        // Create footnote references for definitions that have references
        let footnoteIndex = 0;
        footnoteDefinitions.forEach((definition, id) => {
            const positions = referencePositions.get(id);
            if (positions && positions.length > 0) {
                footnoteIndex++;

                // Process multi-line footnote content
                let footnoteContent = definition.content;

                // Check if there are continuation lines (indented lines following the definition)
                for (let i = definition.line + 1; i < lines.length; i++) {
                    const nextLine = lines[i];

                    // If line starts with spaces/tabs and isn't another footnote definition, it's continuation
                    if (nextLine.match(/^\s+/) && !nextLine.match(/^\[(\^[^\]]+)\]:/)) {
                        footnoteContent += ' ' + nextLine.trim();
                    } else if (nextLine.trim() === '') {
                        // Empty line - check if next line is continuation
                        if (i + 1 < lines.length && lines[i + 1].match(/^\s+/)) {
                            footnoteContent += '\n';
                            continue;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }

                footnotes.push({
                    id: `markdown-footnote-${footnoteIndex}`,
                    content: processMarkdownFootnoteContent(footnoteContent),
                    position: Math.min(...positions), // Use the first reference position
                    originalMarkup: `[${id}]`,
                });
            }
        });

    } catch (error) {
        console.warn('Error extracting Markdown footnotes:', error);
    }

    return footnotes;
};

/**
 * Processes Markdown footnote content, converting inline Markdown to HTML
 */
const processMarkdownFootnoteContent = (content: string): string => {
    let processed = content.trim();

    // Convert basic Markdown formatting to HTML
    processed = processed
        // Bold: **text** or __text__
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')

        // Italic: *text* or _text_
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/_([^_]+)_/g, '<em>$1</em>')

        // Code: `code`
        .replace(/`([^`]+)`/g, '<code>$1</code>')

        // Links: [text](url)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

        // Line breaks
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return processed;
};

/**
 * Replaces Markdown footnote references with Codex format footnotes
 */
export const replaceMarkdownFootnotesInContent = (
    content: string,
    footnotes: FootnoteReference[]
): string => {
    let modifiedContent = content;

    // Create a map of original markup to footnote for easy replacement
    const footnoteMap = new Map<string, FootnoteReference>();
    footnotes.forEach(footnote => {
        if (footnote.originalMarkup) {
            footnoteMap.set(footnote.originalMarkup, footnote);
        }
    });

    // Sort footnotes by position (reverse order to avoid position shifts)
    const sortedFootnotes = footnotes.sort((a, b) => (b.position || 0) - (a.position || 0));

    sortedFootnotes.forEach((footnote, index) => {
        const reverseIndex = footnotes.length - index;
        const marker = reverseIndex.toString();

        // Create Codex footnote marker
        const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnote.content)}">${marker}</sup>`;

        // Replace all instances of the footnote reference
        if (footnote.originalMarkup) {
            const regex = new RegExp(escapeRegExp(footnote.originalMarkup), 'g');
            modifiedContent = modifiedContent.replace(regex, codexFootnote);
        }
    });

    // Remove footnote definitions from the content
    modifiedContent = modifiedContent.replace(/^\[(\^[^\]]+)\]:\s*.+$/gm, '');

    // Clean up extra whitespace
    modifiedContent = modifiedContent.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

    return modifiedContent;
};

/**
 * Processes Markdown content to extract and integrate footnotes
 */
export const processMarkdownWithFootnotes = (content: string): {
    content: string;
    footnotes: FootnoteReference[];
} => {
    // Extract footnotes
    const footnotes = extractMarkdownFootnotes(content);

    // Replace footnote references with Codex format
    const processedContent = replaceMarkdownFootnotesInContent(content, footnotes);

    return {
        content: processedContent,
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

/**
 * Escapes special regex characters
 */
const escapeRegExp = (string: string): string => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};
