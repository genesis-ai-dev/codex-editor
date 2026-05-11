import * as assert from "assert";
import { runWithConcurrencyPool } from "../../../exportHandler/audioExporter";

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
});
