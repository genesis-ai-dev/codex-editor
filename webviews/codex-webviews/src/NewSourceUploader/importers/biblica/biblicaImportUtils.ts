/**
 * Biblica-specific import helpers for note paragraph filtering and line-break splitting.
 */

/** InDesign ACE placeholder markers in running headers / structural paragraphs. */
const ACE_MARKER_PATTERN = /<\?ACE\s+\d+\?>/gi;

/** Apostrophe characters used as structural glue in English Biblica IDML (source serif). */
const STRUCTURAL_APOSTROPHE_PATTERN = /^['\u02BC\u2019\u2032\u00B4]+$/;

/**
 * Note styles use the intro prefix (e.g. intro%3aipi, intro%3aili1).
 */
export function isBiblicaNoteSectionStyle(paragraphStyle: string): boolean {
    return paragraphStyle.includes("intro%3a") || paragraphStyle.includes("intro:");
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

export function stripStructuralApostropheSegments(
    segments: string[],
    structuralIndexes: number[]
): string[] {
    const skip = new Set(structuralIndexes);
    return segments.filter((_, index) => !skip.has(index));
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
