import { Item, SearchResults } from './types';

export const compareVerses = (searchResults: SearchResults): Item[] => {
    const combinedVerses = searchResults.bibleResults.map((bibleVerse) => {
        const codexVerse = searchResults.codexResults.find(
            (codexVerse) => codexVerse.ref === bibleVerse.ref
        );
        return {
            ...bibleVerse,
            codexText: codexVerse ? codexVerse.text : undefined,
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