import { describe, it, expect } from "vitest";
import {
    extractHtmlSkeleton,
    compareHtmlStructure,
    getStructureMismatchDescription,
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
});
