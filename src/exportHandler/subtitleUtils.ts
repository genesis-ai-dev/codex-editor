import { CodexNotebookAsJSONData } from "@types";

export const removeHtmlTags = (content: string) => {
    return content
        // Convert block-level elements to newlines before removing tags
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
        // Remove all other HTML tags
        .replace(/<[^>]*>/g, "")
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

export function generateSrtData(
    cells: CodexNotebookAsJSONData["cells"],
    includeStyles: boolean
): string {
    let output = "";
    let index = 1;

    // Filter out merged cells before processing
    const activeCells = cells.filter((unit) => {
        const metadata = unit.metadata;
        return !metadata?.data?.merged;
    });

    activeCells.forEach((unit) => {
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
