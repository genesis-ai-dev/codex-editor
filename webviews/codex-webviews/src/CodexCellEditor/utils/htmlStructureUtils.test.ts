import { describe, it, expect } from "vitest";
import {
    extractHtmlSkeleton,
    compareHtmlStructure,
    getStructureMismatchDescription,
    removeBareSpanPairs,
    convertBareSpanPairsToParagraphs,
    tryDeterministicStructureFix,
    extractPlainTextFromHtml,
    type HtmlStructureDiff,
} from "../../../../../sharedUtils/htmlStructureUtils";

describe("htmlStructureUtils", () => {
    describe("extractHtmlSkeleton", () => {
        it("returns empty string for empty input", () => {
            expect(extractHtmlSkeleton("")).toBe("");
        });

        it("returns empty string for plain text", () => {
            expect(extractHtmlSkeleton("Hello world")).toBe("");
        });

        it("extracts simple tags", () => {
            expect(extractHtmlSkeleton("<p>Hello</p>")).toBe("<p></p>");
        });

        it("extracts self-closing br tags", () => {
            expect(extractHtmlSkeleton("text<br/>more")).toBe("<br/>");
            expect(extractHtmlSkeleton("text<br />more")).toBe("<br/>");
        });

        it("extracts nested tags", () => {
            const html = '<p>Some <strong>bold</strong> and <em>italic</em> text</p>';
            expect(extractHtmlSkeleton(html)).toBe(
                "<p><strong></strong><em></em></p>"
            );
        });

        it("extracts tags with attributes", () => {
            const html = '<span data-tag="bd" style="color:red">bold</span>';
            expect(extractHtmlSkeleton(html)).toBe("<span></span>");
        });

        it("ignores USFM bracket markers (not valid HTML tags)", () => {
            const html = 'text<\\f + \\fr 1:3. \\ft> footnote <\\f*>';
            expect(extractHtmlSkeleton(html)).toBe("");
        });

        it("ignores entity-encoded bracket markers", () => {
            const html = 'text&lt;\\f + \\fr 1:3. \\ft&gt; footnote';
            expect(extractHtmlSkeleton(html)).toBe("");
        });

        it("extracts multiple self-closing tags", () => {
            const html = "line one<br/>line two<br/>line three";
            expect(extractHtmlSkeleton(html)).toBe("<br/><br/>");
        });

        it("extracts formatting tags from USFM-imported HTML", () => {
            const html =
                'He said <strong data-tag="bd">boldly</strong> and <em data-tag="it">softly</em>';
            expect(extractHtmlSkeleton(html)).toBe(
                "<strong></strong><em></em>"
            );
        });
    });

    describe("compareHtmlStructure", () => {
        it("reports match for identical plain text", () => {
            const result = compareHtmlStructure("Hello world", "Ahoj svet");
            expect(result.isMatch).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("reports match for identical HTML structures", () => {
            const source = "<p>Hello <strong>world</strong></p>";
            const target = "<p>Ahoj <strong>svet</strong></p>";
            const result = compareHtmlStructure(source, target);
            expect(result.isMatch).toBe(true);
        });

        it("detects missing tags in target", () => {
            const source = "text<br/>more text";
            const target = "text more text";
            const result = compareHtmlStructure(source, target);
            expect(result.isMatch).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain("Missing tags");
            expect(result.errors[0]).toContain("<br/>");
        });

        it("detects extra tags in target", () => {
            const source = "plain text";
            const target = "<p>wrapped text</p>";
            const result = compareHtmlStructure(source, target);
            expect(result.isMatch).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain("Extra tags");
        });

        it("detects both missing and extra tags", () => {
            const source = "<p>text<br/>more</p>";
            const target = "<div>text more</div>";
            const result = compareHtmlStructure(source, target);
            expect(result.isMatch).toBe(false);
            expect(result.errors.length).toBeGreaterThanOrEqual(1);
        });

        it("detects tag order differences", () => {
            const source = "<strong>a</strong><em>b</em>";
            const target = "<em>b</em><strong>a</strong>";
            const result = compareHtmlStructure(source, target);
            expect(result.isMatch).toBe(false);
            expect(result.errors[0]).toContain("order or nesting");
        });

        it("handles multiple br tags", () => {
            const source = "a<br/>b<br/>c";
            const target = "a<br/>b c";
            const result = compareHtmlStructure(source, target);
            expect(result.isMatch).toBe(false);
            expect(result.errors[0]).toContain("Missing tags");
            expect(result.errors[0]).toContain("<br/>");
        });

        it("ignores USFM bracket markers during comparison", () => {
            const source =
                'text<\\f + \\fr 1:3. \\ft> footnote content<\\f*>';
            const target =
                'text<\\f + \\fr 1:3. \\ft> preložený obsah<\\f*>';
            const result = compareHtmlStructure(source, target);
            expect(result.isMatch).toBe(true);
        });

        it("matches when both have same formatting tags with different text", () => {
            const source =
                '<strong data-tag="bd">bold text</strong> and <em data-tag="it">italic</em>';
            const target =
                '<strong data-tag="bd">tučný text</strong> and <em data-tag="it">kurzíva</em>';
            const result = compareHtmlStructure(source, target);
            expect(result.isMatch).toBe(true);
        });
    });

    describe("getStructureMismatchDescription", () => {
        it("returns empty string for matching structures", () => {
            const diff: HtmlStructureDiff = { isMatch: true, errors: [] };
            expect(getStructureMismatchDescription(diff)).toBe("");
        });

        it("returns default message for mismatch with no specific errors", () => {
            const diff: HtmlStructureDiff = { isMatch: false, errors: [] };
            expect(getStructureMismatchDescription(diff)).toBe(
                "HTML structure does not match source"
            );
        });

        it("joins multiple errors with semicolon", () => {
            const diff: HtmlStructureDiff = {
                isMatch: false,
                errors: ["Missing tags: <br/>", "Extra tags: <p>"],
            };
            expect(getStructureMismatchDescription(diff)).toBe(
                "Missing tags: <br/>; Extra tags: <p>"
            );
        });

        it("returns single error as-is", () => {
            const diff: HtmlStructureDiff = {
                isMatch: false,
                errors: ["Missing tags: <br/>"],
            };
            expect(getStructureMismatchDescription(diff)).toBe(
                "Missing tags: <br/>"
            );
        });
    });

    describe("removeBareSpanPairs", () => {
        it("removes an attribute-less span wrapper, keeping its content", () => {
            expect(removeBareSpanPairs("<p><span>Hola</span></p>")).toBe("<p>Hola</p>");
        });

        it("removes a top-level bare span", () => {
            expect(removeBareSpanPairs("<span>Hola</span>")).toBe("Hola");
        });

        it("preserves spans with attributes", () => {
            const html = '<p><span style="font-size: 18pt">Hola</span></p>';
            expect(removeBareSpanPairs(html)).toBe(html);
        });

        it("removes only the bare span when nested inside a styled span", () => {
            const html = '<span style="color:red"><span>Hola</span> mundo</span>';
            expect(removeBareSpanPairs(html)).toBe('<span style="color:red">Hola mundo</span>');
        });

        it("removes a bare span that wraps a styled span", () => {
            const html = '<span><span data-tag="bd">Hola</span></span>';
            expect(removeBareSpanPairs(html)).toBe('<span data-tag="bd">Hola</span>');
        });

        it("removes multiple bare span pairs", () => {
            expect(removeBareSpanPairs("<span>a</span> <span>b</span>")).toBe("a b");
        });

        it("returns input unchanged when there are no bare spans", () => {
            expect(removeBareSpanPairs("<p>Hola</p>")).toBe("<p>Hola</p>");
        });

        it("handles empty input", () => {
            expect(removeBareSpanPairs("")).toBe("");
        });
    });

    describe("convertBareSpanPairsToParagraphs", () => {
        it("converts a bare span wrapper to a paragraph", () => {
            expect(convertBareSpanPairsToParagraphs("<span>Hola</span>")).toBe("<p>Hola</p>");
        });

        it("preserves spans with attributes", () => {
            const html = '<span style="color:red">Hola</span>';
            expect(convertBareSpanPairsToParagraphs(html)).toBe(html);
        });

        it("converts only the bare span in mixed content", () => {
            expect(convertBareSpanPairsToParagraphs("<span>a</span><p>b</p>")).toBe(
                "<p>a</p><p>b</p>"
            );
        });

        it("handles empty input", () => {
            expect(convertBareSpanPairsToParagraphs("")).toBe("");
        });
    });

    describe("tryDeterministicStructureFix", () => {
        it("fixes the spurious LLM span wrapper", () => {
            const fixed = tryDeterministicStructureFix(
                "<p>Hello world</p>",
                "<p><span>Hola mundo</span></p>"
            );
            expect(fixed).toBe("<p>Hola mundo</p>");
        });

        it("converts the editor's span-first convention back to a paragraph", () => {
            // The cell editor used to save a single paragraph as <span>…</span>.
            const fixed = tryDeterministicStructureFix(
                '<p data-style-id="ListParagraph" style="line-height: 1.2">List five things.</p>',
                "<span>Enumera cinco cosas.</span>"
            );
            expect(fixed).toBe("<p>Enumera cinco cosas.</p>");
        });

        it("converts the first-paragraph span in multi-paragraph content", () => {
            const fixed = tryDeterministicStructureFix(
                "<p>Hello</p><p>world</p>",
                "<span>Hola</span><p>mundo</p>"
            );
            expect(fixed).toBe("<p>Hola</p><p>mundo</p>");
        });

        it("returns null when structures already match", () => {
            expect(
                tryDeterministicStructureFix("<p>Hello</p>", "<p>Hola</p>")
            ).toBeNull();
        });

        it("returns null when unwrapping does not produce a match", () => {
            expect(
                tryDeterministicStructureFix("<p>Hello</p><br/>", "<p><span>Hola</span></p>")
            ).toBeNull();
        });

        it("returns null when the mismatch is not span-related", () => {
            expect(
                tryDeterministicStructureFix("<p>Hello</p><br/>", "<p>Hola</p>")
            ).toBeNull();
        });

        it("keeps bare spans that the source also has", () => {
            // Removing all bare spans would overshoot; the fix must verify and bail.
            expect(
                tryDeterministicStructureFix(
                    "<p><span>Hello</span></p>",
                    "<p><span>Hola</span><span>mundo</span></p>"
                )
            ).toBeNull();
        });
    });

    describe("extractPlainTextFromHtml", () => {
        it("strips tags and normalizes whitespace", () => {
            expect(extractPlainTextFromHtml("<p>Hola  <strong>mundo</strong> </p>")).toBe(
                "Hola mundo"
            );
        });

        it("decodes common entities", () => {
            expect(extractPlainTextFromHtml("<p>you&#39;re &amp; me</p>")).toBe("you're & me");
        });

        it("handles empty input", () => {
            expect(extractPlainTextFromHtml("")).toBe("");
        });
    });
});
