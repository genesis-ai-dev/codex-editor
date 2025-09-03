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
};

// From HTML block (e.g., <p data-tag="p"> ... ) to USFM paragraph line
export const htmlBlockToUsfm = (html: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const el = doc.body.firstElementChild as HTMLElement | null;
    if (!el) return html;
    const tag = el.getAttribute('data-tag');
    const inner = htmlInlineToUsfm(el.innerHTML);
    if (tag) {
        const content = inner.trim();
        return content.length > 0 ? `\\${tag} ${content}` : `\\${tag}`;
    }
    return inner;
};



