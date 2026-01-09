// Utilities to convert USFM inline/paragraph markers to HTML with data-tag attributes and back.
// This aims for round-trip fidelity rather than full semantic rendering.

const isAlphaNum = (ch: string) => /[A-Za-z0-9]/.test(ch);

// Converts USFM inline markers (character-level styling) to HTML, using semantic tags when obvious,
// always including data-tag to retain round-trip fidelity. Maintains a stack to close tags properly.
export const convertUsfmInlineMarkersToHtml = (usfmText: string): string => {
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
                // consume milestone suffix
                j += 2;
            }
            // Closing marker
            if (usfmText[j] === '*') {
                // Pop until matching 'name' if present in stack
                let idx = stack.length - 1;
                while (idx >= 0 && stack[idx].marker !== name) idx--;
                if (idx >= 0) {
                    const entry = stack.splice(idx, 1)[0];
                    // Close any entries after idx first (maintain order)
                    // But since USFM should be well-formed, idx should be top; handle generically
                    for (const closer of entry.closers) out += closer;
                } else {
                    // Fallback: generic span close
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
    // Close any dangling tags (defensive)
    while (stack.length > 0) {
        const entry = stack.pop()!;
        for (const closer of entry.closers) out += closer;
    }
    return out;
};

// Convert a paragraph-level USFM line like "\\p text" or "\\mt1 Title" to an HTML block
export const usfmBlockToHtml = (line: string): string => {
    const m = line.match(/^\\(\S+)(?:\s+)?(.*)$/);
    if (!m) return line;
    const tag = m[1];
    const text = m[2] || '';
    const inner = convertUsfmInlineMarkersToHtml(text);
    // Choose a reasonable HTML element; unknowns fall back to div
    let el = 'div';
    if (/^p[mri]?\d*$/.test(tag) || tag === 'p' || tag === 'b' || tag === 'nb') el = 'p';
    else if (/^mt\d*$/.test(tag) || /^ms\d*$/.test(tag) || /^s\d*$/.test(tag) || tag === 'r' || tag === 'd') el = 'h2';
    else if (/^q\d*$/.test(tag) || tag === 'qc' || tag === 'qr') el = 'p';
    return `<${el} data-tag="${tag}">${inner}</${el}>`;
};

// From HTML back to inline USFM for verse content
export const htmlInlineToUsfm = (html: string): string => {
    // Check if DOMParser is available (browser context)
    if (typeof DOMParser !== 'undefined') {
        try {
            // Use DOM to parse spans with data-tag
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
                // small-caps heuristic
                const style = el.getAttribute('style') || '';
                if (style.includes('small-caps')) return 'sc';
                return null;
            };
            const walk = (node: Node): string => {
                if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node as HTMLElement;
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
            // Fall through to regex-based approach if DOM parsing fails
            console.warn('DOMParser failed, using regex fallback:', error);
        }
    }

    // Fallback: Regex-based approach for Node.js context
    // Process nested tags by repeatedly processing innermost tags first
    let result = html;
    let changed = true;
    let iterations = 0;
    const maxIterations = 20; // Prevent infinite loops

    while (changed && iterations < maxIterations) {
        iterations++;
        changed = false;
        const before = result;

        // Match innermost tags (tags that don't contain other tags) - handle data-tag first
        result = result.replace(/<(\w+)[^>]*data-tag="([^"]+)"[^>]*>([^<]*)<\/\1>/gi, (match, tagName, dataTag, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\${dataTag} ${innerUsfm}\\${dataTag}*` : '';
        });

        // Handle semantic tags without data-tag (only if no nested tags)
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
        result = result.replace(/<sup[^>]*>([^<]*)<\/sup>/gi, (match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\sup ${innerUsfm}\\sup*` : '';
        });

        // Handle small-caps via style attribute
        result = result.replace(/<span[^>]*style="[^"]*small-caps[^"]*"[^>]*>([^<]*)<\/span>/gi, (match, content) => {
            changed = true;
            const innerUsfm = content.trim();
            return innerUsfm ? `\\sc ${innerUsfm}\\sc*` : '';
        });

        // Handle nested tags with data-tag (process recursively)
        result = result.replace(/<(\w+)[^>]*data-tag="([^"]+)"[^>]*>(.*?)<\/\1>/gi, (match, tagName, dataTag, content) => {
            // Only process if content still has tags (nested)
            if (content.includes('<')) {
                const innerUsfm = htmlInlineToUsfm(content); // Recursive call
                changed = true;
                return innerUsfm.trim() ? `\\${dataTag} ${innerUsfm}\\${dataTag}*` : '';
            }
            return match; // Leave for next iteration
        });

        // Handle nested semantic tags
        result = result.replace(/<strong[^>]*>(.*?)<\/strong>/gi, (match, content) => {
            if (content.includes('<')) {
                const innerUsfm = htmlInlineToUsfm(content);
                changed = true;
                return innerUsfm.trim() ? `\\bd ${innerUsfm}\\bd*` : '';
            }
            return match;
        });
        result = result.replace(/<em[^>]*>(.*?)<\/em>/gi, (match, content) => {
            if (content.includes('<')) {
                const innerUsfm = htmlInlineToUsfm(content);
                changed = true;
                return innerUsfm.trim() ? `\\it ${innerUsfm}\\it*` : '';
            }
            return match;
        });

        if (before === result) {
            changed = false;
        }
    }

    // Remove remaining HTML tags
    result = result.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    result = result.replace(/&nbsp;/g, ' ');
    result = result.replace(/&amp;/g, '&');
    result = result.replace(/&lt;/g, '<');
    result = result.replace(/&gt;/g, '>');
    result = result.replace(/&quot;/g, '"');
    result = result.replace(/&#39;/g, "'");
    result = result.replace(/&#x27;/g, "'");

    return result.trim();
};

// Helper to escape regex special characters
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// From HTML block (e.g., <p data-tag="p"> ... ) to USFM paragraph line
export const htmlBlockToUsfm = (html: string): string => {
    // Check if DOMParser is available (browser context)
    if (typeof DOMParser !== 'undefined') {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const el = doc.body.firstElementChild as HTMLElement | null;
            if (el) {
                const tag = el.getAttribute('data-tag');
                const inner = htmlInlineToUsfm(el.innerHTML);
                if (tag) {
                    const content = inner.trim();
                    return content.length > 0 ? `\\${tag} ${content}` : `\\${tag}`;
                }
                return inner;
            }
        } catch (error) {
            // Fall through to regex-based approach if DOM parsing fails
            console.warn('DOMParser failed in htmlBlockToUsfm, using regex fallback:', error);
        }
    }

    // Fallback: Regex-based approach for Node.js context
    const dataTagMatch = html.match(/<(\w+)[^>]*data-tag="([^"]+)"[^>]*>(.*?)<\/\1>/i);
    if (dataTagMatch) {
        const [, , tag, content] = dataTagMatch;
        const inner = htmlInlineToUsfm(content);
        const trimmed = inner.trim();
        return trimmed.length > 0 ? `\\${tag} ${trimmed}` : `\\${tag}`;
    }

    // No data-tag found, just convert inner content
    const innerMatch = html.match(/<[^>]+>(.*?)<\/[^>]+>/i);
    if (innerMatch) {
        return htmlInlineToUsfm(innerMatch[1]);
    }

    return htmlInlineToUsfm(html);
};



