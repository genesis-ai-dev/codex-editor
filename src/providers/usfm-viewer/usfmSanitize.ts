export function sanitizeUSFM(usfm: string): string {
    // Regex to match \c or \s# tags followed by any content until the first \v tag
    const regex: RegExp = /(\\c \d+|\\s\d+)((?:.(?!\\c \d+|\\s\d+))*?)(\\v)/gs;

    // Replacement function to insert \p tag if not present
    function insertPTagIfNeeded(
        match: string,
        tag: string,
        middleContent: string,
        vTag: string,
    ): string {
        // Check for a \p tag in the middle content
        if (!/\\p/.test(middleContent)) {
            // If \p tag is missing, insert it before the \v tag
            return `${tag}\n\\p\n${vTag}`;
        }
        // If \p tag is present, return the original match
        return match;
    }

    // Apply the replacement to the USFM string
    let correctedUSFM: string = usfm.replace(regex, insertPTagIfNeeded);

    // Handle cases where \c or \s# are followed immediately by each other before a \v tag
    // This regex captures sequences of \c followed by \s# (or vice versa) without an intervening \v, to ensure only one \p is inserted
    const complexCaseRegex: RegExp =
        /(\\c \d+\n\\s\d+|\\s\d+\n\\c \d+)((?:.(?!\\c \d+|\\s\d+|\\v))*?)(\\v)/gs;
    correctedUSFM = correctedUSFM.replace(complexCaseRegex, insertPTagIfNeeded);

    return correctedUSFM;
}
