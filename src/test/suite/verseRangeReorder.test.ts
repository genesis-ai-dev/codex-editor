import * as assert from "assert";
import { reorderVerseRangeCells } from "../../projectManager/utils/merge/utils/verseRangeReorder";
import { CodexCellTypes } from "../../../types/enums";

function milestoneCell(id: string, value: string) {
    return {
        kind: 2,
        languageId: "html",
        value,
        metadata: { id, type: CodexCellTypes.MILESTONE, edits: [] },
    };
}

function textCell(id: string, value: string, globalRef?: string) {
    return {
        kind: 2,
        languageId: "scripture",
        value,
        metadata: {
            id,
            type: CodexCellTypes.TEXT,
            data: { globalReferences: globalRef === undefined ? [] : [globalRef] },
            edits: [],
        },
    };
}

function styleCell(id: string, value: string) {
    return {
        kind: 2,
        languageId: "html",
        value,
        metadata: { id, type: CodexCellTypes.STYLE, data: { globalReferences: [] }, edits: [] },
    };
}

function paratextCell(id: string, value: string, parentId: string) {
    return {
        kind: 2,
        languageId: "html",
        value,
        metadata: { id, type: CodexCellTypes.PARATEXT, parentId, data: {}, edits: [] },
    };
}

function cellIds(cells: any[]): string[] {
    return cells.map((c) => c?.metadata?.id);
}

suite("reorderVerseRangeCells - bail-outs for unmatchable content", () => {
    test("book-only globalReferences (IDML import): original interleaved order is preserved", () => {
        // Every text cell carries a book-only ref like ["JOB"], which parseVerseRef cannot
        // parse. Reordering used to hoist all milestones to the top and append every text
        // cell after them, making each section appear empty in the editor.
        const cells = [
            milestoneCell("M1", "Job 1"),
            textCell("T1", "<span>section one a</span>", "JOB"),
            textCell("T2", "<span>section one b</span>", "JOB"),
            milestoneCell("M2", "Job 2"),
            textCell("T3", "<span>section two</span>", "JOB"),
            milestoneCell("M3", "Job 3"),
            textCell("T4", "<span>section three</span>", "JOB"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "T1", "T2", "M2", "T3", "M3", "T4"]);
        assert.strictEqual(result.orderChanged, false);
        assert.strictEqual(result.mutated, false);
    });

    test("empty globalReferences (docx/subtitles/tms shape): original order is preserved", () => {
        const cells = [
            milestoneCell("M1", "1"),
            textCell("T1", "<span>para one</span>"),
            textCell("T2", "<span>para two</span>"),
            textCell("T3", "<span>para three</span>"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "T1", "T2", "T3"]);
        assert.strictEqual(result.orderChanged, false);
    });

    test("milestones whose chapters match no content chapter: original order is preserved", () => {
        const cells = [
            milestoneCell("M1", "John 4"),
            textCell("T1", "<span>5:1</span>", "JHN 5:1"),
            textCell("T2", "<span>5:2</span>", "JHN 5:2"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "T1", "T2"]);
        assert.strictEqual(result.orderChanged, false);
    });

    test("unparseable milestone values (no digits): original order is preserved", () => {
        const cells = [
            milestoneCell("M1", "Introduction"),
            textCell("T1", "<span>1:1</span>", "GEN 1:1"),
            milestoneCell("M2", "Main Part"),
            textCell("T2", "<span>2:1</span>", "GEN 2:1"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "T1", "M2", "T2"]);
        assert.strictEqual(result.orderChanged, false);
    });
});

suite("reorderVerseRangeCells - importerType gate", () => {
    test("known non-Bible importer (markdown) with verse citations: strict no-op", () => {
        // Markdown extracts Bible citations from anywhere in the text, so document cells can
        // carry parseable refs. The importer type tells us this is a document, not scripture.
        const cells = [
            milestoneCell("M1", "1"),
            textCell("P1", "<span>intro paragraph</span>"),
            textCell("P2", "<span>see Genesis 1:5</span>", "GEN 1:5"),
            textCell("P3", "<span>middle paragraph</span>"),
            textCell("P4", "<span>see Genesis 1:2</span>", "GEN 1:2"),
        ];

        const result = reorderVerseRangeCells(cells, { importerType: "markdown" });

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "P1", "P2", "P3", "P4"]);
        assert.strictEqual(result.orderChanged, false);
        assert.strictEqual(result.mutated, false);
    });

    test("Bible importer type (usfm) still reorders", () => {
        const cells = [
            milestoneCell("M1", "John 4"),
            textCell("V2", "<span>v2</span>", "JHN 4:2"),
            textCell("V1", "<span>v1</span>", "JHN 4:1"),
        ];

        const result = reorderVerseRangeCells(cells, { importerType: "usfm" });

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "V1", "V2"]);
        assert.strictEqual(result.orderChanged, true);
    });

    test("unknown importer type falls back to content heuristics", () => {
        const cells = [
            milestoneCell("M1", "John 4"),
            textCell("V2", "<span>v2</span>", "JHN 4:2"),
            textCell("V1", "<span>v1</span>", "JHN 4:1"),
        ];

        const result = reorderVerseRangeCells(cells, { importerType: undefined });

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "V1", "V2"]);
    });
});

suite("reorderVerseRangeCells - chapter-range milestones", () => {
    test("content chapters are matched to range milestones like 'Job 4-31'", () => {
        const cells = [
            milestoneCell("M1", "Job 1-3"),
            textCell("T1", "<span>1:1</span>", "JOB 1:1"),
            textCell("T2", "<span>2:1</span>", "JOB 2:1"),
            milestoneCell("M2", "Job 4-31"),
            textCell("T3", "<span>4:1</span>", "JOB 4:1"),
            textCell("T4", "<span>31:1</span>", "JOB 31:1"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "T1", "T2", "M2", "T3", "T4"]);
        assert.strictEqual(result.orderChanged, false);
    });

    test("content under a range milestone is restored from shuffled order", () => {
        // Chapter 5 content drifted in front of chapter 4 inside the "Job 4-31" section.
        const cells = [
            milestoneCell("M1", "Job 1-3"),
            textCell("T1", "<span>1:1</span>", "JOB 1:1"),
            milestoneCell("M2", "Job 4-31"),
            textCell("T3", "<span>5:1</span>", "JOB 5:1"),
            textCell("T2", "<span>4:1</span>", "JOB 4:1"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "T1", "M2", "T2", "T3"]);
        assert.strictEqual(result.orderChanged, true);
    });

    test("mixed single-chapter and range milestones place each chapter correctly", () => {
        const cells = [
            milestoneCell("M1", "Job 1"),
            textCell("T1", "<span>1:1</span>", "JOB 1:1"),
            milestoneCell("M2", "Job 2"),
            textCell("T2", "<span>2:1</span>", "JOB 2:1"),
            milestoneCell("M3", "Job 3-31"),
            textCell("T3", "<span>3:1</span>", "JOB 3:1"),
            textCell("T4", "<span>10:1</span>", "JOB 10:1"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(
            cellIds(result.cells),
            ["M1", "T1", "M2", "T2", "M3", "T3", "T4"]
        );
        assert.strictEqual(result.orderChanged, false);
    });
});

suite("reorderVerseRangeCells - multi-book files", () => {
    test("milestones only claim chapters of their own book despite chapter-number collisions", () => {
        // JOB 4 and SNG 4 both exist; "Job 4" must not capture Song of Songs content.
        const cells = [
            milestoneCell("MJ", "Job 4"),
            textCell("J1", "<span>job 4:1</span>", "JOB 4:1"),
            milestoneCell("MS", "Song of Songs 4"),
            textCell("S1", "<span>sng 4:1</span>", "SNG 4:1"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["MJ", "J1", "MS", "S1"]);
        assert.strictEqual(result.orderChanged, false);
    });

    test("multi-book content with unresolvable milestone books is left untouched", () => {
        // Milestone values are bare numbers; with two books in the file there is no safe way
        // to decide which book each milestone covers, so nothing may move.
        const cells = [
            milestoneCell("M1", "4"),
            textCell("J1", "<span>job 4:1</span>", "JOB 4:1"),
            milestoneCell("M2", "4"),
            textCell("S1", "<span>sng 4:1</span>", "SNG 4:1"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "J1", "M2", "S1"]);
        assert.strictEqual(result.orderChanged, false);
    });
});

suite("reorderVerseRangeCells - unplaceable cells stay anchored", () => {
    test("USFM shape: heading and marker TEXT cells with empty refs keep their position", () => {
        // The USFM importer writes section headings and paragraph markers as TEXT cells with
        // empty globalReferences, interleaved between verse cells. They must not be moved to
        // the end of the file.
        const cells = [
            milestoneCell("M1", "Genesis 1"),
            textCell("H1", "<span>The Creation</span>"),
            textCell("V1", "<span>v1</span>", "GEN 1:1"),
            textCell("P1", "<span></span>"),
            textCell("V2", "<span>v2</span>", "GEN 1:2"),
            milestoneCell("M2", "Genesis 2"),
            textCell("H2", "<span>The Garden</span>"),
            textCell("V3", "<span>v1</span>", "GEN 2:1"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(
            cellIds(result.cells),
            ["M1", "H1", "V1", "P1", "V2", "M2", "H2", "V3"]
        );
        assert.strictEqual(result.orderChanged, false);
    });

    test("marker cells follow their verse when verses are reordered", () => {
        const cells = [
            milestoneCell("M1", "Genesis 1"),
            textCell("V2", "<span>v2</span>", "GEN 1:2"),
            textCell("P1", "<span>marker after v2</span>"),
            textCell("V1", "<span>v1</span>", "GEN 1:1"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "V1", "V2", "P1"]);
        assert.strictEqual(result.orderChanged, true);
    });

    test("style cells keep their position", () => {
        const cells = [
            milestoneCell("M1", "Genesis 1"),
            textCell("V1", "<span>v1</span>", "GEN 1:1"),
            styleCell("ST1", "<span data-tag='b'></span>"),
            textCell("V2", "<span>v2</span>", "GEN 1:2"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "V1", "ST1", "V2"]);
        assert.strictEqual(result.orderChanged, false);
    });

    test("orphan paratext (missing parent) stays in place", () => {
        const cells = [
            milestoneCell("M1", "Genesis 1"),
            textCell("V1", "<span>v1</span>", "GEN 1:1"),
            paratextCell("ORPH", "<span>orphan note</span>", "missing-id"),
            textCell("V2", "<span>v2</span>", "GEN 1:2"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "V1", "ORPH", "V2"]);
        assert.strictEqual(result.orderChanged, false);
    });

    test("ref cells whose chapter matches no milestone stay anchored (with other matches present)", () => {
        // Chapter 7 has no milestone; its cell must not jump to the end of the file.
        const cells = [
            milestoneCell("M1", "Genesis 1"),
            textCell("V1", "<span>v1</span>", "GEN 1:1"),
            textCell("X7", "<span>stray 7:1</span>", "GEN 7:1"),
            textCell("V2", "<span>v2</span>", "GEN 1:2"),
        ];

        const result = reorderVerseRangeCells(cells);

        // V1 and V2 sort under M1; X7 is unplaceable and follows its preceding anchor (V1).
        assert.deepStrictEqual(cellIds(result.cells), ["M1", "V1", "X7", "V2"]);
    });
});

suite("reorderVerseRangeCells - real-world USFM structures", () => {
    test("double milestones per chapter (bare '1' then 'Luke 1'): verses stay under the nearest one", () => {
        // usfm-experimental files emit a bare-number milestone a few cells before the real
        // "Luke N" milestone. Verses already sitting under "Luke 1" must NOT be yanked up to the
        // earlier "1" milestone (which covers the same chapter), and the empty cell between the
        // two milestones must stay put.
        const cells = [
            milestoneCell("M0", "0"),
            textCell("FRONT", "<span>front matter</span>"),
            milestoneCell("MNUM", "1"),
            textCell("GAP", "<span></span>"),
            milestoneCell("MLUKE", "Luke 1"),
            textCell("V1", "<span>v1</span>", "LUK 1:1"),
            textCell("V2", "<span>v2</span>", "LUK 1:2"),
            textCell("V3", "<span>v3</span>", "LUK 1:3"),
        ];

        const result = reorderVerseRangeCells(cells, { importerType: "usfm-experimental" });

        assert.deepStrictEqual(
            cellIds(result.cells),
            ["M0", "FRONT", "MNUM", "GAP", "MLUKE", "V1", "V2", "V3"]
        );
        assert.strictEqual(result.orderChanged, false);
    });

    test("double milestones: out-of-order verses under 'Luke 1' are sorted, not pulled to '1'", () => {
        const cells = [
            milestoneCell("MNUM", "1"),
            textCell("GAP", "<span></span>"),
            milestoneCell("MLUKE", "Luke 1"),
            textCell("V2", "<span>v2</span>", "LUK 1:2"),
            textCell("V1", "<span>v1</span>", "LUK 1:1"),
        ];

        const result = reorderVerseRangeCells(cells, { importerType: "usfm-experimental" });

        // V1/V2 sort under MLUKE (nearest preceding milestone covering ch1), NOT under MNUM.
        assert.deepStrictEqual(
            cellIds(result.cells),
            ["MNUM", "GAP", "MLUKE", "V1", "V2"]
        );
        assert.strictEqual(result.orderChanged, true);
    });

    test("trailing empty duplicate-verse block (no milestone) is NOT pulled into the scripture", () => {
        // Some translation .codex files carry a populated scripture block followed by a trailing
        // block of empty duplicate verse cells that has no milestones of its own. Those empty
        // cells must stay at the end — never leap-frogged up under an early chapter milestone.
        const cells = [
            milestoneCell("M1", "John 1"),
            textCell("V1", "<span>v1</span>", "JHN 1:1"),
            textCell("V2", "<span>v2</span>", "JHN 1:2"),
            milestoneCell("M2", "John 2"),
            textCell("V3", "<span>2:1</span>", "JHN 2:1"),
            // Trailing duplicate block: empty cells, no milestone precedes them that covers ch1.
            textCell("E1", "<span></span>", "JHN 1:1"),
            textCell("E2", "<span></span>", "JHN 1:2"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(
            cellIds(result.cells),
            ["M1", "V1", "V2", "M2", "V3", "E1", "E2"]
        );
        assert.strictEqual(result.orderChanged, false);
    });

    test("verse-range cell drifted just above its milestone is pulled down", () => {
        // The original migration's core job: a range cell sitting immediately above its chapter
        // milestone (nothing else between) is pulled under it in verse order.
        const cells = [
            textCell("R", "<span>3-5</span>", "JHN 4:3-5"),
            milestoneCell("M", "John 4"),
            textCell("V1", "<span>v1</span>", "JHN 4:1"),
            textCell("V2", "<span>v2</span>", "JHN 4:2"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M", "V1", "V2", "R"]);
        assert.strictEqual(result.cells[3].metadata.cellLabel, "3-5");
    });
});

suite("reorderVerseRangeCells - core behaviors", () => {
    test("normal milestone + parseable refs: out-of-order verses are still reordered", () => {
        const cells = [
            milestoneCell("M1", "John 4"),
            textCell("V2", "<span>v2</span>", "JHN 4:2"),
            textCell("V1", "<span>v1</span>", "JHN 4:1"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "V1", "V2"]);
        assert.strictEqual(result.orderChanged, true);
    });

    test("paratext with parent present is emitted immediately before its parent", () => {
        const cells = [
            milestoneCell("M1", "John 4"),
            textCell("V1", "<span>v1</span>", "JHN 4:1"),
            paratextCell("PT", "<span>heading for v2</span>", "V2"),
            textCell("V2", "<span>v2</span>", "JHN 4:2"),
        ];

        const result = reorderVerseRangeCells(cells);

        assert.deepStrictEqual(cellIds(result.cells), ["M1", "V1", "PT", "V2"]);
    });

    test("verse-range cells without milestones still get cellLabel autofill", () => {
        const cells = [textCell("R1", "<span>v3-5</span>", "JHN 4:3-5")];

        const result = reorderVerseRangeCells(cells);

        assert.strictEqual(result.cells[0].metadata.cellLabel, "3-5");
        assert.strictEqual(result.mutated, true);
    });

    test("reorder is idempotent", () => {
        const cells = [
            milestoneCell("M1", "Genesis 1"),
            textCell("H1", "<span>heading</span>"),
            textCell("V2", "<span>v2</span>", "GEN 1:2"),
            textCell("V1", "<span>v1</span>", "GEN 1:1"),
            styleCell("ST1", "<span></span>"),
            milestoneCell("M2", "Genesis 2-3"),
            textCell("V3", "<span>2:1</span>", "GEN 2:1"),
            paratextCell("PT", "<span>note</span>", "V3"),
        ];

        const first = reorderVerseRangeCells(cells);
        const second = reorderVerseRangeCells(first.cells);

        assert.deepStrictEqual(cellIds(second.cells), cellIds(first.cells));
        assert.strictEqual(second.orderChanged, false);
    });

    test("never drops or duplicates cells", () => {
        const cells = [
            milestoneCell("M1", "Genesis 1"),
            textCell("H1", "<span>heading</span>"),
            textCell("V2", "<span>v2</span>", "GEN 1:2"),
            paratextCell("ORPH", "<span>orphan</span>", "missing"),
            textCell("V1", "<span>v1</span>", "GEN 1:1"),
            styleCell("ST1", "<span></span>"),
            { kind: 2, value: "no metadata cell" },
        ];

        const result = reorderVerseRangeCells(cells);

        assert.strictEqual(result.cells.length, cells.length);
        const inputSet = new Set(cells);
        for (const cell of result.cells) {
            assert.ok(inputSet.has(cell), "Output must reuse the same cell instances");
            inputSet.delete(cell);
        }
        assert.strictEqual(inputSet.size, 0, "Every input cell must appear exactly once");
    });
});

suite("reorderVerseRangeCells - repairMode rescues stranded cells", () => {
    const buildStranded = () => [
        milestoneCell("m14", "Matthew 14"),
        textCell("v14_5", "five", "MAT 14:5"),
        milestoneCell("m15", "Matthew 15"),
        textCell("v15_1", "x", "MAT 15:1"),
        // A content single parked after the ch15 milestone (the post-dedup damage shape).
        textCell("v14_6", "six", "MAT 14:6"),
    ];

    test("conservative mode leaves a cell stranded past a later milestone (sync behavior)", () => {
        const res = reorderVerseRangeCells(buildStranded(), {});
        assert.deepStrictEqual(cellIds(res.cells), ["m14", "v14_5", "m15", "v15_1", "v14_6"]);
        assert.strictEqual(res.orderChanged, false);
    });

    test("repairMode pulls the stranded cell back into its chapter, in verse order", () => {
        const res = reorderVerseRangeCells(buildStranded(), { repairMode: true });
        assert.deepStrictEqual(cellIds(res.cells), ["m14", "v14_5", "v14_6", "m15", "v15_1"]);
        assert.strictEqual(res.orderChanged, true);
    });
});
