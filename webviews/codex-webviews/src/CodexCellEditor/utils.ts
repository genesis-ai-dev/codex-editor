export const processVerseContent = (cellContent: string) => {
    const verseRefRegex = /(?<=^|\s)(?=[A-Z, 1-9]{3} \d{1,3}:\d{1,3})/;
    const lines = cellContent.split(verseRefRegex);
    return lines
        .map((line) => {
            const verseMarker = line.match(/(\b[A-Z, 1-9]{3}\s\d+:\d+\b)/)?.[0];
            if (verseMarker) {
                const lineWithoutVerseRefMarker = line
                    .replace(`${verseMarker} `, "")
                    .replace(`${verseMarker}\n`, "")
                    .replace(`${verseMarker}`, "");
                return {
                    verseMarkers: [verseMarker],
                    verseContent: lineWithoutVerseRefMarker,
                };
            }
            return null;
        })
        .filter((line) => line !== null);
};

/**
 * @deprecated This function has been replaced with proper utilities in footnoteUtils.ts
 * Use `processHtmlContent` from footnoteUtils.ts instead for better maintainability and type safety.
 * 
 * This function is kept temporarily for backward compatibility but should not be used in new code.
 */
export const HACKY_removeContiguousSpans = (html: string) => {
    console.warn('HACKY_removeContiguousSpans is deprecated. Use processHtmlContent from footnoteUtils.ts instead.');

    // Import the proper function dynamically to avoid circular dependencies
    try {
        // For now, provide basic functionality while migration is complete
        return html.replace(/<\/span><span>/g, "");
    } catch (error) {
        console.error('Error in deprecated HACKY_removeContiguousSpans:', error);
        return html;
    }
};

export const sanitizeQuillHtml = (originalHTML: string) => {
    return originalHTML.replace(/<div>/g, "<span>").replace(/<\/div>/g, "</span>");
}
