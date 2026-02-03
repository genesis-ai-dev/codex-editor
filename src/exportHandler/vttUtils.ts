import { CodexNotebookAsJSONData } from "@types";
import { removeHtmlTags } from "./subtitleUtils";
import * as vscode from "vscode";

/**
 * Inserts line breaks for dialogue patterns when missing.
 * If there are no existing newlines, convert occurrences of " -" into "\n-" to split lines like:
 * "-Line one. -Line two." -> "-Line one.\n-Line two."
 */
const ensureDialogueLineBreaks = (text: string): string => {
    if (!text) return text;
    // Insert a newline before any dialogue dash that is not already at the start of a line
    // e.g., "-A. -B." => "-A.\n-B."
    return text.replace(/(?<!\n)\s+-/g, "\n-");
};

/**
 * Process HTML content for VTT format - preserve supported HTML tags while converting paragraph breaks to newlines
 */
const processVttContent = (content: string): string => {
    const processed = content
        // Convert block-level elements to newlines before processing
        .replace(/<\/p>/gi, "\n") // End of paragraph
        .replace(/<p[^>]*>/gi, "\n") // Start of paragraph - add newline before content
        .replace(/<br\s*\/>/gi, "\n") // Line breaks
        .replace(/<\/div>/gi, "\n") // End of div
        .replace(/<div[^>]*>/gi, "\n") // Start of div - add newline before content
        .replace(/<\/h[1-6]>/gi, "\n") // End of headings
        .replace(/<h[1-6][^>]*>/gi, "\n") // Start of headings - add newline before content
        .replace(/<\/li>/gi, "\n") // End of list items
        .replace(/<li[^>]*>/gi, "\n• ") // Start of list items with bullet and newline
        .replace(/<\/ul>|<\/ol>/gi, "\n") // End of lists
        .replace(/<ul[^>]*>|<ol[^>]*>/gi, "\n") // Start of lists - add newline
        // Remove unsupported HTML tags while preserving VTT-supported ones
        // VTT supports: <b>, <i>, <u>, <c>, <v>, <lang>, <ruby>, <rt>
        .replace(/<(?!\/?(?:b|i|u|c|v|lang|ruby|rt)(?:\s|>))[^>]*>/gi, "")
        // Clean up HTML entities
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#\d+;/g, "") // Remove numeric HTML entities
        .replace(/&[a-zA-Z]+;/g, "") // Remove other named HTML entities
        // Clean up multiple consecutive newlines and whitespace
        .replace(/\n\s*\n/g, "\n") // Replace multiple newlines with single newline
        .replace(/^\s+|\s+$/g, "") // Trim leading/trailing whitespace
        .replace(/[ \t]+/g, " "); // Replace multiple spaces/tabs with single space
    return ensureDialogueLineBreaks(processed);
};

type ProcessedUnit = {
    id: string | undefined;
    startTime: number;
    endTime: number;
    finalText: string;
};

export const generateVttData = (
    cells: CodexNotebookAsJSONData["cells"],
    includeStyles: boolean,
    cueSplitting: boolean,
    filePath: string
): string => {
    if (!cells.length) return "";

    const formatTime = (seconds: number): string => {
        const date = new Date(seconds * 1000);
        return date.toISOString().substr(11, 12);
    };

    const units: ProcessedUnit[] = cells
        .filter((unit) => {
            const metadata = unit.metadata;
            return !metadata?.data?.merged && !!unit.metadata?.data?.startTime;
        })
        .map((unit, index) => {
            const startTime = Number(unit.metadata?.data?.startTime ?? index);
            const endTime = Number(unit.metadata?.data?.endTime ?? index + 1);
            const text = includeStyles ? processVttContent(unit.value) : removeHtmlTags(unit.value);
            const finalText = ensureDialogueLineBreaks(text);
            return {
                id: unit.metadata?.cellLabel || unit.metadata?.id,
                startTime,
                endTime,
                finalText,
            };
        });

    const cues =
        cueSplitting && units.length > 0
            ? buildSplitCues(units, formatTime)
            : units
                .map(
                    (unit) =>
                        `${unit.id}
${formatTime(unit.startTime)} --> ${formatTime(unit.endTime)}
${unit.finalText}

`
                )
                .join("\n");

    if (cues.length === 0) {
        vscode.window.showInformationMessage("No cues found in the " + filePath);
    }
    return `WEBVTT

${cues}`;
};

/**
 * Returns true if any two cues in the given cells have overlapping time ranges.
 * Uses the same cell filtering as generateVttData (excludes merged, requires startTime).
 * Two cues [s1,e1] and [s2,e2] overlap when s1 < e2 && s2 < e1.
 */
export const hasOverlappingCues = (cells: CodexNotebookAsJSONData["cells"]): boolean => {
    const units = cells
        .filter((unit) => {
            const metadata = unit.metadata;
            return !metadata?.data?.merged && !!unit.metadata?.data?.startTime;
        })
        .map((unit, index) => ({
            startTime: Number(unit.metadata?.data?.startTime ?? index),
            endTime: Number(unit.metadata?.data?.endTime ?? index + 1),
        }));

    for (let i = 0; i < units.length; i++) {
        for (let j = i + 1; j < units.length; j++) {
            const a = units[i];
            const b = units[j];
            if (a.startTime < b.endTime && b.startTime < a.endTime) return true;
        }
    }
    return false;
};

/**
 * Build VTT cues by splitting on all unique timestamps. For each adjacent pair of timestamps,
 * emits one cue containing the concatenated text of all units active in that time range.
 * Cue is active in [tStart, tEnd) when unit.startTime < tEnd && unit.endTime > tStart.
 */
function buildSplitCues(units: ProcessedUnit[], formatTime: (s: number) => string): string {
    const timestamps = new Set<number>();
    for (const unit of units) {
        timestamps.add(unit.startTime);
        timestamps.add(unit.endTime);
    }
    const sorted = Array.from(timestamps).sort((a, b) => a - b);

    const parts: string[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
        const tStart = sorted[i];
        const tEnd = sorted[i + 1];
        if (tStart === tEnd) continue;

        const active = units.filter((unit) => unit.startTime < tEnd && unit.endTime > tStart);
        if (active.length === 0) continue;

        const text = active.map((unit) => unit.finalText).join("\n\n");
        const cueId = `${active[0].id}-split`;
        parts.push(`${cueId}
${formatTime(tStart)} --> ${formatTime(tEnd)}
${text}

`);
    }
    return parts.join("\n");
}
