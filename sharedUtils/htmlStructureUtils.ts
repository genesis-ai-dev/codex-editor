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
