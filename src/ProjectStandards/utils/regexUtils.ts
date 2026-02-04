/**
 * Utilities for regex compilation, caching, and testing.
 * Performance is critical - regexes are compiled once and cached.
 */

// Cache for compiled regex patterns
const regexCache = new Map<string, RegExp>();

// HTML tag regex for stripping HTML before matching
const HTML_TAG_REGEX = /<\/?[^>]+(>|$)/g;

/**
 * Get a compiled regex from cache or compile and cache it.
 * Uses case-insensitive and global flags by default.
 */
export function getCompiledRegex(pattern: string, flags: string = "gi"): RegExp {
    const cacheKey = `${pattern}::${flags}`;

    if (!regexCache.has(cacheKey)) {
        try {
            regexCache.set(cacheKey, new RegExp(pattern, flags));
        } catch (error) {
            throw new Error(`Invalid regex pattern: ${(error as Error).message}`);
        }
    }

    return regexCache.get(cacheKey)!;
}

/**
 * Clear a specific pattern from the cache.
 * Useful when a standard's regex is updated.
 */
export function clearRegexFromCache(pattern: string): void {
    // Clear all cache entries for this pattern (all flag combinations)
    for (const key of regexCache.keys()) {
        if (key.startsWith(`${pattern}::`)) {
            regexCache.delete(key);
        }
    }
}

/**
 * Clear the entire regex cache.
 * Useful for memory management or when many standards change.
 */
export function clearRegexCache(): void {
    regexCache.clear();
}

/**
 * Get the current size of the regex cache.
 * Useful for debugging and monitoring.
 */
export function getRegexCacheSize(): number {
    return regexCache.size;
}

/**
 * Strip HTML tags from text before regex matching.
 */
export function stripHtml(text: string): string {
    if (!text) return "";
    return text.replace(HTML_TAG_REGEX, "");
}

/**
 * Test if a pattern is a valid regex.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateRegex(pattern: string): { valid: boolean; error?: string; } {
    if (!pattern || pattern.trim() === "") {
        return { valid: false, error: "Pattern cannot be empty" };
    }

    try {
        new RegExp(pattern, "gi");
        return { valid: true };
    } catch (error) {
        return { valid: false, error: (error as Error).message };
    }
}

/**
 * Find all matches of a pattern in text.
 * Returns array of match objects with text and position.
 */
export function findAllMatches(
    pattern: string,
    text: string,
    stripHtmlFirst: boolean = true
): Array<{ match: string; index: number; length: number; }> {
    const processedText = stripHtmlFirst ? stripHtml(text) : text;

    if (!processedText) {
        return [];
    }

    try {
        const regex = getCompiledRegex(pattern);
        const matches: Array<{ match: string; index: number; length: number; }> = [];

        let match: RegExpExecArray | null;

        // Reset regex state for fresh matching
        regex.lastIndex = 0;

        while ((match = regex.exec(processedText)) !== null) {
            matches.push({
                match: match[0],
                index: match.index,
                length: match[0].length,
            });

            // Prevent infinite loop for zero-length matches
            if (match.index === regex.lastIndex) {
                regex.lastIndex++;
            }
        }

        return matches;
    } catch (error) {
        console.error("[RegexUtils] Error finding matches:", error);
        return [];
    }
}

/**
 * Test a pattern against text and return whether it matches.
 */
export function testPattern(pattern: string, text: string, stripHtmlFirst: boolean = true): boolean {
    const processedText = stripHtmlFirst ? stripHtml(text) : text;

    if (!processedText) {
        return false;
    }

    try {
        const regex = getCompiledRegex(pattern);
        regex.lastIndex = 0; // Reset for fresh test
        return regex.test(processedText);
    } catch (error) {
        console.error("[RegexUtils] Error testing pattern:", error);
        return false;
    }
}

/**
 * Get the first match of a pattern in text.
 * Returns the matched text or null if no match.
 */
export function getFirstMatch(
    pattern: string,
    text: string,
    stripHtmlFirst: boolean = true
): string | null {
    const matches = findAllMatches(pattern, text, stripHtmlFirst);
    return matches.length > 0 ? matches[0].match : null;
}

/**
 * Count the number of matches of a pattern in text.
 */
export function countMatches(
    pattern: string,
    text: string,
    stripHtmlFirst: boolean = true
): number {
    return findAllMatches(pattern, text, stripHtmlFirst).length;
}

/**
 * Escape special regex characters in a string.
 * Useful for creating literal match patterns.
 */
export function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create a word boundary pattern for a term.
 * Ensures the term is matched as a whole word, not part of another word.
 */
export function createWordBoundaryPattern(term: string): string {
    return `\\b${escapeRegex(term)}\\b`;
}

/**
 * Create an alternation pattern from multiple terms.
 * Example: ["foo", "bar"] => "\\b(foo|bar)\\b"
 */
export function createAlternationPattern(terms: string[], wordBoundary: boolean = true): string {
    const escaped = terms.map(escapeRegex);
    const alternation = `(${escaped.join("|")})`;
    return wordBoundary ? `\\b${alternation}\\b` : alternation;
}
