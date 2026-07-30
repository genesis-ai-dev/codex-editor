import type { Delta } from "quill";
import { Parchment } from "quill";
import { matchText as builtinMatchText } from "quill/modules/clipboard";

/**
 * Whitespace-preserving replacement for Quill's built-in `matchText` matcher.
 *
 * ### Why this exists
 *
 * Quill's default text matcher (quill/modules/clipboard.js → `matchText`)
 * actively destroys data by collapsing runs of 2+ ASCII spaces into a single
 * space when converting HTML → Delta. For a general-purpose rich-text editor
 * that matches HTML rendering semantics, but for a scripture translation
 * editor it silently corrupts content imported from source texts — e.g.
 * mid-line double spaces in Portuguese source materials become invisible and
 * uneditable in the open cell while still present in the closed-cell view.
 * See issue #1010.
 *
 * ### What this does
 *
 * Mirrors Quill 2.0.3's `matchText` exactly except for the single offending
 * line that collapses `/ {2,}/g → ' '`. All other behavior is preserved:
 *
 *  - Microsoft Word `<o:p>&nbsp;</o:p>` empty-line marker handling.
 *  - `<pre>` ancestor pass-through (Quill preserves whitespace inside `<pre>`).
 *  - Dropping pure-whitespace text nodes that sit between block elements
 *    (mimics how browsers ignore indentation between block tags).
 *  - Normalizing non-NBSP whitespace (tabs, CR, LF) to a regular space.
 *  - Stripping single leading/trailing spaces at block boundaries.
 *  - Final NBSP → space normalization, so user-typed double spaces (which
 *    browsers in contenteditable convert to ` \u00A0`) round-trip as two
 *    regular spaces in the saved HTML.
 *
 * ### Future
 *
 * Upstream PR https://github.com/slab/quill/pull/4319 ("Fix white spaces not
 * being preserved when pasted into editor") would make `Clipboard#convert()`
 * respect inline `white-space` style and obsolete this whole module. As of
 * 2026-06 it remains open and unmerged. When/if it lands, remove this file
 * and the matcher splice in Editor.tsx.
 *
 * The `isLine`, `isPreNode`, and `isBetweenInlineElements` helpers mirror
 * Quill's private versions (clipboard.js lines 236–258 in 2.0.3) which are
 * not exported. They've been structurally stable across recent Quill versions.
 */

const preNodes = new WeakMap<Node, boolean>();
function isPreNode(node: Node | null): boolean {
    if (node == null) return false;
    const cached = preNodes.get(node);
    if (cached !== undefined) return cached;
    const result =
        node instanceof Element && node.tagName === "PRE" ? true : isPreNode(node.parentNode);
    preNodes.set(node, result);
    return result;
}

// `scroll` is Quill's ScrollBlot; we don't depend on its full shape, just the
// `query` method that resolves a DOM node to a registered blot definition.
type ScrollLike = { query?: (node: Node) => unknown };

function isLine(node: Node | null, scroll: ScrollLike | undefined | null): boolean {
    if (!(node instanceof Element)) return false;
    const match = scroll?.query?.(node) as { prototype?: unknown } | null | undefined;
    return match != null && match.prototype instanceof Parchment.BlockBlot;
}

function isBetweenInlineElements(node: Node, scroll: ScrollLike | undefined | null): boolean {
    const prev = (node as ChildNode).previousElementSibling;
    const next = (node as ChildNode).nextElementSibling;
    return !!(prev && next && !isLine(prev, scroll) && !isLine(next, scroll));
}

export function preserveWhitespaceMatchText(
    node: Text,
    delta: Delta,
    scroll: ScrollLike | undefined | null
): Delta {
    let text = node.data;

    if (node.parentElement?.tagName === "O:P") {
        return delta.insert(text.trim());
    }

    if (isPreNode(node)) {
        return delta.insert(text);
    }

    if (
        text.trim().length === 0 &&
        text.includes("\n") &&
        !isBetweenInlineElements(node, scroll)
    ) {
        return delta;
    }

    text = text.replace(/[^\S\u00a0]/g, " ");
    // NOTE: Quill's matchText collapses runs here with `text.replace(/ {2,}/g, ' ')`.
    // We intentionally do NOT collapse — that's the entire point of this file.

    const prevSibling = node.previousSibling;
    const nextSibling = node.nextSibling;
    if (
        (prevSibling == null && node.parentElement != null && isLine(node.parentElement, scroll)) ||
        (prevSibling instanceof Element && isLine(prevSibling, scroll))
    ) {
        text = text.replace(/^ /, "");
    }
    if (
        (nextSibling == null && node.parentElement != null && isLine(node.parentElement, scroll)) ||
        (nextSibling instanceof Element && isLine(nextSibling, scroll))
    ) {
        text = text.replace(/ $/, "");
    }

    text = text.replaceAll("\u00a0", " ");
    return delta.insert(text);
}

/**
 * Shape of the parts of Quill's Clipboard module we touch. Mirrors what
 * `quill.getModule("clipboard")` actually returns at runtime; declared inline
 * here so consumers don't need to depend on Quill's internal types.
 */
type ClipboardModuleLike = {
    matchers?: Array<[number | string, (node: Node, delta: Delta, scroll: unknown) => Delta]>;
};

/**
 * Swaps Quill's built-in TEXT_NODE `matchText` matcher with the
 * whitespace-preserving version above. Identifies the existing entry by
 * function reference (using the imported `builtinMatchText`) rather than by
 * position, so the replacement is robust to Quill reordering its default
 * matchers in a future patch release.
 *
 * Returns `true` if the swap succeeded, `false` if Quill's built-in matcher
 * couldn't be located (e.g. because Quill's internals changed shape in an
 * upgrade). Callers should treat `false` as a regression signal.
 */
export function installPreserveWhitespaceMatcher(clipboardModule: ClipboardModuleLike): boolean {
    // Defensive against test doubles that stub out `clipboard` without a
    // `matchers` array — silently no-op there.
    if (!Array.isArray(clipboardModule?.matchers)) return false;

    const entry = clipboardModule.matchers.find(
        ([selector, matcher]) =>
            selector === Node.TEXT_NODE && matcher === (builtinMatchText as unknown)
    );
    if (!entry) return false;
    entry[1] = preserveWhitespaceMatchText as (
        node: Node,
        delta: Delta,
        scroll: unknown
    ) => Delta;
    return true;
}
