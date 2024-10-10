export function cleanWord(word: string | undefined | null): string {
    // this is for the spellchecker
    if (word === undefined || word === null) {
        return "";
    }
    return (
        word
            // Remove non-letter/non-number characters from start and end
            .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "")
            // Replace multiple apostrophes with a single one
            .replace(/''+/g, "'")
            // Remove apostrophes at the start or end of words
            .replace(/(?<!\S)'|'(?!\S)/gu, "")
            // Remove other characters that are not letters, numbers, apostrophes, or whitespace
            .replace(/[^\p{L}\p{N}'\s]/gu, "")
    );
    // Convert to lowercase ? We won't do this for now to handle proper nouns, etc.
    // .toLowerCase();
}
