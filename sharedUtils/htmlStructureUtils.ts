import { isSelfClosingHtmlTag as isSelfClosing, peelWrapperChain } from "./htmlWrapperUtils";
import {
    collapseAdjacentEquivalentStyledSpans,
    isDocxFormattingContext,
    restoreDocxFormatting,
    type HtmlStructureOptions,
} from "./docxHtmlFormatting";
export type { HtmlStructureOptions } from "./docxHtmlFormatting";

export interface HtmlStructureDiff {
    isMatch: boolean;
    errors: string[];
}

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

/**
 * Drop attribute-less empty `<span>&nbsp;</span>` spacers (the join marker
 * cell merge inserts between two cells). They are not round-trip structure.
 * Spans with attributes are preserved.
 */
const stripEmptyBareSpans = (html: string): string =>
    (html || "").replace(/<span>(?:\s|&nbsp;)*<\/span>/gi, "");

const summarizeTagList = (tags: string[]): string => {
    const counts = new Map<string, number>();
    for (const tag of tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([tag, count]) => (count > 1 ? `${count}× ${tag}` : tag))
        .join(", ");
};

/**
 * Extract normalized plain text from an HTML fragment. Used to detect when a
 * "resolved" translation actually reverted to the source-language text, and
 * to treat untranslated/placeholder cells as empty for structure checks.
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

/**
 * Untranslated cells and merge-spacer-only cells are not translations.
 * Flagging them as structure mismatches (and offering Resolve) is wrong:
 * there is no translation yet, and Resolve cannot invent one without
 * copying source-language text.
 */
export const isEmptyOrPlaceholderHtml = (html: string | undefined | null): boolean => {
    if (!html) return true;
    const text = extractPlainTextFromHtml(html).toLowerCase();
    return text.length === 0 || text === "click to translate" || text === "no text";
};

/** Inserted between two non-empty cells when they are merged. */
export const MERGE_CELL_SEPARATOR = "<span>&nbsp;</span>";

/**
 * Join two cell HTML fragments for a merge. Empty/placeholder cells stay
 * empty so they are not mistaken for translated content (which would trip
 * HTML structure enforcement). The spacer is only used when both sides
 * have real text.
 */
export const joinMergedCellHtml = (previousHtml: string, currentHtml: string): string => {
    const previousEmpty = isEmptyOrPlaceholderHtml(previousHtml);
    const currentEmpty = isEmptyOrPlaceholderHtml(currentHtml);
    if (!previousEmpty && !currentEmpty) {
        return `${previousHtml}${MERGE_CELL_SEPARATOR}${currentHtml}`;
    }
    if (!previousEmpty) return previousHtml;
    if (!currentEmpty) return currentHtml;
    return "";
};

/**
 * Normalize an HTML fragment for structure comparison. User line breaks are
 * allowed (Enter / Shift+Enter); InDesign spans, EOC markers, and other
 * real tags are still enforced. Applied to both sides:
 * - empty paragraphs (blank lines) are dropped,
 * - empty bare `<span>` spacers from cell merge are dropped,
 * - bare `<br>` tags are dropped (attributed breaks such as InDesign's
 *   `<br class="idml-eoc">` still count as structure),
 * - adjacent bare-paragraph boundaries are collapsed, so a paragraph the
 *   user split with Enter still compares as one block.
 */
const normalizeForStructureComparison = (html: string, options?: HtmlStructureOptions): string => {
    const cleaned = stripEmptyBareSpans(stripEmptyParagraphs(html));
    return (isDocxFormattingContext(options) ? collapseAdjacentEquivalentStyledSpans(cleaned) : cleaned)
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/p>\s*<p>/gi, " ");
};

export const compareHtmlStructure = (
    sourceHtml: string,
    targetHtml: string,
    options?: HtmlStructureOptions,
): HtmlStructureDiff => {
    // Untranslated / spacer-only targets are not mismatches. Checking them
    // would flag every empty cell against a paragraph-based source (IDML,
    // docx) and make Resolve fail after merging two untranslated cells.
    if (isEmptyOrPlaceholderHtml(targetHtml)) {
        return { isMatch: true, errors: [] };
    }

    const sourceSkeleton = extractHtmlSkeleton(normalizeForStructureComparison(sourceHtml, options));
    const targetSkeleton = extractHtmlSkeleton(normalizeForStructureComparison(targetHtml, options));
    if (sourceSkeleton === targetSkeleton) {
        return { isMatch: true, errors: [] };
    }
    const errors: string[] = [];
    const sourceTags = tokenizeSkeleton(sourceSkeleton);
    const targetTags = tokenizeSkeleton(targetSkeleton);
    const missingInTarget = tagDifference(sourceTags, targetTags);
    const extraInTarget = tagDifference(targetTags, sourceTags);
    if (missingInTarget.length > 0) {
        errors.push(`Missing tags: ${summarizeTagList(missingInTarget)}`);
    }
    if (extraInTarget.length > 0) {
        errors.push(`Extra tags: ${summarizeTagList(extraInTarget)}`);
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
 * Line breaks are never touched: the comparison tolerates them (see
 * `normalizeForStructureComparison`), so a user's Enter/Shift+Enter neither
 * flags a mismatch nor gets stripped by a resolve.
 *
 * Returns the fixed HTML only if the result verifiably matches the source
 * structure; returns null when no deterministic fix applies.
 */
export const tryDeterministicStructureFix = (
    sourceHtml: string,
    targetHtml: string,
    options?: HtmlStructureOptions,
): string | null => {
    if (isEmptyOrPlaceholderHtml(targetHtml)) return null;
    const docx = isDocxFormattingContext(options);
    const formattingFix = docx ? restoreDocxFormatting(sourceHtml, targetHtml) : null;
    if (formattingFix !== null && compareHtmlStructure(sourceHtml, formattingFix, options).isMatch) {
        return formattingFix;
    }
    if (compareHtmlStructure(sourceHtml, targetHtml, options).isMatch) return null;
    // DOCX uses the attribute-preserving repair above, never the generic
    // source-wrapper replacement that can overwrite target presentation.
    const rewrapped = docx ? null : rewrapWithSourceWrappers(sourceHtml, targetHtml);
    const candidates = [
        // Preferred: re-dressing with the source's verbatim wrappers keeps the
        // source's attributes (styles, data-style-id) for round-trip export.
        ...(rewrapped !== null ? [rewrapped] : []),
        convertBareSpanPairsToParagraphs(targetHtml),
        removeBareSpanPairs(targetHtml),
        removeBareParagraphPairs(targetHtml),
        removeBareParagraphPairs(removeBareSpanPairs(targetHtml)),
        // Plain-text targets (e.g. translations applied from other views) that
        // just need the source's single block wrapper.
        `<p>${targetHtml}</p>`,
    ];
    for (const candidate of candidates) {
        if (candidate !== targetHtml && compareHtmlStructure(sourceHtml, candidate, options).isMatch) {
            return candidate;
        }
    }
    return null;
};

/** Shared by cell warnings and Resolve All so attribute-only repairs are reachable. */
export const getHtmlStructureRepairDiff = (
    sourceHtml: string,
    targetHtml: string,
    options?: HtmlStructureOptions,
): HtmlStructureDiff => {
    const diff = compareHtmlStructure(sourceHtml, targetHtml, options);
    if (!diff.isMatch || !isDocxFormattingContext(options)) return diff;
    if (tryDeterministicStructureFix(sourceHtml, targetHtml, options) !== null) {
        return { isMatch: false, errors: ["Missing DOCX formatting attributes"] };
    }
    return diff;
};
