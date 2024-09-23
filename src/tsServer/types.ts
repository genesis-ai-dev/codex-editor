export const verseRefRegex = /(\b[A-Z, 1-9]{3}\s\d+:\d+\b)/;

export type Dictionary = {
    // not sure why this was commented?
    entries: DictionaryEntry[];
};

export type DictionaryEntry = {
    id: string;
    headWord: string;
    hash: string;
};

export type SpellCheckResult = {
    word: string;
    corrections: string[];
};

export type SpellCheckFunction = (word: string) => SpellCheckResult;
