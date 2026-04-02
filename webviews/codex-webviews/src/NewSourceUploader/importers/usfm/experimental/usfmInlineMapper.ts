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

/**
 * Convert a USFM footnote to inline bracket format.
 * USFM markers and references go inside <> brackets, translatable text stays outside.
 * On export, stripping the brackets recovers valid USFM.
 *
 * Example: caller="+", body="\\fr 1:16. \\ft Quoting \\xt Leviticus 11:44-45\\xt*"
 * Result:  "<\\f + \\fr 1:16. \\ft> Quoting <\\xt> Leviticus <11:44-45\\xt*\\f*>"
 */
function footnoteToInlineBrackets(caller: string, footnoteBody: string): string {
    let result = '';
    let remaining = footnoteBody.trim();

    let bracket = `\\f ${caller}`;

    const frMatch = remaining.match(/^\\fr\s+([^\\]+?)(?=\\|$)/);
    if (frMatch) {
        bracket += ` \\fr ${frMatch[1].trim()}`;
        remaining = remaining.substring(frMatch[0].length).trimStart();
    }

    if (/^\\ft\b/.test(remaining)) {
        bracket += ' \\ft';
        remaining = remaining.replace(/^\\ft\s*/, '');
    }

    result += `<${bracket}>`;

    while (remaining.length > 0) {
        remaining = remaining.trimStart();
        if (remaining.length === 0) break;

        const xtOpenMatch = remaining.match(/^(\\[+]?xt)\s*/);
        if (xtOpenMatch) {
            remaining = remaining.substring(xtOpenMatch[0].length);
            const closerTag = xtOpenMatch[1] + '*';
            const closerIdx = remaining.indexOf(closerTag);

            if (closerIdx !== -1) {
                const xtContent = remaining.substring(0, closerIdx);
                remaining = remaining.substring(closerIdx + closerTag.length);

                const splitMatch = xtContent.match(/^(.*?)\s*(\d[\d:,\-\u2013.]*)$/);
                if (splitMatch && splitMatch[1].trim()) {
                    result += ` <${xtOpenMatch[1]}> ${splitMatch[1].trim()} <${splitMatch[2].trim()}${closerTag}>`;
                } else if (splitMatch && !splitMatch[1].trim()) {
                    result += ` <${xtOpenMatch[1]} ${xtContent.trim()}${closerTag}>`;
                } else {
                    result += ` <${xtOpenMatch[1]}> ${xtContent.trim()} <${closerTag}>`;
                }
            } else {
                result += ` <${xtOpenMatch[1]}>`;
            }
            continue;
        }

        const otherMarkerMatch = remaining.match(/^(\\[+]?[a-zA-Z]+\*?)\s*/);
        if (otherMarkerMatch) {
            result += ` <${otherMarkerMatch[1]}>`;
            remaining = remaining.substring(otherMarkerMatch[0].length);
            continue;
        }

        const textMatch = remaining.match(/^([^\\]+)/);
        if (textMatch) {
            const textContent = textMatch[1].trim();
            if (textContent) {
                if (/^[.,;:!?)}\]]/.test(textContent)) {
                    result += textContent;
                } else {
                    result += ` ${textContent}`;
                }
            }
            remaining = remaining.substring(textMatch[0].length);
            continue;
        }

        result += remaining[0];
        remaining = remaining.substring(1);
    }

    result = result.trimEnd();
    if (result.endsWith('>')) {
        result = result.slice(0, -1) + '\\f*>';
    } else {
        result += '<\\f*>';
    }

    return result.trim();
}

// Converts USFM inline markers (character-level styling) to HTML
export const convertUsfmInlineMarkersToHtml = (usfmText: string): string => {
    let processedText = usfmText;

    const footnoteRegex = /\\f\s+([+\-*]|\w+)\s*(.*?)\\f\*/gs;
    const footnoteReplacements: Map<string, string> = new Map();
    const PLACEHOLDER = '\uFFFD';

    const footnotes: Array<{ caller: string; body: string; position: number; length: number }> = [];
    let match;
    while ((match = footnoteRegex.exec(usfmText)) !== null) {
        footnotes.push({
            caller: match[1] || '+',
            body: match[2] || '',
            position: match.index,
            length: match[0].length,
        });
    }

    for (let i = footnotes.length - 1; i >= 0; i--) {
        const fn = footnotes[i];
        const bracketText = footnoteToInlineBrackets(fn.caller, fn.body);
        const htmlBracketText = bracketText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const placeholder = `${PLACEHOLDER}${i}${PLACEHOLDER}`;
        footnoteReplacements.set(placeholder, htmlBracketText);

        processedText = processedText.substring(0, fn.position) +
                      placeholder +
                      processedText.substring(fn.position + fn.length);
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

    for (const [placeholder, replacement] of footnoteReplacements) {
        out = out.replace(placeholder, replacement);
    }

    return out;
};

/**
 * Unescape all HTML entities in a footnote attribute value.
 * Handles both properly-escaped (new) and partially-escaped (legacy) content.
 */
function unescapeFootnoteHtml(raw: string): string {
    return raw
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

/**
 * Convert footnote inner HTML to USFM markers.
 * Handles both new format (data-tag spans) and legacy format (<em> based).
 */
function footnoteHtmlToUsfm(footnoteHtml: string): string {
    let usfm = '\\f +';

    // New format: <span data-tag="fr">ref</span> <span data-tag="ft">text</span>
    const frMatch = footnoteHtml.match(/<span[^>]*data-tag="fr"[^>]*>(.*?)<\/span>/);
    const ftMatch = footnoteHtml.match(/<span[^>]*data-tag="ft"[^>]*>([\s\S]*?)<\/span>/);

    if (frMatch || ftMatch) {
        console.log('[USFM Export] Footnote format: data-tag spans');
        if (frMatch) {
            usfm += ` \\fr ${frMatch[1].trim()}`;
        }
        if (ftMatch) {
            usfm += ` \\ft ${htmlInlineToUsfm(ftMatch[1])}`;
        }
    } else {
        // Legacy format: <p><em>reference: </em> text</p> or just <p>text</p>
        const emRefMatch = footnoteHtml.match(/<em[^>]*>([^<]+?):\s*<\/em>/);
        if (emRefMatch) {
            console.log('[USFM Export] Footnote format: legacy <em>, ref:', emRefMatch[1]);
            usfm += ` \\fr ${emRefMatch[1].trim()}`;
            const afterRef = footnoteHtml
                .replace(/<\/?p>/g, '')
                .replace(/<em[^>]*>[^<]*<\/em>/, '')
                .replace(/^\s*&?\s*(?:nbsp;)?\s*/, '')
                .trim();
            if (afterRef) {
                usfm += ` \\ft ${htmlInlineToUsfm(afterRef)}`;
            }
        } else {
            console.log('[USFM Export] Footnote format: no structured match, raw:', footnoteHtml.substring(0, 100));
            const innerText = footnoteHtml.replace(/<\/?p>/g, '').trim();
            if (innerText) {
                usfm += ` \\ft ${htmlInlineToUsfm(innerText)}`;
            }
        }
    }

    usfm += '\\f*';
    return usfm;
}

/**
 * Pre-process footnote <sup> elements by scanning the string character-by-character.
 * This avoids regex issues with > characters inside data-footnote attribute values.
 */
function processFootnoteSupElements(html: string): string {
    const SUP_OPEN = '<sup ';
    const SUP_CLOSE = '</sup>';
    let result = '';
    let pos = 0;

    while (pos < html.length) {
        const supStart = html.toLowerCase().indexOf(SUP_OPEN, pos);
        if (supStart === -1) {
            result += html.substring(pos);
            break;
        }

        result += html.substring(pos, supStart);

        // Find the closing > of the opening tag by tracking quoted attributes
        let tagEnd = -1;
        let inQuote: string | null = null;
        for (let i = supStart + SUP_OPEN.length; i < html.length; i++) {
            const ch = html[i];
            if (inQuote) {
                if (ch === inQuote) inQuote = null;
            } else if (ch === '"' || ch === "'") {
                inQuote = ch;
            } else if (ch === '>') {
                tagEnd = i;
                break;
            }
        }

        if (tagEnd === -1) {
            result += html.substring(supStart);
            break;
        }

        const openTag = html.substring(supStart, tagEnd + 1);

        // Find the matching </sup>
        const closeStart = html.toLowerCase().indexOf(SUP_CLOSE, tagEnd + 1);
        if (closeStart === -1) {
            result += html.substring(supStart);
            break;
        }

        const fullElement = html.substring(supStart, closeStart + SUP_CLOSE.length);
        pos = closeStart + SUP_CLOSE.length;

        // Check if this is a footnote marker
        if (!openTag.includes('footnote-marker') || !openTag.includes('data-footnote')) {
            result += fullElement;
            continue;
        }

        // Extract the data-footnote attribute value by finding the matching quotes
        // We can't use a simple regex because the value may contain > or other tricky chars.
        // Instead, locate the attribute start and walk through to find the closing quote.
        const attrPrefix = 'data-footnote="';
        const attrStart = openTag.indexOf(attrPrefix);
        if (attrStart === -1) {
            result += fullElement;
            continue;
        }
        const valueStart = attrStart + attrPrefix.length;
        const valueEnd = openTag.indexOf('"', valueStart);
        if (valueEnd === -1) {
            result += fullElement;
            continue;
        }
        const rawAttrValue = openTag.substring(valueStart, valueEnd);

        console.log('[USFM Export] Footnote raw attr value:', rawAttrValue.substring(0, 120));

        const footnoteHtml = unescapeFootnoteHtml(rawAttrValue);
        console.log('[USFM Export] Footnote unescaped HTML:', footnoteHtml.substring(0, 120));

        const usfmResult = footnoteHtmlToUsfm(footnoteHtml);
        console.log('[USFM Export] Footnote USFM result:', usfmResult);

        result += usfmResult;
    }

    return result;
}

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
                        const rawAttr = el.getAttribute('data-footnote') || '';
                        const footnoteHtml = unescapeFootnoteHtml(rawAttr);
                        return footnoteHtmlToUsfm(footnoteHtml);
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
            
            let domResult = Array.from(container.childNodes).map(walk).join('');
            domResult = domResult.replace(/<([^>]*\\[^>]*)>/g, '$1');
            return domResult;
        } catch (error) {
            console.warn('DOMParser failed, using regex fallback:', error);
        }
    }

    // Fallback: Regex-based approach for Node.js context
    // First, extract footnote <sup> elements before any other processing.
    // We can't use [^>]* inside these elements because the data-footnote attribute
    // may contain literal < and > characters (legacy imports didn't escape them).
    let result = processFootnoteSupElements(html);

    let changed = true;
    let iterations = 0;
    const maxIterations = 20;

    while (changed && iterations < maxIterations) {
        iterations++;
        changed = false;
        const before = result;

        // Match innermost tags with data-tag first
        result = result.replace(/<(\w+)[^>]*data-tag="([^"]+)"[^>]*>([^<]*)<\/\1>/gi, (_match, _tagName, dataTag, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\${dataTag} ${innerUsfm}\\${dataTag}*` : '';
        });

        // Handle semantic tags without data-tag
        result = result.replace(/<strong[^>]*>([^<]*)<\/strong>/gi, (_match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\bd ${innerUsfm}\\bd*` : '';
        });
        result = result.replace(/<b[^>]*>([^<]*)<\/b>/gi, (_match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\bd ${innerUsfm}\\bd*` : '';
        });
        result = result.replace(/<em[^>]*>([^<]*)<\/em>/gi, (_match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\it ${innerUsfm}\\it*` : '';
        });
        result = result.replace(/<i[^>]*>([^<]*)<\/i>/gi, (_match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\it ${innerUsfm}\\it*` : '';
        });

        result = result.replace(/<sup[^>]*>([^<]*)<\/sup>/gi, (_match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\sup ${innerUsfm}\\sup*` : '';
        });
        result = result.replace(/<span[^>]*style="[^"]*small-caps[^"]*"[^>]*>([^<]*)<\/span>/gi, (_match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\sc ${innerUsfm}\\sc*` : '';
        });

        // Handle nested tags with data-tag (process recursively)
        result = result.replace(/<(\w+)[^>]*data-tag="([^"]+)"[^>]*>(.*?)<\/\1>/gi, (_match, _tagName, dataTag, content) => {
            if (content.includes('<')) {
                const innerUsfm = htmlInlineToUsfm(content);
                changed = true;
                return innerUsfm ? `\\${dataTag} ${innerUsfm}\\${dataTag}*` : '';
            }
            return _match;
        });

        if (result === before) {
            changed = false;
        }
    }

    // Strip bracket-format footnotes (literal angle brackets) before HTML tag cleanup
    result = result.replace(/<([^>]*\\[^>]*)>/g, '$1');

    // Clean up any remaining HTML tags
    result = result.replace(/<[^>]+>/g, '');

    // Decode entity-encoded bracket-format footnotes, then strip those too
    result = result
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
    result = result.replace(/<([^>]*\\[^>]*)>/g, '$1');

    return result.trim();
};

