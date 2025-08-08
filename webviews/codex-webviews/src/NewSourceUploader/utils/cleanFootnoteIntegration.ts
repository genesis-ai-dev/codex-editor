/**
 * Clean Footnote Integration
 * 
 * A more robust approach that handles mammoth.js footnote output cleanly
 * without creating nested or duplicate footnote markers.
 */

import { FootnoteReference } from './footnoteUtils';

/**
 * Main function to clean and integrate footnotes from mammoth.js output
 */
export const cleanIntegrateFootnotes = (html: string, footnotes: FootnoteReference[]): string => {
    console.log('Clean footnote integration starting...', {
        htmlLength: html.length,
        footnoteCount: footnotes.length,
        htmlPreview: html.substring(0, 300)
    });

    if (footnotes.length === 0) {
        return html;
    }

    let processedHtml = html;

    try {
        // Step 1: Create footnote content map from markdown-extracted footnotes
        const footnoteContentMap = createFootnoteContentMap(footnotes);
        console.log('Footnote content map:', footnoteContentMap);

        // Step 2: Merge standalone footnote paragraphs FIRST (before any replacements)
        processedHtml = mergeStandaloneFootnoteParagraphs(processedHtml, footnoteContentMap);

        // Step 3: Clean up the HTML by removing footnote content sections
        processedHtml = removeFootnoteContentSections(processedHtml, footnotes);

        // Step 4: Replace all remaining footnote reference patterns with clean Codex format
        processedHtml = replaceAllFootnoteReferences(processedHtml, footnoteContentMap);

        // Step 5: Merge any remaining standalone Codex footnote paragraphs
        processedHtml = mergeCodexStandaloneFootnoteParagraphs(processedHtml);

        // Step 6: Final cleanup of artifacts
        processedHtml = finalCleanup(processedHtml);

        console.log('Clean footnote integration complete. Result preview:', processedHtml.substring(0, 500));

    } catch (error) {
        console.warn('Error in clean footnote integration:', error);
    }

    return processedHtml;
};

/**
 * Creates a map of footnote numbers to their content
 */
const createFootnoteContentMap = (footnotes: FootnoteReference[]): Map<string, string> => {
    const map = new Map<string, string>();

    footnotes.forEach(footnote => {
        // Extract number from footnote ID or use position
        const numberMatch = footnote.id.match(/footnote-(\d+)/);
        const number = numberMatch ? numberMatch[1] : footnote.position?.toString();

        if (number) {
            // Clean the content - remove HTML tags and normalize
            const cleanContent = footnote.content
                .replace(/<[^>]*>/g, '') // Remove HTML tags
                .replace(/&lt;[^&]*&gt;/g, '') // Remove escaped HTML
                .replace(/\\/g, '') // Remove escape characters
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim();

            map.set(number, cleanContent);
            console.log(`Mapped footnote ${number}:`, cleanContent.substring(0, 100));
        }
    });

    return map;
};

/**
 * Removes footnote content sections (like <ol> lists) from HTML
 */
const removeFootnoteContentSections = (html: string, footnotes: FootnoteReference[]): string => {
    let processedHtml = html;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Remove ordered lists that contain footnote content
        const orderedLists = doc.querySelectorAll('ol');
        orderedLists.forEach(ol => {
            const text = ol.textContent?.trim() || '';

            // Check if this list contains footnote content
            const containsFootnoteContent = footnotes.some(footnote => {
                const cleanFootnoteContent = footnote.content.replace(/<[^>]*>/g, '').trim();
                return text.includes(cleanFootnoteContent.substring(0, 50)) ||
                    cleanFootnoteContent.includes(text.substring(0, 50));
            });

            if (containsFootnoteContent) {
                console.log('Removing footnote content list:', ol.outerHTML.substring(0, 200));
                processedHtml = processedHtml.replace(ol.outerHTML, '');
            }
        });

        // Remove standalone paragraphs that look like footnote content
        const paragraphs = doc.querySelectorAll('p');
        paragraphs.forEach(p => {
            const text = p.textContent?.trim() || '';

            // Skip if paragraph is too short or contains regular content indicators
            if (text.length < 20 || !text.match(/^\d+[\.\s]/) && !text.includes('footnote')) {
                return;
            }

            const containsFootnoteContent = footnotes.some(footnote => {
                const cleanFootnoteContent = footnote.content.replace(/<[^>]*>/g, '').trim();
                return text.includes(cleanFootnoteContent.substring(0, 50)) ||
                    cleanFootnoteContent.includes(text.substring(0, 50));
            });

            if (containsFootnoteContent) {
                console.log('Removing footnote content paragraph:', p.outerHTML.substring(0, 200));
                processedHtml = processedHtml.replace(p.outerHTML, '');
            }
        });

    } catch (error) {
        console.warn('Error removing footnote content sections:', error);
    }

    return processedHtml;
};

/**
 * Replaces all footnote reference patterns with clean Codex format
 */
const replaceAllFootnoteReferences = (html: string, footnoteContentMap: Map<string, string>): string => {
    let processedHtml = html;

    // Replace footnote reference patterns

    // Pattern 1: Mammoth.js markdown-style references: <sup><a href="#footnote-2" id="footnote-ref-2">2</a></sup>
    processedHtml = processedHtml.replace(
        /<sup><a href="#footnote-(\d+)" id="footnote-ref-\d+">\s*(\d+)\s*<\/a><\/sup>/g,
        (match, num1, num2) => {
            const number = num1 || num2;
            const content = footnoteContentMap.get(number);
            if (content) {
                console.log(`Replacing markdown-style footnote ${number}`);
                return `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(content)}">${number}</sup>`;
            }
            return match;
        }
    );

    // Pattern 2: Complex nested structures: <sup><a><sup>1</sup></a></sup>
    processedHtml = processedHtml.replace(
        /<sup><a[^>]*><sup[^>]*>\s*(\d+)\s*<\/sup><\/a><\/sup>/g,
        (match, number) => {
            const content = footnoteContentMap.get(number);
            if (content) {
                console.log(`Replacing complex nested footnote ${number}`);
                return `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(content)}">${number}</sup>`;
            }
            return match;
        }
    );

    // Pattern 3: Simple superscripts that might be footnotes: <sup>1</sup>
    processedHtml = processedHtml.replace(
        /<sup(?![^>]*class="footnote-marker")[^>]*>\s*(\d+)\s*<\/sup>/g,
        (match, number) => {
            const content = footnoteContentMap.get(number);
            if (content) {
                console.log(`Replacing simple footnote ${number}`);
                return `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(content)}">${number}</sup>`;
            }
            return match; // Keep as-is if no footnote content found
        }
    );

    // Pattern 4: Already partially processed footnotes that might be malformed
    processedHtml = processedHtml.replace(
        /<sup[^>]*class="footnote-marker"[^>]*data-footnote="([^"]*)"[^>]*>\s*(\d+)\s*<\/sup>/g,
        (match, dataFootnote, number) => {
            // If the data-footnote contains escaped HTML or looks malformed, clean it
            if (dataFootnote.includes('&lt;') || dataFootnote.includes('&gt;')) {
                const cleanContent = footnoteContentMap.get(number);
                if (cleanContent) {
                    console.log(`Cleaning malformed footnote ${number}`);
                    return `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(cleanContent)}">${number}</sup>`;
                }
            }
            return match;
        }
    );

    return processedHtml;
};

/**
 * Merges standalone footnote paragraphs with adjacent content paragraphs
 */
const mergeStandaloneFootnoteParagraphs = (html: string, footnoteContentMap: Map<string, string>): string => {
    console.log('Merging standalone footnote paragraphs...');

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
        const container = doc.querySelector('div');

        if (!container) return html;

        // Use all paragraph elements in document order, not just direct children
        const paragraphs = Array.from(container.querySelectorAll('p'));
        let modified = false;

        for (let i = 0; i < paragraphs.length; i++) {
            const p = paragraphs[i];

            // Check if this paragraph contains only a footnote reference
            if (p.tagName === 'P') {
                const content = p.innerHTML.trim();
                console.log(`Checking paragraph ${i}: "${content}"`);

                // Determine if paragraph contains only optional empty anchors and a single footnote sup
                let footnoteNumber: string | null = null;
                let standaloneFootnote = false;

                const childNodes = Array.from(p.childNodes);
                const allowedNodes: ChildNode[] = [];
                let supElement: HTMLElement | null = null;

                childNodes.forEach((node) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const text = (node.textContent || '').trim();
                        if (text.length > 0) {
                            allowedNodes.push(node);
                        }
                        return;
                    }
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as HTMLElement;
                        if (el.tagName === 'A' && (el.textContent || '').trim().length === 0) {
                            // ignore empty anchors
                            return;
                        }
                        if (el.tagName === 'SUP') {
                            supElement = el;
                            return;
                        }
                        // any other meaningful element counts
                        allowedNodes.push(node);
                    }
                });

                // If we found a sup directly, good. Else, check for nested sup inside anchors
                if (!supElement) {
                    const nestedSup = p.querySelector('a sup, sup sup') as HTMLElement | null;
                    if (nestedSup) {
                        supElement = nestedSup;
                    }
                }

                if (supElement && allowedNodes.length === 0) {
                    const numberText = (supElement.textContent || '').trim();
                    if (/^\d+$/.test(numberText)) {
                        footnoteNumber = numberText;
                        standaloneFootnote = true;
                        console.log(`Detected standalone footnote paragraph (DOM) for footnote ${footnoteNumber}`);
                    }
                }

                if (!standaloneFootnote) {
                    // Extra-simple heuristic: if textContent is just a number, treat as standalone footnote paragraph
                    const onlyText = (p.textContent || '').trim();
                    if (/^\d+$/.test(onlyText)) {
                        footnoteNumber = onlyText;
                        standaloneFootnote = true;
                        console.log(`Detected numeric-only paragraph for footnote ${footnoteNumber}`);
                    }
                }

                if (!standaloneFootnote) {
                    // Fallback to regex-based detection for robustness
                    // 1) simple <sup>n</sup>
                    let supMatch = content.match(/^<sup[^>]*>\s*(\d+)\s*<\/sup>$/);
                    if (supMatch) {
                        footnoteNumber = supMatch[1];
                        standaloneFootnote = true;
                        console.log(`Matched simple pattern for footnote ${footnoteNumber}`);
                    }
                    // 2) complex nested
                    if (!standaloneFootnote) {
                        supMatch = content.match(/^<sup[^>]*><a[^>]*><sup[^>]*data-footnote="[^"]*"[^>]*>\s*(\d+)\s*<\/sup><\/a><\/sup>$/);
                        if (supMatch) {
                            footnoteNumber = supMatch[1];
                            standaloneFootnote = true;
                        }
                    }
                    // 3) already processed codex format
                    if (!standaloneFootnote) {
                        supMatch = content.match(/^<sup[^>]*class="footnote-marker"[^>]*data-footnote="[^"]*"[^>]*>\s*(\d+)\s*<\/sup>$/);
                        if (supMatch) {
                            footnoteNumber = supMatch[1];
                            standaloneFootnote = true;
                        }
                    }
                }

                if (standaloneFootnote && footnoteNumber) {
                    const footnoteContent = footnoteContentMap.get(footnoteNumber);

                    if (footnoteContent) {
                        console.log(`Found standalone footnote paragraph for footnote ${footnoteNumber}`);

                        // Create the Codex footnote marker
                        const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnoteContent)}">${footnoteNumber}</sup>`;

                        // Try to merge with the previous paragraph
                        if (i > 0 && paragraphs[i - 1].tagName === 'P') {
                            const prevP = paragraphs[i - 1] as HTMLElement;
                            console.log(`Merging footnote ${footnoteNumber} with previous paragraph`);

                            // Insert footnote before trailing punctuation/quotes if present
                            let prevContent = prevP.innerHTML.trim();
                            const punctMatch = prevContent.match(/([\s\S]*?)(["'”’\)\]]*[.,;:!?]+)$/);
                            if (punctMatch) {
                                prevContent = `${punctMatch[1]}${codexFootnote}${punctMatch[2]}`;
                            } else {
                                prevContent = `${prevContent}${codexFootnote}`;
                            }

                            prevP.innerHTML = prevContent;

                            // Remove the standalone footnote paragraph
                            p.remove();
                            modified = true;

                        } else {
                            // If no previous paragraph, convert this paragraph to contain the footnote inline
                            console.log(`Converting standalone footnote ${footnoteNumber} to inline`);
                            p.innerHTML = codexFootnote;
                            modified = true;
                        }
                    }
                }
            }
        }

        if (modified) {
            const result = container.innerHTML;
            console.log('Paragraph merging complete (DOM). Result preview:', result.substring(0, 300));
            return result;
        }

        // Fallback: Regex-based merge across raw HTML if DOM approach found nothing
        console.log('No standalone footnote paragraphs found via DOM. Trying regex fallback...');
        let processedHtml = html;
        let regexModified = false;

        for (const [footnoteNumber, footnoteContent] of footnoteContentMap) {
            const codexFootnote = `<sup class="footnote-marker" data-footnote="${escapeHtmlAttribute(footnoteContent)}">${footnoteNumber}</sup>`;

            // Merge pattern: </p><p><sup>N</sup></p><p>
            const mergePattern = new RegExp(
                `(</p>)\\s*<p>\\s*(?:<a[^>]*>\\s*<\\/a>\\s*)*<sup[^>]*>\\s*${footnoteNumber}\\s*<\\/sup>\\s*<\\/p>\\s*(<p>)`,
                'g'
            );
            const before1 = processedHtml;
            processedHtml = processedHtml.replace(mergePattern, (_m, prevEnd, nextStart) => {
                regexModified = true;
                return `${codexFootnote}${prevEnd}${nextStart}`;
            });
            if (processedHtml !== before1) {
                console.log(`Regex-merged inline footnote ${footnoteNumber} between paragraphs`);
            }

            // Merge at end: </p><p><sup>N</sup></p>$
            const endPattern = new RegExp(
                `(</p>)\\s*<p>\\s*(?:<a[^>]*>\\s*<\\/a>\\s*)*<sup[^>]*>\\s*${footnoteNumber}\\s*<\\/sup>\\s*<\\/p>\\s*$`,
                'g'
            );
            const before2 = processedHtml;
            processedHtml = processedHtml.replace(endPattern, (_m, prevEnd) => {
                regexModified = true;
                return `${codexFootnote}${prevEnd}`;
            });
            if (processedHtml !== before2) {
                console.log(`Regex-merged end footnote ${footnoteNumber}`);
            }

            // Merge before punctuation: .</p><p><sup>N</sup></p>
            const punctPattern = new RegExp(
                `([\"'”’\)\]]*[\.,;:!?]+)(</p>)\\s*<p>\\s*(?:<a[^>]*>\\s*<\\/a>\\s*)*<sup[^>]*>\\s*${footnoteNumber}\\s*<\\/sup>\\s*<\\/p>`,
                'g'
            );
            const before3 = processedHtml;
            processedHtml = processedHtml.replace(punctPattern, (_m, punct, prevEnd) => {
                regexModified = true;
                return `${codexFootnote}${punct}${prevEnd}`;
            });
            if (processedHtml !== before3) {
                console.log(`Regex-merged footnote ${footnoteNumber} before punctuation`);
            }
        }

        if (regexModified) {
            // Remove any now-empty paragraphs
            processedHtml = processedHtml.replace(/<p>\s*<\/p>/g, '');
            console.log('Paragraph merging complete (regex). Result preview:', processedHtml.substring(0, 300));
            return processedHtml;
        }

    } catch (error) {
        console.warn('Error merging standalone footnote paragraphs:', error);
    }

    return html;
};

/**
 * Final cleanup of HTML artifacts
 */
const finalCleanup = (html: string): string => {
    return html
        // Remove empty anchor tags
        .replace(/<a[^>]*><\/a>/g, '')
        .replace(/<a[^>]*>\s*<\/a>/g, '')
        // Remove empty paragraphs
        .replace(/<p>\s*<\/p>/g, '')
        .replace(/<p><\/p>/g, '')
        // Remove multiple consecutive spaces
        .replace(/\s+/g, ' ')
        // Remove spaces before punctuation
        .replace(/\s+([.,;:])/g, '$1')
        // Clean up any remaining malformed sup tags
        .replace(/<sup<sup/g, '<sup')
        .replace(/sup>/g, '</sup>')
        // Remove any orphaned closing tags
        .replace(/<\/sup><\/sup>/g, '</sup>')
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
