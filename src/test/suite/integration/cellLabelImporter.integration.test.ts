import * as assert from "assert";
import * as vscode from "vscode";
import { matchCellLabels } from "../../../cellLabelImporter/matcher";
import type { FileData } from "../../../cellLabelImporter/types";

suite("Cell Label Importer Integration", () => {
    test("matches using mapped start time column to metadata.data.startTime", async () => {
        const sourceFiles: FileData[] = [
            {
                uri: vscode.Uri.file("/tmp/sample.codex"),
                cells: [
                    {
                        value: "<span>Line 1</span>\n",
                        metadata: {
                            id: "uuid-1",
                            data: { startTime: 10.5, endTime: 11.2 },
                            cellLabel: "OLD",
                        },
                    },
                ],
            },
        ];

        const importedRows = [
            {
                LABEL: "NEW_LABEL",
                BEGIN_TS: "00:00:10.500",
            },
        ];

        const result = await matchCellLabels(
            importedRows,
            sourceFiles,
            [],
            "LABEL",
            {
                matchColumn: "BEGIN_TS",
                matchFieldPath: "metadata.data.startTime",
            }
        );

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].matched, true);
        assert.strictEqual(result[0].cellId, "uuid-1");
        assert.strictEqual(result[0].newLabel, "NEW_LABEL");
    });

    test("matches using mapped column to metadata.id string", async () => {
        const sourceFiles: FileData[] = [
            {
                uri: vscode.Uri.file("/tmp/sample-2.codex"),
                cells: [
                    {
                        value: "<span>Line 2</span>\n",
                        metadata: {
                            id: "uuid-2",
                            data: { startTime: 20.1, endTime: 21.2 },
                        },
                    },
                ],
            },
        ];

        const importedRows = [
            {
                LABEL: "NEW_LABEL_2",
                CELL_ID: "uuid-2",
            },
        ];

        const result = await matchCellLabels(
            importedRows,
            sourceFiles,
            [],
            "LABEL",
            {
                matchColumn: "CELL_ID",
                matchFieldPath: "metadata.id",
            }
        );

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].matched, true);
        assert.strictEqual(result[0].cellId, "uuid-2");
        assert.strictEqual(result[0].newLabel, "NEW_LABEL_2");
    });
});
