import { CodexNotebookAsJSONData } from "@types";
import { generateVttData } from "./vttUtils";

export const removeHtmlTags = (content: string) => {
    return content
        .replace(/<[^>]*>/g, "") // Remove HTML tags
        .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, "") // Remove common HTML entities
        .replace(/&nbsp; ?/g, " ") // Remove &nbsp;
        .replace(/&#\d+;/g, "") // Remove numeric HTML entities
        .replace(/&[a-zA-Z]+;/g, "") // Remove other named HTML entities
        .trim();
};

export function generateSrtData(
    cells: CodexNotebookAsJSONData["cells"],
    includeStyles: boolean
): string {
    let output = "";
    let index = 1;

    cells.forEach((unit) => {
        const cellId = unit.metadata?.id;
        if (!cellId) return;

        const text = includeStyles ? unit.value : removeHtmlTags(unit.value);

        const startTime = unit.metadata?.data?.startTime;
        const endTime = unit.metadata?.data?.endTime;

        const formatTime = (seconds: number): string => {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            const ms = Math.floor((seconds % 1) * 1000);

            return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
        };

        output += `${index++}\n`;
        output += `${formatTime(Number(startTime))} --> ${formatTime(Number(endTime))}\n`;
        output += `${includeStyles ? text : text}\n\n`;
    });

    return output;
}
