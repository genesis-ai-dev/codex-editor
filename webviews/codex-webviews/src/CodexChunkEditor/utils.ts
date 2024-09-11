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

export const HACKY_removeContiguousSpans = (html: string) => {
    return html.replace(/<\/span><span>/g, '');
};