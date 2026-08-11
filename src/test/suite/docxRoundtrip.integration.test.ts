import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import JSZip from "jszip";

import { parseFile as parseDocxRoundtrip } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/docx/index";
import { exportDocxWithTranslations } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/docx/docxExporter";

type FileLike = {
    name: string;
    size: number;
    lastModified: number;
    arrayBuffer: () => Promise<ArrayBuffer>;
};

function toArrayBuffer(buf: Buffer): ArrayBuffer {
    // Ensure we always return a real ArrayBuffer (not SharedArrayBuffer) and tightly-sized.
    const copy = new Uint8Array(buf.byteLength);
    copy.set(buf);
    return copy.buffer;
}

function resolveMockDocxPath(): string {
    // In extension tests, `__dirname` is usually `<repo>/out/test/suite`.
    // This reliably gets us back to the repo root.
    const repoRootFromOut = path.resolve(__dirname, "../../..");

    const candidates: string[] = [
        // Preferred: committed test fixture
        path.resolve(repoRootFromOut, "src/test/suite/mocks/file-sample_1MB.docx"),
        // Fallback: when running directly from repo root
        path.resolve(process.cwd(), "src/test/suite/mocks/file-sample_1MB.docx"),
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }

    throw new Error(`Could not find DOCX mock fixture. Tried:\n${candidates.join("\n")}`);
}

function uint8Equals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function decodeBasicEntities(text: string): string {
    return (text ?? "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

/**
 * Extract paragraph texts in *linear XML order* from word/document.xml.
 *
 * IMPORTANT: We intentionally do NOT use an XML-to-object parser here because object key traversal
 * order can diverge from original XML order in complex documents (tables, textboxes, etc).
 * The exporter uses linear `<w:p>` order; this test must too.
 */
function extractParagraphTexts(documentXml: string): string[] {
    const bodyOpenIdx = documentXml.indexOf("<w:body");
    if (bodyOpenIdx < 0) return [];
    const bodyStart = documentXml.indexOf(">", bodyOpenIdx);
    const bodyCloseIdx = documentXml.indexOf("</w:body>");
    if (bodyStart < 0 || bodyCloseIdx < 0) return [];

    const bodyXml = documentXml.slice(bodyStart + 1, bodyCloseIdx);

    const paragraphs: string[] = [];
    const paraRe = /<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g;
    let m: RegExpExecArray | null;
    while ((m = paraRe.exec(bodyXml)) !== null) {
        const pXml = m[0];
        // Extract all w:t text nodes in-order inside this paragraph.
        let out = "";
        const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
        let t: RegExpExecArray | null;
        while ((t = tRe.exec(pXml)) !== null) {
            out += decodeBasicEntities(t[1]);
        }
        paragraphs.push(out);
    }
    return paragraphs;
}

function countTableCellsInDocumentXml(documentXml: string): number {
    const bodyOpenIdx = documentXml.indexOf("<w:body");
    if (bodyOpenIdx < 0) return 0;
    const bodyStart = documentXml.indexOf(">", bodyOpenIdx);
    const bodyCloseIdx = documentXml.indexOf("</w:body>");
    if (bodyStart < 0 || bodyCloseIdx < 0) return 0;
    const bodyXml = documentXml.slice(bodyStart + 1, bodyCloseIdx);
    // Count <w:tc ...> start tags (table cells). This is stable for OOXML tables.
    const matches = bodyXml.match(/<w:tc\b/g);
    return matches?.length ?? 0;
}

suite("DOCX round-trip integration (mock DOCX fixture)", function () {
    // Parsing/zip work can take a bit on CI and in VS Code host.
    this.timeout(120_000);

    test("import -> translate 2 cells -> export: only those paragraphs change", async () => {
        const docxPath = resolveMockDocxPath();
        const originalBuf = fs.readFileSync(docxPath);
        const originalArrayBuffer = toArrayBuffer(originalBuf);

        const fileLike: FileLike = {
            name: path.basename(docxPath),
            size: originalBuf.byteLength,
            lastModified: Date.now(),
            arrayBuffer: async () => originalArrayBuffer,
        };

        const imported = await parseDocxRoundtrip(fileLike as unknown as File);
        assert.strictEqual(imported.success, true, "Expected DOCX import success");
        assert.ok(imported.notebookPair, "Expected notebookPair from importer");

        const codexCells = imported.notebookPair!.codex.cells;
        assert.ok(codexCells.length > 0, `Expected at least one cell for ${path.basename(docxPath)}`);

        // We add milestone cells after import; filter to DOCX-mapped cells.
        const docxCells = codexCells.filter((c: any) => {
            const meta = c?.metadata;
            return typeof meta?.paragraphIndex === "number" || Array.isArray(meta?.paragraphIndices);
        });
        assert.ok(docxCells.length > 0, "Expected at least one DOCX-mapped cell");

        // Table cells should be represented as cells with `metadata.paragraphIndices`.
        const tableCells = docxCells.filter((c: any) => Array.isArray(c?.metadata?.paragraphIndices));
        assert.ok(tableCells.length > 0, "Expected table cells to be imported as individual cells");

        // Verify we imported *all* DOCX table cells (including empty ones).
        const originalZipForCounts = await JSZip.loadAsync(originalArrayBuffer);
        const originalDocXmlForCounts = await originalZipForCounts.file("word/document.xml")!.async("string");
        const expectedTableCellCount = countTableCellsInDocumentXml(originalDocXmlForCounts);
        assert.ok(expectedTableCellCount > 0, "Expected the DOCX fixture to contain at least one table cell");
        assert.strictEqual(
            tableCells.length,
            expectedTableCellCount,
            "Expected all DOCX table cells to be imported as individual cells"
        );

        // Pick two *non-empty* table-cell targets so export proves it can update table content.
        const nonEmptyTableCells = tableCells.filter((c: any) => String(c?.metadata?.data?.originalText ?? "").trim());
        assert.ok(nonEmptyTableCells.length >= 2, "Expected at least two non-empty table cells in fixture");
        const t1 = nonEmptyTableCells[0] as any;
        const t2 = nonEmptyTableCells[nonEmptyTableCells.length - 1] as any;
        const p1 = (t1.metadata.paragraphIndices as number[])[0];
        const p2 = (t2.metadata.paragraphIndices as number[])[0];
        assert.ok(Number.isFinite(p1) && p1 >= 0, "Expected valid paragraphIndex for first table cell target");
        assert.ok(Number.isFinite(p2) && p2 >= 0, "Expected valid paragraphIndex for second table cell target");
        assert.notStrictEqual(p1, p2, "Expected distinct paragraphIndex values for table cell targets");

        const dummy1 = "__DUMMY_TRANSLATION_ONE__";
        const dummy2 = "__DUMMY_TRANSLATION_TWO__";

        // Build exporter input: only the two chosen paragraphs get translated content.
        const exporterCells = codexCells.map((c: any) => {
            const meta = c?.metadata;
            const paragraphIndex = meta?.paragraphIndex;
            const paragraphIndices: number[] | undefined = Array.isArray(meta?.paragraphIndices)
                ? meta.paragraphIndices
                : undefined;
            let value = "";
            if (
                (Array.isArray(paragraphIndices) && paragraphIndices.includes(p1)) ||
                (!Array.isArray(paragraphIndices) && paragraphIndex === p1)
            ) {
                value = `<p>${dummy1}</p>`;
            }
            if (
                (Array.isArray(paragraphIndices) && paragraphIndices.includes(p2)) ||
                (!Array.isArray(paragraphIndices) && paragraphIndex === p2)
            ) {
                value = `<p>${dummy2}</p>`;
            }
            return {
                kind: 2,
                value,
                metadata: c.metadata,
            };
        });

        const exportedArrayBuffer = await exportDocxWithTranslations(originalArrayBuffer, exporterCells);

        const originalZip = await JSZip.loadAsync(originalArrayBuffer);
        const exportedZip = await JSZip.loadAsync(exportedArrayBuffer);

        // JSZip may include explicit directory entries (e.g. "word/") in generated zips.
        // Ignore those and compare only file entries.
        const origNames = Object.keys(originalZip.files).filter((n) => !n.endsWith("/")).sort();
        const expNames = Object.keys(exportedZip.files).filter((n) => !n.endsWith("/")).sort();
        assert.deepStrictEqual(expNames, origNames, "Expected exported DOCX to have the same file list as original");

        // Compare uncompressed contents for all files except the main document.xml.
        for (const name of origNames) {
            const oFile = originalZip.file(name);
            const eFile = exportedZip.file(name);
            assert.ok(oFile, `Original zip missing ${name}`);
            assert.ok(eFile, `Exported zip missing ${name}`);

            if (name === "word/document.xml") continue;

            const oBytes = await oFile!.async("uint8array");
            const eBytes = await eFile!.async("uint8array");
            assert.ok(uint8Equals(oBytes, eBytes), `Unexpected change in ${name}`);
        }

        const originalDocXml = await originalZip.file("word/document.xml")!.async("string");
        const exportedDocXml = await exportedZip.file("word/document.xml")!.async("string");
        assert.ok(
            Math.abs(exportedDocXml.length - originalDocXml.length) < 200_000,
            `Expected document.xml to change minimally; got length ${originalDocXml.length} -> ${exportedDocXml.length}`
        );

        const origParagraphTexts = extractParagraphTexts(originalDocXml);
        const expParagraphTexts = extractParagraphTexts(exportedDocXml);
        assert.strictEqual(
            expParagraphTexts.length,
            origParagraphTexts.length,
            "Expected same paragraph count in document.xml"
        );

        let changedCount = 0;
        for (let i = 0; i < origParagraphTexts.length; i++) {
            const o = origParagraphTexts[i];
            const e = expParagraphTexts[i];
            if (o !== e) {
                changedCount++;
                if (i === p1) {
                    assert.strictEqual(e, dummy1, "Expected paragraph p1 to be replaced with dummy1");
                } else if (i === p2) {
                    assert.strictEqual(e, dummy2, "Expected paragraph p2 to be replaced with dummy2");
                } else {
                    assert.fail(`Unexpected paragraph text change at index ${i}`);
                }
            }
        }

        assert.strictEqual(changedCount, 2, "Expected exactly two paragraphs to change");
    });

    test("import (split) -> translate one middle segment -> export: untranslated segments keep source text", async () => {
        const docxPath = resolveMockDocxPath();
        const originalBuf = fs.readFileSync(docxPath);
        const originalArrayBuffer = toArrayBuffer(originalBuf);

        const fileLike: FileLike = {
            name: path.basename(docxPath),
            size: originalBuf.byteLength,
            lastModified: Date.now(),
            arrayBuffer: async () => originalArrayBuffer,
        };

        // Force aggressive splitting so ordinary paragraphs break into 3+ segments.
        const imported = await parseDocxRoundtrip(fileLike as unknown as File, undefined, {
            idealCellLength: 10,
        });
        assert.strictEqual(imported.success, true, "Expected DOCX import success");
        assert.ok(imported.notebookPair, "Expected notebookPair from importer");

        const codexCells = imported.notebookPair!.codex.cells;

        // Group split-paragraph segment cells (skip table cells and unsplit paragraphs).
        const segmentsByPara = new Map<number, any[]>();
        for (const c of codexCells as any[]) {
            const meta = c?.metadata;
            if (Array.isArray(meta?.paragraphIndices)) continue; // table cell
            if (typeof meta?.segmentIndex !== "number") continue; // only split segments
            if (typeof meta?.paragraphIndex !== "number") continue;
            const arr = segmentsByPara.get(meta.paragraphIndex) ?? [];
            arr.push(c);
            segmentsByPara.set(meta.paragraphIndex, arr);
        }

        // Find a paragraph split into >= 3 segments, all with non-empty source text.
        let targetPara: number | undefined;
        let targetSegments: any[] | undefined;
        for (const [paraIdx, segs] of segmentsByPara) {
            if (segs.length < 3) continue;
            const sorted = [...segs].sort(
                (a, b) => a.metadata.segmentIndex - b.metadata.segmentIndex
            );
            if (sorted.every((s) => String(s.metadata?.data?.originalText ?? "").trim().length > 0)) {
                targetPara = paraIdx;
                targetSegments = sorted;
                break;
            }
        }

        assert.ok(
            targetPara !== undefined && targetSegments,
            "Expected the fixture to contain a paragraph split into >= 3 non-empty segments"
        );

        const sorted = targetSegments!;
        const middleIdx = Math.floor(sorted.length / 2);
        const middleCellId = sorted[middleIdx].metadata.id;
        const dummy = "__MIDDLE_SEGMENT_TRANSLATION__";

        // Build exporter input: ONLY the middle segment of the target paragraph is translated.
        // Every other cell is left untranslated (empty) so it stays byte-untouched.
        const exporterCells = (codexCells as any[]).map((c) => ({
            kind: 2,
            value: c?.metadata?.id === middleCellId ? `<p>${dummy}</p>` : "",
            metadata: c.metadata,
        }));

        const exportedArrayBuffer = await exportDocxWithTranslations(originalArrayBuffer, exporterCells);

        const originalZip = await JSZip.loadAsync(originalArrayBuffer);
        const exportedZip = await JSZip.loadAsync(exportedArrayBuffer);

        const originalDocXml = await originalZip.file("word/document.xml")!.async("string");
        const exportedDocXml = await exportedZip.file("word/document.xml")!.async("string");

        const origParagraphTexts = extractParagraphTexts(originalDocXml);
        const expParagraphTexts = extractParagraphTexts(exportedDocXml);
        assert.strictEqual(
            expParagraphTexts.length,
            origParagraphTexts.length,
            "Expected same paragraph count in document.xml"
        );

        // Untranslated segments fall back to their (trimmed) source text; the translated middle
        // segment shows the translation. Order is preserved by segmentIndex.
        const expectedCombined = sorted
            .map((s, i) => (i === middleIdx ? dummy : String(s.metadata.data.originalText).trim()))
            .join(" ");

        assert.strictEqual(
            expParagraphTexts[targetPara!],
            expectedCombined,
            "Expected the split paragraph to keep source text for untranslated segments"
        );

        // Explicit no-data-loss checks.
        const firstSource = String(sorted[0].metadata.data.originalText).trim();
        const lastSource = String(sorted[sorted.length - 1].metadata.data.originalText).trim();
        assert.ok(
            expParagraphTexts[targetPara!].includes(firstSource),
            "Expected first (untranslated) segment source to be preserved"
        );
        assert.ok(
            expParagraphTexts[targetPara!].includes(lastSource),
            "Expected last (untranslated) segment source to be preserved"
        );
        assert.ok(
            expParagraphTexts[targetPara!].includes(dummy),
            "Expected the translated middle segment to be present"
        );
        assert.notStrictEqual(
            expParagraphTexts[targetPara!],
            dummy,
            "Paragraph must not be overwritten with only the translated segment"
        );

        // Only the target paragraph should change; everything else stays untouched.
        let changedCount = 0;
        for (let i = 0; i < origParagraphTexts.length; i++) {
            if (origParagraphTexts[i] !== expParagraphTexts[i]) {
                changedCount++;
                assert.strictEqual(i, targetPara, `Unexpected paragraph text change at index ${i}`);
            }
        }
        assert.strictEqual(changedCount, 1, "Expected exactly one paragraph to change");
    });

    test("import (split) -> translate all segments -> export: full joined translation (regression)", async () => {
        const docxPath = resolveMockDocxPath();
        const originalBuf = fs.readFileSync(docxPath);
        const originalArrayBuffer = toArrayBuffer(originalBuf);

        const fileLike: FileLike = {
            name: path.basename(docxPath),
            size: originalBuf.byteLength,
            lastModified: Date.now(),
            arrayBuffer: async () => originalArrayBuffer,
        };

        const imported = await parseDocxRoundtrip(fileLike as unknown as File, undefined, {
            idealCellLength: 10,
        });
        assert.strictEqual(imported.success, true, "Expected DOCX import success");
        const codexCells = imported.notebookPair!.codex.cells;

        const segmentsByPara = new Map<number, any[]>();
        for (const c of codexCells as any[]) {
            const meta = c?.metadata;
            if (Array.isArray(meta?.paragraphIndices)) continue;
            if (typeof meta?.segmentIndex !== "number") continue;
            if (typeof meta?.paragraphIndex !== "number") continue;
            const arr = segmentsByPara.get(meta.paragraphIndex) ?? [];
            arr.push(c);
            segmentsByPara.set(meta.paragraphIndex, arr);
        }

        let targetPara: number | undefined;
        let targetSegments: any[] | undefined;
        for (const [paraIdx, segs] of segmentsByPara) {
            if (segs.length < 3) continue;
            targetPara = paraIdx;
            targetSegments = [...segs].sort(
                (a, b) => a.metadata.segmentIndex - b.metadata.segmentIndex
            );
            break;
        }
        assert.ok(
            targetPara !== undefined && targetSegments,
            "Expected the fixture to contain a paragraph split into >= 3 segments"
        );

        const sorted = targetSegments!;
        const idToDummy = new Map<string, string>();
        sorted.forEach((s, i) => idToDummy.set(s.metadata.id, `__SEG_${i}__`));

        const exporterCells = (codexCells as any[]).map((c) => {
            const dummy = idToDummy.get(c?.metadata?.id);
            return {
                kind: 2,
                value: dummy ? `<p>${dummy}</p>` : "",
                metadata: c.metadata,
            };
        });

        const exportedArrayBuffer = await exportDocxWithTranslations(originalArrayBuffer, exporterCells);
        const exportedZip = await JSZip.loadAsync(exportedArrayBuffer);
        const exportedDocXml = await exportedZip.file("word/document.xml")!.async("string");
        const expParagraphTexts = extractParagraphTexts(exportedDocXml);

        const expectedCombined = sorted.map((_, i) => `__SEG_${i}__`).join(" ");
        assert.strictEqual(
            expParagraphTexts[targetPara!],
            expectedCombined,
            "Expected fully-translated split paragraph to export the full joined translation"
        );
    });
});

