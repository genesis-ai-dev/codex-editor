import { useMemo } from "react";
import { CodexNotebookAsJSONData, QuillCellContent } from "@types";
import { removeHtmlTags } from "./subtitleUtils";
import { ExportOptions } from "./exportHandler";
import * as vscode from "vscode";

/**
 * Process HTML content for VTT format - preserve supported HTML tags while converting paragraph breaks to newlines
 */
const processVttContent = (content: string): string => {
    return content
        // Convert block-level elements to newlines before processing
        .replace(/<\/p>/gi, "\n") // End of paragraph
        .replace(/<p[^>]*>/gi, "\n") // Start of paragraph - add newline before content
        .replace(/<br\s*\/?>/gi, "\n") // Line breaks
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
};

export const generateVttData = (
    cells: CodexNotebookAsJSONData["cells"],
    includeStyles: boolean,
    filePath: string
): string => {
    if (!cells.length) return "";

    const formatTime = (seconds: number): string => {
        const date = new Date(seconds * 1000);
        return date.toISOString().substr(11, 12);
    };

    const cues = cells
        .filter((unit) => !!unit.metadata?.data?.startTime)
        .map((unit, index) => {
            const startTime = unit.metadata?.data?.startTime ?? index;
            const endTime = unit.metadata?.data?.endTime ?? index + 1;
            return `${unit.metadata?.id}
${formatTime(Number(startTime))} --> ${formatTime(Number(endTime))}
${includeStyles ? processVttContent(unit.value) : removeHtmlTags(unit.value)}

`;
        })
        .join("\n");

    if (cues.length === 0) {
        vscode.window.showInformationMessage("No cues found in the " + filePath);
    }
    return `WEBVTT

${cues}`;
};
