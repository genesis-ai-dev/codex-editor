import * as assert from "assert";
import { CodexCellTypes } from "../../../../types/enums";
import {
    applyTranslationToNotebook,
    describeTranslationImport,
    type TranslationAlignedCell,
    type TranslationCell,
    type TranslationNotebook,
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

const find = (nb: TranslationNotebook, id: string): TranslationCell | undefined =>
    nb.cells.find((c) => c.metadata?.id === id);

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

        test("a cell that already holds a translation is left alone, and so are its extra cues", () => {
            const target = cell("A", "existing work", 10, 18);
            const { updatedNotebook, stats } = applyTranslationToNotebook(
                notebook([target]),
                [primary(target, "TRANSLATION A", 10, 18), overlap(target, "SUB-CUE B", 12, 14)],
                opts
            );

            assert.strictEqual(find(updatedNotebook, "A")!.value, "existing work");
            assert.strictEqual(stats.insertedCount, 0);
            assert.strictEqual(stats.mergedCueCount, 0);
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
            assert.strictEqual(stats.skippedCount, 1);
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

    suite("describeTranslationImport", () => {
        test("mentions merged cues only when there are some", () => {
            const base = { insertedCount: 3, skippedCount: 1, paratextCount: 0, mergedCueCount: 0 };
            assert.ok(!describeTranslationImport(base).includes("merged"));
            assert.ok(
                describeTranslationImport({ ...base, mergedCueCount: 2 }).includes(
                    "2 overlapping cues merged in"
                )
            );
        });
    });
});
