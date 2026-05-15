import { describe, expect, it } from "vitest";
import { exportMarkdownWithTranslations } from "./markdownExporter";
import { htmlTranslationToMarkdownForRoundTrip } from "../../utils/htmlToMarkdownRoundTrip";

describe("htmlTranslationToMarkdownForRoundTrip", () => {
    it("preserves bold and links from typical Quill-style HTML", () => {
        const md = htmlTranslationToMarkdownForRoundTrip(
            '<p><strong>Bold</strong> and <a href="https://x.test">link</a>.</p>'
        );
        expect(md).toContain("**Bold**");
        expect(md).toContain("[link](https://x.test)");
    });

    it("preserves line breaks via br → markdown hard breaks", () => {
        const md = htmlTranslationToMarkdownForRoundTrip(
            "<p><strong>A:</strong> x<br><strong>B:</strong> y</p>"
        );
        expect(md).toContain("**A:** x");
        expect(md).toContain("**B:** y");
        expect(md).toMatch(/x\s{2,}\n/);
    });

    it("does not escape numbered heading like # 1. Title", () => {
        const md = htmlTranslationToMarkdownForRoundTrip("<h1>1. Zhrnutie projektu</h1>");
        expect(md).toMatch(/^#\s+1\.\s+Zhrnutie/);
        expect(md).not.toContain("1\\.");
    });

    it("uses asterisk bullets for unordered lists", () => {
        const md = htmlTranslationToMarkdownForRoundTrip(
            "<ul><li><strong>IN:</strong> a</li><li><strong>OUT:</strong> b</li></ul>"
        );
        expect(md).toContain("*");
        expect(md).toContain("**IN:**");
        expect(md).toContain("**OUT:**");
    });

    it("inserts blank line before glued list after closing paren", () => {
        const md = htmlTranslationToMarkdownForRoundTrip(
            "<p>Voliteľný email).-   <strong>VON:</strong> b</p>"
        );
        expect(md).toContain(").\n\n");
        expect(md).toContain("**VON:**");
    });
});

describe("exportMarkdownWithTranslations", () => {
    it("preserves markdown bold when translated HTML keeps strong tags", () => {
        const source = "**Label:** Value\n";
        const cells = [
            {
                kind: 2,
                value: "<p><strong>Štítok:</strong> Hodnota</p>",
                metadata: { sourceSpan: { start: 0, end: source.length } },
            },
        ];
        const out = exportMarkdownWithTranslations(source, cells as never);
        expect(out).toContain("**Štítok:**");
        expect(out).toContain("Hodnota");
    });

    it("splices translated spans from end to start", () => {
        const source = "AAA\nBBB\nCCC";
        const cells = [
            {
                kind: 2,
                value: "<p>two</p>",
                metadata: { sourceSpan: { start: 4, end: 7 }, segmentIndex: 1 },
            },
            {
                kind: 2,
                value: "<p>one</p>",
                metadata: { sourceSpan: { start: 0, end: 3 }, segmentIndex: 0 },
            },
        ];
        const out = exportMarkdownWithTranslations(source, cells as never);
        expect(out).toBe("one\ntwo\nCCC");
    });

    it("skips empty translations when skipEmpty is default", () => {
        const source = "keep";
        const cells = [{ kind: 2, value: "", metadata: { sourceSpan: { start: 0, end: 4 } } }];
        expect(exportMarkdownWithTranslations(source, cells as never)).toBe("keep");
    });

    it("preserves line breaks between consecutive list items", () => {
        const source =
            "## 2.1 Herci\n" +
            "*   **Predajca:** vytvára profil.\n" +
            "*   **Zákazník:** prezerá stránku.\n" +
            "*   **Správca:** obmedzené akcie.\n";
        const cells = [
            {
                kind: 2,
                value: "<h2>2.1 Herci</h2>",
                metadata: { sourceSpan: { start: 0, end: 13 } },
            },
            {
                kind: 2,
                value: "<p>*   <strong>Predajca:</strong> vytvára profil.</p>",
                metadata: { sourceSpan: { start: 13, end: 47 } },
            },
            {
                kind: 2,
                value: "<p>*   <strong>Zákazník:</strong> prezerá stránku.</p>",
                metadata: { sourceSpan: { start: 47, end: 82 } },
            },
            {
                kind: 2,
                value: "<p>*   <strong>Správca:</strong> obmedzené akcie.</p>",
                metadata: { sourceSpan: { start: 82, end: 116 } },
            },
        ];
        const out = exportMarkdownWithTranslations(source, cells as never);
        const lines = out.split("\n");
        expect(lines.length).toBeGreaterThanOrEqual(4);
        expect(out).toContain("Herci\n");
        expect(out).toContain("profil.\n");
        expect(out).toContain("stránku.\n");
    });
});
