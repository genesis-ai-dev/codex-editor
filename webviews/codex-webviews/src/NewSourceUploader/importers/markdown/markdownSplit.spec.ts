import { describe, expect, it } from "vitest";
import { splitMarkdownIntoSpannedSegments, getLineStartsAndLines, lineEndExclusive } from "./markdownSplit";

describe("splitMarkdownIntoSpannedSegments", () => {
    it("assigns non-overlapping spans that cover headings and paragraphs", () => {
        const md = "# Title\n\nHello world.\n";
        const segs = splitMarkdownIntoSpannedSegments(md);
        expect(segs.length).toBe(2);
        expect(segs[0].text).toBe("# Title");
        expect(segs[1].text).toBe("Hello world.");
        expect(md.slice(segs[0].start, segs[0].end)).toContain("# Title");
        expect(md.slice(segs[1].start, segs[1].end)).toContain("Hello world.");
        expect(segs[0].end).toBeLessThanOrEqual(segs[1].start);
    });

    it("keeps list items as separate segments", () => {
        const md = "- a\n- b\n";
        const segs = splitMarkdownIntoSpannedSegments(md);
        expect(segs.map((s) => s.text)).toEqual(["- a", "- b"]);
    });
});

describe("getLineStartsAndLines", () => {
    it("lineEndExclusive matches joined slice", () => {
        const content = "a\nbc\ndef";
        const { starts, lines } = getLineStartsAndLines(content);
        expect(lines).toEqual(["a", "bc", "def"]);
        const slice01 = content.slice(starts[0], lineEndExclusive(lines, starts, 1));
        expect(slice01).toBe("a\nbc\n");
    });
});
