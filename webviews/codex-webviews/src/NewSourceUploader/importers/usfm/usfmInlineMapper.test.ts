import { describe, it, expect } from "vitest";
import {
    convertUsfmInlineMarkersToHtml,
    htmlInlineToUsfm,
} from "./usfmInlineMapper";

// ── Import: footnote bracket format ──────────────────────────────────────────

describe("convertUsfmInlineMarkersToHtml (import)", () => {
    describe("simple footnotes", () => {
        it("converts a basic \\f + \\fr \\ft footnote to bracket format", () => {
            const usfm =
                'living hope\\f + \\fr 1:3. \\ft Or "a hope that brings us life."\\f* through';
            const html = convertUsfmInlineMarkersToHtml(usfm);

            expect(html).toContain("&lt;");
            expect(html).toContain("\\f +");
            expect(html).toContain("\\fr 1:3.");
            expect(html).toContain("\\ft");
            expect(html).toContain("\\f*");
            expect(html).not.toContain("<sup");
        });

        it("preserves translatable text outside brackets", () => {
            const usfm =
                'be holy\\f + \\fr 1:16. \\ft Quoting \\xt Leviticus 11:44-45\\xt*\\f*';
            const html = convertUsfmInlineMarkersToHtml(usfm);

            expect(html).toContain("Quoting");
            expect(html).toContain("Leviticus");
        });

        it("entity-encodes angle brackets in the output", () => {
            const usfm = 'text\\f + \\fr 1:1. \\ft note\\f* more';
            const html = convertUsfmInlineMarkersToHtml(usfm);

            expect(html).toContain("&lt;");
            expect(html).toContain("&gt;");
            const literalBracketCount = (html.match(/<\\f/g) || []).length;
            expect(literalBracketCount).toBe(0);
        });
    });

    describe("cross-reference footnotes", () => {
        it("handles \\xt with verse reference", () => {
            const usfm =
                'text\\f + \\fr 2:7. \\ft Quoting \\xt Psalms 118:22\\xt*.\\f*';
            const html = convertUsfmInlineMarkersToHtml(usfm);

            expect(html).toContain("Psalms");
            expect(html).toContain("118:22");
            expect(html).toContain("\\xt");
        });

        it("handles multiple \\xt references in one footnote", () => {
            const usfm =
                'holy\\f + \\fr 1:16. \\ft Quoting \\xt Leviticus 11:44-45\\xt* or \\xt Leviticus 19:2\\xt*\\f*';
            const html = convertUsfmInlineMarkersToHtml(usfm);

            const xtCount = (html.match(/\\xt/g) || []).length;
            expect(xtCount).toBeGreaterThanOrEqual(2);
            expect(html).toContain("Leviticus");
        });
    });

    describe("inline formatting markers", () => {
        it("converts \\bd to <strong> with data-tag", () => {
            const html = convertUsfmInlineMarkersToHtml("\\bd bold\\bd*");
            expect(html).toContain('<strong data-tag="bd">');
            expect(html).toContain("bold");
            expect(html).toContain("</strong>");
        });

        it("converts \\it to <em> with data-tag", () => {
            const html = convertUsfmInlineMarkersToHtml("\\it italic\\it*");
            expect(html).toContain('<em data-tag="it">');
            expect(html).toContain("italic");
            expect(html).toContain("</em>");
        });

        it("converts \\sc to small-caps span", () => {
            const html = convertUsfmInlineMarkersToHtml("\\sc Lord\\sc*");
            expect(html).toContain("small-caps");
            expect(html).toContain("Lord");
        });

        it("handles nested formatting", () => {
            const html = convertUsfmInlineMarkersToHtml(
                "\\bd bold and \\it italic\\it*\\bd*"
            );
            expect(html).toContain('<strong data-tag="bd">');
            expect(html).toContain('<em data-tag="it">');
        });
    });

    describe("text without markers", () => {
        it("returns plain text unchanged", () => {
            const text = "This is plain text with no markers.";
            expect(convertUsfmInlineMarkersToHtml(text)).toBe(text);
        });
    });
});

// ── Export: bracket stripping ────────────────────────────────────────────────

describe("htmlInlineToUsfm (export)", () => {
    describe("literal angle bracket format", () => {
        it("strips literal brackets and preserves USFM markers", () => {
            const html =
                'living hope<\\f + \\fr 1:3. \\ft> Or "a hope."<\\f*> through';
            const usfm = htmlInlineToUsfm(html);

            expect(usfm).toContain("\\f + \\fr 1:3. \\ft");
            expect(usfm).toContain("\\f*");
            expect(usfm).not.toContain("<");
            expect(usfm).not.toContain(">");
        });

        it("strips brackets with \\xt cross-references", () => {
            const html =
                'holy<\\f + \\fr 1:16. \\ft> Quoting <\\xt> Leviticus <11:44-45\\xt*> or <\\xt> Leviticus <19:2\\xt*\\f*>';
            const usfm = htmlInlineToUsfm(html);

            expect(usfm).toContain("\\f + \\fr 1:16. \\ft");
            expect(usfm).toContain("\\xt");
            expect(usfm).toContain("Leviticus");
            expect(usfm).toContain("11:44-45\\xt*");
            expect(usfm).toContain("19:2\\xt*\\f*");
            expect(usfm).not.toContain("<");
            expect(usfm).not.toContain(">");
        });

        it("handles \\f* closing marker in brackets", () => {
            const html = 'text<\\f + \\fr 1:1. \\ft> note<\\f*> more';
            const usfm = htmlInlineToUsfm(html);

            expect(usfm).toContain("\\f + \\fr 1:1. \\ft");
            expect(usfm).toContain("\\f*");
            expect(usfm).toContain("note");
            expect(usfm).toContain("more");
        });
    });

    describe("entity-encoded angle bracket format", () => {
        it("decodes entities and strips brackets", () => {
            const html =
                'nádej&lt;\\f + \\fr 1:3. \\ft&gt; alebo "nádej."&lt;\\f*&gt; skrze';
            const usfm = htmlInlineToUsfm(html);

            expect(usfm).toContain("\\f + \\fr 1:3. \\ft");
            expect(usfm).toContain("\\f*");
            expect(usfm).not.toContain("&lt;");
            expect(usfm).not.toContain("&gt;");
            expect(usfm).not.toContain("<");
            expect(usfm).not.toContain(">");
        });

        it("handles entity-encoded \\xt cross-references", () => {
            const html =
                'svätý.&lt;\\f + \\fr 1:16. \\ft&gt; Cituje &lt;\\xt&gt; Leviticus &lt;11:44-45\\xt*&gt; alebo &lt;\\xt&gt; Leviticus &lt;19:2\\xt*\\f*&gt;';
            const usfm = htmlInlineToUsfm(html);

            expect(usfm).toContain("\\f + \\fr 1:16. \\ft");
            expect(usfm).toContain("\\xt");
            expect(usfm).toContain("Leviticus");
            expect(usfm).not.toContain("&lt;");
            expect(usfm).not.toContain("&gt;");
        });
    });

    describe("inline formatting tags", () => {
        it("converts <strong data-tag> back to \\bd", () => {
            const html = '<strong data-tag="bd">bold text</strong>';
            const usfm = htmlInlineToUsfm(html);
            expect(usfm).toBe("\\bd bold text\\bd*");
        });

        it("converts <em data-tag> back to \\it", () => {
            const html = '<em data-tag="it">italic text</em>';
            const usfm = htmlInlineToUsfm(html);
            expect(usfm).toBe("\\it italic text\\it*");
        });

        it("converts small-caps span back to \\sc", () => {
            const html =
                '<span data-tag="sc" style="font-variant: small-caps;">Lord</span>';
            const usfm = htmlInlineToUsfm(html);
            expect(usfm).toBe("\\sc Lord\\sc*");
        });

        it("converts <strong> without data-tag to \\bd", () => {
            const html = "<strong>bold</strong>";
            const usfm = htmlInlineToUsfm(html);
            expect(usfm).toBe("\\bd bold\\bd*");
        });

        it("converts <em> without data-tag to \\it", () => {
            const html = "<em>italic</em>";
            const usfm = htmlInlineToUsfm(html);
            expect(usfm).toBe("\\it italic\\it*");
        });
    });

    describe("plain text and edge cases", () => {
        it("returns plain text unchanged", () => {
            expect(htmlInlineToUsfm("Hello world")).toBe("Hello world");
        });

        it("returns empty string for empty input", () => {
            expect(htmlInlineToUsfm("")).toBe("");
        });

        it("strips generic HTML tags not related to USFM", () => {
            const html = "<div>text</div>";
            const usfm = htmlInlineToUsfm(html);
            expect(usfm).toBe("text");
            expect(usfm).not.toContain("<");
        });

        it("does not strip brackets that have no backslash", () => {
            const html = "text <some regular tag> more";
            const usfm = htmlInlineToUsfm(html);
            expect(usfm).not.toContain("<");
        });

        it("decodes &nbsp; entities", () => {
            const html = "word&nbsp;another";
            const usfm = htmlInlineToUsfm(html);
            // DOMParser converts &nbsp; to \u00A0, regex path converts to regular space
            expect(usfm).toMatch(/^word[\s\u00A0]another$/);
        });

        it("decodes &amp; entities", () => {
            const html = "bread &amp; butter";
            const usfm = htmlInlineToUsfm(html);
            expect(usfm).toBe("bread & butter");
        });
    });

    describe("mixed formatting and brackets", () => {
        it("handles formatting tags alongside bracket footnotes", () => {
            const html =
                '<em data-tag="it">italic</em> text<\\f + \\fr 1:1. \\ft> note<\\f*>';
            const usfm = htmlInlineToUsfm(html);

            expect(usfm).toContain("\\it italic\\it*");
            expect(usfm).toContain("\\f + \\fr 1:1. \\ft");
            expect(usfm).toContain("\\f*");
            expect(usfm).not.toContain("<");
            expect(usfm).not.toContain(">");
        });
    });
});

// ── Full round-trip: import → export ─────────────────────────────────────────

describe("USFM footnote round-trip", () => {
    const roundTrip = (usfmInput: string): string => {
        const html = convertUsfmInlineMarkersToHtml(usfmInput);
        return htmlInlineToUsfm(html);
    };

    it("preserves simple footnote through round-trip", () => {
        const original =
            'living hope\\f + \\fr 1:3. \\ft Or "a hope that brings us life."\\f* through';
        const result = roundTrip(original);

        expect(result).toContain("\\f +");
        expect(result).toContain("\\fr 1:3.");
        expect(result).toContain("\\ft");
        expect(result).toContain("\\f*");
        expect(result).toContain("living hope");
        expect(result).toContain("through");
    });

    it("preserves footnote with \\xt cross-reference through round-trip", () => {
        const original =
            'holy\\f + \\fr 2:7. \\ft Quoting \\xt Psalms 118:22\\xt*.\\f*';
        const result = roundTrip(original);

        expect(result).toContain("\\f +");
        expect(result).toContain("\\fr 2:7.");
        expect(result).toContain("Quoting");
        expect(result).toContain("\\xt");
        expect(result).toContain("Psalms");
        expect(result).toContain("118:22");
        expect(result).toContain("\\xt*");
        expect(result).toContain("\\f*");
    });

    it("preserves multiple \\xt references through round-trip", () => {
        const original =
            'holy\\f + \\fr 1:16. \\ft Quoting \\xt Leviticus 11:44-45\\xt* or \\xt Leviticus 19:2\\xt*\\f*';
        const result = roundTrip(original);

        expect(result).toContain("\\f +");
        expect(result).toContain("\\fr 1:16.");
        expect(result).toContain("Quoting");
        expect(result).toContain("Leviticus");
        expect(result).toContain("11:44-45");
        expect(result).toContain("19:2");
    });

    it("preserves inline formatting through round-trip", () => {
        const original = "\\bd bold\\bd* and \\it italic\\it*";
        const result = roundTrip(original);

        expect(result).toContain("\\bd bold\\bd*");
        expect(result).toContain("\\it italic\\it*");
    });

    it("preserves plain text through round-trip", () => {
        const original = "This is plain text with no markers.";
        expect(roundTrip(original)).toBe(original);
    });

    it("preserves footnote with translatable text through round-trip", () => {
        const original =
            'family.\\f + \\fr 1:22. \\ft Or "with brotherly love."\\f*';
        const result = roundTrip(original);

        expect(result).toContain("\\f +");
        expect(result).toContain("\\fr 1:22.");
        expect(result).toContain("\\ft");
        expect(result).toContain("brotherly love");
        expect(result).toContain("\\f*");
    });

    it("produces no angle brackets in final USFM output", () => {
        const original =
            'text\\f + \\fr 1:25. \\ft Quoting \\xt Isaiah 40:6-8\\xt*.\\f* more text';
        const result = roundTrip(original);

        expect(result).not.toContain("<");
        expect(result).not.toContain(">");
        expect(result).not.toContain("&lt;");
        expect(result).not.toContain("&gt;");
    });
});
