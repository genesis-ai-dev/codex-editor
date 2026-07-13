import * as assert from "assert";
import * as vscode from "vscode";
import {
    runWithConcurrencyPool,
    tokenToAbortSignal,
    ExportCancelledError,
    parseCellIdToBookChapterVerse,
    formatChapterVerseSuffix,
} from "../../../exportHandler/audioExporter";

suite("Audio Exporter - runWithConcurrencyPool", () => {
    test("should process all items and return results in input order", async () => {
        const items = [10, 20, 30, 40, 50];
        const results = await runWithConcurrencyPool(
            items,
            3,
            async (item) => item * 2
        );

        assert.strictEqual(results.length, 5);
        for (let i = 0; i < items.length; i++) {
            assert.strictEqual(results[i].status, "fulfilled");
            if (results[i].status === "fulfilled") {
                assert.strictEqual((results[i] as PromiseFulfilledResult<number>).value, items[i] * 2);
            }
        }
    });

    test("should never exceed the concurrency limit", async () => {
        let activeCount = 0;
        let maxObservedActive = 0;
        const concurrency = 3;
        const items = Array.from({ length: 20 }, (_, i) => i);

        await runWithConcurrencyPool(
            items,
            concurrency,
            async (item) => {
                activeCount++;
                maxObservedActive = Math.max(maxObservedActive, activeCount);

                // Simulate async work with variable duration
                await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));

                activeCount--;
                return item;
            }
        );

        assert.ok(
            maxObservedActive <= concurrency,
            `Max active was ${maxObservedActive}, expected <= ${concurrency}`
        );
        assert.strictEqual(
            maxObservedActive, concurrency,
            `Should saturate all ${concurrency} slots (observed ${maxObservedActive})`
        );
    });

    test("should start a new task immediately when one completes (sliding window)", async () => {
        const concurrency = 3;
        const taskCount = 9;
        const items = Array.from({ length: taskCount }, (_, i) => i);
        const startTimes: number[] = [];
        const endTimes: number[] = [];

        await runWithConcurrencyPool(
            items,
            concurrency,
            async (_item, index) => {
                startTimes[index] = Date.now();
                // First batch takes 50ms, subsequent tasks take 10ms
                const delay = index < concurrency ? 50 : 10;
                await new Promise((resolve) => setTimeout(resolve, delay));
                endTimes[index] = Date.now();
                return index;
            }
        );

        // Tasks 3, 4, 5 should start very soon after tasks 0, 1, 2 finish
        // (not waiting for all 3 to finish like a fixed-batch approach would)
        for (let i = concurrency; i < taskCount; i++) {
            const startedAfterFirstBatch = startTimes[i] >= startTimes[0];
            assert.ok(startedAfterFirstBatch, `Task ${i} should have started after task 0`);
        }

        assert.strictEqual(startTimes.length, taskCount);
        assert.strictEqual(endTimes.length, taskCount);
    });

    test("should handle task failures without crashing the pool", async () => {
        const items = [1, 2, 3, 4, 5];
        const results = await runWithConcurrencyPool(
            items,
            3,
            async (item) => {
                if (item === 3) throw new Error("deliberate failure");
                return item * 10;
            }
        );

        assert.strictEqual(results.length, 5);

        // Successful items
        assert.strictEqual(results[0].status, "fulfilled");
        assert.strictEqual((results[0] as PromiseFulfilledResult<number>).value, 10);
        assert.strictEqual(results[1].status, "fulfilled");
        assert.strictEqual((results[1] as PromiseFulfilledResult<number>).value, 20);
        assert.strictEqual(results[3].status, "fulfilled");
        assert.strictEqual((results[3] as PromiseFulfilledResult<number>).value, 40);
        assert.strictEqual(results[4].status, "fulfilled");
        assert.strictEqual((results[4] as PromiseFulfilledResult<number>).value, 50);

        // Failed item
        assert.strictEqual(results[2].status, "rejected");
        assert.ok(
            (results[2] as PromiseRejectedResult).reason instanceof Error
        );
        assert.strictEqual(
            (results[2] as PromiseRejectedResult).reason.message,
            "deliberate failure"
        );
    });

    test("should call onProgress after each task completes", async () => {
        const items = [1, 2, 3, 4, 5];
        const progressCalls: Array<{ completed: number; total: number }> = [];

        await runWithConcurrencyPool(
            items,
            2,
            async (item) => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                return item;
            },
            (completed, total) => {
                progressCalls.push({ completed, total });
            }
        );

        assert.strictEqual(progressCalls.length, 5);
        // Total should always be the item count
        for (const call of progressCalls) {
            assert.strictEqual(call.total, 5);
        }
        // Completed values should end at the item count
        assert.strictEqual(progressCalls[progressCalls.length - 1].completed, 5);
        // Each call should have a completed value >= previous (monotonically increasing)
        for (let i = 1; i < progressCalls.length; i++) {
            assert.ok(
                progressCalls[i].completed >= progressCalls[i - 1].completed,
                `Progress should be monotonically increasing`
            );
        }
    });

    test("should handle empty input", async () => {
        const results = await runWithConcurrencyPool(
            [],
            10,
            async (item: number) => item * 2
        );

        assert.strictEqual(results.length, 0);
    });

    test("should work when items count is less than concurrency", async () => {
        const items = [1, 2];
        let maxActive = 0;
        let active = 0;

        const results = await runWithConcurrencyPool(
            items,
            10,
            async (item) => {
                active++;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setTimeout(resolve, 10));
                active--;
                return item * 3;
            }
        );

        assert.strictEqual(results.length, 2);
        assert.strictEqual((results[0] as PromiseFulfilledResult<number>).value, 3);
        assert.strictEqual((results[1] as PromiseFulfilledResult<number>).value, 6);
        assert.ok(maxActive <= 2, `Should only spawn workers for available items`);
    });

    test("should maintain correct concurrency through entire run", async () => {
        const concurrency = 5;
        const items = Array.from({ length: 50 }, (_, i) => i);
        const activeSamples: number[] = [];
        let active = 0;

        await runWithConcurrencyPool(
            items,
            concurrency,
            async () => {
                active++;
                activeSamples.push(active);
                // Variable delay to simulate real-world download jitter
                await new Promise((resolve) =>
                    setTimeout(resolve, Math.floor(Math.random() * 30) + 5)
                );
                active--;
                return true;
            }
        );

        const overLimit = activeSamples.filter((s) => s > concurrency);
        assert.strictEqual(
            overLimit.length, 0,
            `Found ${overLimit.length} samples exceeding concurrency limit of ${concurrency}`
        );
        // Verify we actually used all slots at some point
        const hitMax = activeSamples.some((s) => s === concurrency);
        assert.ok(hitMax, `Should have reached max concurrency of ${concurrency}`);
    });

    test("should stop scheduling new tasks after the token is cancelled mid-run", async () => {
        const concurrency = 2;
        const items = Array.from({ length: 20 }, (_, i) => i);
        const cts = new vscode.CancellationTokenSource();
        let processed = 0;

        const results = await runWithConcurrencyPool(
            items,
            concurrency,
            async (item) => {
                processed++;
                // Cancel partway through; subsequent slots should be skipped.
                if (processed === 3) {
                    cts.cancel();
                }
                await new Promise((resolve) => setTimeout(resolve, 5));
                return item;
            },
            undefined,
            cts.token
        );

        // Results array stays dense (one entry per input item).
        assert.strictEqual(results.length, items.length);
        // We must have processed fewer than all items (the rest were skipped).
        assert.ok(
            processed < items.length,
            `Expected to short-circuit, but processed all ${processed} items`
        );
        // Skipped slots are rejected with ExportCancelledError.
        const cancelledSlots = results.filter(
            (r) => r.status === "rejected" &&
                (r as PromiseRejectedResult).reason instanceof ExportCancelledError
        );
        assert.ok(
            cancelledSlots.length > 0,
            "Expected at least one slot marked as cancelled"
        );
        cts.dispose();
    });

    test("should run zero processors when the token is already cancelled", async () => {
        const items = Array.from({ length: 10 }, (_, i) => i);
        const cts = new vscode.CancellationTokenSource();
        cts.cancel();
        let processed = 0;

        const results = await runWithConcurrencyPool(
            items,
            4,
            async (item) => {
                processed++;
                return item;
            },
            undefined,
            cts.token
        );

        assert.strictEqual(processed, 0, "No processor should run for a pre-cancelled token");
        assert.strictEqual(results.length, items.length);
        assert.ok(
            results.every(
                (r) => r.status === "rejected" &&
                    (r as PromiseRejectedResult).reason instanceof ExportCancelledError
            ),
            "Every slot should be marked cancelled"
        );
        cts.dispose();
    });
});

suite("Audio Exporter - tokenToAbortSignal", () => {
    test("aborts the signal when the token is cancelled", () => {
        const cts = new vscode.CancellationTokenSource();
        const { signal, dispose } = tokenToAbortSignal(cts.token);
        assert.ok(signal, "Signal should be created for a live token");
        assert.strictEqual(signal!.aborted, false);
        cts.cancel();
        assert.strictEqual(signal!.aborted, true, "Signal should abort with the token");
        dispose();
        cts.dispose();
    });

    test("returns an already-aborted signal for a pre-cancelled token", () => {
        const cts = new vscode.CancellationTokenSource();
        cts.cancel();
        const { signal } = tokenToAbortSignal(cts.token);
        assert.ok(signal, "Signal should be created");
        assert.strictEqual(signal!.aborted, true);
        cts.dispose();
    });

    test("returns no signal when no token is provided", () => {
        const { signal, dispose } = tokenToAbortSignal(undefined);
        assert.strictEqual(signal, undefined);
        // dispose should be a safe no-op
        dispose();
    });
});

// Helper: build a minimal cell whose globalReferences carry a given ref string.
const cellWithRef = (ref: string) => ({ metadata: { data: { globalReferences: [ref] } } });

suite("Audio Exporter - parseCellIdToBookChapterVerse (issue #1055)", () => {
    test("single verse exposes verse with no verseEnd (regression)", () => {
        const { chapter, verse, verseEnd } = parseCellIdToBookChapterVerse(cellWithRef("1PE 3:1"), "x");
        assert.strictEqual(chapter, 3);
        assert.strictEqual(verse, 1);
        assert.strictEqual(verseEnd, undefined);
    });

    test("two-verse range exposes start and end", () => {
        const { chapter, verse, verseEnd } = parseCellIdToBookChapterVerse(cellWithRef("1PE 3:1-2"), "x");
        assert.strictEqual(chapter, 3);
        assert.strictEqual(verse, 1);
        assert.strictEqual(verseEnd, 2);
    });

    test("multi-verse range (3+) exposes start and end", () => {
        const { verse, verseEnd } = parseCellIdToBookChapterVerse(cellWithRef("1PE 3:1-5"), "x");
        assert.strictEqual(verse, 1);
        assert.strictEqual(verseEnd, 5);
    });

    test("numeric book prefix parses correctly", () => {
        const { book, chapter, verse, verseEnd } = parseCellIdToBookChapterVerse(cellWithRef("2CO 4:7-8"), "x");
        assert.strictEqual(book, "2CO");
        assert.strictEqual(chapter, 4);
        assert.strictEqual(verse, 7);
        assert.strictEqual(verseEnd, 8);
    });

    test("padded verse numbers are normalized (leading zeros stripped)", () => {
        const { verse, verseEnd } = parseCellIdToBookChapterVerse(cellWithRef("1PE 3:001-010"), "x");
        assert.strictEqual(verse, 1);
        assert.strictEqual(verseEnd, 10);
    });

    test("falls back to cellId when globalReferences absent", () => {
        const { chapter, verse, verseEnd } = parseCellIdToBookChapterVerse({}, "1PE 3:1-2");
        assert.strictEqual(chapter, 3);
        assert.strictEqual(verse, 1);
        assert.strictEqual(verseEnd, 2);
    });

    test("chapter-only / malformed ref degrades without NaN", () => {
        const { chapter, verse, verseEnd } = parseCellIdToBookChapterVerse(cellWithRef("GEN 1"), "x");
        assert.strictEqual(chapter, 1);
        assert.strictEqual(verse, undefined);
        assert.strictEqual(verseEnd, undefined);
    });

    // UI-merged cells keep the kept cell's single-verse globalReference but record
    // the merged span in cellLabel (e.g. "1-2"). The exporter should still see a range.
    test("merged cell: single ref + range cellLabel yields the span", () => {
        const cell = { metadata: { cellLabel: "1-2", data: { globalReferences: ["1PE 3:1"] } } };
        const { chapter, verse, verseEnd } = parseCellIdToBookChapterVerse(cell, "x");
        assert.strictEqual(chapter, 3);
        assert.strictEqual(verse, 1);
        assert.strictEqual(verseEnd, 2);
    });

    test("merged cell with multi-verse cellLabel (1-5)", () => {
        const cell = { metadata: { cellLabel: "1-5", data: { globalReferences: ["1PE 3:1"] } } };
        const { verse, verseEnd } = parseCellIdToBookChapterVerse(cell, "x");
        assert.strictEqual(verse, 1);
        assert.strictEqual(verseEnd, 5);
    });

    test("cellLabel range is ignored when it doesn't match the ref's start verse", () => {
        const cell = { metadata: { cellLabel: "1-2", data: { globalReferences: ["1PE 3:5"] } } };
        const { verse, verseEnd } = parseCellIdToBookChapterVerse(cell, "x");
        assert.strictEqual(verse, 5);
        assert.strictEqual(verseEnd, undefined);
    });

    test("non-range cellLabel leaves a single verse untouched", () => {
        const cell = { metadata: { cellLabel: "1", data: { globalReferences: ["1PE 3:1"] } } };
        const { verse, verseEnd } = parseCellIdToBookChapterVerse(cell, "x");
        assert.strictEqual(verse, 1);
        assert.strictEqual(verseEnd, undefined);
    });

    test("globalReferences range takes precedence over cellLabel", () => {
        const cell = { metadata: { cellLabel: "1-3", data: { globalReferences: ["1PE 3:1-3"] } } };
        const { verse, verseEnd } = parseCellIdToBookChapterVerse(cell, "x");
        assert.strictEqual(verse, 1);
        assert.strictEqual(verseEnd, 3);
    });
});

suite("Audio Exporter - formatChapterVerseSuffix (issue #1055)", () => {
    test("single verse -> C{ch}_V{verse}", () => {
        assert.strictEqual(formatChapterVerseSuffix(3, 1), "C3_V1");
    });

    test("verse range -> C{ch}_V{start}-{end}", () => {
        assert.strictEqual(formatChapterVerseSuffix(3, 1, 2), "C3_V1-2");
    });

    test("multi-verse range -> C{ch}_V{start}-{end}", () => {
        assert.strictEqual(formatChapterVerseSuffix(3, 1, 5), "C3_V1-5");
    });

    test("degenerate range (end === start) collapses to single verse", () => {
        assert.strictEqual(formatChapterVerseSuffix(3, 1, 1), "C3_V1");
    });

    test("chapter only -> C{ch}", () => {
        assert.strictEqual(formatChapterVerseSuffix(3, undefined), "C3");
    });

    test("no chapter -> empty string", () => {
        assert.strictEqual(formatChapterVerseSuffix(undefined, undefined), "");
    });
});
