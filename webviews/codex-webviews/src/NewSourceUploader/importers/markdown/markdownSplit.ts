/**
 * Split canonical markdown (e.g. post-footnote processing) into segments with
 * UTF-16 code-unit spans for round-trip export (splice translations only).
 */

export interface MarkdownSpannedSegment {
    /** Trimmed segment text (same as used for marked.parse). */
    text: string;
    /** Inclusive start index in `content` (UTF-16). */
    start: number;
    /** Exclusive end index in `content` (UTF-16). */
    end: number;
}

function lineStartOffsets(content: string): number[] {
    const lines = content.split("\n");
    const starts: number[] = [];
    let pos = 0;
    for (let i = 0; i < lines.length; i++) {
        starts.push(pos);
        pos += lines[i].length + (i < lines.length - 1 ? 1 : 0);
    }
    return starts;
}

/** Exclusive end UTF-16 index for line `i` (includes following newline when not last line). */
export function lineEndExclusive(lines: string[], starts: number[], i: number): number {
    return starts[i] + lines[i].length + (i < lines.length - 1 ? 1 : 0);
}

/** Line starts and split lines for building spans elsewhere (e.g. OBS). */
export function getLineStartsAndLines(content: string): { starts: number[]; lines: string[] } {
    const lines = content.split("\n");
    return { starts: lineStartOffsets(content), lines };
}

/**
 * Mirrors legacy splitMarkdownIntoElements logic but records [start,end) spans
 * into `content` for each emitted segment.
 */
export function splitMarkdownIntoSpannedSegments(content: string): MarkdownSpannedSegment[] {
    const lines = content.split("\n");
    const starts = lineStartOffsets(content);
    const segments: MarkdownSpannedSegment[] = [];

    let currentElement = "";
    let accumStartLine = 0;
    let inCodeBlock = false;
    let codeBlockStartLine = 0;
    let inListContext = false;
    let listDepth = 0;

    const flushParagraph = (endLineInclusive: number) => {
        const trimmed = currentElement.trim();
        if (!trimmed) {
            currentElement = "";
            return;
        }
        const start = starts[accumStartLine];
        const end = lineEndExclusive(lines, starts, endLineInclusive);
        segments.push({ text: trimmed, start, end });
        currentElement = "";
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith("```")) {
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeBlockStartLine = i;
                currentElement = line + "\n";
            } else {
                currentElement += line + "\n";
                inCodeBlock = false;
                const trimmed = currentElement.trim();
                if (trimmed) {
                    const start = starts[codeBlockStartLine];
                    const end = lineEndExclusive(lines, starts, i);
                    segments.push({ text: trimmed, start, end });
                }
                currentElement = "";
            }
            continue;
        }

        if (inCodeBlock) {
            currentElement += line + "\n";
            continue;
        }

        if (trimmedLine.match(/^#{1,6}\s/)) {
            if (currentElement.trim()) {
                flushParagraph(i - 1);
            }
            const start = starts[i];
            const end = lineEndExclusive(lines, starts, i);
            segments.push({ text: trimmedLine, start, end });
            inListContext = false;
            continue;
        }

        const listMatch = trimmedLine.match(/^(\s*)([-*+]|\d+\.)\s(.+)/);
        if (listMatch) {
            const indentation = listMatch[1];
            const currentDepth = Math.floor(indentation.length / 2);

            if (!inListContext || Math.abs(currentDepth - listDepth) > 0) {
                if (currentElement.trim()) {
                    flushParagraph(i - 1);
                }
            }

            const start = starts[i];
            const end = lineEndExclusive(lines, starts, i);
            segments.push({ text: trimmedLine, start, end });
            inListContext = true;
            listDepth = currentDepth;
            continue;
        }

        if (trimmedLine === "") {
            if (currentElement.trim()) {
                flushParagraph(i - 1);
            }
            inListContext = false;
            continue;
        }

        if (inListContext) {
            if (currentElement.trim()) {
                flushParagraph(i - 1);
            }
            inListContext = false;
        }

        if (!currentElement) {
            accumStartLine = i;
        }
        currentElement += line + "\n";
    }

    if (currentElement.trim()) {
        flushParagraph(lines.length - 1);
    }

    return segments.filter((s) => s.text.length > 0);
}
