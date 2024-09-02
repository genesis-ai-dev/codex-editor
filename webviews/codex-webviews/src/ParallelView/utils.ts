import { Item, SearchResults } from './types';

export const compareVerses = (searchResults: SearchResults): Item[] => {
    if (searchResults.bibleResults.length === 0) {
        return searchResults.codexResults;
    }
    const combinedVerses = searchResults.bibleResults.map((bibleVerse) => {
        const codexVerse = searchResults.codexResults.find(
            (codexVerse) => codexVerse.ref === bibleVerse.ref
        );
        return {
            ...bibleVerse,
            codexUri: codexVerse ? codexVerse.uri : undefined,
        };
    });

    const uniqueCodexVerses = searchResults.codexResults.filter(
        (codexVerse) =>
            !searchResults.bibleResults.some(
                (bibleVerse) => bibleVerse.ref === codexVerse.ref
            )
    );

    return [...combinedVerses, ...uniqueCodexVerses];
};