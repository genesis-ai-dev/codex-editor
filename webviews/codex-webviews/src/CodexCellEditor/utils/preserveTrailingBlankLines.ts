import { Delta } from "quill";

/**
 * Preserve trailing paragraph breaks (blank lines) through Quill's
 * HTML → Delta conversion when a cell is opened for editing.
 *
 * ### Why this exists
 *
 * Quill's `Clipboard#convert()` unconditionally strips a single trailing `\n`
 * from the produced Delta (see `quill/modules/clipboard.js`, function
 * `convert()`, the "Remove trailing newline" branch). Combined with how the
 * built-in HTML→Delta traversal encodes trailing empty block elements
 * (`<p><br></p>`, `<p></p>`, …) as one extra `\n` per empty block on top of
 * the always-present block terminator, the net effect is that every trailing
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
 * If the source HTML ends with one or more empty block elements
 * (`<p>[whitespace|<br>]</p>` in any repetition, with optional attributes and
 * inter-tag whitespace), append exactly one extra `\n` insert op to the
 * Delta. That's all: the raw traversal already produced N+1 newlines for N
 * trailing empty blocks, `convert()` stripped one, and `setContents()`
 * needs N+1 to render N+1 blocks (the last `\n` is the required block
 * terminator; every additional `\n` shows as an empty line). We're always
 * off by exactly 1, regardless of how many trailing empties there are — so
 * a constant +1 correction restores the intended block count for any N ≥ 1.
 *
 * If the HTML has no trailing empty block, we don't touch the Delta.
 *
 * ### Non-goals
 *
 * - This does **not** attempt to preserve trailing whitespace that isn't a
 *   full empty paragraph (e.g. a `<span>text </span>` with a single trailing
 *   space — that's handled by the `preserveWhitespace` matcher and is
 *   orthogonal).
 * - This does **not** touch mid-paragraph empty blocks. Those already
 *   survive `convert()` intact: `<p>A</p><p><br></p><p>B</p>` correctly
 *   round-trips as `A\n\nB` and renders back to the same HTML.
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
 * Add back the single `\n` op that Quill's `Clipboard#convert()` strips off
 * when a cell's saved HTML ends with one or more trailing empty paragraphs.
 *
 * Idempotent no-op when the HTML has no trailing empty block.
 */
export function restoreTrailingBlankLine(html: string, delta: Delta): Delta {
    if (!endsWithEmptyBlock(html)) return delta;
    return delta.concat(new Delta().insert("\n"));
}
