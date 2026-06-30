/**
 * Validation rules for user-edited book display names (`fileDisplayName`).
 *
 * Keep this list narrow and conservative. The primary motivation (issue #1013)
 * is that earlier metadata-cleanup logic ran `path.extname()` over the display
 * name and treated anything after a `.` as a strippable extension, silently
 * truncating names like "1. New Items" to "1" on every sync. The safest fix
 * is to disallow filesystem-unsafe characters at the entry point so the name
 * round-trips cleanly through metadata, file IO, and any future tooling that
 * may interpret the value as a path.
 *
 * Shared between the extension host (defensive validation in providers) and
 * the webview (live input warnings + disabled save).
 */

/**
 * Characters that must not appear in a book display name.
 *
 * `.` is the bug from issue #1013. The remaining characters are reserved on
 * common filesystems / URLs and would similarly create downstream surprises
 * if they leaked into the display name.
 */
export const DISALLOWED_BOOK_NAME_CHARS: readonly string[] = [
    ".",
    "/",
    "\\",
    ":",
    "*",
    "?",
    '"',
    "<",
    ">",
    "|",
];

/**
 * Returns the subset of {@link DISALLOWED_BOOK_NAME_CHARS} present in `name`.
 * Returns an empty array if the name is valid (or empty).
 */
export function findDisallowedBookNameChars(name: string): string[] {
    if (!name) return [];
    const seen = new Set<string>();
    for (const ch of name) {
        if (DISALLOWED_BOOK_NAME_CHARS.includes(ch)) {
            seen.add(ch);
        }
    }
    return Array.from(seen);
}

/**
 * True if the name contains any disallowed character. Whitespace-only / empty
 * names are NOT considered "invalid" by this function — those are handled
 * separately by callers that already trim and reject empty input.
 */
export function bookNameHasDisallowedChars(name: string): boolean {
    return findDisallowedBookNameChars(name).length > 0;
}

/**
 * Human-friendly explanation of why a name is rejected, suitable for showing
 * inline beneath an input field. Returns `null` when the name is valid.
 */
export function getBookNameValidationMessage(name: string): string | null {
    const offenders = findDisallowedBookNameChars(name);
    if (offenders.length === 0) return null;

    const list = offenders.map((c) => `"${c}"`).join(", ");
    const noun = offenders.length === 1 ? "character" : "characters";
    return `${list} ${offenders.length === 1 ? "is" : "are"} not allowed in book names. Use dashes (-) or underscores (_) instead.`;
}
