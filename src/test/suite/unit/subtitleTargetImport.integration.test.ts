import * as assert from "assert";
import { CodexCellTypes } from "../../../../types/enums";
import { subtitlesCellAligner } from "../../../../webviews/codex-webviews/src/NewSourceUploader/importers/subtitles/aligner";
import {
    applyTranslationToNotebook,
    type TranslationCell,
    type TranslationNotebook,
} from "../../../providers/NewSourceUploader/translationWriteMerge";

/**
 * End-to-end regression test for issue #1144: the real subtitle aligner feeding the real write
 * path, over the two cue layouts that reproduced the bug in a live project.
 *
 * The two halves of the fix are independent — the aligner decides which cell a cue belongs to, the
 * write path decides what happens to a cue that has to share a cell — so exercising them together
 * is the only way to prove the reported symptom is gone.
 */

const milestone = (id: string): TranslationCell => ({
    kind: 1,
    languageId: "html",
    value: "1",
    metadata: { id, type: CodexCellTypes.MILESTONE, edits: [], data: {} },
});

const subtitleCell = (id: string, startTime: number, endTime: number): TranslationCell => ({
    kind: 1,
    languageId: "html",
    value: "",
    metadata: { id, type: CodexCellTypes.TEXT, edits: [], data: { startTime, endTime } },
});

const cue = (id: string, startTime: number, endTime: number, content: string) => ({
    id,
    content,
    startTime,
    endTime,
});

const runImport = async (cells: TranslationCell[], cues: ReturnType<typeof cue>[]) => {
    const aligned = await subtitlesCellAligner(cells as any, [], cues as any);
    const existing: TranslationNotebook = { cells, metadata: {} };
    return applyTranslationToNotebook(existing, aligned as any, {
        importerType: "subtitles",
        sourceFilePath: "/fixture.source",
        timestamp: "2026-01-01T00:00:00.000Z",
    });
};

const find = (nb: TranslationNotebook, id: string) =>
    nb.cells.find((c) => c.metadata?.id === id);

suite("subtitle target import (end to end)", () => {
    test("a nested source cue keeps its own cell, and neither cell is overwritten", async () => {
        // Reproduced live as project 'Nested-test': cell A held cell B's translation at B's
        // timings, and cell B was left empty.
        const cells = [
            milestone("M"),
            subtitleCell("A", 10, 18),
            subtitleCell("B", 12, 14),
        ];
        const cues = [
            cue("c1", 10, 18, "TRANSLATION A"),
            cue("c2", 12, 14, "TRANSLATION B"),
        ];

        const { updatedNotebook, stats } = await runImport(cells, cues);

        const a = find(updatedNotebook, "A")!;
        const b = find(updatedNotebook, "B")!;
        assert.strictEqual(a.value, "TRANSLATION A");
        assert.strictEqual(a.metadata?.data?.startTime, 10);
        assert.strictEqual(a.metadata?.data?.endTime, 18);
        assert.strictEqual(b.value, "TRANSLATION B");
        assert.strictEqual(b.metadata?.data?.startTime, 12);
        assert.strictEqual(b.metadata?.data?.endTime, 14);

        assert.strictEqual(stats.insertedCount, 2);
        assert.strictEqual(stats.mergedCueCount, 0);
        // The milestone is the only skipped cell, and no cell was invented.
        assert.strictEqual(stats.skippedCount, 1);
        assert.strictEqual(updatedNotebook.cells.length, 3);
    });

    test("a sub-cue is folded into its cell instead of replacing it", async () => {
        // Reproduced live as project 'Subcue-test': the cell held only "SUB-CUE B" at 12 -> 14.
        const cells = [milestone("M"), subtitleCell("A", 10, 18)];
        const cues = [
            cue("c1", 10, 18, "TRANSLATION A"),
            cue("c2", 12, 14, "SUB-CUE B"),
        ];

        const { updatedNotebook, stats } = await runImport(cells, cues);

        const a = find(updatedNotebook, "A")!;
        assert.strictEqual(a.value, "TRANSLATION A SUB-CUE B");
        assert.strictEqual(a.metadata?.data?.startTime, 10);
        assert.strictEqual(a.metadata?.data?.endTime, 18);
        assert.deepStrictEqual(a.metadata?.data?.mergedOverlaps, [
            { startTime: 12, endTime: 14, content: "SUB-CUE B" },
        ]);

        assert.strictEqual(stats.insertedCount, 1);
        assert.strictEqual(stats.mergedCueCount, 1);
        assert.strictEqual(updatedNotebook.cells.length, 2);
    });

    test("the timings reported in issue #1144 land on the right cells", async () => {
        // Source cell 155 is nested inside 154; VTT cue 217 is nested inside cue 216.
        const t = (m: number, s: number) => m * 60 + s;
        const cells = [
            milestone("M"),
            subtitleCell("cell154", t(23, 16.167), t(23, 23.833)),
            subtitleCell("cell155", t(23, 21.125), t(23, 22.167)),
        ];
        const cues = [
            cue("cue216", t(23, 16.167), t(23, 23.834), "cue 216 text"),
            cue("cue217", t(23, 21.125), t(23, 22.167), "cue 217 text"),
        ];

        const { updatedNotebook } = await runImport(cells, cues);

        const c154 = find(updatedNotebook, "cell154")!;
        assert.strictEqual(c154.value, "cue 216 text");
        // The issue's checklist: cell 154 ends at 00:23:23.834, the cue's end, not the sub-cue's.
        assert.strictEqual(c154.metadata?.data?.endTime, t(23, 23.834));
        assert.strictEqual(find(updatedNotebook, "cell155")!.value, "cue 217 text");
    });

    test("stats never claim more cells than the notebook actually gained", async () => {
        const cells = [
            milestone("M"),
            subtitleCell("A", 10, 18),
            subtitleCell("B", 20, 28),
            subtitleCell("C", 30, 38),
        ];
        const cues = [
            cue("c1", 10, 18, "one"),
            cue("c2", 12, 14, "one-b"),
            cue("c3", 20, 28, "two"),
            // Nothing overlaps C, and one cue matches nothing at all.
            cue("c4", 500, 505, "orphan"),
        ];

        const { updatedNotebook, stats } = await runImport(cells, cues);

        const filled = updatedNotebook.cells.filter(
            (c) => c.metadata?.type === CodexCellTypes.TEXT && (c.value ?? "").trim() !== ""
        );
        assert.strictEqual(filled.length, stats.insertedCount);
        assert.strictEqual(find(updatedNotebook, "C")!.value, "");
        // The unmatched cue becomes paratext rather than vanishing.
        assert.strictEqual(stats.paratextCount, 1);
    });
});
