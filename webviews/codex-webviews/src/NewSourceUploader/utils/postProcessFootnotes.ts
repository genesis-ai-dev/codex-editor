/**
 * Post-processing utilities for converting imported footnotes to Codex format
 * 
 * This handles cases where footnotes were imported in non-standard formats
 * and need to be converted to the Codex editor's expected format.
 */

/**
 * Converts mammoth.js footnote format to Codex format
 * 
 * Converts: <sup><a>[2]</a></sup>
 * To: <sup class="footnote-marker" data-footnote="[CONTENT]">2</sup>
 */
export const convertMammothFootnotesToCodex = (html: string, footnoteContentMap?: Map<string, string>): string => {
    if (!html) return html;

    let processedHtml = html;

    // Pattern to match mammoth.js footnote format: <sup><a>[number]</a></sup>
    const mammothFootnotePattern = /<sup><a>\[(\d+)\]<\/a><\/sup>/g;

    let match;
    const footnoteReplacements: Array<{ original: string; replacement: string; }> = [];

    while ((match = mammothFootnotePattern.exec(html)) !== null) {
        const [fullMatch, footnoteNumber] = match;

        // Get footnote content from map or use placeholder
        const footnoteContent = footnoteContentMap?.get(footnoteNumber) ||
            `Footnote ${footnoteNumber} content (imported from DOCX)`;

        // Create Codex format footnote
        const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnoteContent)}">${footnoteNumber}</sup>`;

        footnoteReplacements.push({
            original: fullMatch,
            replacement: codexFootnote,
        });
    }

    // Apply all replacements
    footnoteReplacements.forEach(({ original, replacement }) => {
        processedHtml = processedHtml.replace(original, replacement);
    });

    return processedHtml;
};

/**
 * Converts generic superscript footnotes to Codex format
 * 
 * Converts: <sup>2</sup>
 * To: <sup class="footnote-marker" data-footnote="[CONTENT]">2</sup>
 */
export const convertGenericSupToCodexFootnotes = (html: string, footnoteContentMap?: Map<string, string>): string => {
    if (!html) return html;

    let processedHtml = html;

    // Pattern to match generic superscript numbers that might be footnotes
    const genericSupPattern = /<sup>(\d+)<\/sup>/g;

    let match;
    const footnoteReplacements: Array<{ original: string; replacement: string; }> = [];

    while ((match = genericSupPattern.exec(html)) !== null) {
        const [fullMatch, footnoteNumber] = match;

        // Only convert if this looks like a footnote (reasonable number range)
        const num = parseInt(footnoteNumber, 10);
        if (num >= 1 && num <= 999) {
            // Get footnote content from map or use placeholder
            const footnoteContent = footnoteContentMap?.get(footnoteNumber) ||
                `Footnote ${footnoteNumber} content (imported)`;

            // Create Codex format footnote
            const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnoteContent)}">${footnoteNumber}</sup>`;

            footnoteReplacements.push({
                original: fullMatch,
                replacement: codexFootnote,
            });
        }
    }

    // Apply all replacements
    footnoteReplacements.forEach(({ original, replacement }) => {
        processedHtml = processedHtml.replace(original, replacement);
    });

    return processedHtml;
};

/**
 * Attempts to extract footnote content from document text
 * 
 * Looks for patterns like:
 * - "2. This is footnote content"
 * - "[2] This is footnote content"
 * - Footnote paragraphs at the end of the document
 */
export const extractFootnoteContentFromText = (html: string): Map<string, string> => {
    const footnoteMap = new Map<string, string>();

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Look for paragraphs that might contain footnote definitions
        const paragraphs = doc.querySelectorAll('p');

        paragraphs.forEach(p => {
            const text = p.textContent?.trim();
            if (!text) return;

            // Pattern 1: "2. Footnote content..."
            let match = text.match(/^(\d+)\.\s+(.+)/);
            if (match && match[2].length > 10) {
                footnoteMap.set(match[1], match[2]);
                return;
            }

            // Pattern 2: "[2] Footnote content..."
            match = text.match(/^\[(\d+)\]\s+(.+)/);
            if (match && match[2].length > 10) {
                footnoteMap.set(match[1], match[2]);
                return;
            }

            // Pattern 3: "2 Footnote content..." (space separated)
            match = text.match(/^(\d+)\s+(.+)/);
            if (match && match[2].length > 20) { // Longer threshold for this pattern
                footnoteMap.set(match[1], match[2]);
                return;
            }
        });

    } catch (error) {
        console.warn('Error extracting footnote content from text:', error);
    }

    return footnoteMap;
};

/**
 * Main function to post-process imported content and convert footnotes to Codex format
 */
export const postProcessImportedFootnotes = (html: string): string => {
    if (!html) return html;

    // First, try to extract footnote content from the document
    const footnoteContentMap = extractFootnoteContentFromText(html);

    // Convert mammoth.js format footnotes
    let processedHtml = convertMammothFootnotesToCodex(html, footnoteContentMap);

    // Convert generic superscript footnotes (as fallback)
    processedHtml = convertGenericSupToCodexFootnotes(processedHtml, footnoteContentMap);

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
