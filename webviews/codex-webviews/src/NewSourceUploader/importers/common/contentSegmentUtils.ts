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
 * Byte ranges of ParagraphStyleRange subtrees nested inside a paragraph block.
 *
 * InDesign puts tables inside the CharacterStyleRange of a host paragraph, and every table
 * cell holds its own ParagraphStyleRange. Those nested paragraphs are addressed as separate
 * paragraphs in their own right, so their <Content> slots must not be counted as, or
 * overwritten by, the host paragraph's segments.
 */
function getNestedParagraphRanges(paragraphBlock: string): Array<{ start: number; end: number; }> {
    const ranges: Array<{ start: number; end: number; }> = [];
    const tagRegex = /<(\/?)ParagraphStyleRange\b[^>]*?(\/?)>/gi;
    let depth = 0;
    let nestedStart = -1;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(paragraphBlock)) !== null) {
        const isClosing = match[1] === "/";
        const isSelfClosing = match[2] === "/";

        if (isSelfClosing) {
            if (depth >= 1 && nestedStart < 0) {
                ranges.push({ start: match.index, end: match.index + match[0].length });
            }
            continue;
        }

        if (isClosing) {
            depth--;
            if (depth === 1 && nestedStart >= 0) {
                ranges.push({ start: nestedStart, end: match.index + match[0].length });
                nestedStart = -1;
            }
            continue;
        }

        depth++;
        // depth 1 is the block's own ParagraphStyleRange; anything deeper is nested.
        if (depth === 2 && nestedStart < 0) {
            nestedStart = match.index;
        }
    }

    return ranges;
}

function isOffsetNested(offset: number, ranges: Array<{ start: number; end: number; }>): boolean {
    return ranges.some((range) => offset >= range.start && offset < range.end);
}

/**
 * Blank out nested paragraph subtrees, preserving length so offsets stay comparable to the
 * original block. Lets the segment regexes below read only the host paragraph's own markup.
 */
function maskNestedParagraphs(paragraphBlock: string): string {
    const ranges = getNestedParagraphRanges(paragraphBlock);
    if (ranges.length === 0) {
        return paragraphBlock;
    }

    let masked = paragraphBlock;
    for (const { start, end } of ranges) {
        masked = masked.slice(0, start) + " ".repeat(end - start) + masked.slice(end);
    }
    return masked;
}

/**
 * InDesign writes its special characters as processing instructions inside the text itself,
 * e.g. a table-of-contents line is <Content>Genesis<?ACE 8?>6</Content> where <?ACE 8?> is a
 * right indent tab. They are markup rather than translatable text, so each marker becomes its
 * own segment slot: the editor shows a tab in its place and export re-emits the original
 * instruction verbatim, whatever the translator did to that slot.
 */
const ACE_MARKER_DISPLAY_TEXT = "\t";

interface ContentPart {
    /** Segment text: the decoded content, or the stand-in shown for a marker. */
    text: string;
    /** Source bytes of this slot, re-emitted verbatim when the slot is left alone. */
    raw: string;
    /** True for the instruction slots, which are never rewritten from cell text. */
    isMarker: boolean;
}

/**
 * Break one <Content> body into alternating text and marker slots. Empty text runs around a
 * marker are dropped, so the same input always yields the same slot count on both the import
 * and the export side.
 */
function splitContentInnerParts(inner: string): ContentPart[] {
    const markerRegex = /<\?ACE\s+\d+\?>/gi;
    if (!markerRegex.test(inner)) {
        return [{ text: decodeXmlEntities(inner), raw: inner, isMarker: false }];
    }
    markerRegex.lastIndex = 0;

    const parts: ContentPart[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = markerRegex.exec(inner)) !== null) {
        const before = inner.slice(lastIndex, match.index);
        if (before.length > 0) {
            parts.push({ text: decodeXmlEntities(before), raw: before, isMarker: false });
        }
        parts.push({ text: ACE_MARKER_DISPLAY_TEXT, raw: match[0], isMarker: true });
        lastIndex = match.index + match[0].length;
    }

    const tail = inner.slice(lastIndex);
    if (tail.length > 0) {
        parts.push({ text: decodeXmlEntities(tail), raw: tail, isMarker: false });
    }
    return parts;
}

/**
 * Extract every <Content> text value owned by a ParagraphStyleRange block, in document order.
 * Content inside nested paragraphs (table cells) belongs to those paragraphs and is skipped.
 */
export function extractContentSegmentsFromParagraphXml(paragraphBlock: string): string[] {
    const ownBlock = maskNestedParagraphs(paragraphBlock);
    const segments: string[] = [];
    const contentRegex = /<Content>([\s\S]*?)<\/Content>/gi;
    let match: RegExpExecArray | null;
    while ((match = contentRegex.exec(ownBlock)) !== null) {
        for (const part of splitContentInnerParts(match[1] ?? "")) {
            segments.push(part.text);
        }
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
    const ownBlock = maskNestedParagraphs(paragraphBlock);
    const segments: string[] = [];
    const breakBefore: boolean[] = [];
    let pendingBreak = false;

    const tokenRegex = /(<Content>[\s\S]*?<\/Content>)|(<Br\s*\/?>)/gi;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(ownBlock)) !== null) {
        if (match[1]) {
            const contentInner = /<Content>([\s\S]*?)<\/Content>/i.exec(match[1]);
            for (const part of splitContentInnerParts(contentInner?.[1] ?? "")) {
                segments.push(part.text);
                // Only the first slot of a <Content> can sit after a <Br />.
                breakBefore.push(pendingBreak);
                pendingBreak = false;
            }
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
    const ownBlock = maskNestedParagraphs(paragraphBlock);
    const styles: string[] = [];
    const csrRegex =
        /<CharacterStyleRange\b[^>]*AppliedCharacterStyle="([^"]*)"[^>]*>([\s\S]*?)<\/CharacterStyleRange>/gi;
    let csrMatch: RegExpExecArray | null;
    while ((csrMatch = csrRegex.exec(ownBlock)) !== null) {
        const style = csrMatch[1] ?? "";
        const inner = csrMatch[2] ?? "";
        const contentRegex = /<Content>([\s\S]*?)<\/Content>/gi;
        let contentMatch: RegExpExecArray | null;
        while ((contentMatch = contentRegex.exec(inner)) !== null) {
            const slotCount = splitContentInnerParts(contentMatch[1] ?? "").length;
            for (let slot = 0; slot < slotCount; slot++) {
                styles.push(style);
            }
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
    const nestedRanges = getNestedParagraphRanges(paragraphBlock);

    let segmentIndex = 0;
    return paragraphBlock.replace(/<Content>([\s\S]*?)<\/Content>/g, (match, oldInner: string, offset: number) => {
        // Nested table-cell paragraphs are addressed separately; leave their slots untouched.
        if (isOffsetNested(offset, nestedRanges)) {
            return match;
        }

        const parts = splitContentInnerParts(oldInner ?? "");
        const baseIndex = segmentIndex;
        segmentIndex += parts.length;

        let changed = false;
        const rebuilt: string[] = [];

        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
            const part = parts[partIndex];

            // Marker slots are markup the translator never owns; restore them untouched.
            if (part.isMarker) {
                rebuilt.push(part.raw);
                continue;
            }

            const currentIndex = baseIndex + partIndex;
            const xmlOriginal = part.text;
            const slotOriginal = originals[currentIndex] ?? xmlOriginal;
            const translated =
                currentIndex < segments.length ? segments[currentIndex] : undefined;

            if (translated === undefined) {
                rebuilt.push(part.raw);
                continue;
            }

            if (forceClear.has(currentIndex)) {
                if (!(translated === "" && xmlOriginal === "")) {
                    changed = true;
                }
                rebuilt.push(xmlEscape(""));
                continue;
            }

            // Empty slot with original text usually means a mapping failure — keep XML as-is.
            if (translated.trim() === "" && slotOriginal.trim() !== "") {
                rebuilt.push(part.raw);
                continue;
            }

            if (translated === slotOriginal || translated === xmlOriginal) {
                rebuilt.push(part.raw);
                continue;
            }

            rebuilt.push(xmlEscape(translated));
            changed = true;
        }

        if (!changed) {
            return match;
        }

        return `<Content>${rebuilt.join("")}</Content>`;
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
 * Locate a ParagraphStyleRange block by Self/id or by story order index.
 */
export function findParagraphBlockInStoryXml(
    storyXml: string,
    options: { paragraphId?: string; paragraphOrder?: number; }
): { block: string; start: number; end: number; } | null {
    const blocks = listParagraphBlocksInDocumentOrder(storyXml);
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
 * Apostrophes are their own <Content> slot, so "Aaron's walking stick" is
 * three slots: "Aaron" / "'" / "s walking stick". Translators replace the
 * headword with the full target phrase ("O cajado de Arão") and the English
 * tail is left unmatched. Clear that untranslated follower with the apostrophe
 * so export does not emit “O cajado de Arão:s walking stick”.
 */
export function expandForceClearWithUntranslatedFollowers(
    forceClearIndexes: number[] | undefined,
    originalSegments: string[],
    translatedSegments: string[]
): number[] {
    const expanded = [...(forceClearIndexes ?? [])];
    const seen = new Set(expanded);

    for (const index of forceClearIndexes ?? []) {
        const follower = index + 1;
        if (follower >= originalSegments.length || seen.has(follower)) {
            continue;
        }

        const original = originalSegments[follower] ?? "";
        if (original.trim() === "") {
            continue;
        }

        const translated = translatedSegments[follower] ?? "";
        const independentlyTranslated =
            translated.trim() !== "" && translated !== original;
        if (independentlyTranslated) {
            continue;
        }

        expanded.push(follower);
        seen.add(follower);
    }

    return expanded;
}

/**
 * Slots the translator emptied by folding their text into a neighbouring run.
 *
 * IDML gives every character style its own <Content> slot, so "Ahijah the
 * prophet" arrives as three slots (key term / plain / key term). A translator
 * who renders the whole phrase in the first slot leaves the other two empty,
 * and falling back to the source text there prints the English straight back
 * into the translated note ("Aías the prophetpara ser rei…").
 *
 * The same folding strands the tail of a paragraph. Structural apostrophes give
 * the English extra slots ("Hamanʼs" is three), so a translation that renders
 * the paragraph in fewer runs runs out of slots early and every remaining one is
 * left empty. `parsedSegments` ends at the last slot the cell actually rendered a
 * span for, which separates the two cases: an empty entry within that range was
 * emitted as empty on purpose, while anything past it is simply unknown and keeps
 * its source text. Slots before the first translated run keep it too — nothing
 * has been written yet for them to have been folded into.
 */
export function findAbandonedSegmentIndexes(
    originalSegments: string[],
    parsedSegments: string[],
    preserveSegmentIndexes?: number[]
): number[] {
    const preserve = new Set(preserveSegmentIndexes ?? []);
    const isFilled = (index: number): boolean =>
        (parsedSegments[index] ?? "").trim().length > 0;

    const abandoned: number[] = [];
    let filledBefore = false;
    for (let index = 0; index < originalSegments.length; index++) {
        if (isFilled(index)) {
            filledBefore = true;
            continue;
        }
        if (!filledBefore || index >= parsedSegments.length || preserve.has(index)) {
            continue;
        }
        if ((originalSegments[index] ?? "").trim().length > 0) {
            abandoned.push(index);
        }
    }

    return abandoned;
}

function mergeIndexLists(...lists: number[][]): number[] {
    return [...new Set(lists.flat())].sort((a, b) => a - b);
}

/** A run of digits and punctuation, then the first word: "4:1 – 5:32 A ". */
const REFERENCE_THEN_WORDS = /^([^\p{L}]*\p{Nd}[^\p{L}]*)(\p{L}[\s\S]*)$/u;
const digitsOf = (value: string): string => value.replace(/[^\p{Nd}]/gu, "");

/**
 * Note body text that slid forward into the passage reference styling it.
 *
 * A note opens with its reference in a bold run of its own ("4:1 – 5:32") and
 * the body starts in the next run. Where the translation needs fewer runs than
 * the English — Portuguese opening "A linhagem" against an English "The" that
 * sits in its own run before the key term — the reflow packs the body's first
 * word into the reference run, and export prints it bold: "4:1 – 5:32 A".
 *
 * References are digits, so the source run holds no letters whatsoever. Letters
 * the translation left there are body text, and the run after it is where they
 * were headed. Requiring the reference itself to have survived in place keeps
 * this to that repair and away from paragraphs whose runs are wholly shifted.
 */
export function moveReferenceRunSpilloverToBody(
    translatedSegments: string[],
    originalSegments: string[],
    blockedIndexes?: Set<number>
): string[] {
    const result = [...translatedSegments];

    for (let index = 0; index < result.length; index++) {
        const destination = index + 1;
        if (blockedIndexes?.has(index) || blockedIndexes?.has(destination)) {
            continue;
        }

        const original = originalSegments[index] ?? "";
        if (!original.trim() || /\p{L}/u.test(original) || !/\p{Nd}/u.test(original)) {
            continue;
        }

        const spillover = REFERENCE_THEN_WORDS.exec(result[index] ?? "");
        if (!spillover || digitsOf(spillover[1]) !== digitsOf(original)) {
            continue;
        }

        // Only hand the words to a run the translator already wrote in; an empty
        // one still falls back to its English source, which we would be erasing.
        const body = result[destination];
        if (!body?.trim()) {
            continue;
        }

        const reference = spillover[1].replace(/\s+$/u, "");
        result[index] = reference;
        result[destination] = `${spillover[1].slice(reference.length)}${spillover[2]}${body}`;
    }

    return result;
}

/** Trailing clause marks that leaked onto a key-term / bold run: "Davi.", "Jeoacaz,". */
const BOLD_THEN_PUNCT = /^(.*\p{L}\p{M}*)(\s*[.,;:!?…]+)\s*$/u;
const ENDS_WITH_CLAUSE_PUNCT = /[.,;:!?…]\s*$/u;

/**
 * Key-term and other emphasised character styles whose leftover punctuation
 * should sit in the following plain run, not in the bold itself.
 */
function isEmphasizedCharacterStyle(style: string | undefined): boolean {
    if (!style) {
        return false;
    }
    const normalized = style.replace(/%3a/gi, ":").toLowerCase();
    return (
        /(?:^|[/:])(?:k_)?xt(?:$|[/:_])/i.test(normalized) ||
        normalized.includes("bold") ||
        /(?:^|[/:])bd(?:$|[/:_])/i.test(normalized)
    );
}

function destinationAlreadyHasPunct(destination: string, punct: string): boolean {
    const marks = punct.replace(/\s+/gu, "");
    const leading = /^\s*([.,;:!?…]+)/u.exec(destination)?.[1] ?? "";
    return leading.length > 0 && marks.length > 0 && leading[0] === marks[0];
}

/**
 * Leftover "." / "," (and the rest of the clause marks) that slid onto a
 * bold or key-term run.
 *
 * IDML keeps "David" in a `k_xt` run and the following "." or "," in the
 * plain run after it. When the translation needs fewer runs, the mark is
 * packed onto the name — InDesign then prints **Davi.** / **Jeoacaz,**. The
 * name itself is still in place (the original run has letters and no
 * trailing mark), so the extra punctuation is handed to the next run.
 *
 * Headings that are two bold slots on purpose (`1:1–31` / `Isaiah`) are
 * left alone: the destination is emphasised as well, so there is no plain
 * run to receive the mark.
 */
export function moveBoldPunctuationSpilloverToBody(
    translatedSegments: string[],
    originalSegments: string[],
    blockedIndexes?: Set<number>,
    segmentStyles?: string[]
): string[] {
    const result = [...translatedSegments];

    for (let index = 0; index < result.length; index++) {
        const destination = index + 1;
        if (blockedIndexes?.has(index) || blockedIndexes?.has(destination)) {
            continue;
        }

        const original = originalSegments[index] ?? "";
        if (!original.trim() || !/\p{L}/u.test(original) || ENDS_WITH_CLAUSE_PUNCT.test(original)) {
            continue;
        }

        const hasStyles = (segmentStyles?.length ?? 0) > 0;
        if (hasStyles && !isEmphasizedCharacterStyle(segmentStyles?.[index])) {
            continue;
        }
        if (hasStyles && isEmphasizedCharacterStyle(segmentStyles?.[destination])) {
            continue;
        }

        const spillover = BOLD_THEN_PUNCT.exec(result[index] ?? "");
        if (!spillover) {
            continue;
        }

        const body = result[destination];
        if (!body?.trim()) {
            continue;
        }

        const word = spillover[1];
        const punct = spillover[2].replace(/\s+$/u, "");
        result[index] = word;
        if (!destinationAlreadyHasPunct(body, punct)) {
            result[destination] = `${punct.replace(/^\s+/u, "")}${body}`;
        }
    }

    return result;
}

/**
 * Apply translated segments to one paragraph block without touching any other XML.
 *
 * `preserveSegmentIndexes` names slots that are hidden from the editor but must
 * keep their source value — Biblica's chapter/verse delimiters, which IDML needs
 * to bound each verse.
 */
export function applySegmentTranslationToParagraphBlock(
    paragraphBlock: string,
    translatedHtml: string,
    originalSegments?: string[],
    xmlEscape?: (value: string) => string,
    forceClearSegmentIndexes?: number[],
    preserveSegmentIndexes?: number[]
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

    // Emptied slots are only recognisable before `resolveTranslatedSegments`
    // refills them from the source; without spans there is no per-slot signal.
    const parsedSegments = parseSegmentsFromCellHtml(translatedHtml);

    const forceClearIndexes = mergeIndexLists(
        expandForceClearWithUntranslatedFollowers(
            forceClearSegmentIndexes,
            originals,
            translatedSegments
        ),
        parsedSegments
            ? findAbandonedSegmentIndexes(
                originals,
                parsedSegments,
                preserveSegmentIndexes
            )
            : []
    );
    const forceClear = new Set(forceClearIndexes);
    const blocked = new Set([...forceClear, ...(preserveSegmentIndexes ?? [])]);
    const reflowed = moveBoldPunctuationSpilloverToBody(
        moveReferenceRunSpilloverToBody(translatedSegments, originals, blocked),
        originals,
        blocked,
        extractSegmentStylesFromParagraphXml(paragraphBlock)
    );
    const clearedSegments = reflowed.map((text, index) =>
        forceClear.has(index) ? "" : text
    );

    return replaceParagraphContentBySegments(
        paragraphBlock,
        clearedSegments,
        escape,
        originals,
        forceClearIndexes
    );
}

/**
 * Every ParagraphStyleRange block in the story, ordered by opening tag position.
 *
 * Nested paragraphs (table cells) are included so this order matches DOM
 * getElementsByTagName("ParagraphStyleRange") — the order the parser numbers paragraphs by.
 * Paragraph ranges carry no Self attribute in Biblica IDML, so this index is the only
 * addressing available and both sides have to count identically.
 */
function listParagraphBlocksInDocumentOrder(
    storyXml: string
): Array<{ block: string; start: number; end: number; openTag: string; }> {
    const collect = (requireStoryWrapper: boolean) => {
        const found: Array<{ block: string; start: number; end: number; openTag: string; }> = [];
        const openStack: Array<{ start: number; openTag: string; }> = [];
        let inStory = !requireStoryWrapper;
        let storyDepth = 0;

        const tagRegex = /<(\/?)(Story|ParagraphStyleRange)\b[^>]*?(\/?)>/gi;
        let match: RegExpExecArray | null;

        while ((match = tagRegex.exec(storyXml)) !== null) {
            const tag = match[0];
            const isClosing = match[1] === "/";
            const tagName = match[2];
            const isSelfClosing = match[3] === "/";

            if (tagName === "Story") {
                if (!requireStoryWrapper) {
                    continue;
                }
                if (isSelfClosing) {
                    continue;
                }
                if (isClosing) {
                    storyDepth--;
                    if (storyDepth === 0) {
                        inStory = false;
                    }
                } else {
                    storyDepth++;
                    inStory = true;
                }
                continue;
            }

            if (!inStory) {
                continue;
            }

            if (isSelfClosing) {
                found.push({
                    block: tag,
                    start: match.index,
                    end: match.index + tag.length,
                    openTag: tag,
                });
                continue;
            }

            if (isClosing) {
                const open = openStack.pop();
                if (open) {
                    const end = match.index + tag.length;
                    found.push({
                        block: storyXml.slice(open.start, end),
                        start: open.start,
                        end,
                        openTag: open.openTag,
                    });
                }
                continue;
            }

            openStack.push({ start: match.index, openTag: tag });
        }

        return found.sort((a, b) => a.start - b.start);
    };

    const withinStory = collect(true);
    if (withinStory.length > 0) {
        return withinStory;
    }

    // Fallback when Story wrapper tags are absent from the XML fragment.
    return collect(false);
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
    const dataAfter = (paragraph.paragraphStyleRange as { dataAfter?: string[]; })?.dataAfter;
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
        /**
         * Indexes that split a single word, to be folded into the run that opened it
         * along with the run that follows them.
         */
        joinSegmentIndexes?: number[];
    }
): string {
    if (segments.length === 0) {
        return "";
    }

    const segmentIndexOffset = options?.segmentIndexOffset ?? 0;
    const totalSegmentCount = options?.totalSegmentCount ?? segments.length;
    const skipIndexes = new Set(options?.skipSegmentIndexes ?? []);
    const joinIndexes = new Set(options?.joinSegmentIndexes ?? []);
    const defaultStyle = "CharacterStyle/$ID/[No character style]";

    // IDML sets the apostrophe of "Hamanʼs" in its own font, so the word arrives as
    // three slots. A joined slot keeps its text but gives up its own span, and so does
    // the slot after it, leaving the translator one run holding the whole word.
    const runs: Array<{ index: number; style: string; text: string; lineBreak: boolean; }> = [];
    let joinFollowing = false;

    for (let i = 0; i < segments.length; i++) {
        const index = segmentIndexOffset + i;
        const openRun = runs[runs.length - 1];
        const joinsWord = joinIndexes.has(index) && openRun !== undefined;

        if (openRun && (joinsWord || joinFollowing)) {
            openRun.text += segments[i] ?? "";
            joinFollowing = joinsWord;
            continue;
        }

        joinFollowing = false;
        if (skipIndexes.has(index)) {
            continue;
        }

        runs.push({
            index,
            style: segmentStyles?.[i] ?? defaultStyle,
            text: segments[i] ?? "",
            lineBreak: breakBefore?.[i] ?? false,
        });
    }

    const spanParts: string[] = [];
    runs.forEach((run, position) => {
        if (position > 0) {
            spanParts.push(
                run.lineBreak
                    ? `<br class="idml-eoc" data-eoc="1" />`
                    : `<span class="idml-eoc" data-eoc="1" aria-hidden="true"></span>`
            );
        }
        spanParts.push(
            `<span class="idml-segment" data-segment-index="${run.index}" data-character-style="${escapeHtml(run.style)}">${escapeHtml(run.text)}</span>`
        );
    });

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
    const indexed: { index: number; text: string; }[] = [];
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

/** Inclusive range of paragraph slots that one split cell is responsible for. */
export interface SegmentRange {
    start: number;
    end: number;
}

/**
 * Fallback when the caller cannot say which slots a cell owns: its filled spans
 * bound it. Gaps at the edges then stay with the scaffold, so a run emptied
 * right at a cell boundary keeps its source text rather than being dropped.
 */
function inferRangeFromFilledSlots(parsed: string[]): SegmentRange | undefined {
    const filled = parsed
        .map((text, index) => (text.trim().length > 0 ? index : -1))
        .filter((index) => index >= 0);
    return filled.length === 0
        ? undefined
        : { start: filled[0], end: filled[filled.length - 1] };
}

/**
 * Merge translated HTML from multiple cells that split one paragraph at line breaks.
 * Preserves original segment indices for surgical export.
 *
 * Within the slots a cell owns, an empty span means the translator folded that
 * run into a neighbour; blanking it here is what lets the export step tell a
 * folded run apart from an untranslated one. Slots outside the cell's range
 * belong to a sibling cell and keep their scaffold value.
 */
export function mergeSplitCellTranslations(
    cellHtmlList: string[],
    originalSegments: string[],
    breakBefore?: boolean[],
    cellRanges?: (SegmentRange | undefined)[]
): string {
    const merged = [...originalSegments];

    cellHtmlList.forEach((html, cellIndex) => {
        const parsed = parseSegmentsFromCellHtml(html);
        if (!parsed) {
            return;
        }
        const range = cellRanges?.[cellIndex] ?? inferRangeFromFilledSlots(parsed);
        if (!range) {
            return;
        }
        const last = Math.min(range.end, merged.length - 1);
        for (let i = Math.max(range.start, 0); i <= last; i++) {
            merged[i] = parsed[i] ?? "";
        }
    });

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
