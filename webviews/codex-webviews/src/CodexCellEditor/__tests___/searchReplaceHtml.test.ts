/**
 * Regression tests for issue #1103 (find-replace destructiveness).
 *
 * These cover the DOM-aware `replaceInCellHtml` / `deleteInCellHtml`
 * helpers that back FloatingSearchBar. The behavior we're locking in:
 *
 *  - Multi-paragraph cells stay multi-paragraph.
 *  - Inline formatting (footnote markers, `<em>`, etc.) is preserved.
 *  - Trailing blank lines are preserved (#1103 issue-body Scenario B).
 *  - "Replace only the Nth match" hits exactly one occurrence.
 *  - No-op replacements return the input string byte-for-byte (so callers
 *    can skip the round-trip to the extension host via reference equality).
 */

import { describe, it, expect } from "vitest";
import { replaceInCellHtml, deleteInCellHtml } from "../utils/searchReplaceHtml";

describe("replaceInCellHtml — structural preservation", () => {
    it("preserves paragraph structure in a narration + dialogue cell", () => {
        // The exact scenario from #1103: Spanish-style narration then dialogue.
        const html = "<span>Narrator says foo.</span><p>Character replies foo.</p>";
        const out = replaceInCellHtml(html, "foo", "bar", true);
        expect(out).toBe("<span>Narrator says bar.</span><p>Character replies bar.</p>");
    });

    it("preserves trailing blank line", () => {
        const html = "<span>Hello foo world</span><p><br></p>";
        const out = replaceInCellHtml(html, "foo", "bar", true);
        expect(out).toBe("<span>Hello bar world</span><p><br></p>");
    });

    it("preserves mid-paragraph blank line", () => {
        const html = "<p>A foo B</p><p><br></p><p>C foo D</p>";
        const out = replaceInCellHtml(html, "foo", "bar", true);
        expect(out).toBe("<p>A bar B</p><p><br></p><p>C bar D</p>");
    });

    it("preserves inline footnote markers", () => {
        const html = '<span>Hello foo<sup class="footnote-marker" data-footnote="1">1</sup> world foo.</span>';
        const out = replaceInCellHtml(html, "foo", "bar", true);
        expect(out).toBe(
            '<span>Hello bar<sup class="footnote-marker" data-footnote="1">1</sup> world bar.</span>'
        );
    });

    it("preserves inline `<em>` / `<strong>` formatting around a match", () => {
        const html = "<span>Say <em>foo</em> loudly.</span>";
        const out = replaceInCellHtml(html, "foo", "bar", true);
        expect(out).toBe("<span>Say <em>bar</em> loudly.</span>");
    });

    it("replaces across multiple text nodes independently", () => {
        const html = "<span>foo</span> and <em>foo</em> and <strong>foo</strong>";
        const out = replaceInCellHtml(html, "foo", "bar", true);
        expect(out).toBe("<span>bar</span> and <em>bar</em> and <strong>bar</strong>");
    });
});

describe("replaceInCellHtml — case sensitivity", () => {
    it("case-insensitive replace hits mixed case", () => {
        const html = "<p>Foo FOO foo fOo</p>";
        const out = replaceInCellHtml(html, "foo", "bar", false);
        expect(out).toBe("<p>bar bar bar bar</p>");
    });

    it("case-sensitive replace only hits exact case", () => {
        const html = "<p>Foo FOO foo fOo</p>";
        const out = replaceInCellHtml(html, "foo", "bar", true);
        expect(out).toBe("<p>Foo FOO bar fOo</p>");
    });
});

describe("replaceInCellHtml — onlyMatchIndex (single-hit)", () => {
    it("replaces only the first match when onlyMatchIndex=0", () => {
        const html = "<p>foo foo foo</p>";
        const out = replaceInCellHtml(html, "foo", "bar", true, { onlyMatchIndex: 0 });
        expect(out).toBe("<p>bar foo foo</p>");
    });

    it("replaces only the second match when onlyMatchIndex=1", () => {
        const html = "<p>foo foo foo</p>";
        const out = replaceInCellHtml(html, "foo", "bar", true, { onlyMatchIndex: 1 });
        expect(out).toBe("<p>foo bar foo</p>");
    });

    it("replaces only the third match when onlyMatchIndex=2", () => {
        const html = "<p>foo foo foo</p>";
        const out = replaceInCellHtml(html, "foo", "bar", true, { onlyMatchIndex: 2 });
        expect(out).toBe("<p>foo foo bar</p>");
    });

    it("counts matches across text nodes in tree order", () => {
        // Second `foo` should be the one inside <em>.
        const html = "<p>foo <em>foo</em> foo</p>";
        const out = replaceInCellHtml(html, "foo", "bar", true, { onlyMatchIndex: 1 });
        expect(out).toBe("<p>foo <em>bar</em> foo</p>");
    });

    it("returns input unchanged when onlyMatchIndex is out of range", () => {
        const html = "<p>foo foo</p>";
        const out = replaceInCellHtml(html, "foo", "bar", true, { onlyMatchIndex: 5 });
        expect(out).toBe(html);
    });
});

describe("replaceInCellHtml — no-op fast paths", () => {
    it("returns input reference when query is empty", () => {
        const html = "<p>Hello</p>";
        expect(replaceInCellHtml(html, "", "bar", true)).toBe(html);
    });

    it("returns input reference when html is empty", () => {
        expect(replaceInCellHtml("", "foo", "bar", true)).toBe("");
    });

    it("returns input reference when query is not present", () => {
        const html = "<p>Hello world</p>";
        // Same reference (skips DOMParser round-trip when we know we'd
        // change nothing) — this lets callers cheaply detect no-change.
        expect(replaceInCellHtml(html, "notpresent", "bar", true)).toBe(html);
    });
});

describe("replaceInCellHtml — special characters in the query", () => {
    it("treats query as literal text, not regex", () => {
        const html = "<p>a.b.c and abc</p>";
        const out = replaceInCellHtml(html, "a.b.c", "X", true);
        expect(out).toBe("<p>X and abc</p>");
    });

    it("treats brackets/parens in the query as literal", () => {
        const html = "<p>f(oo) and foo</p>";
        const out = replaceInCellHtml(html, "f(oo)", "X", true);
        expect(out).toBe("<p>X and foo</p>");
    });
});

describe("deleteInCellHtml", () => {
    it("deletes all matches by default while preserving markup", () => {
        const html = "<p>hello foo world foo</p><p>trailing foo</p>";
        const out = deleteInCellHtml(html, "foo", true);
        expect(out).toBe("<p>hello  world </p><p>trailing </p>");
    });

    it("deletes only the targeted match when onlyMatchIndex is provided", () => {
        const html = "<p>a foo b foo c</p>";
        const out = deleteInCellHtml(html, "foo", true, { onlyMatchIndex: 0 });
        expect(out).toBe("<p>a  b foo c</p>");
    });

    it("preserves trailing empty <p> while deleting", () => {
        const html = "<span>hello foo</span><p><br></p>";
        const out = deleteInCellHtml(html, "foo", true);
        expect(out).toBe("<span>hello </span><p><br></p>");
    });
});

describe("replaceInCellHtml — regressions that used to break under the plain-text path", () => {
    it("does not merge multi-paragraph cells when replacing a match in only one paragraph", () => {
        const html = "<p>A foo</p><p>B</p>";
        const out = replaceInCellHtml(html, "foo", "bar", true);
        expect(out).toBe("<p>A bar</p><p>B</p>");
        expect(out).toContain("</p><p>"); // paragraphs are still separate
    });

    it("does not merge multi-paragraph cells when the query is not in the first paragraph", () => {
        const html = "<p>A</p><p>B foo</p>";
        const out = replaceInCellHtml(html, "foo", "bar", true);
        expect(out).toBe("<p>A</p><p>B bar</p>");
    });

    it("keeps footnote marker intact even when the search match sits right next to it", () => {
        const html =
            '<span>foo<sup class="footnote-marker">1</sup> foo</span>';
        const out = replaceInCellHtml(html, "foo", "bar", true);
        expect(out).toBe('<span>bar<sup class="footnote-marker">1</sup> bar</span>');
    });
});
