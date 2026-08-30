const SELF_CLOSING_TAGS = new Set([
    "br", "hr", "img", "input", "meta", "link",
    "area", "base", "col", "embed", "source", "track", "wbr",
]);

export const isSelfClosingHtmlTag = (tagName: string): boolean =>
    SELF_CLOSING_TAGS.has(tagName.toLowerCase());

/** Match one element covering the entire fragment, never adjacent siblings. */
export const matchFullWrapper = (
    html: string,
): { openTag: string; tagName: string; inner: string } | null => {
    const trimmed = html.trim();
    const openMatch = /^<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/.exec(trimmed);
    if (!openMatch || openMatch[0].endsWith("/>")) return null;
    const tagName = openMatch[1].toLowerCase();
    if (isSelfClosingHtmlTag(tagName)) return null;
    const closeTag = `</${tagName}>`;
    if (!trimmed.toLowerCase().endsWith(closeTag)) return null;
    const inner = trimmed.slice(openMatch[0].length, trimmed.length - closeTag.length);
    let depth = 0;
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(inner)) !== null) {
        if (match[1].toLowerCase() !== tagName) continue;
        if (match[0].startsWith("</")) {
            if (--depth < 0) return null;
        } else if (!match[0].endsWith("/>")) {
            depth++;
        }
    }
    return depth === 0 ? { openTag: openMatch[0], tagName, inner } : null;
};

export const peelWrapperChain = (
    html: string,
    accept: (openTag: string) => boolean,
): { openTags: string[]; closeTags: string[]; inner: string } => {
    const openTags: string[] = [];
    const closeTags: string[] = [];
    let inner = html;
    let wrapper = matchFullWrapper(inner);
    while (wrapper && accept(wrapper.openTag)) {
        openTags.push(wrapper.openTag);
        closeTags.unshift(`</${wrapper.tagName}>`);
        inner = wrapper.inner;
        wrapper = matchFullWrapper(inner);
    }
    return { openTags, closeTags, inner };
};
