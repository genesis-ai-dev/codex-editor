/**
 * Extracts the book, chapter, and verse from a reference string.
 *
 * The reference string must be in the format "Book Abbreviation Chapter:Verse".
 * Book abbreviations are expected to be three letters. If the string does not match
 * this format, a default value of Genesis 1:1 (GEN 1:1) is returned.
 *
 * @param refString - The scripture reference string to be parsed.
 * @returns An object containing the book abbreviation, chapter number, and verse number.
 *
 * @example
 * ```typescript
 * // Extracts and returns { book: "MAT", chapter: 28, verse: 19 }
 * const result = extractBookChapterVerse("MAT 28:19");
 * ```
 *
 * @example
 * ```typescript
 * // Returns the default { book: "GEN", chapter: 1, verse: 1 } for non-matching strings
 * const result = extractBookChapterVerse("Not a valid reference");
 * ```
 */
export const extractBookChapterVerse = (
    refString: string
): { bookID: string; chapter: number; verse: number } => {
    const match = refString.match(/([A-Za-z0-9]{3}) (\d+):(\d+)/);

    return match
        ? {
              bookID: match[1],
              chapter: parseInt(match[2], 10),
              verse: parseInt(match[3], 10),
          }
        : { bookID: "GEN", chapter: 1, verse: 1 };
};
