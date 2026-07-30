/**
 * Regression test for issue #1010: double spaces in source content must
 * survive Quill's HTML → Delta conversion when a cell is opened.
 *
 * The test uses a real Quill instance (no mocks) and exercises the same code
 * path the editor uses on cell open. If a future Quill upgrade restructures
 * its clipboard module such that we can no longer locate the built-in
 * `matchText` by reference (or changes its semantics), this test will fail
 * loudly — that's the regression signal to revisit utils/preserveWhitespace.ts.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Quill, { Delta } from "quill";
import { installPreserveWhitespaceMatcher } from "../utils/preserveWhitespace";

type ClipboardModule = {
    convert: (args: { html?: string; text?: string }) => Delta;
    matchers: Array<[number | string, unknown]>;
};

function makeQuillWithPreservedWhitespace(): { quill: Quill; clipboard: ClipboardModule } {
    const container = document.createElement("div");
    container.id = "quill-host";
    document.body.appendChild(container);

    const quill = new Quill(container, { theme: "snow" });
    const clipboard = quill.getModule("clipboard") as unknown as ClipboardModule;

    const swapped = installPreserveWhitespaceMatcher(clipboard as never);
    if (!swapped) {
        throw new Error(
            "installPreserveWhitespaceMatcher failed: Quill's built-in matchText could not be located. " +
                "If you just upgraded Quill, check that `matchText` is still exported from quill/modules/clipboard."
        );
    }

    return { quill, clipboard };
}

function deltaText(delta: Delta): string {
    return delta.ops
        .map((op) => (typeof op.insert === "string" ? op.insert : ""))
        .join("");
}

describe("preserveWhitespaceMatchText (issue #1010)", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("preserves mid-line double ASCII spaces in a <p>", () => {
        const { clipboard } = makeQuillWithPreservedWhitespace();

        const delta = clipboard.convert({ html: "<p>hello  world</p>", text: "" });

        expect(deltaText(delta)).toContain("hello  world");
    });

    it("preserves runs of 3+ ASCII spaces verbatim", () => {
        const { clipboard } = makeQuillWithPreservedWhitespace();

        const delta = clipboard.convert({ html: "<p>a   b    c</p>", text: "" });

        expect(deltaText(delta)).toContain("a   b    c");
    });

    it("normalizes &nbsp; to a regular space (matches Quill's existing semantics)", () => {
        // We don't want to silently let \u00A0 leak into the saved Delta — the
        // user-visible text should be regular spaces. Only the *count* of
        // consecutive spaces should be preserved.
        const { clipboard } = makeQuillWithPreservedWhitespace();

        const delta = clipboard.convert({ html: "<p>foo&nbsp;&nbsp;bar</p>", text: "" });

        const text = deltaText(delta);
        expect(text).toContain("foo  bar");
        expect(text).not.toContain("\u00a0");
    });

    it("still strips a single leading space at the start of a block", () => {
        // This is Quill's existing semantics for handling indented HTML —
        // we want to preserve it. A leading single space at a block boundary
        // should still be dropped.
        const { clipboard } = makeQuillWithPreservedWhitespace();

        const delta = clipboard.convert({ html: "<p> leading</p>", text: "" });

        expect(deltaText(delta)).not.toMatch(/^ leading/);
    });

    it("still drops pure-whitespace text nodes between block elements", () => {
        // Multi-paragraph HTML with newline indentation between <p> tags
        // shouldn't produce phantom whitespace ops in the Delta.
        const { clipboard } = makeQuillWithPreservedWhitespace();

        const delta = clipboard.convert({
            html: "<p>one</p>\n    <p>two</p>",
            text: "",
        });

        const inserts = delta.ops
            .map((op) => op.insert)
            .filter((insert): insert is string => typeof insert === "string");

        // No op should be purely indentation whitespace.
        expect(inserts.every((s) => s.trim().length > 0 || s === "\n")).toBe(true);
    });
});
