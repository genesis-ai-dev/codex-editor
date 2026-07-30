/**
 * IDML content-segment round-trip utilities.
 *
 * Each <Content> node in a ParagraphStyleRange is one editable text slot.
 * Segments are joined with END_OF_CONTENT in stored plain text, and rendered
 * as indexed spans in HTML so export can map 1:1 back onto <Content> nodes
 * without rebuilding CharacterStyleRange XML.
 */

import type { IDMLParagraph } from "../indesign/types";

/** Plain-text/metadata delimiter (stored in metadata only, not in editor HTML). */
export const END_OF_CONTENT = "\u001E";

export function joinContentSegments(segments: string[]): string {
    return segments.join(END_OF_CONTENT);
}

export function splitContentSegments(markedText: string): string[] {
    if (!markedText.includes(END_OF_CONTENT)) {
        return [markedText];
    }
    return markedText.split(END_OF_CONTENT);
}

/**
 * Extract every <Content> text value inside a ParagraphStyleRange block, in document order.
 */
export function extractContentSegmentsFromParagraphXml(paragraphBlock: string): string[] {
    const segments: string[] = [];
    const contentRegex = /<Content>([\s\S]*?)<\/Content>/gi;
    let match: RegExpExecArray | null;
    while ((match = contentRegex.exec(paragraphBlock)) !== null) {
        segments.push(decodeXmlEntities(match[1] ?? ""));
    }
    return segments;
}

/**
 * Extract segments from parsed paragraph metadata (fallback when XML is unavailable).
 */
export interface ContentSegmentStructure {
    segments: string[];
    breakBefore: boolean[];
}

/**
 * Walk paragraph XML and collect each <Content> text plus whether a <Br /> precedes it.
 */
export function extractContentSegmentStructureFromParagraphXml(
    paragraphBlock: string
): ContentSegmentStructure {
    const segments: string[] = [];
    const breakBefore: boolean[] = [];
    let pendingBreak = false;

    const tokenRegex = /(<Content>[\s\S]*?<\/Content>)|(<Br\s*\/?>)/gi;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(paragraphBlock)) !== null) {
        if (match[1]) {
            const contentInner = /<Content>([\s\S]*?)<\/Content>/i.exec(match[1]);
            segments.push(decodeXmlEntities(contentInner?.[1] ?? ""));
            breakBefore.push(pendingBreak);
            pendingBreak = false;
        } else if (match[2]) {
            pendingBreak = true;
        }
    }

    return { segments, breakBefore };
}

export function extractContentSegmentStructureFromParagraph(
    paragraph: IDMLParagraph
): ContentSegmentStructure {
    if (Array.isArray(paragraph.contentSegments) && paragraph.contentSegments.length > 0) {
        const breakBefore = paragraph.contentSegmentBreakBefore ?? [];
        return {
            segments: [...paragraph.contentSegments],
            breakBefore: paragraph.contentSegments.map((_, index) => breakBefore[index] ?? false),
        };
    }

    const segments: string[] = [];
    const breakBefore: boolean[] = [];
    for (const range of paragraph.characterStyleRanges || []) {
        const content = range.content ?? "";
        if (!content) {
            continue;
        }
        const parts = content.split("\n");
        const endsWithBreak = content.endsWith("\n");
        const sliceEnd =
            endsWithBreak && parts.length > 0 && parts[parts.length - 1] === ""
                ? parts.length - 1
                : parts.length;
        for (let i = 0; i < sliceEnd; i++) {
            segments.push(parts[i] ?? "");
            breakBefore.push(i > 0);
        }
    }
    return { segments, breakBefore };
}

export function extractContentSegmentsFromParagraph(paragraph: IDMLParagraph): string[] {
    return extractContentSegmentStructureFromParagraph(paragraph).segments;
}

/**
 * Extract one character style per <Content> node from paragraph XML (document order).
 */
export function extractSegmentStylesFromParagraphXml(paragraphBlock: string): string[] {
    const styles: string[] = [];
    const csrRegex =
        /<CharacterStyleRange\b[^>]*AppliedCharacterStyle="([^"]*)"[^>]*>([\s\S]*?)<\/CharacterStyleRange>/gi;
    let csrMatch: RegExpExecArray | null;
    while ((csrMatch = csrRegex.exec(paragraphBlock)) !== null) {
        const style = csrMatch[1] ?? "";
        const inner = csrMatch[2] ?? "";
        const contentRegex = /<Content>([\s\S]*?)<\/Content>/gi;
        let contentMatch: RegExpExecArray | null;
        while ((contentMatch = contentRegex.exec(inner)) !== null) {
            styles.push(style);
        }
    }
    return styles;
}

/**
 * Replace only inner text of <Content> nodes; leave Br, style ranges, and all
 * other markup byte-identical unless the translated slot explicitly changed.
 */
export function replaceParagraphContentBySegments(
    paragraphBlock: string,
    segments: string[],
    xmlEscape: (value: string) => string,
    originalSegments?: string[],
    forceClearSegmentIndexes?: number[]
): string {
    const xmlOriginals = extractContentSegmentsFromParagraphXml(paragraphBlock);
    const originals =
        originalSegments && originalSegments.length > 0
            ? padSegmentArray(originalSegments, xmlOriginals.length, xmlOriginals)
            : xmlOriginals;
    const forceClear = new Set(forceClearSegmentIndexes ?? []);

    let segmentIndex = 0;
    return paragraphBlock.replace(/<Content>([\s\S]*?)<\/Content>/g, (match, oldInner: string) => {
        const xmlOriginal = decodeXmlEntities(oldInner ?? "");
        const slotOriginal = originals[segmentIndex] ?? xmlOriginal;
        const translated =
            segmentIndex < segments.length ? segments[segmentIndex] : undefined;
        const currentIndex = segmentIndex;
        segmentIndex += 1;

        if (translated === undefined) {
            return match;
        }

        if (forceClear.has(currentIndex)) {
            if (translated === "" && xmlOriginal === "") {
                return match;
            }
            return `<Content>${xmlEscape("")}</Content>`;
        }

        // Empty slot with original text usually means a mapping failure — keep XML as-is.
        if (translated.trim() === "" && slotOriginal.trim() !== "") {
            return match;
        }

        if (translated === slotOriginal || translated === xmlOriginal) {
            return match;
        }

        return `<Content>${xmlEscape(translated)}</Content>`;
    });
}

function padSegmentArray(
    segments: string[],
    expectedCount: number,
    fallback: string[]
): string[] {
    return Array.from({ length: expectedCount }, (_, index) => {
        if (index < segments.length) {
            return segments[index];
        }
        return fallback[index] ?? "";
    });
}

/**
 * Locate a top-level ParagraphStyleRange block by Self/id or by story order index.
 */
export function findParagraphBlockInStoryXml(
    storyXml: string,
    options: { paragraphId?: string; paragraphOrder?: number }
): { block: string; start: number; end: number } | null {
    const blocks = listTopLevelParagraphBlocks(storyXml);
    if (options.paragraphId) {
        const escapedId = escapeRegExp(options.paragraphId);
        const idPattern = new RegExp(
            `\\b(?:Self|id)=["']${escapedId}["']`,
            "i"
        );
        const byId = blocks.find(({ openTag }) => idPattern.test(openTag));
        if (byId) {
            return byId;
        }
    }

    if (typeof options.paragraphOrder === "number") {
        const byOrder = blocks[options.paragraphOrder];
        if (byOrder) {
            return byOrder;
        }
    }

    return null;
}

/**
 * Apply translated segments to one paragraph block without touching any other XML.
 */
export function applySegmentTranslationToParagraphBlock(
    paragraphBlock: string,
    translatedHtml: string,
    originalSegments?: string[],
    xmlEscape?: (value: string) => string,
    forceClearSegmentIndexes?: number[]
): string {
    const escape = xmlEscape ?? defaultXmlEscape;
    const xmlSegments = extractContentSegmentsFromParagraphXml(paragraphBlock);
    if (xmlSegments.length === 0) {
        return paragraphBlock;
    }

    const originals =
        originalSegments && originalSegments.length > 0
            ? padSegmentArray(originalSegments, xmlSegments.length, xmlSegments)
            : xmlSegments;

    const translatedSegments = resolveTranslatedSegments(
        translatedHtml,
        xmlSegments.length,
        originals
    );

    const forceClear = new Set(forceClearSegmentIndexes ?? []);
    const clearedSegments = translatedSegments.map((text, index) =>
        forceClear.has(index) ? "" : text
    );

    return replaceParagraphContentBySegments(
        paragraphBlock,
        clearedSegments,
        escape,
        originals,
        forceClearSegmentIndexes
    );
}

function listTopLevelParagraphBlocks(
    storyXml: string
): Array<{ block: string; start: number; end: number; openTag: string }> {
    const blocks: Array<{ block: string; start: number; end: number; openTag: string }> = [];
    let depth = 0;
    let currentStart = -1;
    let currentOpenTag = "";
    let inStory = false;
    let storyDepth = 0;

    const tagRegex = /<\/?(?:Story|ParagraphStyleRange)\b[^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(storyXml)) !== null) {
        const tag = match[0];
        const tagName = tag.match(/<\/?(\w+)/)?.[1];
        const isClosing = tag.startsWith("</");
        const pos = match.index;

        if (tagName === "Story") {
            if (isClosing) {
                storyDepth--;
                if (storyDepth === 0) {
                    inStory = false;
                }
            } else {
                storyDepth++;
                if (storyDepth === 1) {
                    inStory = true;
                    depth = 0;
                }
            }
            continue;
        }

        if (!inStory || tagName !== "ParagraphStyleRange") {
            continue;
        }

        if (isClosing) {
            depth--;
            if (depth === 0 && currentStart >= 0) {
                const end = pos + tag.length;
                blocks.push({
                    block: storyXml.slice(currentStart, end),
                    start: currentStart,
                    end,
                    openTag: currentOpenTag,
                });
                currentStart = -1;
                currentOpenTag = "";
            }
        } else if (depth === 0) {
            currentStart = pos;
            currentOpenTag = tag;
            depth++;
        } else {
            depth++;
        }
    }

    if (blocks.length > 0) {
        return blocks;
    }

    // Fallback when Story wrapper tags are absent from the XML fragment.
    const flatRegex = /<ParagraphStyleRange\b[^>]*>[\s\S]*?<\/ParagraphStyleRange>/gi;
    let flatMatch: RegExpExecArray | null;
    while ((flatMatch = flatRegex.exec(storyXml)) !== null) {
        const block = flatMatch[0];
        const start = flatMatch.index;
        blocks.push({
            block,
            start,
            end: start + block.length,
            openTag: block.match(/^<ParagraphStyleRange\b[^>]*>/i)?.[0] ?? "",
        });
    }

    return blocks;
}

function defaultXmlEscape(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when a paragraph has no text but contains Br runs (spacing / break paragraphs).
 */
export function isStructuralBreakParagraph(paragraph: IDMLParagraph): boolean {
    const segments = paragraph.contentSegments ?? extractContentSegmentsFromParagraph(paragraph);
    const hasText = segments.some((segment) => segment.trim().length > 0);
    if (hasText) {
        return false;
    }
    const combined = paragraph.paragraphStyleRange?.content ?? "";
    if (combined.includes("\n")) {
        return true;
    }
    const dataAfter = (paragraph.paragraphStyleRange as { dataAfter?: string[] })?.dataAfter;
    return Array.isArray(dataAfter) && dataAfter.length > 0;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function decodeXmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

/**
 * Derive one character style per content segment from parsed ranges.
 */
export function getSegmentCharacterStylesForParagraph(
    paragraph: IDMLParagraph,
    segmentCount: number
): string[] {
    const styles: string[] = [];
    const defaultStyle = "CharacterStyle/$ID/[No character style]";

    for (const range of paragraph.characterStyleRanges || []) {
        const content = range.content ?? "";
        if (!content && styles.length >= segmentCount) {
            continue;
        }

        const parts = content.split("\n");
        const endsWithBreak = content.endsWith("\n");
        const sliceEnd =
            endsWithBreak && parts.length > 0 && parts[parts.length - 1] === ""
                ? parts.length - 1
                : parts.length;

        for (let i = 0; i < sliceEnd; i++) {
            styles.push(range.appliedCharacterStyle || defaultStyle);
        }
    }

    if (styles.length === 0) {
        return Array.from({ length: segmentCount }, () => defaultStyle);
    }

    while (styles.length < segmentCount) {
        styles.push(styles[styles.length - 1] || defaultStyle);
    }

    return styles.slice(0, segmentCount);
}

/**
 * Build editor HTML with one span per content segment.
 * Segment boundaries are invisible in the UI; line breaks only where IDML had <Br />.
 */
export function buildSegmentedParagraphHtml(
    segments: string[],
    paragraphStyle: string,
    storyId: string,
    segmentStyles?: string[],
    breakBefore?: boolean[],
    options?: {
        segmentIndexOffset?: number;
        totalSegmentCount?: number;
        /** Original segment indexes to omit from editor HTML (structural apostrophes). */
        skipSegmentIndexes?: number[];
    }
): string {
    if (segments.length === 0) {
        return "";
    }

    const segmentIndexOffset = options?.segmentIndexOffset ?? 0;
    const totalSegmentCount = options?.totalSegmentCount ?? segments.length;
    const skipIndexes = new Set(options?.skipSegmentIndexes ?? []);
    const defaultStyle = "CharacterStyle/$ID/[No character style]";
    const spanParts: string[] = [];
    let previousVisibleIndex = -1;

    for (let i = 0; i < segments.length; i++) {
        if (skipIndexes.has(segmentIndexOffset + i)) {
            continue;
        }

        const segmentText = segments[i] ?? "";
        const charStyle = segmentStyles?.[i] ?? defaultStyle;

        if (previousVisibleIndex >= 0) {
            const isLineBreak = breakBefore?.[i] ?? false;
            if (isLineBreak) {
                spanParts.push(`<br class="idml-eoc" data-eoc="1" />`);
            } else {
                spanParts.push(`<span class="idml-eoc" data-eoc="1" aria-hidden="true"></span>`);
            }
        }

        spanParts.push(
            `<span class="idml-segment" data-segment-index="${segmentIndexOffset + i}" data-character-style="${escapeHtml(charStyle)}">${escapeHtml(segmentText)}</span>`
        );
        previousVisibleIndex = i;
    }

    if (spanParts.length === 0) {
        return "";
    }

    return `<p class="indesign-paragraph" data-paragraph-style="${escapeHtml(paragraphStyle)}" data-story-id="${escapeHtml(storyId)}" data-segment-count="${totalSegmentCount}">${spanParts.join("")}</p>`;
}

/**
 * Parse translated cell HTML back into content segments (preferred export path).
 */
export function parseSegmentsFromCellHtml(html: string): string[] | null {
    if (!html || !html.includes("data-segment-index")) {
        return null;
    }

    const spanRegex =
        /<span[^>]*\bdata-segment-index=["'](\d+)["'][^>]*>([\s\S]*?)<\/span>/gi;
    const indexed: { index: number; text: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = spanRegex.exec(html)) !== null) {
        const index = Number.parseInt(match[1], 10);
        if (Number.isNaN(index)) {
            continue;
        }
        const inner = (match[2] ?? "")
            .replace(/<span[^>]*\bdata-eoc=["']1["'][^>]*>[\s\S]*?<\/span>/gi, END_OF_CONTENT)
            .replace(/<br[^>]*\bdata-eoc=["']1["'][^>]*\/?>/gi, END_OF_CONTENT)
            .replace(/<br\s*\/?>/gi, END_OF_CONTENT)
            .replace(/<[^>]*>/g, "");
        indexed.push({ index, text: decodeXmlEntities(inner) });
    }

    if (indexed.length === 0) {
        return null;
    }

    indexed.sort((a, b) => a.index - b.index);
    const maxIndex = indexed[indexed.length - 1].index;
    const segments = Array.from({ length: maxIndex + 1 }, () => "");
    for (const item of indexed) {
        segments[item.index] = item.text;
    }
    return segments;
}

/**
 * Resolve translated segments using HTML spans, EOC markers, or safe fallbacks.
 */
export function resolveTranslatedSegments(
    translatedHtml: string,
    expectedSegmentCount: number,
    originalSegments?: string[]
): string[] {
    const fromHtml = parseSegmentsFromCellHtml(translatedHtml);
    if (fromHtml && fromHtml.length > 0) {
        return mergeTranslatedSegments(fromHtml, expectedSegmentCount, originalSegments);
    }

    const plain = stripCellHtmlToPlainText(translatedHtml);

    if (plain.includes(END_OF_CONTENT)) {
        return mergeTranslatedSegments(
            splitContentSegments(plain),
            expectedSegmentCount,
            originalSegments
        );
    }

    const trimmed = plain.trim();
    if (expectedSegmentCount <= 1) {
        return [trimmed];
    }

    const byNewline = trimmed.split("\n");
    if (byNewline.length === expectedSegmentCount) {
        return byNewline;
    }

    // Single edited blob for a multi-segment paragraph: update only text-bearing slots.
    if (originalSegments && originalSegments.length === expectedSegmentCount) {
        const textSlotIndexes = originalSegments
            .map((segment, index) => (segment.trim().length > 0 ? index : -1))
            .filter((index) => index >= 0);

        if (textSlotIndexes.length === 1) {
            const result = [...originalSegments];
            result[textSlotIndexes[0]] = trimmed;
            return result;
        }

        if (textSlotIndexes.length > 1) {
            return mergeTranslatedSegments([trimmed], expectedSegmentCount, originalSegments);
        }
    }

    return mergeTranslatedSegments([trimmed], expectedSegmentCount, originalSegments);
}

/**
 * Merge translated HTML from multiple cells that split one paragraph at line breaks.
 * Preserves original segment indices for surgical export.
 */
export function mergeSplitCellTranslations(
    cellHtmlList: string[],
    originalSegments: string[],
    breakBefore?: boolean[]
): string {
    const merged = [...originalSegments];

    for (const html of cellHtmlList) {
        const parsed = parseSegmentsFromCellHtml(html);
        if (!parsed) {
            continue;
        }
        for (let i = 0; i < parsed.length; i++) {
            const text = parsed[i];
            if (typeof text === "string" && text.trim().length > 0) {
                merged[i] = text;
            }
        }
    }

    return buildSegmentedParagraphHtml(merged, "", "", undefined, breakBefore, {
        totalSegmentCount: originalSegments.length,
    });
}

function stripCellHtmlToPlainText(html: string): string {
    return html
        .replace(/<span[^>]*\bdata-eoc=["']1["'][^>]*>[\s\S]*?<\/span>/gi, END_OF_CONTENT)
        .replace(/<br[^>]*\bdata-eoc=["']1["'][^>]*\/?>/gi, END_OF_CONTENT)
        .replace(/<br\s*\/?>/gi, END_OF_CONTENT)
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');
}

/**
 * Merge parsed translation onto the original segment scaffold.
 * Unmapped or empty slots keep the original text so Br/Content structure stays intact.
 */
function mergeTranslatedSegments(
    translated: string[],
    expectedCount: number,
    originalSegments?: string[]
): string[] {
    if (expectedCount <= 0) {
        return translated;
    }

    if (translated.length > expectedCount) {
        const head = translated.slice(0, expectedCount - 1);
        const tail = translated.slice(expectedCount - 1).join("");
        translated = [...head, tail];
    }

    return Array.from({ length: expectedCount }, (_, index) => {
        const candidate = translated[index];
        const hasTranslation =
            typeof candidate === "string" && candidate.trim().length > 0;

        if (hasTranslation) {
            return candidate;
        }

        if (originalSegments && index < originalSegments.length) {
            return originalSegments[index];
        }

        return candidate ?? "";
    });
}
