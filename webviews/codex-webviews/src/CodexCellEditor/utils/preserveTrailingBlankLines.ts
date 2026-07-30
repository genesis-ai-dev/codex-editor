import { Delta } from "quill";

/**
 * Preserve trailing paragraph breaks (blank lines) through Quill's
 * HTML → Delta conversion when a cell is opened for editing.
 *
 * ### Why this exists
 *
 * Quill's `Clipboard#convert()` strips a single trailing `\n` from the
 * produced Delta (see `quill/modules/clipboard.js`, function `convert()`,
 * the "Remove trailing newline" branch). Combined with how the built-in
 * HTML→Delta traversal encodes trailing empty block elements
 * (`<p><br></p>`, `<p></p>`, …) as one extra `\n` per empty block on top of
 * the always-present block terminator, the net effect is that a trailing
 * blank line in the saved cell HTML is silently discarded on cell open:
 *
 * ```text
 *   HTML "<p>Hello</p><p><br></p>"        → raw Delta "Hello\n\n"
 *   convert() strips one trailing \n      →     Delta "Hello\n"
 *   setContents(Delta("Hello\n")) renders → "<p>Hello</p>"           (❌ blank line gone)
 * ```
 *
 * For a translation editor where a blank line at the end of a cell is the
 * only mechanism the user has to mark a paragraph break at the end of a
 * verse (e.g. between narration and dialogue in Spanish), this data loss is
 * silent and destructive. Once the cell is edited and saved, the trailing
 * blank line is gone from `quill.root.innerHTML` too, so the cell is
 * permanently truncated. See issue #1103.
 *
 * ### What this does
 *
 * Re-append exactly **one** `\n` insert op to the converted Delta, but
 * **only when `convert()` actually stripped the trailing blank line**.
 *
 * The subtlety: `convert()` does not *unconditionally* strip. Its guard is
 * `deltaEndsWith(delta, '\n') && lastOp.attributes == null`. So when the
 * trailing empty block carries block-level formatting (e.g. an aligned
 * `<p class="ql-align-center"><br></p>`, a heading, etc.), the trailing
 * newline op has attributes, `convert()` leaves it in place, and the empty
 * line already round-trips correctly. In that case adding another `\n`
 * would inject a **phantom** empty paragraph that the user can't delete
 * (every reopen re-adds it, because the stored HTML still ends with the
 * formatted empty block). That was the regression this guard fixes.
 *
 * We therefore decide using the **raw, pre-strip Delta** (from
 * `clipboardModule.convertHTML`, which does not apply the strip). If its
 * last op is a plain trailing `\n` (no attributes), `convert()` stripped
 * it, and — provided the HTML actually ends with an empty block (user
 * intent, vs. the always-present single document-terminating newline that
 * every non-empty cell has) — we add it back. One `\n` is always the right
 * correction because `convert()` only ever strips a single newline, so N
 * trailing empty blocks are only ever off by one.
 *
 * When the raw Delta isn't available (e.g. a future Quill drops
 * `convertHTML`), we fall back to inspecting the converted Delta. That's
 * slightly less complete (it can miss the "formatted content immediately
 * followed by a plain trailing empty block" case, losing that one blank
 * line) but is still safe: it never produces a phantom line.
 *
 * ### Non-goals
 *
 * - Does **not** preserve trailing whitespace that isn't a full empty
 *   paragraph (a `<span>text </span>` with a single trailing space is the
 *   `preserveWhitespace` matcher's concern, and is orthogonal).
 * - Does **not** touch mid-paragraph empty blocks. Those already survive
 *   `convert()` intact: `<p>A</p><p><br></p><p>B</p>` round-trips as
 *   `A\n\nB` and renders back to the same HTML.
 */

const TRAILING_EMPTY_BLOCK = /(?:<p(?:\s[^>]*)?>\s*(?:<br\s*\/?>)?\s*<\/p>\s*)+$/i;

/**
 * `true` if the given HTML ends with one or more empty `<p>` blocks
 * (`<p></p>`, `<p><br></p>`, or `<p><br/></p>`, in any repetition,
 * optionally separated or followed by whitespace).
 */
export function endsWithEmptyBlock(html: string): boolean {
    if (!html) return false;
    return TRAILING_EMPTY_BLOCK.test(html);
}

/**
 * Whether Quill's `convert()` stripped a plain trailing blank line that the
 * source HTML intended to keep — i.e. whether we should add one `\n` back.
 *
 * `decisionDelta` should be the **raw** (pre-strip) Delta from
 * `convertHTML` when available; the converted Delta is an acceptable but
 * slightly less complete fallback (see the module doc-comment).
 */
function shouldRestoreTrailingBlank(html: string, decisionDelta: Delta): boolean {
    if (!endsWithEmptyBlock(html)) return false;

    const ops = decisionDelta?.ops;
    if (!ops || ops.length === 0) return false;

    const lastOp = ops[ops.length - 1];
    if (!lastOp || typeof lastOp.insert !== "string") return false;
    if (!lastOp.insert.endsWith("\n")) return false;

    // `convert()` only strips the trailing newline when the final op has no
    // attributes. A formatted trailing empty block (attributes present) is
    // preserved by `convert()` already — adding another would double it.
    return lastOp.attributes == null;
}

/**
 * Add back the single `\n` op that Quill's `Clipboard#convert()` strips off
 * when a cell's saved HTML ends with a plain trailing empty paragraph.
 *
 * @param html          the source HTML being loaded into the editor
 * @param convertedDelta the Delta returned by `clipboardModule.convert()`
 *                       (post-strip) — this is what we return, possibly with
 *                       one `\n` appended
 * @param rawDelta      optional pre-strip Delta from
 *                      `clipboardModule.convertHTML()`; strongly preferred
 *                      for a correct decision. Falls back to `convertedDelta`
 *                      when omitted.
 *
 * Idempotent no-op when the HTML has no trailing empty block or when
 * `convert()` didn't strip one.
 */
export function restoreTrailingBlankLine(
    html: string,
    convertedDelta: Delta,
    rawDelta?: Delta
): Delta {
    const decisionDelta = rawDelta ?? convertedDelta;
    if (!shouldRestoreTrailingBlank(html, decisionDelta)) return convertedDelta;
    return convertedDelta.concat(new Delta().insert("\n"));
}
