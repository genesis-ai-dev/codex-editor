/**
 * Biblica-specific import helpers for note paragraph filtering and line-break splitting.
 */

import type { IDMLStory } from "./types";

/** InDesign ACE placeholder markers in running headers / structural paragraphs. */
const ACE_MARKER_PATTERN = /<\?ACE\s+\d+\?>/gi;

/** Apostrophe characters used as structural glue in English Biblica IDML (source serif). */
const STRUCTURAL_APOSTROPHE_PATTERN = /^['\u02BC\u2019\u2032\u00B4]+$/;

/** Character styles carrying the hidden chapter/verse delimiters (USFM \c and \v). */
const VERSE_MARKER_STYLE_PATTERN = /(?:^|\/)meta(?:%3a|:)[cv](?:_sp)?$/i;

/**
 * Note styles use the intro prefix (e.g. intro%3aipi, intro%3aili1).
 */
export function isBiblicaNoteSectionStyle(paragraphStyle: string): boolean {
    return paragraphStyle.includes("intro%3a") || paragraphStyle.includes("intro:");
}

/**
 * Division headings (intro:imt2) introduce a group of books — "Stories about Jesus"
 * before Matthew, "Letters and messages" before Romans. InDesign places them inside the
 * following book's front matter, but they describe the whole group rather than that book.
 */
export function isBiblicaDivisionHeadingStyle(paragraphStyle: string): boolean {
    return paragraphStyle.includes("intro%3aimt2") || paragraphStyle.includes("intro:imt2");
}

/**
 * Book titles (intro:imt1) open a book preface, which ends any open division section.
 */
export function isBiblicaBookTitleStyle(paragraphStyle: string): boolean {
    return paragraphStyle.includes("intro%3aimt1") || paragraphStyle.includes("intro:imt1");
}

/**
 * True when a document carries no scripture at all.
 *
 * Biblica ships the study Bible's front and back matter (title pages, contents, "how to
 * use", the Bible Dictionary, timelines, maps, cover) as separate IDML volumes with no
 * chapter/verse markers anywhere. Their text lives in layout paragraph styles such as
 * text:m, toc:*, title:mt1 or Box Text rather than the intro/* note styles, so every
 * text-bearing paragraph has to become a cell instead of only the note styles.
 */
export function isBiblicaFrontBackMatterDocument(stories: IDMLStory[]): boolean {
    for (const story of stories) {
        for (const paragraph of story.paragraphs) {
            const metadata = paragraph.metadata as
                | { biblicaVerseSegments?: unknown[]; isPartOfSpanningVerse?: boolean; }
                | undefined;
            if (metadata?.isPartOfSpanningVerse) {
                return false;
            }
            if (
                Array.isArray(metadata?.biblicaVerseSegments) &&
                metadata.biblicaVerseSegments.length > 0
            ) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Major section headings (head:ms1) split front/back matter into milestones. In the Bible
 * Dictionary each one holds a single alphabet letter ("A", "B", …).
 */
export function isBiblicaMajorSectionHeadingStyle(paragraphStyle: string): boolean {
    return paragraphStyle.includes("head%3ams1") || paragraphStyle.includes("head:ms1");
}

/**
 * Running heads (meta:rh) repeat the section marker and page number on every page. InDesign
 * regenerates them from the layout, so they hold no translatable text of their own.
 */
export function isBiblicaRunningHeadStyle(paragraphStyle: string): boolean {
    return paragraphStyle.includes("meta%3arh") || paragraphStyle.includes("meta:rh");
}

/**
 * Turn division heading text into a milestone label. Soft hyphens are typesetting hints
 * in the IDML text ("Sto\u00adries about Jesus") and must not leak into the label.
 */
export function toDivisionMilestoneLabel(headingText: string): string {
    return headingText.replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
}

/**
 * True when visible text is empty after stripping ACE markers and whitespace.
 */
export function isStructuralOnlyContent(segments: string[]): boolean {
    const visible = segments
        .join("")
        .replace(ACE_MARKER_PATTERN, "")
        .replace(/\s+/g, "")
        .trim();
    return visible.length === 0;
}

/**
 * True for InDesign "source serif" apostrophe glue or apostrophe-only segment text.
 */
export function isSourceSerifCharacterStyle(characterStyle: string): boolean {
    return characterStyle.toLowerCase().includes("source serif");
}

export function isStructuralApostropheContent(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.length > 0 && STRUCTURAL_APOSTROPHE_PATTERN.test(trimmed);
}

export function isStructuralApostropheSegment(text: string, characterStyle?: string): boolean {
    if (characterStyle && isSourceSerifCharacterStyle(characterStyle)) {
        return true;
    }
    return isStructuralApostropheContent(text);
}

/**
 * Indexes of <Content> slots that carry structural apostrophes only (not translated).
 */
export function getStructuralApostropheSegmentIndexes(
    segments: string[],
    segmentStyles?: string[]
): number[] {
    const indexes: number[] = [];
    for (let i = 0; i < segments.length; i++) {
        if (isStructuralApostropheSegment(segments[i] ?? "", segmentStyles?.[i])) {
            indexes.push(i);
        }
    }
    return indexes;
}

export function omitSegmentsAtIndexes(segments: string[], indexes: number[]): string[] {
    const skip = new Set(indexes);
    return segments.filter((_, index) => !skip.has(index));
}

/**
 * True for the chapter/verse delimiter slots InDesign keeps alongside the text.
 */
export function isVerseMarkerSegment(characterStyle?: string): boolean {
    return !!characterStyle && VERSE_MARKER_STYLE_PATTERN.test(characterStyle);
}

/**
 * Indexes of <Content> slots holding chapter/verse delimiters.
 *
 * InDesign flushes the closing markers of a book's final verse into the next paragraph of
 * the text flow — usually the following book's intro:ie — so Matthew's closing "28:20"
 * lands in Mark's preface. The markers are invisible in the printed layout and must stay
 * out of cells. Unlike structural apostrophes they are never cleared on export: IDML needs
 * them to delimit verses, so the exporter leaves those slots at their original value.
 */
export function getVerseMarkerSegmentIndexes(
    segments: string[],
    segmentStyles?: string[]
): number[] {
    const indexes: number[] = [];
    for (let i = 0; i < segments.length; i++) {
        if (isVerseMarkerSegment(segmentStyles?.[i])) {
            indexes.push(i);
        }
    }
    return indexes;
}

/** Union of segment index lists, sorted ascending. */
export function mergeSegmentIndexes(...lists: number[][]): number[] {
    return [...new Set(lists.flat())].sort((a, b) => a - b);
}

export interface LineBreakSegmentGroup {
    /** Index of the first segment in the parent paragraph. */
    startIndex: number;
    segments: string[];
    /** breakBefore flags relative to this group (index 0 is always false). */
    breakBefore: boolean[];
}

/**
 * Split content segments at IDML line breaks (breakBefore[i] === true).
 * Each group becomes one editor cell, preserving original segment indices for export.
 */
export function splitSegmentsAtLineBreaks(
    segments: string[],
    breakBefore: boolean[]
): LineBreakSegmentGroup[] {
    if (segments.length === 0) {
        return [];
    }

    const groups: LineBreakSegmentGroup[] = [];
    let currentStart = 0;
    let currentSegments: string[] = [segments[0] ?? ""];
    let currentBreakBefore: boolean[] = [false];

    for (let i = 1; i < segments.length; i++) {
        if (breakBefore[i]) {
            groups.push({
                startIndex: currentStart,
                segments: currentSegments,
                breakBefore: currentBreakBefore,
            });
            currentStart = i;
            currentSegments = [segments[i] ?? ""];
            currentBreakBefore = [false];
        } else {
            currentSegments.push(segments[i] ?? "");
            currentBreakBefore.push(false);
        }
    }

    groups.push({
        startIndex: currentStart,
        segments: currentSegments,
        breakBefore: currentBreakBefore,
    });

    return groups.filter((group) => !isStructuralOnlyContent(group.segments));
}
