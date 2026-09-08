import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocxWithTranslations } from "./docxExporter";
import { DOCX_PARAGRAPH_MAPPING_VERSION } from "./cellMetadata";
import { tryDeterministicStructureFix } from "../../../../../../sharedUtils/htmlStructureUtils";

const textBoxParagraph =
    `<w:p><w:r><w:drawing><mc:AlternateContent>` +
    `<mc:Choice Requires="wps"><wps:txbx><w:txbxContent>` +
    `<w:p><w:r><w:t>Box line one.</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>Box line two.</w:t></w:r></w:p>` +
    `</w:txbxContent></wps:txbx></mc:Choice>` +
    `<mc:Fallback><w:pict><v:textbox><w:txbxContent>` +
    `<w:p><w:r><w:t>Box line one.</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>Box line two.</w:t></w:r></w:p>` +
    `</w:txbxContent></v:textbox></w:pict></mc:Fallback>` +
    `</mc:AlternateContent></w:drawing></w:r></w:p>`;

async function makeDocx(body: string): Promise<ArrayBuffer> {
    const zip = new JSZip();
    zip.file(
        "word/document.xml",
        `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`,
    );
    return zip.generateAsync({ type: "arraybuffer" });
}

async function getDocumentXml(docx: ArrayBuffer): Promise<string> {
    const zip = await JSZip.loadAsync(docx);
    return zip.file("word/document.xml")!.async("string");
}

function cell(paragraphIndex: number, sourceText: string, value: string, metadata: Record<string, unknown> = {}) {
    return {
        kind: 2,
        value,
        metadata: {
            id: `cell-${paragraphIndex}`,
            paragraphIndex,
            data: { originalText: sourceText },
            ...metadata,
        },
    };
}

describe("DOCX exporter paragraph compatibility", () => {
    it("exports identical XML before and after a formatting-only cell repair", async () => {
        const original = await makeDocx('<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
            '<w:r><w:rPr><w:u w:val="single"/><w:sz w:val="36"/></w:rPr><w:t>Le</w:t></w:r>' +
            '<w:r><w:rPr><w:u w:val="single"/><w:sz w:val="36"/></w:rPr><w:t>sson #6</w:t></w:r></w:p>');
        const source = '<p style="text-align: center"><span style="font-size: 18pt"><u>Le</u></span>' +
            '<span style="font-size: 18pt"><u>sson #6</u></span></p>';
        const target = cell(0, "Lesson #6", "<p>Lección #6</p>");
        const repaired = tryDeterministicStructureFix(source, target.value, { importerType: "docx" });
        expect(repaired).not.toBeNull();
        const before = await exportDocxWithTranslations(original, [target]);
        const after = await exportDocxWithTranslations(original, [{ ...target, value: repaired! }]);
        expect(await getDocumentXml(after)).toBe(await getDocumentXml(before));
    });

    it("exports legacy coordinates and removes the duplicated fallback branch", async () => {
        const original = await makeDocx(
            `<w:p><w:r><w:t>Before</w:t></w:r></w:p>` +
            textBoxParagraph +
            `<w:p><w:r><w:t>After</w:t></w:r></w:p>`,
        );

        // Under the <=0.31 scanner, the paragraph after the textbox was index 5.
        const exported = await exportDocxWithTranslations(original, [
            cell(1, "Box line one.", "Línea uno."),
            cell(2, "Box line two.", "Línea dos."),
            cell(5, "After", "Después"),
        ]);
        const xml = await getDocumentXml(exported);

        expect(xml).toContain("Línea uno.");
        expect(xml).toContain("Línea dos.");
        expect(xml).toContain("Después");
        expect(xml).not.toContain("Box line one.");
        expect(xml).not.toContain("Box line two.");
        expect(xml).not.toContain("<mc:Fallback");
        expect(xml.match(/Línea uno\./g)).toHaveLength(1);
    });

    it("uses the current coordinate model when the importer version is explicit", async () => {
        const original = await makeDocx(
            `<w:p><w:r><w:t>Before</w:t></w:r></w:p>` +
            textBoxParagraph +
            `<w:p><w:r><w:t>After</w:t></w:r></w:p>`,
        );
        const exported = await exportDocxWithTranslations(original, [
            cell(2, "After", "Después", {
                paragraphMappingVersion: DOCX_PARAGRAPH_MAPPING_VERSION,
            }),
        ]);
        const xml = await getDocumentXml(exported);

        expect(xml).toContain("Después");
        expect(xml).not.toContain("After");
        expect(xml).not.toContain("<mc:Fallback");
    });

    it("ignores re-import tombstones instead of concatenating their text", async () => {
        const original = await makeDocx(`<w:p><w:r><w:t>Heading</w:t></w:r></w:p>`);
        const exported = await exportDocxWithTranslations(original, [
            cell(0, "Heading", "Encabezado", {
                paragraphMappingVersion: DOCX_PARAGRAPH_MAPPING_VERSION,
            }),
            cell(0, "Heading", "Encabezado", {
                paragraphMappingVersion: DOCX_PARAGRAPH_MAPPING_VERSION,
                data: { originalText: "Heading", deleted: true },
            }),
        ]);
        const xml = await getDocumentXml(exported);

        expect(xml.match(/Encabezado/g)).toHaveLength(1);
    });

    it("coalesces an active untranslated alias sharing the same segment index", async () => {
        const original = await makeDocx(`<w:p><w:r><w:t>Heading</w:t></w:r></w:p>`);
        const exported = await exportDocxWithTranslations(original, [
            cell(0, "Heading", "Encabezado"),
            cell(0, "Heading", ""),
        ]);
        const xml = await getDocumentXml(exported);

        expect(xml.match(/Encabezado/g)).toHaveLength(1);
        expect(xml).not.toContain("Heading");
    });

    it("collapses a verified Choice/Fallback segment cycle without dropping real splits", async () => {
        const original = await makeDocx(
            `<w:p><w:r><w:t>First</w:t></w:r><w:r><w:t> Second</w:t></w:r></w:p>`,
        );
        const segments = [
            { index: 0, source: "First", value: "Primero" },
            { index: 1, source: "Second", value: "Segundo" },
            // Historical fallback aliases: same sources, no translations.
            { index: 2, source: "First", value: "" },
            { index: 3, source: "Second", value: "" },
        ].map((segment) => ({
            kind: 2,
            value: segment.value,
            metadata: {
                id: `segment-${segment.index}`,
                paragraphIndex: 0,
                segmentIndex: segment.index,
                segmentCount: 4,
                data: { originalText: segment.source },
            },
        }));

        const exported = await exportDocxWithTranslations(original, segments);
        const xml = await getDocumentXml(exported);
        const text = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
            .map((match) => match[1])
            .join("");

        expect(text).toBe("Primero Segundo");
        expect(text.match(/Primero/g)).toHaveLength(1);
        expect(text).not.toContain("First");
    });

    it("refuses an ambiguous stale coordinate instead of writing to a guessed paragraph", async () => {
        const original = await makeDocx(
            `<w:p><w:r><w:t>Repeated</w:t></w:r></w:p>` +
            `<w:p><w:r><w:t>Repeated</w:t></w:r></w:p>`,
        );

        await expect(exportDocxWithTranslations(original, [
            cell(99, "Repeated", "Repetido"),
        ])).rejects.toThrow(/matched 2 export destinations/);
    });
});
