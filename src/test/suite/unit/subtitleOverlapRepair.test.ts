import * as assert from "assert";
import { CodexCellTypes, EditType } from "../../../../types/enums";
import {
    applySubtitleOverlapRepair,
    isAffectedByOverlapOverwrite,
    planSubtitleOverlapRepair,
    type RepairCell,
    type RepairNotebook,
} from "../../../projectManager/utils/merge/utils/subtitleOverlapRepair";

/**
 * Tests for the issue #1144 repair. The fixtures mirror the two projects that reproduced the bug:
 * a cell left holding a nested cue's text and timings, with the .source still carrying the truth.
 */

const cell = (
    id: string,
    value: string,
    startTime?: number,
    endTime?: number,
    metadata: Record<string, unknown> = {}
): RepairCell => ({
    kind: 1,
    languageId: "html",
    value,
    metadata: {
        id,
        type: CodexCellTypes.TEXT,
        edits: [],
        data: startTime === undefined ? {} : { startTime, endTime },
        ...metadata,
    },
});

/** A notebook carrying the fingerprint the buggy importer left behind. */
const damagedNotebook = (cells: RepairCell[], childCellCount = 1): RepairNotebook => ({
    cells,
    metadata: {
        importContext: {
            lastTranslationImport: {
                importerType: "subtitles",
                stats: { insertedCount: 2, skippedCount: 1, paratextCount: 0, childCellCount },
            },
        },
    },
});

const sourceNotebook = (cells: RepairCell[]): RepairNotebook => ({ cells, metadata: {} });

suite("subtitleOverlapRepair", () => {
    suite("isAffectedByOverlapOverwrite", () => {
        test("recognises a file written by the buggy importer", () => {
            assert.strictEqual(
                isAffectedByOverlapOverwrite(damagedNotebook([cell("A", "x", 12, 14)])),
                true
            );
        });

        test("ignores a file imported by the fixed importer", () => {
            const healthy: RepairNotebook = {
                cells: [cell("A", "x", 10, 18)],
                metadata: {
                    importContext: {
                        lastTranslationImport: {
                            stats: { insertedCount: 1, mergedCueCount: 1 },
                        },
                    },
                },
            };
            assert.strictEqual(isAffectedByOverlapOverwrite(healthy), false);
        });

        test("ignores a file that has never had a translation imported", () => {
            assert.strictEqual(isAffectedByOverlapOverwrite({ cells: [], metadata: {} }), false);
        });

        test("leaves a file alone if it really does contain child text cells", () => {
            const withChildren = damagedNotebook([
                cell("A", "x", 12, 14),
                cell("A-child", "y", 12, 14, { parentId: "A" }),
            ]);
            assert.strictEqual(isAffectedByOverlapOverwrite(withChildren), false);
        });
    });

    suite("planSubtitleOverlapRepair", () => {
        test("flags a cell holding a nested cue's short range", () => {
            // The 'Subcue-test' repro: source says 10 -> 18, the cell ended up at 12 -> 14.
            const codex = damagedNotebook([cell("A", "SUB-CUE B", 12, 14)]);
            const source = sourceNotebook([cell("A", "Source cell A", 10, 18)]);

            const plan = planSubtitleOverlapRepair(codex, source);

            assert.strictEqual(plan.isAffectedFile, true);
            assert.strictEqual(plan.candidates.length, 1);
            assert.deepStrictEqual(plan.candidates[0], {
                cellId: "A",
                strandedValue: "SUB-CUE B",
                currentStartTime: 12,
                currentEndTime: 14,
                sourceStartTime: 10,
                sourceEndTime: 18,
            });
        });

        test("does not flag a cell that was merely retimed", () => {
            // A retimed target legitimately shifts, and keeps roughly its own duration.
            const codex = damagedNotebook([cell("A", "translated", 10.5, 18.4)]);
            const source = sourceNotebook([cell("A", "Source cell A", 10, 18)]);

            assert.strictEqual(planSubtitleOverlapRepair(codex, source).candidates.length, 0);
        });

        test("does not flag a cell whose range extends past its source range", () => {
            const codex = damagedNotebook([cell("A", "translated", 12, 25)]);
            const source = sourceNotebook([cell("A", "Source cell A", 10, 18)]);

            assert.strictEqual(planSubtitleOverlapRepair(codex, source).candidates.length, 0);
        });

        test("does not flag an empty cell — there is nothing stranded in it", () => {
            const codex = damagedNotebook([cell("A", "", 12, 14)]);
            const source = sourceNotebook([cell("A", "Source cell A", 10, 18)]);

            assert.strictEqual(planSubtitleOverlapRepair(codex, source).candidates.length, 0);
        });

        test("ignores milestone and paratext cells", () => {
            const codex = damagedNotebook([
                cell("M", "1", 12, 14, { type: CodexCellTypes.MILESTONE }),
                cell("P", "a heading", 12, 14, { type: CodexCellTypes.PARATEXT }),
            ]);
            const source = sourceNotebook([
                cell("M", "1", 10, 18, { type: CodexCellTypes.MILESTONE }),
                cell("P", "a heading", 10, 18, { type: CodexCellTypes.PARATEXT }),
            ]);

            assert.strictEqual(planSubtitleOverlapRepair(codex, source).candidates.length, 0);
        });

        test("returns nothing for a file that does not carry the fingerprint", () => {
            const codex: RepairNotebook = { cells: [cell("A", "x", 12, 14)], metadata: {} };
            const source = sourceNotebook([cell("A", "Source cell A", 10, 18)]);

            const plan = planSubtitleOverlapRepair(codex, source);
            assert.strictEqual(plan.isAffectedFile, false);
            assert.strictEqual(plan.candidates.length, 0);
        });
    });

    suite("applySubtitleOverlapRepair", () => {
        test("restores the timestamps and parks the stranded text", () => {
            const codex = damagedNotebook([cell("A", "SUB-CUE B", 12, 14)]);
            const source = sourceNotebook([cell("A", "Source cell A", 10, 18)]);

            const plan = planSubtitleOverlapRepair(codex, source);
            const result = applySubtitleOverlapRepair(codex, plan, 1000);

            assert.strictEqual(result.changed, true);
            assert.strictEqual(result.repairedCount, 1);

            const repaired = codex.cells[0];
            assert.strictEqual(repaired.value, "");
            assert.strictEqual(repaired.metadata?.data?.startTime, 10);
            assert.strictEqual(repaired.metadata?.data?.endTime, 18);
            // Nothing is destroyed: the sub-cue's words are kept.
            assert.strictEqual(repaired.metadata?.data?.repairedFromValue, "SUB-CUE B");
        });

        test("records the change as MIGRATION edits so it survives a sync merge", () => {
            const codex = damagedNotebook([cell("A", "SUB-CUE B", 12, 14)]);
            const source = sourceNotebook([cell("A", "Source cell A", 10, 18)]);

            applySubtitleOverlapRepair(codex, planSubtitleOverlapRepair(codex, source), 1000);

            const edits = codex.cells[0].metadata?.edits ?? [];
            assert.strictEqual(edits.length, 3);
            assert.ok(edits.every((e: any) => e.type === EditType.MIGRATION));
            assert.ok(edits.every((e: any) => e.timestamp === 1000));
            const maps = edits.map((e: any) => e.editMap.join("."));
            assert.ok(maps.includes("metadata.data.startTime"));
            assert.ok(maps.includes("metadata.data.endTime"));
            assert.ok(maps.includes("value"));
        });

        test("is idempotent — a second run finds nothing left to repair", () => {
            const codex = damagedNotebook([cell("A", "SUB-CUE B", 12, 14)]);
            const source = sourceNotebook([cell("A", "Source cell A", 10, 18)]);

            applySubtitleOverlapRepair(codex, planSubtitleOverlapRepair(codex, source), 1000);
            const secondPlan = planSubtitleOverlapRepair(codex, source);
            const second = applySubtitleOverlapRepair(codex, secondPlan, 2000);

            assert.strictEqual(second.changed, false);
            assert.strictEqual(second.repairedCount, 0);
            assert.strictEqual(codex.cells[0].metadata?.edits?.length, 3);
        });

        test("retires the fingerprint so the file is not scanned again", () => {
            const codex = damagedNotebook([cell("A", "SUB-CUE B", 12, 14)]);
            const source = sourceNotebook([cell("A", "Source cell A", 10, 18)]);

            applySubtitleOverlapRepair(codex, planSubtitleOverlapRepair(codex, source), 1000);

            const stats = (codex.metadata as any).importContext.lastTranslationImport.stats;
            assert.strictEqual(stats.childCellCount, undefined);
            assert.strictEqual(stats.repairedOverlapOverwrites, 1);
            assert.strictEqual(isAffectedByOverlapOverwrite(codex), false);
        });

        test("leaves untouched cells exactly as they were", () => {
            const codex = damagedNotebook([
                cell("A", "SUB-CUE B", 12, 14),
                cell("B", "a good translation", 20, 28),
            ]);
            const source = sourceNotebook([
                cell("A", "Source cell A", 10, 18),
                cell("B", "Source cell B", 20, 28),
            ]);

            applySubtitleOverlapRepair(codex, planSubtitleOverlapRepair(codex, source), 1000);

            const untouched = codex.cells[1];
            assert.strictEqual(untouched.value, "a good translation");
            assert.strictEqual(untouched.metadata?.edits?.length, 0);
        });
    });
});
