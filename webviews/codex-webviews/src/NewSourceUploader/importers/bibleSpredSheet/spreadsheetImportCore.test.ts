import { describe, expect, it } from "vitest";
import { buildSpreadsheetImportResult } from "./spreadsheetImportCore";
import { parseSpreadsheetFile } from "./parser";
import { exportSpreadsheetWithTranslations } from "./spreadsheetExporter";

describe("spreadsheet round-trip row coordinates", () => {
    it("accepts source column zero and retains physical row indices after empty rows", async () => {
        const content = "Source,Notes\nFirst,a\n,b\nThird,c\n";
        const file = {
            name: "sample.csv",
            size: content.length,
            text: async () => content,
        } as File;
        const parsedData = {
            filename: "sample",
            delimiter: ",",
            columns: [
                { index: 0, name: "Source", sampleValues: ["First", "Third"] },
                { index: 1, name: "Notes", sampleValues: ["a", "b", "c"] },
            ],
            rows: [
                { 0: "First", 1: "a" },
                { 0: "", 1: "b" },
                { 0: "Third", 1: "c" },
            ],
            hasHeader: true,
        };

        const result = await buildSpreadsheetImportResult(
            file,
            parsedData,
            { isTranslationImport: false, columnMapping: { 0: "source", 1: "unused" } },
            () => undefined,
        );
        const textCells = result.notebookPairWithMilestones.source.cells.filter(
            (cell) => cell.metadata?.type === "text",
        );

        expect(textCells.map((cell) => cell.metadata?.data?.rowIndex)).toEqual([0, 2]);
    });

    it("keeps multiline records, blank rows, BOM, and CRLF aligned during export", async () => {
        const content = '\uFEFFSource,Notes\r\n"First\ncontinued",a\r\n,b\r\nThird,c\r\n';
        const file = {
            name: "multiline.csv",
            size: content.length,
            text: async () => content,
        } as File;
        const parsedData = await parseSpreadsheetFile(file);
        expect(parsedData.rows).toHaveLength(3);
        expect(parsedData.rows[0][0]).toBe("First\ncontinued");

        const built = await buildSpreadsheetImportResult(
            file,
            parsedData,
            { isTranslationImport: false, columnMapping: { 0: "source", 1: "unused" } },
            () => undefined,
        );
        const textCells = built.notebookPairWithMilestones.codex.cells.filter(
            (cell) => cell.metadata?.type === "text",
        );
        expect(textCells.map((cell) => cell.metadata?.data?.rowIndex)).toEqual([0, 2]);
        textCells[1].content = "<p>Tercero</p>";

        const output = exportSpreadsheetWithTranslations(
            textCells.map((cell) => ({
                id: cell.id,
                value: cell.content,
                metadata: cell.metadata,
            })) as never,
            built.notebookPairWithMilestones.codex.metadata as never,
        );
        expect(output).toBe('\uFEFFSource,Notes\r\n"First\ncontinued",a\r\n,b\r\nTercero,c\r\n');
    });

    it("translates the first physical record when the spreadsheet has no header", () => {
        const output = exportSpreadsheetWithTranslations(
            [{
                id: "row-0",
                value: "<p>Primero</p>",
                metadata: { data: { rowIndex: 0, sourceColumnIndex: 0 } },
            }],
            {
                originalFileContent: "First,a\nSecond,b\n",
                sourceColumnIndex: 0,
                delimiter: ",",
                hasHeader: false,
            },
        );

        expect(output).toBe("Primero,a\nSecond,b\n");
    });
});
