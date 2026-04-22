/**
 * DOM-based engram highlighter. Takes a container element whose HTML has
 * already been rendered via `dangerouslySetInnerHTML` and wraps each engram
 * span (by token match) in a `<span class="engram-highlight" ...>` with a
 * token-count based color, leaving any existing nested nodes (like footnote
 * markers) intact when possible.
 *
 * The approach is tolerant of the fact that the server's offset math and
 * the webview's DOM text don't have to line up exactly — we match engrams
 * by their normalized token sequence rather than by byte offset.
 */

export interface RenderedEngram {
    text: string;
    tokenCount: number;
    matchedCellId?: string;
    matchedCellLabel?: string;
    matchedSnippet?: string;
    isOrphan: boolean;
}

const HIGHLIGHT_CLASS = "engram-highlight";
const ORPHAN_CLASS = "engram-orphan";
const MATCH_CLASS = "engram-match";

const TOKEN_RE = /[\p{L}\p{N}\p{M}]+/gu;

function normalize(text: string): string[] {
    return (text || "").toLowerCase().match(TOKEN_RE) ?? [];
}

/** Concatenate the lowercased tokens found in the DOM subtree along with a
 *  map from each token's character index in the concatenated string to the
 *  DOM text node / offset it came from. Allows us to locate matches across
 *  text-node boundaries and then wrap them back into the DOM.
 */
interface TokenIndexEntry {
    token: string;
    node: Text;
    /** Character offset inside the text node where the token starts. */
    nodeStart: number;
    /** Character offset inside the text node where the token ends (exclusive). */
    nodeEnd: number;
}

function buildTokenIndex(container: HTMLElement): TokenIndexEntry[] {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            // Skip nodes already inside an engram wrapper (idempotency) and
            // skip footnote markers — we don't want to highlight them.
            if (parent.closest(`.${HIGHLIGHT_CLASS}`)) return NodeFilter.FILTER_REJECT;
            if (parent.closest(".footnote-marker")) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    const entries: TokenIndexEntry[] = [];
    let current: Node | null;
    while ((current = walker.nextNode())) {
        const textNode = current as Text;
        const text = textNode.nodeValue ?? "";
        let m: RegExpExecArray | null;
        TOKEN_RE.lastIndex = 0;
        while ((m = TOKEN_RE.exec(text)) !== null) {
            entries.push({
                token: m[0].toLowerCase(),
                node: textNode,
                nodeStart: m.index,
                nodeEnd: m.index + m[0].length,
            });
        }
    }
    return entries;
}

/** Colour ramp based on token count. Longer matches → stronger color. */
function backgroundForEngram(engram: RenderedEngram): string {
    if (engram.isOrphan) {
        return "rgba(244, 114, 114, 0.28)"; // warning red for spans with no corpus match
    }
    // 2 tokens: faint, 3: mid, 4+: strong
    if (engram.tokenCount >= 5) return "rgba(88, 166, 255, 0.35)";
    if (engram.tokenCount >= 3) return "rgba(88, 166, 255, 0.22)";
    return "rgba(88, 166, 255, 0.14)";
}

/** Wrap tokens[from..to] (inclusive..exclusive) from the token index in a
 *  styled `<span>`. Safely splits text nodes as needed. Returns true on
 *  success, false if the tokens aren't contiguous in a single text node
 *  (in which case we fall back to wrapping each contiguous run).
 */
function wrapTokenRange(entries: TokenIndexEntry[], from: number, to: number, engram: RenderedEngram) {
    if (to <= from) return;

    // Group consecutive entries that share the same text node, then wrap
    // each group. This handles engrams that span multiple text nodes
    // (e.g. across a <strong> inline element) by wrapping each piece.
    let i = from;
    while (i < to) {
        const groupStart = i;
        while (i + 1 < to && entries[i + 1].node === entries[groupStart].node) {
            i += 1;
        }
        const groupEnd = i + 1; // exclusive

        const node = entries[groupStart].node;
        const start = entries[groupStart].nodeStart;
        const end = entries[groupEnd - 1].nodeEnd;
        const text = node.nodeValue ?? "";

        // Split the text node so we can wrap just the engram slice.
        const before = text.slice(0, start);
        const match = text.slice(start, end);
        const after = text.slice(end);

        const span = document.createElement("span");
        span.className = HIGHLIGHT_CLASS + " " + (engram.isOrphan ? ORPHAN_CLASS : MATCH_CLASS);
        span.textContent = match;
        span.style.backgroundColor = backgroundForEngram(engram);
        span.style.borderRadius = "3px";
        span.style.padding = "0 2px";
        span.style.cursor = "pointer";
        span.dataset.engramText = engram.text;
        span.dataset.engramTokens = String(engram.tokenCount);
        if (engram.matchedCellId) span.dataset.engramMatchedCellId = engram.matchedCellId;
        if (engram.matchedCellLabel) span.dataset.engramMatchedLabel = engram.matchedCellLabel;
        if (engram.matchedSnippet) span.dataset.engramSnippet = engram.matchedSnippet;
        if (engram.isOrphan) span.dataset.engramOrphan = "1";

        const parent = node.parentNode;
        if (!parent) return;

        const beforeNode = before ? document.createTextNode(before) : null;
        const afterNode = after ? document.createTextNode(after) : null;

        if (afterNode) parent.insertBefore(afterNode, node.nextSibling);
        parent.insertBefore(span, node.nextSibling);
        if (beforeNode) parent.insertBefore(beforeNode, node.nextSibling);
        parent.removeChild(node);

        // Update the entries to reflect the new DOM structure: any remaining
        // entries that referenced the original node in the same group will
        // have been consumed already. Entries referencing the node for later
        // groups (same text node) need their `node` pointer updated to
        // `afterNode`, and their offsets shifted by -end.
        for (let k = groupEnd; k < entries.length; k++) {
            if (entries[k].node === node) {
                if (!afterNode) break;
                entries[k].node = afterNode;
                entries[k].nodeStart -= end;
                entries[k].nodeEnd -= end;
            }
        }

        i = groupEnd;
    }
}

export function applyEngramHighlights(
    container: HTMLElement,
    engrams: RenderedEngram[]
): void {
    if (!container || !engrams || engrams.length === 0) return;

    // Process longer matches first so shorter overlapping spans don't win.
    const ordered = [...engrams].sort((a, b) => b.tokenCount - a.tokenCount);

    const entries = buildTokenIndex(container);
    if (entries.length === 0) return;

    const consumed = new Array(entries.length).fill(false);

    for (const engram of ordered) {
        const queryTokens = normalize(engram.text);
        if (queryTokens.length === 0) continue;

        // Find the first non-consumed token sequence matching queryTokens.
        outer: for (let i = 0; i + queryTokens.length <= entries.length; i++) {
            for (let j = 0; j < queryTokens.length; j++) {
                if (consumed[i + j]) continue outer;
                if (entries[i + j].token !== queryTokens[j]) continue outer;
            }
            // Mark consumed.
            for (let j = 0; j < queryTokens.length; j++) consumed[i + j] = true;
            wrapTokenRange(entries, i, i + queryTokens.length, engram);
            break;
        }
    }
}
