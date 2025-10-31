/**
 * Shared utility functions for determining and standardizing corpus markers
 * for Bible books. Can be used by both extension and webview code.
 */

// New Testament book codes (USFM standard)
const NEW_TESTAMENT_BOOKS = [
    'MAT', 'MRK', 'LUK', 'JHN', 'ACT',
    'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL',
    '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM',
    'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'
];

// Old Testament book codes (USFM standard)  
const OLD_TESTAMENT_BOOKS = [
    'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT',
    '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST',
    'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN',
    'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL'
];

/**
 * Determines the corpus marker for a given book code
 * Returns standardized "NT" or "OT" markers that match navigation expectations
 * 
 * @param bookCode - 3-letter USFM book code (e.g., "GEN", "MAT") or book name
 * @returns "NT" | "OT" | null
 */
export function getCorpusMarkerForBook(bookCode: string): string | null {
    if (!bookCode) return null;

    // Normalize input - convert to uppercase and take first 3 characters if longer
    const normalizedCode = bookCode.toUpperCase().substring(0, 3);

    // Check if it starts with any NT book code
    if (NEW_TESTAMENT_BOOKS.some(nt => normalizedCode.startsWith(nt))) {
        return "NT";
    }

    // Check if it starts with any OT book code  
    if (OLD_TESTAMENT_BOOKS.some(ot => normalizedCode.startsWith(ot))) {
        return "OT";
    }

    // Handle some common variations
    if (bookCode.toLowerCase().includes('testament')) {
        if (bookCode.toLowerCase().includes('new')) return "NT";
        if (bookCode.toLowerCase().includes('old')) return "OT";
    }

    return null;
}

/**
 * Converts full testament names to standardized corpus markers
 * 
 * @param testament - "Old Testament", "New Testament", "OT", "NT", etc.
 * @returns "NT" | "OT" | null
 */
export function standardizeCorpusMarker(testament: string): string | null {
    if (!testament) return null;

    const lower = testament.toLowerCase();

    if (lower.includes('new') || lower === 'nt') return "NT";
    if (lower.includes('old') || lower === 'ot') return "OT";

    return null;
}

/**
 * Gets the display name for a corpus marker
 * 
 * @param corpusMarker - "NT", "OT", etc.
 * @returns Display name like "New Testament", "Old Testament"
 */
export function getCorpusDisplayName(corpusMarker: string): string {
    switch (corpusMarker?.toUpperCase()) {
        case 'NT': return 'New Testament';
        case 'OT': return 'Old Testament';
        default: return corpusMarker || 'Unknown';
    }
}

/**
 * Determines if a book is part of the New Testament
 */
export function isNewTestamentBook(bookCode: string): boolean {
    return getCorpusMarkerForBook(bookCode) === "NT";
}

/**
 * Determines if a book is part of the Old Testament
 */
export function isOldTestamentBook(bookCode: string): boolean {
    return getCorpusMarkerForBook(bookCode) === "OT";
}

