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
 * Remove attribute-less `<span>…</span>` pairs from an HTML fragment, keeping
 * their inner content. Spans with attributes (styles, data-tags) are preserved.
 *
 * These bare spans are artifacts of the LLM completion pipeline, which used to
 * wrap plain-text predictions in a `<span>` wrapper, causing structure
 * mismatches against source cells.
 */
export const removeBareSpanPairs = (html: string): string => {
    if (!html) return html;
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g;
    const openSpans: Array<{ start: number; end: number; isBare: boolean }> = [];
    const removals: Array<[number, number]> = [];
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(html)) !== null) {
        const fullTag = match[0];
        if (match[1].toLowerCase() !== "span") continue;
        if (fullTag.startsWith("</")) {
            const open = openSpans.pop();
            if (open?.isBare) {
                removals.push([open.start, open.end]);
                removals.push([match.index, match.index + fullTag.length]);
            }
        } else if (!fullTag.endsWith("/>")) {
            openSpans.push({
                start: match.index,
                end: match.index + fullTag.length,
                isBare: fullTag === "<span>",
            });
        }
    }
    if (removals.length === 0) return html;
    removals.sort((a, b) => a[0] - b[0]);
    let result = "";
    let last = 0;
    for (const [start, end] of removals) {
        result += html.slice(last, start);
        last = end;
    }
    result += html.slice(last);
    return result;
};

/**
 * Attempt to fix a structure mismatch without an LLM. Currently handles the
 * common case of spurious bare `<span>` wrappers in the translation.
 *
 * Returns the fixed HTML only if the result verifiably matches the source
 * structure; returns null when no deterministic fix applies.
 */
export const tryDeterministicStructureFix = (
    sourceHtml: string,
    targetHtml: string,
): string | null => {
    if (compareHtmlStructure(sourceHtml, targetHtml).isMatch) return null;
    const unwrapped = removeBareSpanPairs(targetHtml);
    if (unwrapped === targetHtml) return null;
    return compareHtmlStructure(sourceHtml, unwrapped).isMatch ? unwrapped : null;
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
