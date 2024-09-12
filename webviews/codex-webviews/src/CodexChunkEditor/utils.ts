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
 * HACKY_removeContiguousSpans is a function that removes contiguous spans from a given HTML string.
 * It uses a regular expression to find and replace all occurrences of </span><span> with an empty string,
 * effectively removing the contiguous spans, and 'merging' the text back together into the same span.
 * 
 * The reason we needed this is because when you add a <li></li> to a verse, it will not render as a block
 * inside a span, so we need to end the current span whenever you insert a <li>. However, if the user
 * later removes the <li>, you will suddenly have two contiguous spans where there should only be one. The 
 * solution is to remove all contiguous spans to handle this edge case.
 * 
 * @param {string} html - The HTML string from which contiguous spans need to be removed.
 * @returns {string} - The HTML string with contiguous spans removed.
 */
export const HACKY_removeContiguousSpans = (html: string) => {
    return html.replace(/<\/span><span>/g, '');
};