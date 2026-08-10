/**
 * HTML-preserving find/replace for cell content.
 *
 * ### Why this exists
 *
 * `FloatingSearchBar` previously did search/replace by calling `stripHtml`
 * on the cell content, running a plain-text regex replacement, and posting
 * the result back as the new saved cell HTML. That silently:
 *
 *  - merges multi-paragraph cells (narration + dialogue → one flat blob),
 *  - strips inline formatting (footnote `<sup>` markers, `<em>`, etc.),
 *  - discards trailing blank lines (which were already fragile — see #1103),
 *  - deletes anything else the plain-text projection can't represent.
 *
 * This module replaces that with a DOM-aware pass: we parse the HTML,
 * walk only its text nodes (`TreeWalker` with `SHOW_TEXT`), do the actual
 * replacement inside those text-node values, and serialize the tree back
 * to HTML. Non-text markup is untouched.
 *
 * The tree-walk order matches `document.body.textContent`, which is the
 * same projection `stripHtml` uses to build the plain-text search index —
 * so the Nth match found by the search bar corresponds to the Nth match
 * we walk here (provided the match doesn't straddle a text-node boundary,
 * which is not something existing highlight code handles either).
 *
 * ### Scope
 *
 * - Case-insensitive matching supported.
 * - `replaceAll` and "replace only the Nth match" (single-hit) both
 *   supported via `options.onlyMatchIndex`.
 * - Empty query or no-match input returns the HTML unchanged (no
 *   round-trip through DOMParser to avoid unnecessary reformatting of the
 *   saved HTML in the common no-op case).
 * - Cross-text-node matches (e.g. query `"hello"` against
 *   `<b>hel</b>lo`) are intentionally NOT supported — the highlight
 *   pipeline in `FloatingSearchBar.applyDomHighlights` doesn't handle them
 *   either, and any fix belongs at the search-index layer, not here.
 */

const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface ReplaceOptions {
    /**
     * If provided, only the Nth match in tree-walk order is replaced (0-indexed).
     * If omitted, every match is replaced.
     */
    onlyMatchIndex?: number;
}

/**
 * Run a text-only find/replace over `html` while preserving all markup.
 *
 * Returns the original `html` string reference when nothing matched, so
 * callers can cheaply detect "no change" via `newHtml === html`.
 */
export function replaceInCellHtml(
    html: string,
    query: string,
    replaceText: string,
    matchCase: boolean,
    options: ReplaceOptions = {}
): string {
    if (!html || !query) return html;

    // Fast path: if the query doesn't occur in the plain-text projection at
    // all, we can skip the full parse/serialize round-trip. `stripHtml`
    // (this file's peer helper) uses the same projection.
    const plainProjection = extractPlainText(html);
    const needle = matchCase ? query : query.toLowerCase();
    const haystack = matchCase ? plainProjection : plainProjection.toLowerCase();
    if (haystack.indexOf(needle) === -1) return html;

    const doc = new DOMParser().parseFromString(html, "text/html");
    const container = doc.body;
    if (!container) return html;

    const regex = new RegExp(escapeRegex(query), matchCase ? "g" : "gi");
    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode()) !== null) {
        textNodes.push(node as Text);
    }

    let globalMatchIndex = 0;
    let changed = false;
    const { onlyMatchIndex } = options;

    for (const textNode of textNodes) {
        const value = textNode.data;
        if (!value) continue;

        // Fast-reject nodes that don't contain any match.
        regex.lastIndex = 0;
        if (!regex.test(value)) continue;

        regex.lastIndex = 0;
        let out = "";
        let cursor = 0;
        let match: RegExpExecArray | null;
        let nodeChanged = false;

        while ((match = regex.exec(value)) !== null) {
            // Guard against zero-width matches (shouldn't happen with our
            // literal-escaped regex, but keeps the loop safe).
            if (match[0].length === 0) {
                regex.lastIndex += 1;
                continue;
            }

            const shouldReplace = onlyMatchIndex === undefined || globalMatchIndex === onlyMatchIndex;
            if (shouldReplace) {
                out += value.slice(cursor, match.index) + replaceText;
                cursor = match.index + match[0].length;
                nodeChanged = true;
            }

            globalMatchIndex += 1;

            if (onlyMatchIndex !== undefined && globalMatchIndex > onlyMatchIndex) {
                // Only the single targeted match is being replaced; stop
                // walking further matches in this node.
                break;
            }
        }

        if (nodeChanged) {
            out += value.slice(cursor);
            textNode.data = out;
            changed = true;
        }

        if (onlyMatchIndex !== undefined && globalMatchIndex > onlyMatchIndex && nodeChanged) {
            // Targeted single-match already applied; no need to keep
            // walking the remaining text nodes.
            break;
        }
    }

    if (!changed) return html;
    return container.innerHTML;
}

/**
 * Delete a single match by replacing it with the empty string.
 * Thin wrapper over `replaceInCellHtml` for readability at the call site.
 */
export function deleteInCellHtml(
    html: string,
    query: string,
    matchCase: boolean,
    options: ReplaceOptions = {}
): string {
    return replaceInCellHtml(html, query, "", matchCase, options);
}

/**
 * Best-effort plain-text projection of the cell HTML. Uses DOMParser when
 * available (browser / jsdom test env), falls back to a naive tag-strip
 * regex otherwise. Kept internal — callers that want to *display* the
 * plain text should keep using `stripHtml` in `FloatingSearchBar.tsx`,
 * which is what we're intentionally paralleling here.
 */
function extractPlainText(html: string): string {
    if (typeof DOMParser !== "undefined") {
        try {
            const doc = new DOMParser().parseFromString(html, "text/html");
            return doc.body.textContent || "";
        } catch {
            // fall through
        }
    }
    return html.replace(/<[^>]*>/g, "");
}
