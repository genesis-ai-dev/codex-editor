export const verseRefRegex = /(\b[A-Z, 1-9]{3}\s\d+:\d+\b)/;

export type SpellCheckResult = {
    word: string;
    corrections: string[];
};

export type SpellCheckFunction = (word: string) => SpellCheckResult;
