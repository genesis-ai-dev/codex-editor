import * as assert from "assert";
import { CodexCellTypes, EditType } from "../../../../types/enums";
import {
    applyTranslationToNotebook,
    describeTranslationImport,
    needsBulkOverwriteConfirmation,
    type TranslationAlignedCell,
    type TranslationCell,
    type TranslationNotebook,
    type TranslationOverwriteRisk,
    type TranslationWriteStats,
} from "../../../providers/NewSourceUploader/translationWriteMerge";

/**
 * Regression tests for issue #1144 — an additional overlapping cue used to replace the cell's real
 * translation (text and timestamps) instead of being folded into it.
 */

const cell = (
    id: string,
    value: string,
    startTime?: number,
    endTime?: number,
    metadata: Record<string, unknown> = {}
): TranslationCell => ({
    kind: 1,
    languageId: "html",
    value,
    metadata: {
        id,
        type: CodexCellTypes.TEXT,
        data: startTime === undefined ? {} : { startTime, endTime },
        ...metadata,
    },
});

const notebook = (cells: TranslationCell[], metadata: Record<string, unknown> = {}): TranslationNotebook => ({
    cells,
    metadata,
});

const primary = (
    target: TranslationCell,
    content: string,
    startTime: number,
    endTime: number
): TranslationAlignedCell => ({
    notebookCell: target,
    importedContent: { id: target.metadata!.id!, content, startTime, endTime },
});

const overlap = (
    target: TranslationCell,
    content: string,
    startTime: number,
    endTime: number
): TranslationAlignedCell => ({
    notebookCell: target,
    importedContent: {
        id: `cue-${content}`,
        content,
        startTime,
        endTime,
        parentId: target.metadata!.id!,
    },
    isAdditionalOverlap: true,
});

/** A cue the aligner matched to its cell by id — only possible for this project's own export. */
const idMatch = (
    target: TranslationCell,
    content: string,
    startTime: number,
    endTime: number
): TranslationAlignedCell => ({
    ...primary(target, content, startTime, endTime),
    alignmentMethod: "exact-id",
});

const find = (nb: TranslationNotebook, id: string): TranslationCell | undefined =>
    nb.cells.find((c) => c.metadata?.id === id);

const timingEditsOf = (written: TranslationCell): Array<[unknown, unknown]> =>
    ((written.metadata?.edits as any[]) ?? [])
        .filter((e) => Array.isArray(e.editMap) && e.editMap[1] === "data")
        .map((e) => [e.editMap[2], e.value]);

const statsWith = (overrides: Partial<TranslationWriteStats> = {}): TranslationWriteStats => ({
    insertedCount: 0,
    updatedCount: 0,
    retimedCount: 0,
    skippedCount: 0,
    paratextCount: 0,
    mergedCueCount: 0,
    ...overrides,
});

const riskWith = (overrides: Partial<TranslationOverwriteRisk> = {}): TranslationOverwriteRisk => ({
    exactIdMatches: 0,
    populatedCellCount: 100,
    ...overrides,
});

const opts = { importerType: "subtitles", sourceFilePath: "/x.source", timestamp: "2026-01-01T00:00:00.000Z" };

suite("translationWriteMerge", () => {
    suite("applyTranslationToNotebook", () => {
        test("an extra cue never replaces the cell's primary match", () => {
            const target = cell("A", "", 10, 18);
            const existing = notebook([target]);

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                existing,
                [primary(target, "TRANSLATION A", 10, 18), overlap(target, "SUB-CUE B", 12, 14)],
                opts
            );

            const written = find(updatedNotebook, "A")!;
            assert.strictEqual(written.value, "TRANSLATION A SUB-CUE B");
            // Timestamps stay those of the best match, not the sub-cue's.
            assert.strictEqual(written.metadata?.data?.startTime, 10);
            assert.strictEqual(written.metadata?.data?.endTime, 18);
            assert.strictEqual(stats.insertedCount, 1);
            assert.strictEqual(stats.mergedCueCount, 1);
        });

        test("no extra cell is created for an overlap", () => {
            const target = cell("A", "", 10, 18);
            const { updatedNotebook } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "TRANSLATION A", 10, 18), overlap(target, "SUB-CUE B", 12, 14)],
                opts
            );

            assert.strictEqual(updatedNotebook.cells.length, 1);
        });

        test("folded cues are recorded on the cell so the merge stays auditable", () => {
            const target = cell("A", "", 10, 18);
            const { updatedNotebook } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "TRANSLATION A", 10, 18), overlap(target, "SUB-CUE B", 12, 14)],
                opts
            );

            const merged = find(updatedNotebook, "A")!.metadata?.data?.mergedOverlaps as any[];
            assert.strictEqual(merged.length, 1);
            assert.deepStrictEqual(merged[0], { startTime: 12, endTime: 14, content: "SUB-CUE B" });
        });

        test("text is joined in temporal order, whatever order the entries arrive in", () => {
            const target = cell("A", "", 0, 30);
            const late = overlap(target, "third", 20, 25);
            const early = overlap(target, "second", 10, 15);

            const forwards = applyTranslationToNotebook(
                notebook([cell("A", "", 0, 30)]),
                [primary(target, "first", 0, 30), early, late],
                opts
            );
            const backwards = applyTranslationToNotebook(
                notebook([cell("A", "", 0, 30)]),
                [late, early, primary(target, "first", 0, 30)],
                opts
            );

            assert.strictEqual(find(forwards.updatedNotebook, "A")!.value, "first second third");
            assert.strictEqual(
                find(forwards.updatedNotebook, "A")!.value,
                find(backwards.updatedNotebook, "A")!.value
            );
        });

        test("replaces a machine-written translation when the imported text differs", () => {
            // Clients round-trip exported files through external editors; their fixes must land.
            const target = cell("A", "written by an earlier import", 10, 18);
            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "TRANSLATION A", 10, 18), overlap(target, "SUB-CUE B", 12, 14)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.value, "TRANSLATION A SUB-CUE B");
            assert.strictEqual(stats.updatedCount, 1);
            assert.strictEqual(stats.insertedCount, 0);
            assert.strictEqual(stats.mergedCueCount, 1);
            assert.strictEqual(stats.skippedCount, 0);
        });

        test("an overwrite records both the previous and the new value in the edit history", () => {
            const target = cell("A", "old value", 10, 18);
            const { updatedNotebook } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "new value", 10, 18)],
                opts
            );

            const edits = (find(updatedNotebook, "A")!.metadata!.edits as any[]) ?? [];
            const valueEdits = edits.filter((e) => e.editMap.length === 1 && e.editMap[0] === "value");
            assert.deepStrictEqual(
                valueEdits.map((e) => e.value),
                ["old value", "new value"]
            );
            // The back-filled previous value sorts just before the import's own edit.
            assert.ok(valueEdits[0].timestamp < valueEdits[1].timestamp);
            assert.strictEqual(valueEdits[1].timestamp, Date.parse(opts.timestamp));
            assert.ok(valueEdits.every((e) => e.type === EditType.INITIAL_IMPORT));
        });

        test("an overwrite that changes the timestamps records those as edits too", () => {
            // The corrupted-export repair restores a displaced cue's true timing; the write must
            // survive sync merges, so the timing change is recorded alongside the value change.
            const target = cell("A", "old value", 12, 14);
            const { updatedNotebook } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "new value", 10, 18)],
                opts
            );

            const written = find(updatedNotebook, "A")!;
            assert.strictEqual(written.metadata?.data?.startTime, 10);
            assert.strictEqual(written.metadata?.data?.endTime, 18);
            const edits = (written.metadata!.edits as any[]) ?? [];
            const timingEdits = edits.filter((e) => e.editMap[1] === "data");
            assert.deepStrictEqual(
                timingEdits.map((e) => [e.editMap[2], e.value]),
                [
                    ["startTime", 10],
                    ["endTime", 18],
                ]
            );
        });

        test("identical imported text leaves the cell alone", () => {
            const target = cell("A", "same text", 10, 18);
            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "same text", 10, 18)],
                opts
            );

            const written = find(updatedNotebook, "A")!;
            assert.strictEqual(written.value, "same text");
            assert.strictEqual(written.metadata!.edits, undefined);
            assert.strictEqual(stats.updatedCount, 0);
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("never replaces text a person typed in the editor", () => {
            const target = cell("A", "typed by hand", 10, 18, {
                edits: [
                    {
                        editMap: ["value"],
                        value: "typed by hand",
                        timestamp: 1,
                        type: EditType.USER_EDIT,
                        author: "sam",
                    },
                ],
            });
            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "imported replacement", 10, 18)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.value, "typed by hand");
            assert.strictEqual(stats.updatedCount, 0);
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("never replaces a validated value", () => {
            const target = cell("A", "approved text", 10, 18, {
                edits: [
                    {
                        editMap: ["value"],
                        value: "approved text",
                        timestamp: 1,
                        type: EditType.INITIAL_IMPORT,
                        validatedBy: [{ username: "reviewer", isDeleted: false }],
                    },
                ],
            });
            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "imported replacement", 10, 18)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.value, "approved text");
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("empty imported text never clobbers an existing translation", () => {
            const target = cell("A", "real work", 10, 18);
            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "", 10, 18)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.value, "real work");
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("milestone cells are never written to", () => {
            const milestone = cell("M", "1", undefined, undefined, {
                type: CodexCellTypes.MILESTONE,
            });
            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([milestone]),
                [primary(milestone, "should not land", 0, 5)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "M")!.value, "1");
            assert.strictEqual(stats.insertedCount, 0);
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("a locked cell is never written to", () => {
            // The editor blocks even its own timestamp updates on a locked cell, so an import
            // writing the file directly must not be the way around that.
            const target = cell("A", "settled text", 983.417, 984.083, { isLocked: true });

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [idMatch(target, "a replacement", 961.792, 991.042)],
                opts
            );

            const written = find(updatedNotebook, "A")!;
            assert.strictEqual(written.value, "settled text");
            assert.strictEqual(written.metadata?.data?.startTime, 983.417);
            assert.strictEqual(stats.updatedCount, 0);
            assert.strictEqual(stats.retimedCount, 0);
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("a locked empty cell is not filled either", () => {
            const target = cell("A", "", 10, 18, { isLocked: true });
            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "a translation", 10, 18)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.value, "");
            assert.strictEqual(stats.insertedCount, 0);
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("unmatched empty cells are not counted as translations", () => {
            // The aligner echoes unmatched target cells back with their own (empty) content.
            const a = cell("A", "", 10, 18);
            const b = cell("B", "", 20, 28);
            const echo: TranslationAlignedCell = {
                notebookCell: b,
                importedContent: { id: "B", content: "", startTime: 20, endTime: 28 },
            };

            const { stats } = applyTranslationToNotebook(
                notebook([a, b]),
                [primary(a, "real translation", 10, 18), echo],
                opts
            );

            assert.strictEqual(stats.insertedCount, 1);
        });

        test("reported stats match the cells actually written", () => {
            const a = cell("A", "", 10, 18);
            const b = cell("B", "already done", 20, 28);
            const c = cell("C", "", 30, 38);

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([a, b, c]),
                [
                    primary(a, "one", 10, 18),
                    overlap(a, "one-and-a-half", 12, 14),
                    primary(b, "two", 20, 28),
                    primary(c, "three", 30, 38),
                ],
                opts
            );

            const withNewText = updatedNotebook.cells.filter(
                (cellData) => cellData.value === "one one-and-a-half" || cellData.value === "three"
            );
            assert.strictEqual(withNewText.length, stats.insertedCount);
            assert.strictEqual(stats.insertedCount, 2);
            // B's machine-written "already done" is replaced by the differing import.
            assert.strictEqual(stats.updatedCount, 1);
            assert.strictEqual(find(updatedNotebook, "B")!.value, "two");
            assert.strictEqual(stats.skippedCount, 0);
            assert.strictEqual(stats.mergedCueCount, 1);

            const recorded = (updatedNotebook.metadata as any).importContext.lastTranslationImport
                .stats;
            assert.deepStrictEqual(recorded, stats);
        });

        test("notebook order is preserved and paratext lands after its parent", () => {
            const a = cell("A", "", 10, 18);
            const b = cell("B", "", 20, 28);
            const paratext: TranslationAlignedCell = {
                notebookCell: null,
                importedContent: {
                    id: "pt-1",
                    content: "a heading",
                    startTime: 19,
                    endTime: 19.5,
                    parentId: "A",
                },
                isParatext: true,
            };

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([a, b]),
                [primary(a, "one", 10, 18), paratext, primary(b, "two", 20, 28)],
                opts
            );

            assert.deepStrictEqual(
                updatedNotebook.cells.map((c) => c.metadata?.id),
                ["A", "pt-1", "B"]
            );
            assert.strictEqual(stats.paratextCount, 1);
        });

        test("an overlap whose parent has no primary match still lands rather than vanishing", () => {
            const a = cell("A", "", 10, 18);
            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([a]),
                [overlap(a, "orphan cue", 12, 14)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.value, "orphan cue");
            assert.strictEqual(stats.insertedCount, 1);
        });

        test("does not mutate the notebook it is given", () => {
            const a = cell("A", "", 10, 18);
            const existing = notebook([a]);

            applyTranslationToNotebook(
                existing,
                [primary(a, "TRANSLATION A", 10, 18), overlap(a, "SUB-CUE B", 12, 14)],
                opts
            );

            assert.strictEqual(existing.cells[0].value, "");
        });
    });

    suite("edit history written before edit maps existed", () => {
        // Old projects store a value edit as `cellValue` with no editMap at all. Reading only the
        // current shape would make a person's typed text look machine-written.
        const legacyEdit = (value: string, type: EditType) => ({
            cellValue: value,
            timestamp: 1,
            type,
            author: "sam",
        });

        test("legacy user edits still protect a cell from being overwritten", () => {
            const target = cell("A", "typed by hand", 10, 18, {
                edits: [legacyEdit("typed by hand", EditType.USER_EDIT)],
            });

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "imported replacement", 10, 18)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.value, "typed by hand");
            assert.strictEqual(stats.updatedCount, 0);
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("a legacy validated value is protected too", () => {
            const target = cell("A", "approved text", 10, 18, {
                edits: [
                    {
                        ...legacyEdit("approved text", EditType.INITIAL_IMPORT),
                        validatedBy: [{ username: "reviewer", isDeleted: false }],
                    },
                ],
            });

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "imported replacement", 10, 18)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.value, "approved text");
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("a legacy edit already holding the current value is not back-filled twice", () => {
            const target = cell("A", "machine draft", 10, 18, {
                edits: [legacyEdit("machine draft", EditType.INITIAL_IMPORT)],
            });

            const { updatedNotebook } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "corrected text", 10, 18)],
                opts
            );

            const edits = (find(updatedNotebook, "A")!.metadata!.edits as any[]) ?? [];
            const recordedValues = edits
                .filter((e) => e.cellValue !== undefined || (e.editMap?.length === 1 && e.editMap[0] === "value"))
                .map((e) => (e.value !== undefined ? e.value : e.cellValue));
            assert.deepStrictEqual(recordedValues, ["machine draft", "corrected text"]);
        });
    });

    suite("timing corrections on a cell that keeps its text", () => {
        test("an id-matched cue corrects the range without touching the text", () => {
            // The corrupted-export heal: the words are right, the range belongs to a nested cue.
            const target = cell("A", "same text", 983.417, 984.083);

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [idMatch(target, "same text", 961.792, 991.042)],
                opts
            );

            const written = find(updatedNotebook, "A")!;
            assert.strictEqual(written.value, "same text");
            assert.strictEqual(written.metadata?.data?.startTime, 961.792);
            assert.strictEqual(written.metadata?.data?.endTime, 991.042);
            assert.strictEqual(stats.retimedCount, 1);
            assert.strictEqual(stats.updatedCount, 0);
            assert.strictEqual(stats.skippedCount, 0);
        });

        test("the corrected range is recorded as edits so it survives a sync merge", () => {
            const target = cell("A", "same text", 983.417, 984.083);
            const { updatedNotebook } = applyTranslationToNotebook(
                notebook([target]),
                [idMatch(target, "same text", 961.792, 991.042)],
                opts
            );

            const written = find(updatedNotebook, "A")!;
            assert.deepStrictEqual(timingEditsOf(written), [
                ["startTime", 961.792],
                ["endTime", 991.042],
            ]);
            // The text was not rewritten, so no value edit belongs in the history.
            const valueEdits = ((written.metadata!.edits as any[]) ?? []).filter(
                (e) => e.editMap?.length === 1 && e.editMap[0] === "value"
            );
            assert.strictEqual(valueEdits.length, 0);
        });

        test("only the field that actually moved is written", () => {
            const target = cell("A", "same text", 10, 984.083);
            const { updatedNotebook } = applyTranslationToNotebook(
                notebook([target]),
                [idMatch(target, "same text", 10, 991.042)],
                opts
            );

            assert.deepStrictEqual(timingEditsOf(find(updatedNotebook, "A")!), [
                ["endTime", 991.042],
            ]);
        });

        test("a merely overlapping cue never retimes a cell", () => {
            // A file whose clock is offset overlaps everything; trusting it would shift the
            // whole notebook.
            const target = cell("A", "same text", 983.417, 984.083);

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "same text", 961.792, 991.042)],
                opts
            );

            const written = find(updatedNotebook, "A")!;
            assert.strictEqual(written.metadata?.data?.startTime, 983.417);
            assert.strictEqual(written.metadata?.data?.endTime, 984.083);
            assert.strictEqual(stats.retimedCount, 0);
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("a range a person placed by hand is left alone", () => {
            const target = cell("A", "same text", 983.417, 984.083, {
                edits: [
                    {
                        editMap: ["metadata", "data", "startTime"],
                        value: 983.417,
                        timestamp: 5,
                        type: EditType.USER_EDIT,
                        author: "sam",
                    },
                ],
            });

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [idMatch(target, "same text", 961.792, 991.042)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.metadata?.data?.startTime, 983.417);
            assert.strictEqual(stats.retimedCount, 0);
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("a sub-millisecond difference is not a correction", () => {
            const target = cell("A", "same text", 961.792, 991.042);
            const { stats } = applyTranslationToNotebook(
                notebook([target]),
                [idMatch(target, "same text", 961.7922, 991.0419)],
                opts
            );

            assert.strictEqual(stats.retimedCount, 0);
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("text a person typed keeps its words but still takes a corrected range", () => {
            const target = cell("A", "typed by hand", 983.417, 984.083, {
                edits: [
                    {
                        editMap: ["value"],
                        value: "typed by hand",
                        timestamp: 1,
                        type: EditType.USER_EDIT,
                        author: "sam",
                    },
                ],
            });

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [idMatch(target, "different imported text", 961.792, 991.042)],
                opts
            );

            const written = find(updatedNotebook, "A")!;
            assert.strictEqual(written.value, "typed by hand");
            assert.strictEqual(written.metadata?.data?.startTime, 961.792);
            assert.strictEqual(stats.retimedCount, 1);
        });

        test("an empty cue never retimes the cell it failed to fill", () => {
            const target = cell("A", "real work", 983.417, 984.083);
            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [idMatch(target, "", 961.792, 991.042)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.metadata?.data?.startTime, 983.417);
            assert.strictEqual(stats.retimedCount, 0);
            assert.strictEqual(stats.skippedCount, 1);
        });

        test("a validated cell is not retimed, because that would clear its badge", () => {
            // The editor reads validation off the LAST edit in the history whatever kind it is, so
            // appending a timing edit to a validated cell would silently un-validate it.
            const target = cell("A", "approved text", 983.417, 984.083, {
                edits: [
                    {
                        editMap: ["value"],
                        value: "approved text",
                        timestamp: 1,
                        type: EditType.INITIAL_IMPORT,
                        validatedBy: [{ username: "reviewer", isDeleted: false }],
                    },
                ],
            });

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [idMatch(target, "approved text", 961.792, 991.042)],
                opts
            );

            const written = find(updatedNotebook, "A")!;
            assert.strictEqual(written.metadata?.data?.startTime, 983.417);
            assert.strictEqual(stats.retimedCount, 0);
            assert.strictEqual(stats.skippedCount, 1);
            // The validation is still the last thing in the history.
            const edits = (written.metadata!.edits as any[]) ?? [];
            assert.strictEqual(edits.length, 1);
            assert.ok(edits[edits.length - 1].validatedBy.length > 0);
        });

        test("a withdrawn validation does not block the correction", () => {
            const target = cell("A", "same text", 983.417, 984.083, {
                edits: [
                    {
                        editMap: ["value"],
                        value: "same text",
                        timestamp: 1,
                        type: EditType.INITIAL_IMPORT,
                        validatedBy: [{ username: "reviewer", isDeleted: true }],
                    },
                ],
            });

            const { stats } = applyTranslationToNotebook(
                notebook([target]),
                [idMatch(target, "same text", 961.792, 991.042)],
                opts
            );

            assert.strictEqual(stats.retimedCount, 1);
        });

        test("a retimed cell keeps the rest of its metadata", () => {
            const target = cell("A", "same text", 983.417, 984.083, {
                cellLabel: "TRAINEES",
                data: { startTime: 983.417, endTime: 984.083, someOtherField: "keep me" },
            });

            const { updatedNotebook } = applyTranslationToNotebook(
                notebook([target]),
                [idMatch(target, "same text", 961.792, 991.042)],
                opts
            );

            const written = find(updatedNotebook, "A")!;
            assert.strictEqual(written.metadata?.cellLabel, "TRAINEES");
            assert.strictEqual(written.metadata?.data?.someOtherField, "keep me");
            assert.strictEqual(written.metadata?.type, CodexCellTypes.TEXT);
        });
    });

    suite("cell type is never changed by an import", () => {
        test("a timed paratext cell stays paratext when its text is replaced", () => {
            // Paratext cells are exported as cues like any other, so a round trip must not quietly
            // promote them into ordinary translation cells.
            const target = cell("P", "an old heading", 19, 19.5, {
                type: CodexCellTypes.PARATEXT,
            });

            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "a corrected heading", 19, 19.5)],
                opts
            );

            const written = find(updatedNotebook, "P")!;
            assert.strictEqual(written.value, "a corrected heading");
            assert.strictEqual(written.metadata?.type, CodexCellTypes.PARATEXT);
            assert.strictEqual(stats.updatedCount, 1);
        });

        test("an empty paratext cell stays paratext when it is filled", () => {
            const target = cell("P", "", 19, 19.5, { type: CodexCellTypes.PARATEXT });
            const { updatedNotebook } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "a heading", 19, 19.5)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "P")!.metadata?.type, CodexCellTypes.PARATEXT);
        });

        test("a cell with no type recorded still becomes a text cell", () => {
            const target: TranslationCell = {
                kind: 1,
                languageId: "html",
                value: "",
                metadata: { id: "A", data: { startTime: 10, endTime: 18 } },
            };

            const { updatedNotebook } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "translation", 10, 18)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.metadata?.type, CodexCellTypes.TEXT);
        });
    });

    suite("evidence of the pre-fix damage is not erased by a later import", () => {
        const damaged = (cells: TranslationCell[]) =>
            notebook(cells, {
                importContext: {
                    lastTranslationImport: {
                        importerType: "subtitles",
                        stats: { insertedCount: 5, childCellCount: 102 },
                    },
                },
            });

        test("the childCellCount marker survives a later import", () => {
            // It is the only thing the one-off repair command uses to recognize a damaged project.
            const a = cell("A", "", 10, 18);
            const { updatedNotebook } = applyTranslationToNotebook(
                damaged([a]),
                [primary(a, "translation", 10, 18)],
                opts
            );

            const recorded = (updatedNotebook.metadata as any).importContext.lastTranslationImport
                .stats;
            assert.strictEqual(recorded.childCellCount, 102);
            assert.strictEqual(recorded.insertedCount, 1);
        });

        test("a healthy project gains no such marker", () => {
            const a = cell("A", "", 10, 18);
            const { updatedNotebook } = applyTranslationToNotebook(
                notebook([a]),
                [primary(a, "translation", 10, 18)],
                opts
            );

            const recorded = (updatedNotebook.metadata as any).importContext.lastTranslationImport
                .stats;
            assert.ok(!("childCellCount" in recorded));
        });
    });

    suite("needsBulkOverwriteConfirmation", () => {
        test("catches a file that matched nothing by id and would replace most of the work", () => {
            assert.strictEqual(
                needsBulkOverwriteConfirmation(
                    statsWith({ updatedCount: 60 }),
                    riskWith({ exactIdMatches: 0, populatedCellCount: 100 })
                ),
                true
            );
        });

        test("stays quiet when the file is this project's own export", () => {
            assert.strictEqual(
                needsBulkOverwriteConfirmation(
                    statsWith({ updatedCount: 60 }),
                    riskWith({ exactIdMatches: 1, populatedCellCount: 100 })
                ),
                false
            );
        });

        test("stays quiet for a handful of cells", () => {
            assert.strictEqual(
                needsBulkOverwriteConfirmation(
                    statsWith({ updatedCount: 9 }),
                    riskWith({ populatedCellCount: 10 })
                ),
                false
            );
        });

        test("stays quiet when most of the existing work is left alone", () => {
            assert.strictEqual(
                needsBulkOverwriteConfirmation(
                    statsWith({ updatedCount: 50 }),
                    riskWith({ populatedCellCount: 100 })
                ),
                false
            );
            assert.strictEqual(
                needsBulkOverwriteConfirmation(
                    statsWith({ updatedCount: 51 }),
                    riskWith({ populatedCellCount: 100 })
                ),
                true
            );
        });

        test("an import that only fills empty cells is never a bulk overwrite", () => {
            assert.strictEqual(
                needsBulkOverwriteConfirmation(
                    statsWith({ insertedCount: 400 }),
                    riskWith({ populatedCellCount: 0 })
                ),
                false
            );
        });

        test("the risk report counts id matches and the work already in the file", () => {
            const a = cell("A", "existing one", 10, 18);
            const b = cell("B", "existing two", 20, 28);
            const c = cell("C", "", 30, 38);
            const milestone = cell("M", "1", undefined, undefined, {
                type: CodexCellTypes.MILESTONE,
            });

            const { overwriteRisk } = applyTranslationToNotebook(
                notebook([a, b, c, milestone]),
                [idMatch(a, "new one", 10, 18), primary(b, "new two", 20, 28)],
                opts
            );

            assert.strictEqual(overwriteRisk.exactIdMatches, 1);
            // The milestone's "1" is structure, not translated work.
            assert.strictEqual(overwriteRisk.populatedCellCount, 2);
        });
    });

    suite("describeTranslationImport", () => {
        const base = statsWith({ insertedCount: 3, skippedCount: 1 });

        test("mentions merged cues only when there are some", () => {
            assert.ok(!describeTranslationImport(base).includes("merged"));
            assert.ok(
                describeTranslationImport({ ...base, mergedCueCount: 2 }).includes(
                    "2 overlapping cues merged in"
                )
            );
        });

        test("mentions updated cells only when there are some", () => {
            assert.ok(!describeTranslationImport(base).includes("updated"));
            assert.ok(describeTranslationImport({ ...base, updatedCount: 2 }).includes("2 updated"));
        });

        test("mentions retimed cells only when there are some", () => {
            assert.ok(!describeTranslationImport(base).includes("retimed"));
            assert.ok(describeTranslationImport({ ...base, retimedCount: 8 }).includes("8 retimed"));
        });
    });
});
