import { describe, expect, it } from "vitest";
import Quill from "quill";
import {
    collapseAdjacentEquivalentStyledSpans,
} from "../../../../../sharedUtils/docxHtmlFormatting";
import {
    compareHtmlStructure,
    getHtmlStructureRepairDiff,
    tryDeterministicStructureFix,
} from "../../../../../sharedUtils/htmlStructureUtils";
import { getStructureMismatchCellIds } from "./structureMismatchCells";
import type { QuillCellContent } from "../../../../../types";

const docx = { importerType: "docx" };
const sourceTitle = '<p data-alignment="center" style="text-align: center">' +
    '<span style="font-size: 18pt; font-family: FFF Tusj Bold"><u>Le</u></span>' +
    '<span style="font-size: 18pt; font-family: FFF Tusj Bold"><u>sson #6, Chapter 2 Overview</u></span></p>';
const spanish = "Lección #6, Resumen del Capítulo 2";
const fix = (source: string, target: string) => tryDeterministicStructureFix(source, target, docx);

describe("DOCX formatting compatibility", () => {
    it("recognizes equivalent legacy title spans without rewriting the translation", () => {
        const target = collapseAdjacentEquivalentStyledSpans(sourceTitle).replace("Lesson #6, Chapter 2 Overview", spanish);
        expect(compareHtmlStructure(sourceTitle, target, docx).isMatch).toBe(true);
        expect(fix(sourceTitle, target)).toBeNull();
        expect(compareHtmlStructure(sourceTitle, target).isMatch).toBe(false);
    });

    it("repairs a plain translated heading, preserving text and all source presentation", () => {
        const repaired = fix(sourceTitle, `<p>${spanish}</p>`)!;
        const element = document.createElement("div");
        element.innerHTML = repaired;
        expect(element.textContent).toBe(spanish);
        expect(element.querySelector("p")?.style.textAlign).toBe("center");
        expect(element.querySelector("span")?.style.fontSize).toBe("18pt");
        expect(element.querySelector("u")?.textContent).toBe(spanish);
        expect(fix(sourceTitle, repaired)).toBeNull();
    });

    it.each([" ", "\n", "\t", "  "])("keeps inter-span whitespace %j", (space) => {
        const html = `<p><span style="color: red">Hola</span>${space}<span style="color: red">mundo</span></p>`;
        expect(collapseAdjacentEquivalentStyledSpans(html)).toBe(`<p><span style="color: red">Hola${space}mundo</span></p>`);
    });

    it.each([
        '<p><span style="color: red">A</span><span style="color: blue">B</span></p>',
        '<p><span style="color: red" data-tag="bd">A</span><span style="color: red" data-tag="bd">B</span></p>',
        '<p><span style="color: red"><strong>A</strong></span><span style="color: red"><em>B</em></span></p>',
        '<p><span style="color: red"><a href="/a">A</a></span><span style="color: red">B</span></p>',
        '<p><span style="color: red" lang="en">A</span><span style="color: red" lang="en">B</span></p>',
        '<p><span style="color: red">A</span></p><p><span style="color: red">B</span></p>',
    ])("leaves different formatting and semantic content intact: %s", (html) => {
        expect(collapseAdjacentEquivalentStyledSpans(html)).toBe(html);
    });

    it("repairs attribute-only loss and exposes it to Resolve All", () => {
        const source = '<p data-style-id="ListParagraph">Conscience is not the law.</p>';
        const target = "<p>La conciencia no es la ley.</p>";
        expect(compareHtmlStructure(source, target, docx).isMatch).toBe(true);
        expect(getHtmlStructureRepairDiff(source, target, docx).isMatch).toBe(false);
        const repaired = fix(source, target)!;
        expect(repaired).toBe('<p data-style-id="ListParagraph">La conciencia no es la ley.</p>');
        const cells = [{ cellMarkers: ["cell-13"], cellContent: target }] as QuillCellContent[];
        const sources = { "cell-13": { content: source } };
        expect(getStructureMismatchCellIds(cells, sources, true, false, docx)).toEqual(["cell-13"]);
        expect(getStructureMismatchCellIds(cells, sources, false, false, docx)).toEqual([]);
        expect(getStructureMismatchCellIds(cells, sources, true, true, docx)).toEqual([]);
        cells[0].cellContent = repaired;
        expect(getStructureMismatchCellIds(cells, sources, true, false, docx)).toEqual([]);
    });

    it("supports legacy DOCX notebook metadata but does not override another importer", () => {
        const source = '<p data-style-id="ListParagraph">Source</p>';
        expect(tryDeterministicStructureFix(source, "<p>Target</p>", { corpusMarker: "docx" })).not.toBeNull();
        expect(tryDeterministicStructureFix(source, "<p>Target</p>", { importerType: "markdown", corpusMarker: "docx" })).toBeNull();
    });

    it.each(["markdown", "obs", "usfm", "biblica", "indesign", "spreadsheet-csv", "spreadsheet-tsv", "pdf", "tms"])(
        "does not apply DOCX normalization or attribute repair to %s", (importerType) => {
            const context = { importerType };
            const canonical = collapseAdjacentEquivalentStyledSpans(sourceTitle);
            expect(compareHtmlStructure(sourceTitle, canonical, context).isMatch).toBe(false);
            const source = '<p data-style-id="ListParagraph">Source</p>';
            expect(tryDeterministicStructureFix(source, "<p>Target</p>", context)).toBeNull();
            expect(getHtmlStructureRepairDiff(source, "<p>Target</p>", context).isMatch).toBe(true);
        },
    );

    it.each([
        ['<p style="text-align: left">English</p>', '<p style="text-align: right" dir="rtl">Español</p>'],
        ['<p><a href="/en">English</a></p>', '<p><a href="/es">Español</a></p>'],
        ['<p lang="en">English</p>', '<p lang="es">Español</p>'],
        ['<p data-style-id="Normal">English</p>', '<p data-style-id="Title">Español</p>'],
        ['<p style="font-size: 18pt">English</p>', '<p class="ql-size-large">Español</p>'],
        ['<p><em>English</em></p>', '<p class="custom-target-format">Español</p>'],
        ['<p style="font-size: 18pt; font-family: Arial">English</p>', '<p style="font: italic 24pt Georgia">Español</p>'],
        ['<p style="margin-left: 20pt">English</p>', '<p style="margin: 0">Español</p>'],
        ['<p style="text-align: left">English</p>', '<p align="right">Español</p>'],
        ['<p style="text-align: left">English</p>', '<p data-alignment="right">Español</p>'],
        ['<p data-style-id="Normal">English</p>', '<p>Hola</p><p>mundo</p>'],
        ['<p data-style-id="Normal">English</p>', '<p><br></p>'],
        ['<p data-style-id="Normal">English</p>', '<p>Click to translate</p>'],
    ])("does not overwrite target presentation, semantics, or user line breaks", (source, target) => {
        expect(fix(source, target)).toBeNull();
    });

    it("keeps target links, footnotes, and whitespace when restoring the paragraph style", () => {
        const source = '<p data-style-id="Normal">See <a href="/en">link</a><sup>1</sup>.</p>';
        const target = '<p>Ver <a href="/es" title="Español">enlace</a><sup data-footnote="Nota">1</sup>. </p>';
        expect(fix(source, target)).toBe(target.replace("<p>", '<p data-style-id="Normal">'));
    });

    it("does not override inherited target font size while inserting a missing span", () => {
        const source = '<p><span style="font-size: 18pt">Source</span></p>';
        const target = '<p style="font-size: 24pt">Traducción</p>';
        const repaired = fix(source, target)!;
        expect(repaired).toBe('<p style="font-size: 24pt"><span>Traducción</span></p>');
        expect(fix(source, repaired)).toBeNull();
    });

    it("preserves missing CSS defaults alongside existing target properties", () => {
        const source = '<p style="text-align: center; line-height: 1.2">Source</p>';
        const target = '<p style="text-align: right; color: blue">Traducción</p>';
        expect(fix(source, target)).toBe('<p style="text-align: right; color: blue; line-height: 1.2">Traducción</p>');
    });

    it("keeps formatting after repeated real Quill load/save/repair cycles", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const quill = new Quill(container);
        let saved = fix(sourceTitle, `<p>${spanish}</p>`)!;
        try {
            for (let cycle = 0; cycle < 3; cycle++) {
                quill.clipboard.dangerouslyPasteHTML(saved);
                const serialized = quill.root.innerHTML;
                saved = fix(sourceTitle, serialized) ?? serialized;
                expect(compareHtmlStructure(sourceTitle, saved, docx).isMatch).toBe(true);
                expect(saved).toContain("font-size: 18pt");
                expect(saved).toContain("FFF Tusj Bold");
                expect(saved.replace(/<[^>]*>/g, "")).toBe(spanish);
            }
        } finally {
            container.remove();
        }
    });
});
