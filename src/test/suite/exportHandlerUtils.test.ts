import * as assert from "assert";
import type { CodexNotebookAsJSONData } from "../../../types";
import { CodexCellTypes } from "../../../types/enums";
import { getActiveCells } from "../../exportHandler/exportHandlerUtils";

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
    test("excludes merged and deleted cells while preserving active-cell order", () => {
        const cells = [
            makeCell("first"),
            makeCell("merged", { merged: true }),
            makeCell("second", { merged: false, deleted: false }),
            makeCell("deleted", { deleted: true }),
            makeCell("third"),
        ];

        const activeCellIds = getActiveCells(cells).map(
            (cell) => cell.metadata.id
        );

        assert.deepStrictEqual(activeCellIds, ["first", "second", "third"]);
    });
});
