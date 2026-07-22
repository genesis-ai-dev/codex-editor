export interface HtmlStructureDiff {
    isMatch: boolean;
    errors: string[];
}

const SELF_CLOSING_TAGS = new Set([
    "br", "hr", "img", "input", "meta", "link",
    "area", "base", "col", "embed", "source", "track", "wbr",
]);

const isSelfClosing = (tagName: string): boolean =>
    SELF_CLOSING_TAGS.has(tagName.toLowerCase());

export const extractHtmlSkeleton = (html: string): string => {
    if (!html) return "";
    const skeleton: string[] = [];
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(html)) !== null) {
        const fullTag = match[0];
        const tagName = match[1].toLowerCase();
        if (fullTag.startsWith("</")) {
            skeleton.push(`</${tagName}>`);
        } else if (fullTag.endsWith("/>") || isSelfClosing(tagName)) {
            skeleton.push(`<${tagName}/>`);
        } else {
            skeleton.push(`<${tagName}>`);
        }
    }
    return skeleton.join("");
};

const tokenizeSkeleton = (skeleton: string): string[] => {
    const tags: string[] = [];
    const regex = /<\/?[a-zA-Z][a-zA-Z0-9]*\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(skeleton)) !== null) {
        tags.push(m[0]);
    }
    return tags;
};

const tagDifference = (a: string[], b: string[]): string[] => {
    const countB = new Map<string, number>();
    for (const tag of b) {
        countB.set(tag, (countB.get(tag) ?? 0) + 1);
    }
    const diff: string[] = [];
    for (const tag of a) {
        const remaining = countB.get(tag) ?? 0;
        if (remaining > 0) {
            countB.set(tag, remaining - 1);
        } else {
            diff.push(tag);
        }
    }
    return diff;
};

/**
 * Remove paragraphs that contain only whitespace and/or `<br>` tags (e.g.
 * Quill's `<p><br></p>` blank lines from Enter presses). Used to normalize
 * both sides before comparing structures, so a user adding or removing a
 * blank line never triggers a mismatch warning. Empty paragraphs carry no
 * text, so they are irrelevant to the round-trip export.
 */
const stripEmptyParagraphs = (html: string): string =>
    (html || "").replace(/<p\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "");

export const compareHtmlStructure = (
    sourceHtml: string,
    targetHtml: string,
): HtmlStructureDiff => {
    const sourceSkeleton = extractHtmlSkeleton(stripEmptyParagraphs(sourceHtml));
    const targetSkeleton = extractHtmlSkeleton(stripEmptyParagraphs(targetHtml));
    if (sourceSkeleton === targetSkeleton) {
        return { isMatch: true, errors: [] };
    }
    const errors: string[] = [];
    const sourceTags = tokenizeSkeleton(sourceSkeleton);
    const targetTags = tokenizeSkeleton(targetSkeleton);
    const missingInTarget = tagDifference(sourceTags, targetTags);
    const extraInTarget = tagDifference(targetTags, sourceTags);
    if (missingInTarget.length > 0) {
        errors.push(`Missing tags: ${missingInTarget.join(", ")}`);
    }
    if (extraInTarget.length > 0) {
        errors.push(`Extra tags: ${extraInTarget.join(", ")}`);
    }
    if (errors.length === 0 && sourceSkeleton !== targetSkeleton) {
        errors.push("Tag order or nesting differs from source");
    }
    return { isMatch: false, errors };
};

export const getStructureMismatchDescription = (
    diff: HtmlStructureDiff,
): string => {
    if (diff.isMatch) return "";
    if (diff.errors.length === 0) return "HTML structure does not match source";
    return diff.errors.join("; ");
};

/**
 * Locate matching attribute-less `<tagName>…</tagName>` pairs in an HTML
 * fragment. Returns [start, end) ranges of the opening and closing tags,
 * sorted by position. Tags with attributes (styles, data-tags) are ignored.
 */
const findBareTagRanges = (html: string, tagName: string): Array<[number, number]> => {
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g;
    const openTags: Array<{ start: number; end: number; isBare: boolean }> = [];
    const ranges: Array<[number, number]> = [];
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(html)) !== null) {
        const fullTag = match[0];
        if (match[1].toLowerCase() !== tagName) continue;
        if (fullTag.startsWith("</")) {
            const open = openTags.pop();
            if (open?.isBare) {
                ranges.push([open.start, open.end]);
                ranges.push([match.index, match.index + fullTag.length]);
            }
        } else if (!fullTag.endsWith("/>")) {
            openTags.push({
                start: match.index,
                end: match.index + fullTag.length,
                isBare: fullTag === `<${tagName}>`,
            });
        }
    }
    return ranges.sort((a, b) => a[0] - b[0]);
};

const replaceRanges = (
    html: string,
    ranges: Array<[number, number]>,
    replacement: (tag: string) => string,
): string => {
    let result = "";
    let last = 0;
    for (const [start, end] of ranges) {
        result += html.slice(last, start) + replacement(html.slice(start, end));
        last = end;
    }
    result += html.slice(last);
    return result;
};

/**
 * Remove attribute-less `<span>…</span>` pairs from an HTML fragment, keeping
 * their inner content. Spans with attributes (styles, data-tags) are preserved.
 *
 * These bare spans are artifacts of the LLM completion pipeline, which used to
 * wrap plain-text predictions in a `<span>` wrapper, causing structure
 * mismatches against source cells.
 */
export const removeBareSpanPairs = (html: string): string => {
    if (!html) return html;
    const ranges = findBareTagRanges(html, "span");
    if (ranges.length === 0) return html;
    return replaceRanges(html, ranges, () => "");
};

/**
 * Remove attribute-less `<p>…</p>` pairs from an HTML fragment, keeping their
 * inner content. The editor always wraps content in a block element, which
 * mismatches inline sources (e.g. USFM verse cells).
 */
export const removeBareParagraphPairs = (html: string): string => {
    if (!html) return html;
    const ranges = findBareTagRanges(html, "p");
    if (ranges.length === 0) return html;
    return replaceRanges(html, ranges, () => "");
};

/**
 * Convert attribute-less `<span>…</span>` pairs to `<p>…</p>` pairs.
 *
 * The cell editor's save pipeline historically converted a cell's first
 * paragraph to a bare span (the inline cell convention), which breaks the
 * structure of paragraph-based sources such as docx imports.
 */
export const convertBareSpanPairsToParagraphs = (html: string): string => {
    if (!html) return html;
    const ranges = findBareTagRanges(html, "span");
    if (ranges.length === 0) return html;
    return replaceRanges(html, ranges, (tag) => (tag === "<span>" ? "<p>" : "</p>"));
};

/**
 * If the (trimmed) fragment is exactly one element wrapping all remaining
 * content, return its opening tag, tag name, and inner content; otherwise null.
 */
const matchFullWrapper = (
    html: string,
): { openTag: string; tagName: string; inner: string } | null => {
    const trimmed = html.trim();
    const openMatch = /^<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/.exec(trimmed);
    if (!openMatch || openMatch[0].endsWith("/>")) return null;
    const tagName = openMatch[1].toLowerCase();
    if (isSelfClosing(tagName)) return null;
    const closeTag = `</${tagName}>`;
    if (!trimmed.toLowerCase().endsWith(closeTag)) return null;
    const inner = trimmed.slice(openMatch[0].length, trimmed.length - closeTag.length);
    // Reject when the closing tag at the end pairs with a nested opening tag
    // rather than the leading one (e.g. `<p>a</p><p>b</p>`).
    let depth = 0;
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = tagRegex.exec(inner)) !== null) {
        if (m[1].toLowerCase() !== tagName) continue;
        if (m[0].startsWith("</")) {
            depth--;
            if (depth < 0) return null;
        } else if (!m[0].endsWith("/>")) {
            depth++;
        }
    }
    return depth === 0 ? { openTag: openMatch[0], tagName, inner } : null;
};

/**
 * Peel off the chain of full-coverage wrapper elements accepted by `accept`,
 * outermost first. Returns the opening tags, matching closing tags (in
 * closing order), and the innermost content.
 */
const peelWrapperChain = (
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

/**
 * Re-dress a target fragment with the source's exact wrapper chain: peel the
 * bare `<p>`/`<span>` wrappers the editor leaves behind (Quill drops inline
 * styles it has no registered format for, e.g. docx `<span style="font-family:
 * …">` runs), then wrap the remaining content in the source's verbatim opening
 * tags. Never changes the target's text. Returns null when the source has no
 * wrapper chain to copy.
 */
export const rewrapWithSourceWrappers = (
    sourceHtml: string,
    targetHtml: string,
): string | null => {
    if (!sourceHtml || !targetHtml) return null;
    const source = peelWrapperChain(sourceHtml, () => true);
    if (source.openTags.length === 0) return null;
    const target = peelWrapperChain(
        targetHtml,
        (openTag) => openTag === "<p>" || openTag === "<span>",
    );
    if (!target.inner.trim()) return null;
    return source.openTags.join("") + target.inner + source.closeTags.join("");
};

/**
 * Attempt to fix a structure mismatch without an LLM. Handles the common
 * artifacts of the editing pipeline: spurious bare `<span>`/`<p>` wrappers
 * that should be removed, bare spans that should have been `<p>` tags, or
 * source wrapper chains (styled `<p>`/`<span>` from docx imports) that the
 * editor stripped on save.
 *
 * Returns the fixed HTML only if the result verifiably matches the source
 * structure; returns null when no deterministic fix applies.
 */
export const tryDeterministicStructureFix = (
    sourceHtml: string,
    targetHtml: string,
): string | null => {
    if (compareHtmlStructure(sourceHtml, targetHtml).isMatch) return null;
    const rewrapped = rewrapWithSourceWrappers(sourceHtml, targetHtml);
    const candidates = [
        // Preferred: re-dressing with the source's verbatim wrappers keeps the
        // source's attributes (styles, data-style-id) for round-trip export.
        ...(rewrapped !== null ? [rewrapped] : []),
        removeBareSpanPairs(targetHtml),
        convertBareSpanPairsToParagraphs(targetHtml),
        removeBareParagraphPairs(targetHtml),
        removeBareParagraphPairs(removeBareSpanPairs(targetHtml)),
        // Plain-text targets (e.g. translations applied from other views) that
        // just need the source's single block wrapper.
        `<p>${targetHtml}</p>`,
    ];
    for (const candidate of candidates) {
        if (candidate !== targetHtml && compareHtmlStructure(sourceHtml, candidate).isMatch) {
            return candidate;
        }
    }
    return null;
};

/**
 * Extract normalized plain text from an HTML fragment. Used to detect when a
 * "resolved" translation actually reverted to the source-language text.
 */
export const extractPlainTextFromHtml = (html: string): string =>
    (html || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
