import { QuillCellContent } from "types";

export const removeHtmlTags = (content: string) => {
    return content
        .replace(/<[^>]*>/g, "") // Remove HTML tags
        .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, "") // Remove common HTML entities
        .replace(/&nbsp; ?/g, " ") // Remove &nbsp;
        .replace(/&#\d+;/g, "") // Remove numeric HTML entities
        .replace(/&[a-zA-Z]+;/g, "") // Remove other named HTML entities
        .trim();
};

export const getCellValueData = (cell: QuillCellContent) => {
    // Ensure editHistory exists and is an array
    const editHistory = cell.editHistory || [];
    
    // Find the latest edit that matches the current cell content
    const latestEditThatMatchesCellValue = editHistory
        .slice()
        .reverse()
        .find((edit) => edit.cellValue === cell.cellContent);

    return {
        cellId: cell.cellMarkers?.[0] || "",
        cellContent: cell.cellContent || "",
        cellType: cell.cellType,
        validatedBy: latestEditThatMatchesCellValue?.validatedBy || [],
        editType: latestEditThatMatchesCellValue?.type || "user-edit",
        author: latestEditThatMatchesCellValue?.author || "",
        timestamp: latestEditThatMatchesCellValue?.timestamp || Date.now(),
        cellLabel: cell.cellLabel || "",
    };
};
