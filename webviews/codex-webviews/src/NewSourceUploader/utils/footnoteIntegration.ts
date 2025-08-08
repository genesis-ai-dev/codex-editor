/**
 * Footnote Integration Utilities
 * 
 * Handles the integration of footnote content with main content to prevent
 * footnotes from being split into separate cells.
 */

import { FootnoteReference } from './footnoteUtils';

export interface IntegratedContent {
    content: string;
    footnotes: FootnoteReference[];
    shouldMergeWithNext?: boolean;
}

/**
 * Integrates footnotes directly into HTML content before it gets split into segments
 */
export const integrateFootnotesIntoHtml = (html: string, footnotes: FootnoteReference[]): string => {
    console.log('Integrating footnotes into HTML content...', {
        htmlLength: html.length,
        footnoteCount: footnotes.length,
        htmlPreview: html.substring(0, 500)
    });

    if (footnotes.length === 0) {
        return html;
    }

    let processedHtml = html;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Create footnote lookup map
        const footnoteMap = new Map<number, FootnoteReference>();
        footnotes.forEach(footnote => {
            if (footnote.position) {
                footnoteMap.set(footnote.position, footnote);
            }
        });

        console.log('Footnote map for integration:', Array.from(footnoteMap.entries()));

        // Find footnote references and their corresponding content
        const footnoteReferences = findFootnoteReferencesInHtml(doc);
        const footnoteContentElements = findFootnoteContentInHtml(doc, footnotes);

        console.log('Found footnote references:', footnoteReferences);
        console.log('Found footnote content elements:', footnoteContentElements);

        // Apply footnote integration
        footnoteReferences.forEach(ref => {
            const footnote = footnoteMap.get(ref.number);
            if (footnote) {
                const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnote.content)}">${ref.number}</sup>`;
                console.log(`Replacing footnote reference ${ref.number}:`, ref.element.outerHTML, '→', codexFootnote);
                processedHtml = processedHtml.replace(ref.element.outerHTML, codexFootnote);
            }
        });

        // Remove footnote content elements that are now integrated
        footnoteContentElements.forEach(contentEl => {
            console.log('Removing footnote content element:', contentEl.outerHTML);
            processedHtml = processedHtml.replace(contentEl.outerHTML, '');
        });

        // Clean up empty paragraphs and artifacts
        processedHtml = cleanupHtmlArtifacts(processedHtml);

        console.log('Footnote integration complete. Result:', processedHtml);

    } catch (error) {
        console.warn('Error integrating footnotes into HTML:', error);
    }

    return processedHtml;
};

/**
 * Integrates footnote content into main content before cell splitting
 */
export const integrateFootnotesBeforeCellSplit = (
    htmlSegments: string[],
    footnotes: FootnoteReference[]
): string[] => {
    console.log('Integrating footnotes before cell split...', {
        segmentCount: htmlSegments.length,
        footnoteCount: footnotes.length
    });

    if (footnotes.length === 0) {
        return htmlSegments;
    }

    const integratedSegments: string[] = [];
    let footnoteIndex = 0;

    for (let i = 0; i < htmlSegments.length; i++) {
        const segment = htmlSegments[i];
        console.log(`Processing segment ${i}:`, segment);

        // Check if this segment contains footnote references
        const hasFootnoteReferences = containsFootnoteReferences(segment);

        // Check if this segment contains footnote content
        const footnoteContent = extractFootnoteContentFromSegment(segment, footnotes);

        if (footnoteContent) {
            console.log(`Segment ${i} contains footnote content:`, footnoteContent);

            // This segment contains footnote content - we need to merge it with the previous segment
            if (integratedSegments.length > 0) {
                const lastSegmentIndex = integratedSegments.length - 1;
                const lastSegment = integratedSegments[lastSegmentIndex];

                // Apply the footnote content to the previous segment
                const integratedSegment = applyFootnoteContentToSegment(
                    lastSegment,
                    footnoteContent
                );

                integratedSegments[lastSegmentIndex] = integratedSegment;
                console.log(`Integrated footnote into previous segment:`, integratedSegment);

                // Skip this segment as its content has been integrated
                continue;
            }
        }

        if (hasFootnoteReferences) {
            console.log(`Segment ${i} has footnote references`);

            // Look ahead for footnote content in subsequent segments
            const upcomingFootnotes = findUpcomingFootnoteContent(
                htmlSegments,
                i + 1,
                footnotes
            );

            if (upcomingFootnotes.length > 0) {
                console.log(`Found upcoming footnotes for segment ${i}:`, upcomingFootnotes);

                // Apply footnotes to this segment
                let processedSegment = segment;
                upcomingFootnotes.forEach(footnote => {
                    processedSegment = applyFootnoteContentToSegment(processedSegment, footnote);
                });

                integratedSegments.push(processedSegment);
                console.log(`Integrated segment with footnotes:`, processedSegment);
            } else {
                integratedSegments.push(segment);
            }
        } else {
            integratedSegments.push(segment);
        }
    }

    console.log('Footnote integration complete. Final segments:', integratedSegments);
    return integratedSegments;
};

/**
 * Checks if a segment contains footnote references
 */
const containsFootnoteReferences = (segment: string): boolean => {
    // Look for various footnote reference patterns
    const patterns = [
        /<sup[^>]*>\s*\d+\s*<\/sup>/i,  // <sup>1</sup>
        /<sup[^>]*><a[^>]*>\s*\d+\s*<\/a><\/sup>/i,  // <sup><a>1</a></sup>
        /<sup[^>]*><a[^>]*><sup[^>]*>\s*\d+\s*<\/sup><\/a><\/sup>/i,  // <sup><a><sup>1</sup></a></sup>
        /\[\d+\]/,  // [1]
    ];

    return patterns.some(pattern => pattern.test(segment));
};

/**
 * Extracts footnote content from a segment
 */
const extractFootnoteContentFromSegment = (
    segment: string,
    footnotes: FootnoteReference[]
): FootnoteReference | null => {
    // Check if this segment looks like footnote content
    const parser = new DOMParser();
    const doc = parser.parseFromString(segment, 'text/html');

    // Pattern 1: Ordered list with footnote content
    const orderedLists = doc.querySelectorAll('ol li');
    if (orderedLists.length > 0) {
        for (const li of orderedLists) {
            const text = li.textContent?.trim();
            if (text && text.length > 10) {
                // This looks like footnote content
                const footnoteNumber = findFootnoteNumberFromContent(text);
                if (footnoteNumber) {
                    return {
                        id: `footnote-${footnoteNumber}`,
                        content: cleanFootnoteContent(text),
                        position: footnoteNumber,
                    };
                }

                // Try to match with existing footnotes
                const matchingFootnote = footnotes.find(fn =>
                    fn.content.includes(text.substring(0, 50)) ||
                    text.includes(fn.content.substring(0, 50))
                );

                if (matchingFootnote) {
                    return {
                        ...matchingFootnote,
                        content: cleanFootnoteContent(text),
                    };
                }
            }
        }
    }

    // Pattern 2: Paragraph that looks like footnote content
    const paragraphs = doc.querySelectorAll('p');
    for (const p of paragraphs) {
        const text = p.textContent?.trim();
        if (text && text.length > 10) {
            const footnoteNumber = findFootnoteNumberFromContent(text);
            if (footnoteNumber) {
                return {
                    id: `footnote-${footnoteNumber}`,
                    content: cleanFootnoteContent(text),
                    position: footnoteNumber,
                };
            }
        }
    }

    return null;
};

/**
 * Finds footnote number from content text
 */
const findFootnoteNumberFromContent = (text: string): number | null => {
    // Pattern: "1. Content" or "1 Content"
    const match = text.match(/^(\d+)[\.\s]+/);
    if (match) {
        return parseInt(match[1], 10);
    }
    return null;
};

/**
 * Cleans footnote content by removing numbering and artifacts
 */
const cleanFootnoteContent = (text: string): string => {
    return text
        .replace(/^(\d+)[\.\s]+/, '') // Remove leading number
        .replace(/\s*↑\s*$/, '') // Remove return arrow
        .trim();
};

/**
 * Looks ahead for footnote content in upcoming segments
 */
const findUpcomingFootnoteContent = (
    segments: string[],
    startIndex: number,
    footnotes: FootnoteReference[]
): FootnoteReference[] => {
    const upcomingFootnotes: FootnoteReference[] = [];

    // Look at the next few segments for footnote content
    for (let i = startIndex; i < Math.min(startIndex + 3, segments.length); i++) {
        const footnoteContent = extractFootnoteContentFromSegment(segments[i], footnotes);
        if (footnoteContent) {
            upcomingFootnotes.push(footnoteContent);
        }
    }

    return upcomingFootnotes;
};

/**
 * Applies footnote content to a segment
 */
const applyFootnoteContentToSegment = (
    segment: string,
    footnote: FootnoteReference
): string => {
    console.log('Applying footnote to segment:', { segment, footnote });

    let processedSegment = segment;
    const footnoteNumber = footnote.position || 1;

    // Create the Codex footnote format
    const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnote.content)}">${footnoteNumber}</sup>`;

    // Replace various footnote reference patterns
    const patterns = [
        // Pattern 1: <sup><a><sup>1</sup></a></sup>
        {
            pattern: new RegExp(`<sup[^>]*><a[^>]*><sup[^>]*>\\s*${footnoteNumber}\\s*<\\/sup><\\/a><\\/sup>`, 'gi'),
            replacement: codexFootnote
        },
        // Pattern 2: <sup><a>1</a></sup>
        {
            pattern: new RegExp(`<sup[^>]*><a[^>]*>\\s*${footnoteNumber}\\s*<\\/a><\\/sup>`, 'gi'),
            replacement: codexFootnote
        },
        // Pattern 3: <sup>1</sup>
        {
            pattern: new RegExp(`<sup[^>]*>\\s*${footnoteNumber}\\s*<\\/sup>`, 'gi'),
            replacement: codexFootnote
        },
        // Pattern 4: [1]
        {
            pattern: new RegExp(`\\[${footnoteNumber}\\]`, 'g'),
            replacement: codexFootnote
        }
    ];

    patterns.forEach(({ pattern, replacement }) => {
        if (pattern.test(processedSegment)) {
            console.log(`Replacing pattern ${pattern} with ${replacement}`);
            processedSegment = processedSegment.replace(pattern, replacement);
        }
    });

    // Clean up artifacts
    processedSegment = processedSegment.replace(/<a><\/a>/g, '');
    processedSegment = processedSegment.replace(/<a\s*><\/a>/g, '');
    processedSegment = processedSegment.replace(/<p>\s*<\/p>/g, '');

    console.log('Applied footnote, result:', processedSegment);
    return processedSegment;
};

/**
 * Finds footnote references in HTML document
 */
const findFootnoteReferencesInHtml = (doc: Document): Array<{ number: number; element: Element; }> => {
    const references: Array<{ number: number; element: Element; }> = [];

    // Pattern 1: <sup><a><sup>1</sup></a></sup>
    const complexSupElements = doc.querySelectorAll('sup sup');
    complexSupElements.forEach(innerSup => {
        const text = innerSup.textContent?.trim();
        if (text && /^\d+$/.test(text)) {
            const number = parseInt(text, 10);
            let outerSup = innerSup.parentElement;
            while (outerSup && outerSup.tagName === 'A') {
                outerSup = outerSup.parentElement;
            }
            if (outerSup && outerSup.tagName === 'SUP') {
                references.push({ number, element: outerSup });
            }
        }
    });

    // Pattern 2: Simple <sup>1</sup> (not already caught)
    const simpleSupElements = doc.querySelectorAll('sup:not(.footnote-marker)');
    simpleSupElements.forEach(sup => {
        if (sup.querySelector('sup') || sup.closest('sup sup')) {
            return; // Skip nested ones already processed
        }
        const text = sup.textContent?.trim();
        if (text && /^\d+$/.test(text)) {
            const number = parseInt(text, 10);
            references.push({ number, element: sup });
        }
    });

    return references;
};

/**
 * Finds footnote content elements in HTML document
 */
const findFootnoteContentInHtml = (doc: Document, footnotes: FootnoteReference[]): Element[] => {
    const contentElements: Element[] = [];

    // Pattern 1: <ol><li> containing footnote content
    const orderedLists = doc.querySelectorAll('ol');
    orderedLists.forEach(ol => {
        const listItems = ol.querySelectorAll('li');
        listItems.forEach(li => {
            const text = li.textContent?.trim();
            if (text && text.length > 10) {
                // Check if this matches any of our footnotes
                const matchingFootnote = footnotes.find(fn =>
                    text.includes(fn.content) || fn.content.includes(text.substring(0, 50))
                );
                if (matchingFootnote) {
                    contentElements.push(ol); // Remove the entire list
                }
            }
        });
    });

    // Pattern 2: Standalone paragraphs that look like footnote content
    const paragraphs = doc.querySelectorAll('p');
    paragraphs.forEach(p => {
        const text = p.textContent?.trim();
        if (text && text.length > 10) {
            const matchingFootnote = footnotes.find(fn =>
                text.includes(fn.content) || fn.content.includes(text.substring(0, 50))
            );
            if (matchingFootnote) {
                contentElements.push(p);
            }
        }
    });

    return contentElements;
};

/**
 * Cleans up HTML artifacts after footnote integration
 */
const cleanupHtmlArtifacts = (html: string): string => {
    return html
        .replace(/<a><\/a>/g, '') // Empty anchor tags
        .replace(/<a\s*><\/a>/g, '') // Empty anchor tags with whitespace
        .replace(/<a>\s*<\/a>/g, '') // Empty anchor tags with content whitespace
        .replace(/<p>\s*<\/p>/g, '') // Empty paragraphs
        .replace(/<p><\/p>/g, '') // Empty paragraphs without whitespace
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
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
