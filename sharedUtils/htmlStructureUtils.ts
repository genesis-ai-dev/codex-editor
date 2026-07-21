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

export const compareHtmlStructure = (
    sourceHtml: string,
    targetHtml: string,
): HtmlStructureDiff => {
    const sourceSkeleton = extractHtmlSkeleton(sourceHtml);
    const targetSkeleton = extractHtmlSkeleton(targetHtml);
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
 * Attempt to fix a structure mismatch without an LLM. Handles the common
 * artifacts of the editing pipeline: spurious bare `<span>`/`<p>` wrappers
 * that should be removed, or bare spans that should have been `<p>` tags.
 *
 * Returns the fixed HTML only if the result verifiably matches the source
 * structure; returns null when no deterministic fix applies.
 */
export const tryDeterministicStructureFix = (
    sourceHtml: string,
    targetHtml: string,
): string | null => {
    if (compareHtmlStructure(sourceHtml, targetHtml).isMatch) return null;
    const candidates = [
        removeBareSpanPairs(targetHtml),
        convertBareSpanPairsToParagraphs(targetHtml),
        removeBareParagraphPairs(targetHtml),
        removeBareParagraphPairs(removeBareSpanPairs(targetHtml)),
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
