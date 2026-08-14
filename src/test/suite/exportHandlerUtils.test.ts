import * as assert from "assert";
import type { CodexNotebookAsJSONData } from "../../../types";
import { CodexCellTypes } from "../../../types/enums";
import {
    getActiveCells,
    getVerseMarkerForCell,
    verseMarkerFromCellLabel,
} from "../../exportHandler/exportHandlerUtils";

type Cell = CodexNotebookAsJSONData["cells"][number];

const makeCell = (
    id: string,
    data?: Cell["metadata"]["data"]
): Cell => ({
    kind: 2,
    languageId: "html",
    value: id,
    metadata: {
        id,
        type: CodexCellTypes.TEXT,
        edits: [],
        data,
    },
});

suite("Export handler active-cell filtering", () => {
    test("excludes merged, deleted, and hidden cells while preserving active-cell order", () => {
        const cells = [
            makeCell("first"),
            makeCell("merged", { merged: true }),
            makeCell("second", { merged: false, deleted: false }),
            makeCell("deleted", { deleted: true }),
            makeCell("hidden", { hidden: true }),
            makeCell("third"),
        ];

        const activeCellIds = getActiveCells(cells).map(
            (cell) => cell.metadata.id
        );

        assert.deepStrictEqual(activeCellIds, ["first", "second", "third"]);
    });
});

const cellWithLabel = (cellLabel?: string) => ({
    metadata: { cellLabel },
});

suite("Export verse marker derivation", () => {
    test("single-verse refs still export the bare verse number", () => {
        assert.strictEqual(
            getVerseMarkerForCell(cellWithLabel(), "GEN 1:1"),
            "1"
        );
    });

    test("ranged refs export the full range instead of the trailing verse", () => {
        assert.strictEqual(
            getVerseMarkerForCell(cellWithLabel(), "GEN 1:1-3"),
            "1-3"
        );
    });

    test("a range cellLabel from a UI merge wins over a single-verse ref", () => {
        assert.strictEqual(
            getVerseMarkerForCell(cellWithLabel("1-3"), "GEN 1:1"),
            "1-3"
        );
    });

    test("a verse-segment cellLabel exports as the marker", () => {
        assert.strictEqual(
            getVerseMarkerForCell(cellWithLabel("1b"), "GEN 1:1"),
            "1b"
        );
    });

    test("a multi-part merge-chain label collapses to its span", () => {
        assert.strictEqual(
            getVerseMarkerForCell(cellWithLabel("1-2-3"), "GEN 1:1"),
            "1-3"
        );
    });

    test("a non-marker cellLabel is ignored in favor of the ref", () => {
        assert.strictEqual(
            getVerseMarkerForCell(cellWithLabel("Narrator"), "GEN 1:2"),
            "2"
        );
    });

    test("legacy cell-id-suffixed range refs export their range", () => {
        assert.strictEqual(
            getVerseMarkerForCell(
                cellWithLabel(),
                "GEN 1:11-12:1764564500321-k9yvyjy9o"
            ),
            "11-12"
        );
    });

    test("verseMarkerFromCellLabel rejects empty and malformed labels", () => {
        assert.strictEqual(verseMarkerFromCellLabel(""), null);
        assert.strictEqual(verseMarkerFromCellLabel("   "), null);
        assert.strictEqual(verseMarkerFromCellLabel("Narrator"), null);
        assert.strictEqual(verseMarkerFromCellLabel("1-"), null);
        assert.strictEqual(verseMarkerFromCellLabel(undefined), null);
        assert.strictEqual(verseMarkerFromCellLabel("5"), "5");
        assert.strictEqual(verseMarkerFromCellLabel(" 1 - 2 "), "1-2");
    });
});
