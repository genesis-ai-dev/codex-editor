/**
 * Standalone USFM Inline Marker Converter
 * Converts USFM inline markers to HTML and back
 * Copied from common/usfmHtmlMapper.ts to be standalone
 */

const isAlphaNum = (ch: string) => /[A-Za-z0-9]/.test(ch);

// Helper function to convert inline markers in footnote text (without processing footnotes recursively)
function convertUsfmInlineMarkersInText(usfmText: string): string {
    type StackEntry = { marker: string; closers: string[]; };
    const stack: StackEntry[] = [];

    const openFor = (marker: string): { openers: string[]; closers: string[]; } => {
        switch (marker) {
            case 'bd':
                return { openers: [`<strong data-tag="bd">`], closers: ['</strong>'] };
            case 'it':
                return { openers: [`<em data-tag="it">`], closers: ['</em>'] };
            case 'bdit':
                return { openers: ['<em>', `<strong data-tag="bdit">`], closers: ['</strong>', '</em>'] };
            case 'sup':
                return { openers: [`<sup data-tag="sup">`], closers: ['</sup>'] };
            case 'sc':
                return { openers: [`<span data-tag="sc" style="font-variant: small-caps;">`], closers: ['</span>'] };
            default:
                return { openers: [`<span data-tag="${marker}">`], closers: ['</span>'] };
        }
    };

    let i = 0;
    let out = '';
    while (i < usfmText.length) {
        const ch = usfmText[i];
        if (ch === '\\') {
            let j = i + 1;
            let name = '';
            // Support plus-prefixed note-internal markers like \+xt
            if (usfmText[j] === '+') {
                name += '+';
                j++;
            }
            while (j < usfmText.length && isAlphaNum(usfmText[j])) {
                name += usfmText[j];
                j++;
            }
            // Milestones \qt-s/\qt-e are treated as inline spans with data-tag; we ignore -s/-e in HTML
            if (usfmText[j] === '-' && (usfmText[j + 1] === 's' || usfmText[j + 1] === 'e')) {
                j += 2;
            }
            // Closing marker
            if (usfmText[j] === '*') {
                let idx = stack.length - 1;
                while (idx >= 0 && stack[idx].marker !== name) idx--;
                if (idx >= 0) {
                    const entry = stack.splice(idx, 1)[0];
                    for (const closer of entry.closers) out += closer;
                } else {
                    out += '</span>';
                }
                j += 1;
                i = j;
                continue;
            }
            if (usfmText[j] === ' ') j += 1;
            const { openers, closers } = openFor(name);
            openers.forEach(op => (out += op));
            stack.push({ marker: name, closers: [...closers] });
            i = j;
        } else {
            out += ch;
            i++;
        }
    }
    // Close any dangling tags
    while (stack.length > 0) {
        const entry = stack.pop()!;
        for (const closer of entry.closers) out += closer;
    }
    return out;
}

// Converts USFM inline markers (character-level styling) to HTML
export const convertUsfmInlineMarkersToHtml = (usfmText: string): string => {
    // First, handle footnotes (\f...\f*)
    // USFM footnote format: \f + \fr reference \ft footnote text\f*
    // or simpler: \f + \ft footnote text\f*
    let processedText = usfmText;
    let footnoteCounter = 0;
    
    // Match footnote pattern: \f + \fr? ... \ft ... \f*
    const footnoteRegex = /\\f\s+([+\-*]|\w+)\s*(.*?)\\f\*/gs;
    const footnotes: Array<{ caller: string; content: string; position: number }> = [];
    
    let match;
    while ((match = footnoteRegex.exec(usfmText)) !== null) {
        footnoteCounter++;
        const [fullMatch, caller, footnoteContent] = match;
        const position = match.index;
        
        // Parse footnote content
        let reference = '';
        let footnoteText = '';
        
        // Extract \fr reference if present
        const frMatch = footnoteContent.match(/\\fr\s+([^\\]+)/);
        if (frMatch) {
            reference = frMatch[1].trim();
        }
        
        // Extract \ft text (everything after \fr or the main content)
        const ftMatch = footnoteContent.match(/\\ft\s+(.*)/s);
        if (ftMatch) {
            footnoteText = ftMatch[1].trim();
        } else {
            // No \ft marker, use content directly (after removing \fr if present)
            footnoteText = footnoteContent.replace(/\\fr\s+[^\\]+/g, '').trim();
        }
        
        // Convert footnote text to HTML (handle inline markers within footnote)
        // Use a helper function to avoid recursion
        const footnoteHtml = convertUsfmInlineMarkersInText(footnoteText);
        
        // Build footnote HTML in the format: <p><em>reference: </em>text</p>
        let footnoteContentHtml = '';
        if (reference) {
            footnoteContentHtml = `<p><em>${reference}: </em>&nbsp;${footnoteHtml}</p>`;
        } else {
            footnoteContentHtml = `<p>${footnoteHtml}</p>`;
        }
        
        // Escape HTML for use in data attribute
        const escapedFootnote = footnoteContentHtml
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        
        footnotes.push({
            caller: caller || '+',
            content: escapedFootnote,
            position,
        });
    }
    
    // Replace footnotes in reverse order to preserve positions
    for (let i = footnotes.length - 1; i >= 0; i--) {
        const footnote = footnotes[i];
        const footnoteRegex2 = /\\f\s+([+\-*]|\w+)\s*(.*?)\\f\*/s;
        const footnoteMatch = processedText.substring(footnote.position).match(footnoteRegex2);
        if (footnoteMatch) {
            const footnoteNumber = i + 1; // Use 1-based numbering
            const replacement = `<sup data-footnote="${footnote.content}" class="footnote-marker">${footnoteNumber}</sup>`;
            processedText = processedText.substring(0, footnote.position) + 
                          replacement + 
                          processedText.substring(footnote.position + footnoteMatch[0].length);
        }
    }
    
    // Now process other inline markers
    type StackEntry = { marker: string; closers: string[]; };
    const stack: StackEntry[] = [];

    const openFor = (marker: string): { openers: string[]; closers: string[]; } => {
        switch (marker) {
            case 'bd':
                return { openers: [`<strong data-tag="bd">`], closers: ['</strong>'] };
            case 'it':
                return { openers: [`<em data-tag="it">`], closers: ['</em>'] };
            case 'bdit':
                return { openers: ['<em>', `<strong data-tag="bdit">`], closers: ['</strong>', '</em>'] };
            case 'sup':
                return { openers: [`<sup data-tag="sup">`], closers: ['</sup>'] };
            case 'sc':
                return { openers: [`<span data-tag="sc" style="font-variant: small-caps;">`], closers: ['</span>'] };
            default:
                return { openers: [`<span data-tag="${marker}">`], closers: ['</span>'] };
        }
    };

    let i = 0;
    let out = '';
    while (i < processedText.length) {
        const ch = processedText[i];
        if (ch === '\\') {
            let j = i + 1;
            let name = '';
            // Support plus-prefixed note-internal markers like \+xt
            if (processedText[j] === '+') {
                name += '+';
                j++;
            }
            while (j < processedText.length && isAlphaNum(processedText[j])) {
                name += processedText[j];
                j++;
            }
            // Milestones \qt-s/\qt-e are treated as inline spans with data-tag; we ignore -s/-e in HTML
            if (processedText[j] === '-' && (processedText[j + 1] === 's' || processedText[j + 1] === 'e')) {
                j += 2;
            }
            // Closing marker
            if (processedText[j] === '*') {
                let idx = stack.length - 1;
                while (idx >= 0 && stack[idx].marker !== name) idx--;
                if (idx >= 0) {
                    const entry = stack.splice(idx, 1)[0];
                    for (const closer of entry.closers) out += closer;
                } else {
                    out += '</span>';
                }
                j += 1;
                i = j;
                continue;
            }
            if (processedText[j] === ' ') j += 1;
            const { openers, closers } = openFor(name);
            openers.forEach(op => (out += op));
            stack.push({ marker: name, closers: [...closers] });
            i = j;
        } else {
            out += ch;
            i++;
        }
    }
    // Close any dangling tags
    while (stack.length > 0) {
        const entry = stack.pop()!;
        for (const closer of entry.closers) out += closer;
    }
    return out;
};

// Convert HTML back to USFM inline markers
export const htmlInlineToUsfm = (html: string): string => {
    // Check if DOMParser is available (browser context)
    if (typeof DOMParser !== 'undefined') {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
            const container = doc.body.firstElementChild as HTMLElement | null;
            if (!container) return html;

            const inferMarkerFromElement = (el: HTMLElement): string | null => {
                if (el.hasAttribute('data-tag')) return el.getAttribute('data-tag');
                const tag = el.tagName.toLowerCase();
                if (tag === 'strong' || tag === 'b') return 'bd';
                if (tag === 'em' || tag === 'i') return 'it';
                if (tag === 'sup') return 'sup';
                const style = el.getAttribute('style') || '';
                if (style.includes('small-caps')) return 'sc';
                return null;
            };

            const walk = (node: Node): string => {
                if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node as HTMLElement;
                    
                    // Handle footnotes: <sup data-footnote="..." class="footnote-marker">N</sup>
                    if (el.tagName.toLowerCase() === 'sup' && 
                        el.hasAttribute('data-footnote') && 
                        el.classList.contains('footnote-marker')) {
                        const footnoteContent = el.getAttribute('data-footnote') || '';
                        // Unescape HTML entities
                        const unescaped = footnoteContent
                            .replace(/&quot;/g, '"')
                            .replace(/&#39;/g, "'")
                            .replace(/&nbsp;/g, ' ');
                        
                        // Parse footnote HTML back to USFM
                        // Format: <p><em>reference: </em>text</p> or <p>text</p>
                        const parser = new DOMParser();
                        const footnoteDoc = parser.parseFromString(unescaped, 'text/html');
                        const footnotePara = footnoteDoc.body.querySelector('p');
                        
                        if (footnotePara) {
                            let reference = '';
                            let footnoteText = '';
                            
                            // Check for <em> tag (reference)
                            const emTag = footnotePara.querySelector('em');
                            if (emTag) {
                                reference = emTag.textContent?.trim() || '';
                                // Remove the reference from the paragraph
                                const textNodes = Array.from(footnotePara.childNodes)
                                    .filter(n => {
                                        if (n.nodeType === Node.TEXT_NODE) return true;
                                        if (n.nodeType === Node.ELEMENT_NODE) {
                                            const el = n as Element;
                                            return el.tagName.toLowerCase() !== 'em';
                                        }
                                        return false;
                                    })
                                    .map(n => {
                                        if (n.nodeType === Node.TEXT_NODE) return n.textContent || '';
                                        if (n.nodeType === Node.ELEMENT_NODE) {
                                            return htmlInlineToUsfm((n as HTMLElement).outerHTML);
                                        }
                                        return '';
                                    })
                                    .join('')
                                    .trim();
                                footnoteText = textNodes.replace(/^:?\s*/, '');
                            } else {
                                // No reference, just text
                                footnoteText = htmlInlineToUsfm(footnotePara.innerHTML);
                            }
                            
                            // Build USFM footnote: \f + \fr reference \ft text\f*
                            let usfmFootnote = '\\f +';
                            if (reference) {
                                usfmFootnote += ` \\fr ${reference}`;
                            }
                            if (footnoteText) {
                                usfmFootnote += ` \\ft ${footnoteText}`;
                            }
                            usfmFootnote += '\\f*';
                            
                            return usfmFootnote;
                        }
                    }
                    
                    const tag = inferMarkerFromElement(el);
                    const inner = Array.from(el.childNodes).map(walk).join('');
                    if (tag) {
                        return `\\${tag} ${inner}\\${tag}*`;
                    }
                    return inner;
                }
                return '';
            };
            
            return Array.from(container.childNodes).map(walk).join('');
        } catch (error) {
            console.warn('DOMParser failed, using regex fallback:', error);
        }
    }

    // Fallback: Regex-based approach for Node.js context
    let result = html;
    let changed = true;
    let iterations = 0;
    const maxIterations = 20;

    while (changed && iterations < maxIterations) {
        iterations++;
        changed = false;
        const before = result;

        // Match innermost tags with data-tag first
        result = result.replace(/<(\w+)[^>]*data-tag="([^"]+)"[^>]*>([^<]*)<\/\1>/gi, (match, tagName, dataTag, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\${dataTag} ${innerUsfm}\\${dataTag}*` : '';
        });

        // Handle semantic tags without data-tag
        result = result.replace(/<strong[^>]*>([^<]*)<\/strong>/gi, (match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\bd ${innerUsfm}\\bd*` : '';
        });
        result = result.replace(/<b[^>]*>([^<]*)<\/b>/gi, (match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\bd ${innerUsfm}\\bd*` : '';
        });
        result = result.replace(/<em[^>]*>([^<]*)<\/em>/gi, (match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\it ${innerUsfm}\\it*` : '';
        });
        result = result.replace(/<i[^>]*>([^<]*)<\/i>/gi, (match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\it ${innerUsfm}\\it*` : '';
        });
        // Handle footnotes BEFORE regular sup tags
        result = result.replace(/<sup[^>]*data-footnote="([^"]+)"[^>]*class="footnote-marker"[^>]*>(\d+)<\/sup>/gi, (match, footnoteContent, footnoteNum) => {
            changed = true;
            // Unescape HTML entities
            const unescaped = footnoteContent
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&nbsp;/g, ' ');
            
            // Parse footnote HTML: <p><em>reference: </em>text</p> or <p>text</p>
            // Use regex to extract reference and text
            const refMatch = unescaped.match(/<p><em>([^<]+):\s*<\/em>&nbsp;(.*?)<\/p>/);
            let usfmFootnote = '\\f +';
            
            if (refMatch) {
                const [, reference, text] = refMatch;
                usfmFootnote += ` \\fr ${reference.trim()}`;
                // Convert HTML in text back to USFM
                const textUsfm = htmlInlineToUsfm(text);
                if (textUsfm) {
                    usfmFootnote += ` \\ft ${textUsfm}`;
                }
            } else {
                // No reference, just text
                const textMatch = unescaped.match(/<p>(.*?)<\/p>/);
                if (textMatch) {
                    const textUsfm = htmlInlineToUsfm(textMatch[1]);
                    if (textUsfm) {
                        usfmFootnote += ` \\ft ${textUsfm}`;
                    }
                }
            }
            usfmFootnote += '\\f*';
            return usfmFootnote;
        });
        
        result = result.replace(/<sup[^>]*>([^<]*)<\/sup>/gi, (match, content) => {
            // Skip if this was already processed as a footnote
            if (match.includes('data-footnote')) return match;
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\sup ${innerUsfm}\\sup*` : '';
        });
        result = result.replace(/<span[^>]*style="[^"]*small-caps[^"]*"[^>]*>([^<]*)<\/span>/gi, (match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\sc ${innerUsfm}\\sc*` : '';
        });

        // Handle nested tags with data-tag (process recursively)
        result = result.replace(/<(\w+)[^>]*data-tag="([^"]+)"[^>]*>(.*?)<\/\1>/gi, (match, tagName, dataTag, content) => {
            if (content.includes('<')) {
                const innerUsfm = htmlInlineToUsfm(content);
                changed = true;
                return innerUsfm ? `\\${dataTag} ${innerUsfm}\\${dataTag}*` : '';
            }
            return match;
        });

        if (result === before) {
            changed = false;
        }
    }

    // Clean up any remaining HTML tags
    result = result.replace(/<[^>]+>/g, '');

    return result.trim();
};

