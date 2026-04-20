import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { htmlTranslationToMarkdownForRoundTrip } from "../../utils/htmlToMarkdownRoundTrip";
import { preprocessParagraphForHardLineBreaks } from "./markdownImportPreprocess";

describe("preprocessParagraphForHardLineBreaks", () => {
    it("inserts GFM hard breaks for single newlines", () => {
        const input = "**A:** x\n**B:** y";
        expect(preprocessParagraphForHardLineBreaks(input)).toBe("**A:** x  \n**B:** y");
    });

    it("does not alter blank-line paragraph boundaries", () => {
        const input = "**A:** x\n\n**B:** y";
        expect(preprocessParagraphForHardLineBreaks(input)).toBe("**A:** x\n\n**B:** y");
    });
});

describe("markdown paragraph → HTML → markdown (import + export helpers)", () => {
    it("keeps label-per-line layout through marked and Turndown", async () => {
        marked.setOptions({ gfm: true, breaks: false });
        const raw = "**Project name:** VendorBook\n**Domain:** SaaS";
        const prepped = preprocessParagraphForHardLineBreaks(raw);
        const html = String(await marked.parse(prepped)).trim();
        expect(html).toContain("<br>");
        const back = htmlTranslationToMarkdownForRoundTrip(html);
        expect(back).toContain("**Project name:**");
        expect(back).toContain("**Domain:**");
        expect(back).toMatch(/VendorBook\s{2,}\n/);
    });
});
