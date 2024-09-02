export function cleanWord(word: string): string {
    return word
        // Remove non-alphanumeric characters from start and end
        .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
        // Replace multiple apostrophes with a single one
        .replace(/''+/g, "'")
        // Remove apostrophes at the start or end of words and other special characters
        .replace(/(?<!\S)'|'(?!\S)|[^\p{L}\p{N}'\s]/gu, '')
        // Convert to lowercase
        .toLowerCase();
}