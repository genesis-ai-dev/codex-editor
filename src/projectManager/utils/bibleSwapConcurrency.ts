import os from "os";

/** Match audio export download pool sizing (see audioExporter.ts). */
export const BIBLE_SWAP_WORKER_CONCURRENCY = 30;

export function bibleSwapWorkerCount(taskCount: number): number {
    const cpus = Math.max(1, os.cpus().length);
    return Math.min(BIBLE_SWAP_WORKER_CONCURRENCY, cpus, Math.max(1, taskCount));
}

/**
 * Sliding-window async pool — keeps `concurrency` tasks in flight at once.
 */
export async function runWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) return [];

    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const runWorker = async (): Promise<void> => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await fn(items[index], index);
        }
    };

    const workerCount = Math.min(Math.max(1, concurrency), items.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}
