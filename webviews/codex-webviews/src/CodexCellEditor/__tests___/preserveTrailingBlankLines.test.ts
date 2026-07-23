/**
 * Regression tests for issue #1103: a trailing paragraph break (blank line)
 * at the end of a cell must survive the HTML → Delta → editor round-trip
 * that runs when a cell is opened for editing.
 *
 * These tests exercise the same code path Editor.tsx uses on cell open:
 *   1. `clipboardModule.convert({ html, text: "" })`
 *   2. `restoreTrailingBlankLine(html, delta)`
 *   3. `quill.setContents(delta, "silent")`
 * and assert on the resulting `quill.root.innerHTML`.
 *
 * If a future Quill upgrade changes the strip-one-trailing-newline behavior
 * (see quill/modules/clipboard.js) these tests will still pass or fail
 * loudly — because they assert on the observable end state (rendered
 * paragraph count), not on the intermediate Delta ops.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Quill, { Delta } from "quill";
import { installPreserveWhitespaceMatcher } from "../utils/preserveWhitespace";
import {
    endsWithEmptyBlock,
    restoreTrailingBlankLine,
} from "../utils/preserveTrailingBlankLines";

type ClipboardModule = {
    convert: (args: { html?: string; text?: string }) => Delta;
    convertHTML: (html: string) => Delta;
    matchers: Array<[number | string, unknown]>;
};

function makeQuill(): { quill: Quill; clipboard: ClipboardModule } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const quill = new Quill(container, { theme: "snow" });
    const clipboard = quill.getModule("clipboard") as unknown as ClipboardModule;
    installPreserveWhitespaceMatcher(clipboard as never);
    return { quill, clipboard };
}

/**
 * Mirrors Editor.tsx's on-open pipeline exactly, including passing the raw
 * (pre-strip) Delta from `convertHTML` so the phantom-line guard is exercised.
 */
function loadThroughEditorPipeline(quill: Quill, clipboard: ClipboardModule, html: string): string {
    const converted = clipboard.convert({ html, text: "" });
    const raw = clipboard.convertHTML(html);
    const withTrailing = restoreTrailingBlankLine(html, converted, raw);
    quill.setContents(withTrailing, "silent");
    return quill.root.innerHTML;
}

describe("endsWithEmptyBlock", () => {
    it("matches a bare trailing empty <p>", () => {
        expect(endsWithEmptyBlock("<span>x</span><p><br></p>")).toBe(true);
    });

    it("matches multiple trailing empty <p>", () => {
        expect(endsWithEmptyBlock("<span>x</span><p><br></p><p><br></p>")).toBe(true);
    });

    it("matches <p></p> without a <br>", () => {
        expect(endsWithEmptyBlock("<span>x</span><p></p>")).toBe(true);
    });

    it("matches <p><br/></p> (self-closed)", () => {
        expect(endsWithEmptyBlock("<span>x</span><p><br/></p>")).toBe(true);
    });

    it("matches trailing empty <p> with attributes", () => {
        expect(endsWithEmptyBlock('<span>x</span><p class="x"><br></p>')).toBe(true);
    });

    it("tolerates trailing whitespace after the empty <p>", () => {
        expect(endsWithEmptyBlock("<span>x</span><p><br></p>   \n  ")).toBe(true);
    });

    it("does not match a mid-paragraph empty <p>", () => {
        expect(endsWithEmptyBlock("<p>a</p><p><br></p><p>b</p>")).toBe(false);
    });

    it("does not match a <p> containing text", () => {
        expect(endsWithEmptyBlock("<p>hello</p>")).toBe(false);
    });

    it("does not match empty/undefined input", () => {
        expect(endsWithEmptyBlock("")).toBe(false);
    });
});

describe("restoreTrailingBlankLine — round-trip through Quill (issue #1103)", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("preserves a single trailing blank line", () => {
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(quill, clipboard, "<span>Hello</span><p><br></p>");
        expect(html).toBe("<p>Hello</p><p><br></p>");
    });

    it("preserves two trailing blank lines", () => {
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(
            quill,
            clipboard,
            "<span>Hello</span><p><br></p><p><br></p>"
        );
        expect(html).toBe("<p>Hello</p><p><br></p><p><br></p>");
    });

    it("preserves three trailing blank lines", () => {
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(
            quill,
            clipboard,
            "<span>Hello</span><p><br></p><p><br></p><p><br></p>"
        );
        expect(html).toBe("<p>Hello</p><p><br></p><p><br></p><p><br></p>");
    });

    it("preserves a trailing blank line for `<p>…</p><p><br></p>` shape too", () => {
        // Same shape from the Quill-side (not passed through
        // processQuillContentForSaving). Both shapes appear in saved data.
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(quill, clipboard, "<p>Hello</p><p><br></p>");
        expect(html).toBe("<p>Hello</p><p><br></p>");
    });

    it("does not add a phantom blank line when there is no trailing empty block", () => {
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(quill, clipboard, "<span>Hello</span>");
        expect(html).toBe("<p>Hello</p>");
    });

    it("does not add a phantom blank line for a multi-paragraph cell without trailing empty", () => {
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(
            quill,
            clipboard,
            "<span>Narration.</span><p>Dialogue.</p>"
        );
        expect(html).toBe("<p>Narration.</p><p>Dialogue.</p>");
    });

    it("preserves a mid-paragraph blank line untouched", () => {
        // Not the bug scenario, but a regression guard: our fix must not
        // multiply mid-paragraph blanks.
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(quill, clipboard, "<p>A</p><p><br></p><p>B</p>");
        expect(html).toBe("<p>A</p><p><br></p><p>B</p>");
    });

    it("preserves a mid-paragraph blank line AND a trailing blank line together", () => {
        // The Spanish-narration+dialogue+trailing-break scenario from #1103.
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(
            quill,
            clipboard,
            "<span>Narrator says.</span><p><br></p><p>Character replies.</p><p><br></p>"
        );
        expect(html).toBe(
            "<p>Narrator says.</p><p><br></p><p>Character replies.</p><p><br></p>"
        );
    });

    it("leaves an all-empty cell rendering as one empty paragraph", () => {
        // Quill renders empty content as `<p><br></p>`. We shouldn't
        // artificially amplify that.
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(quill, clipboard, "");
        expect(html).toBe("<p><br></p>");
    });

    it("round-trips a cell containing only `<p><br></p>`", () => {
        // Whole cell is a single empty paragraph. After load it should still
        // render as a single empty paragraph.
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(quill, clipboard, "<p><br></p>");
        expect(html).toBe("<p><br></p>");
    });
});

describe("restoreTrailingBlankLine — no phantom line for formatted trailing blocks (#1103 regression)", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("does NOT add a phantom line when the trailing empty block is aligned", () => {
        // Regression: convert() does not strip a *formatted* trailing newline,
        // so it already round-trips. Adding another produced an extra,
        // un-deletable empty paragraph on every reopen.
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(
            quill,
            clipboard,
            '<span>Hello</span><p class="ql-align-center"><br></p>'
        );
        expect(html).toBe('<p>Hello</p><p class="ql-align-center"><br></p>');
    });

    it("does NOT add a phantom line when the trailing empty block is right-aligned after another empty", () => {
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(
            quill,
            clipboard,
            '<span>Hello</span><p><br></p><p class="ql-align-right"><br></p>'
        );
        expect(html).toBe('<p>Hello</p><p><br></p><p class="ql-align-right"><br></p>');
    });

    it("preserves a plain trailing blank even when the preceding content is formatted", () => {
        // Here convert() DID strip a plain trailing newline (the empty block
        // is unformatted), so we must restore it — the preceding paragraph's
        // alignment must survive too.
        const { quill, clipboard } = makeQuill();
        const html = loadThroughEditorPipeline(
            quill,
            clipboard,
            '<p class="ql-align-center">Hello</p><p><br></p>'
        );
        expect(html).toBe('<p class="ql-align-center">Hello</p><p><br></p>');
    });

    it("round-trips a formatted trailing block idempotently (open → reopen stays stable)", () => {
        // Simulate open → (no edit) → save shape → reopen. The rendered HTML
        // from the first open must, when re-loaded, produce the same HTML —
        // no growth of empty paragraphs.
        const { quill, clipboard } = makeQuill();
        const first = loadThroughEditorPipeline(
            quill,
            clipboard,
            '<span>Hello</span><p class="ql-align-center"><br></p>'
        );
        const second = loadThroughEditorPipeline(quill, clipboard, first);
        expect(second).toBe(first);
    });
});

describe("restoreTrailingBlankLine — fallback path (no raw delta)", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("still restores a plain trailing blank using only the converted delta", () => {
        const { quill, clipboard } = makeQuill();
        const converted = clipboard.convert({ html: "<span>Hello</span><p><br></p>", text: "" });
        // No raw delta passed — exercises the fallback branch.
        const withTrailing = restoreTrailingBlankLine("<span>Hello</span><p><br></p>", converted);
        quill.setContents(withTrailing, "silent");
        expect(quill.root.innerHTML).toBe("<p>Hello</p><p><br></p>");
    });

    it("does NOT add a phantom line for a formatted trailing block even in the fallback path", () => {
        const { quill, clipboard } = makeQuill();
        const srcHtml = '<span>Hello</span><p class="ql-align-center"><br></p>';
        const converted = clipboard.convert({ html: srcHtml, text: "" });
        const withTrailing = restoreTrailingBlankLine(srcHtml, converted);
        quill.setContents(withTrailing, "silent");
        expect(quill.root.innerHTML).toBe('<p>Hello</p><p class="ql-align-center"><br></p>');
    });
});
