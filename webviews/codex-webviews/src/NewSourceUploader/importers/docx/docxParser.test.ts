import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { DocxParser } from "./docxParser";
import { parseFile } from "./index";

const makeDocx = async (paragraphXml: string): Promise<File> => {
    const zip = new JSZip();
    zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${paragraphXml}<w:sectPr/></w:body></w:document>`);
    const data = await zip.generateAsync({ type: "arraybuffer" });
    return { name: "formatting.docx", size: data.byteLength, lastModified: 0, arrayBuffer: async () => data } as File;
};

describe("DOCX formatting detection", () => {
    it.each([undefined, "1", "true", "on", "0", "false", "off"])("handles formatting toggles with value %s", async (value) => {
        const attr = value === undefined ? "" : ` w:val="${value}"`;
        const file = await makeDocx(`<w:p><w:r><w:rPr><w:b${attr}/><w:i${attr}/><w:strike${attr}/></w:rPr><w:t>text</w:t></w:r></w:p>`);
        const doc = await new DocxParser().parseDocx(file);
        const props = doc.paragraphs[0].runs[0].runProperties;
        const enabled = value === undefined || ["1", "true", "on"].includes(value);
        expect(Boolean(props.bold)).toBe(enabled);
        expect(Boolean(props.italic)).toBe(enabled);
        expect(Boolean(props.strike)).toBe(enabled);
        expect(doc.paragraphs[0].runs[0].content).toBe("text");
    });

    it.each([undefined, "single", "double", "none"])("handles underline value %s", async (value) => {
        const attr = value === undefined ? "" : ` w:val="${value}"`;
        const file = await makeDocx(`<w:p><w:r><w:rPr><w:u${attr}/></w:rPr><w:t>text</w:t></w:r></w:p>`);
        const doc = await new DocxParser().parseDocx(file);
        expect(doc.paragraphs[0].runs[0].runProperties.underline).toBe(value === "none" ? undefined : value ?? true);
    });

    it("retains Lesson 28's genuine inline italics in source cells", async () => {
        const file = await makeDocx('<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr>' +
            '<w:r><w:t>But the important thing is this: </w:t></w:r>' +
            '<w:r><w:rPr><w:i/></w:rPr><w:t>conscience depends on knowledge</w:t></w:r>' +
            '<w:r><w:t> (italics mine).</w:t></w:r></w:p>');
        const result = await parseFile(file);
        expect(result.success).toBe(true);
        const cell = result.notebookPair?.source.cells.find((cell) => cell.content.includes("conscience"));
        expect(cell?.content).toContain("<em>conscience depends on knowledge</em>");
        expect(cell?.metadata?.data?.originalText).toBe("But the important thing is this: conscience depends on knowledge (italics mine).");
        expect(cell?.metadata?.paragraphIndex).toBe(0);
        expect(cell?.metadata?.paragraphMappingVersion).toBe("outermost-no-fallback-v1");
    });
});
