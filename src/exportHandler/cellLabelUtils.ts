/**
 * Builds human-readable labels for cells in audio-missing reporting and
 * export pre-flight summaries. Shared between the audio exporter and the
 * export wizard's pre-flight scan so both surfaces agree on how to identify
 * cells to the user.
 *
 * Labels follow the user-established convention:
 *   - Bible cells use `BOOK chapter:verse` (e.g. `1TH 3:1`)
 *   - Non-Bible cells use `SOURCE \u2014 Label` or `SOURCE \u2014 "snippet"`
 *   - Cells with no usable identifier return `null` and are omitted from
 *     reporting (an opaque UUID/line number isn't actionable for the user).
 */

/**
 * Pulls a short plain-text snippet from a cell's HTML value for use as a
 * human-readable identifier when nothing else is set. Strips tags, decodes
 * common entities, collapses whitespace, and truncates to ~40 chars.
 */
export function extractCellTextSnippet(cell: any): string {
    const raw = (cell?.value || "").toString();
    if (!raw) return "";
    const stripped = raw
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    if (!stripped) return "";
    const MAX = 40;
    return stripped.length <= MAX
        ? stripped
        : `${stripped.slice(0, MAX).trimEnd()}\u2026`;
}

/**
 * Builds a human-friendly label for a cell, suitable for the export progress
 * UI. Returns `null` when the cell has no identifier we can present — those
 * cells are intentionally omitted from missing-audio reporting because a row
 * labelled with an opaque UUID or line number isn't actionable.
 *
 * Resolution rules (matches the `globalReferences` discriminator the user
 * established: present = Bible, absent = anything else):
 *   - Bible cell with a parseable ref: `1TH 3:1`
 *   - Bible cell with chapter only: `1TH 3:<cellLabel>` if cellLabel is set,
 *     else `1TH chapter 3`
 *   - Non-Bible cell with cellLabel: `<source> \u2014 <cellLabel>`
 *   - Non-Bible cell with text content: `<source> \u2014 "first 40 chars\u2026"`
 *   - Otherwise: `null` (caller skips this cell)
 */
export function formatCellDisplayLabel(
    cell: any,
    _cellId: string,
    bookCode: string
): string | null {
    const cellLabel = (cell?.metadata?.cellLabel || "").toString().trim();

    const globalRefs = cell?.metadata?.data?.globalReferences;
    const refIdRaw = Array.isArray(globalRefs) && globalRefs.length > 0
        ? String(globalRefs[0] || "").trim()
        : "";

    if (refIdRaw) {
        // Bible-style cell. Parse "BOOK chapter:verse" out of the ref.
        const [refBookRaw, restRaw] = refIdRaw.split(" ");
        const refBook = (refBookRaw || "").toUpperCase().trim();
        const [chapterStr, verseStr] = (restRaw || "").split(":");
        const chapter = chapterStr && Number.isFinite(Number(chapterStr))
            ? Number(chapterStr)
            : undefined;
        const verse = verseStr && Number.isFinite(Number(verseStr))
            ? Number(verseStr)
            : undefined;

        const book = refBook || bookCode;
        if (chapter !== undefined && verse !== undefined) {
            return `${book} ${chapter}:${verse}`;
        }
        if (chapter !== undefined && cellLabel) {
            return `${book} ${chapter}:${cellLabel}`;
        }
        if (chapter !== undefined) {
            return `${book} chapter ${chapter}`;
        }
        // Malformed ref; fall through to non-Bible handling below.
    }

    if (cellLabel) {
        return `${bookCode} \u2014 ${cellLabel}`;
    }
    const snippet = extractCellTextSnippet(cell);
    if (snippet) {
        return `${bookCode} \u2014 \u201c${snippet}\u201d`;
    }
    return null;
}
