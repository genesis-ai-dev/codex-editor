import { QuillCellContent } from "types";

export const removeHtmlTags = (content: string) => {
    if (!content) return '';

    try {
        // Use proper DOM parsing for better HTML handling when available
        if (typeof document !== 'undefined') {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            
            // Remove footnote elements completely
            const footnotes = tempDiv.querySelectorAll('sup.footnote-marker, sup[data-footnote], sup');
            footnotes.forEach(footnote => footnote.remove());
            
            // Remove spell check markup
            const spellCheckElements = tempDiv.querySelectorAll('.spell-check-error, .spell-check-suggestion, [class*="spell-check"]');
            spellCheckElements.forEach(el => el.remove());
            
            // Replace paragraph end tags with spaces to preserve word boundaries
            tempDiv.innerHTML = tempDiv.innerHTML.replace(/<\/p>/gi, ' ');
            
            // Get clean text content
            const textContent = tempDiv.textContent || tempDiv.innerText || '';
            
            return textContent
                .replace(/\s+/g, ' ') // Normalize whitespace
                .trim();
        }
    } catch (error) {
        console.warn('DOM parsing failed in removeHtmlTags, using fallback:', error);
    }
    
    // Fallback for server-side or when DOM parsing fails
    return content
        .replace(/<sup[^>]*class=["']footnote-marker["'][^>]*>[\s\S]*?<\/sup>/gi, '') // Remove footnotes
        .replace(/<sup[^>]*data-footnote[^>]*>[\s\S]*?<\/sup>/gi, '') // Remove data-footnote sups
        .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '') // Remove any remaining sup tags
        .replace(/<\/p>/gi, ' ') // Replace paragraph end tags with spaces to preserve word boundaries
        .replace(/<[^>]*>/g, "") // Remove HTML tags
        .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, "") // Remove common HTML entities
        .replace(/&nbsp; ?/g, " ") // Remove &nbsp;
        .replace(/&#\d+;/g, "") // Remove numeric HTML entities
        .replace(/&[a-zA-Z]+;/g, "") // Remove other named HTML entities
        .replace(/\s+/g, " ") // Normalize whitespace
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
