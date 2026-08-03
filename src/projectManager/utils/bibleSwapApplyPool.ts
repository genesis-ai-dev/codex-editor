/**
 * Parallel Bible Swap apply — worker pool sized like audio export (up to 30).
 */

import * as path from "path";
import { Worker } from "worker_threads";
import type { BibleSwapMode, SwapStats } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/types";
import type {
    BibleSwapSharedResources,
    SerializedVersificationPlan,
    VersificationPlan,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/index";
import {
    applyBibleSwapWithShared,
    buildBibleSwapSharedResources,
    deserializeVersificationPlan,
    findStudyBookRegions,
    scanStudyStoryForSwap,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/index";
import { bibleSwapWorkerCount } from "./bibleSwapConcurrency";

export interface BibleSwapApplyInput {
    storyKey: string;
    studyStoryXml: string;
}

export interface BibleSwapApplyOutput {
    storyKey: string;
    xml: string;
    stats: SwapStats;
}

let poolAvailable = true;

/**
 * Persistent state reused across export files in one batch. All files in a
 * batch swap against the same Bible story, so tearing workers down after each
 * file forced every worker to rebuild the Bible verse/chapter indexes per
 * file. Call `disposeBibleSwapApplyPool()` when the export batch finishes.
 */
interface PersistentPool {
    bibleStoryXml: string;
    swapMode: BibleSwapMode;
    /** Reference identity: the loader caches one object per (language, volume). */
    serializedPlan?: SerializedVersificationPlan;
    language?: string;
    studyVolume?: string;
    workers: ReadyWorker[];
}
let persistentPool: PersistentPool | null = null;

interface CachedShared {
    bibleStoryXml: string;
    swapMode: BibleSwapMode;
    language?: string;
    shared: BibleSwapSharedResources;
}
let cachedMainThreadShared: CachedShared | null = null;

/** Deserialized precomputed plan, cached by serialized-object reference. */
let cachedDeserializedPlan: {
    ref: SerializedVersificationPlan;
    plan: VersificationPlan;
} | null = null;

function getDeserializedPlan(
    serializedPlan: SerializedVersificationPlan | undefined
): VersificationPlan | undefined {
    if (!serializedPlan) return undefined;
    if (cachedDeserializedPlan?.ref !== serializedPlan) {
        cachedDeserializedPlan = {
            ref: serializedPlan,
            plan: deserializeVersificationPlan(serializedPlan),
        };
    }
    return cachedDeserializedPlan.plan;
}

/** Cheap same-Bible check: length first, then value equality (V8 memcmp). */
function isSameBible(a: string, b: string): boolean {
    return a.length === b.length && a === b;
}

function getMainThreadShared(
    bibleStoryXml: string,
    swapMode: BibleSwapMode,
    language?: string
): BibleSwapSharedResources {
    if (
        cachedMainThreadShared &&
        cachedMainThreadShared.swapMode === swapMode &&
        cachedMainThreadShared.language === language &&
        isSameBible(cachedMainThreadShared.bibleStoryXml, bibleStoryXml)
    ) {
        return cachedMainThreadShared.shared;
    }
    const shared = buildBibleSwapSharedResources(bibleStoryXml, swapMode, language);
    cachedMainThreadShared = { bibleStoryXml, swapMode, language, shared };
    return shared;
}

/** Terminate pooled workers and drop cached Bible indexes. */
export function disposeBibleSwapApplyPool(): void {
    if (persistentPool) {
        for (const w of persistentPool.workers) w.terminate();
        persistentPool = null;
    }
    cachedMainThreadShared = null;
    cachedDeserializedPlan = null;
}

async function getOrCreatePool(
    bibleStoryXml: string,
    swapMode: BibleSwapMode,
    desiredCount: number,
    serializedPlan?: SerializedVersificationPlan,
    language?: string,
    studyVolume?: string
): Promise<ReadyWorker[]> {
    if (
        persistentPool &&
        persistentPool.swapMode === swapMode &&
        persistentPool.serializedPlan === serializedPlan &&
        persistentPool.language === language &&
        persistentPool.studyVolume === studyVolume &&
        isSameBible(persistentPool.bibleStoryXml, bibleStoryXml)
    ) {
        if (persistentPool.workers.length < desiredCount) {
            const extra = await Promise.all(
                Array.from(
                    { length: desiredCount - persistentPool.workers.length },
                    () =>
                        createReadyWorker(
                            bibleStoryXml,
                            swapMode,
                            serializedPlan,
                            language,
                            studyVolume
                        )
                )
            );
            persistentPool.workers.push(...extra);
        }
        return persistentPool.workers;
    }

    disposeBibleSwapApplyPool();
    const workers = await Promise.all(
        Array.from({ length: desiredCount }, () =>
            createReadyWorker(
                bibleStoryXml,
                swapMode,
                serializedPlan,
                language,
                studyVolume
            )
        )
    );
    persistentPool = {
        bibleStoryXml,
        swapMode,
        serializedPlan,
        language,
        studyVolume,
        workers,
    };
    return workers;
}

function applyWorkerScriptPath(): string {
    return path.join(__dirname, "bibleSwapApplyWorker.js");
}

interface ReadyWorker {
    worker: Worker;
    swap: (studyStoryXml: string) => Promise<{ xml: string; stats: SwapStats }>;
    terminate: () => void;
}

function createReadyWorker(
    bibleStoryXml: string,
    swapMode: BibleSwapMode,
    serializedPlan?: SerializedVersificationPlan,
    language?: string,
    studyVolume?: string
): Promise<ReadyWorker> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(applyWorkerScriptPath(), {
            workerData: { bibleStoryXml, swapMode, serializedPlan, language, studyVolume },
        });

        let settled = false;
        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            void worker.terminate();
            reject(err);
        };

        worker.once("message", (msg: { type: string }) => {
            if (msg.type !== "ready") {
                fail(new Error("Bible swap apply worker did not send ready signal"));
                return;
            }
            settled = true;

            let pendingResolve: ((value: { xml: string; stats: SwapStats }) => void) | null =
                null;
            let pendingReject: ((err: Error) => void) | null = null;

            worker.on("message", (result: { type: string; xml?: string; stats?: SwapStats }) => {
                if (result.type !== "result" || !pendingResolve) return;
                pendingResolve({
                    xml: result.xml ?? "",
                    stats: result.stats ?? {
                        replacedCount: 0,
                        skippedPsa: 0,
                        psalmSubheaderOffsets: 0,
                        psalmVersesInserted: 0,
                        missingFromBible: [],
                        extraInBibleAppended: [],
                    },
                });
                pendingResolve = null;
                pendingReject = null;
            });

            worker.on("error", (err) => {
                if (pendingReject) {
                    pendingReject(err);
                    pendingResolve = null;
                    pendingReject = null;
                }
            });

            resolve({
                worker,
                swap: (studyStoryXml: string) =>
                    new Promise<{ xml: string; stats: SwapStats }>((res, rej) => {
                        pendingResolve = res;
                        pendingReject = rej;
                        worker.postMessage({ type: "swap", studyStoryXml });
                    }),
                terminate: () => {
                    void worker.terminate();
                },
            });
        });

        worker.once("error", fail);
        worker.once("exit", (code) => {
            if (code !== 0 && !settled) {
                fail(new Error(`Bible swap apply worker exited with code ${code}`));
            }
        });
    });
}

function applySwapOnMainThread(
    studyStoryXml: string,
    bibleStoryXml: string,
    swapMode: BibleSwapMode,
    shared: BibleSwapSharedResources,
    versificationPlan?: VersificationPlan,
    language?: string,
    studyVolume?: string
): { xml: string; stats: SwapStats } {
    const totalStarted = Date.now();
    const regions = findStudyBookRegions(studyStoryXml);
    const scanStarted = Date.now();
    const studyScan = scanStudyStoryForSwap(studyStoryXml);
    const scanMs = Date.now() - scanStarted;
    const swapStarted = Date.now();
    const result = applyBibleSwapWithShared(
        studyStoryXml,
        bibleStoryXml,
        swapMode,
        shared,
        { studyScan, versificationPlan, language, studyVolume }
    );
    const swapMs = Date.now() - swapStarted;
    console.log(
        `[BibleSwapApply] ${regions.length} book region(s): scan ${scanMs}ms, swap ${swapMs}ms, ` +
            `total ${Date.now() - totalStarted}ms, study ${(studyStoryXml.length / 1_000_000).toFixed(1)}MB`
    );
    return result;
}

async function applyBibleSwapStoriesMainThread(
    bibleStoryXml: string,
    swapMode: BibleSwapMode,
    tasks: BibleSwapApplyInput[],
    serializedPlan?: SerializedVersificationPlan,
    language?: string,
    studyVolume?: string
): Promise<BibleSwapApplyOutput[]> {
    const shared = getMainThreadShared(bibleStoryXml, swapMode, language);
    const plan = getDeserializedPlan(serializedPlan);
    return tasks.map((task) => {
        const { xml, stats } = applySwapOnMainThread(
            task.studyStoryXml,
            bibleStoryXml,
            swapMode,
            shared,
            plan,
            language,
            studyVolume
        );
        return { storyKey: task.storyKey, xml, stats };
    });
}

/**
 * Swap study story XML files in parallel using a bounded worker pool.
 * `serializedPlan` (precomputed language mapping) is sent to each worker at
 * init so per-story plan derivation is skipped everywhere.
 */
export async function applyBibleSwapStoriesParallel(
    bibleStoryXml: string,
    swapMode: BibleSwapMode,
    tasks: BibleSwapApplyInput[],
    serializedPlan?: SerializedVersificationPlan,
    language?: string,
    studyVolume?: string
): Promise<BibleSwapApplyOutput[]> {
    if (tasks.length === 0) return [];

    if (!poolAvailable) {
        return applyBibleSwapStoriesMainThread(
            bibleStoryXml,
            swapMode,
            tasks,
            serializedPlan,
            language,
            studyVolume
        );
    }

    try {
        // Pentateuch volumes are one huge story file — worker startup + full XML
        // copies per region were slower than a single main-thread scan. The
        // cached shared resources make repeat files in a batch nearly free.
        if (tasks.length === 1) {
            const task = tasks[0];
            const shared = getMainThreadShared(bibleStoryXml, swapMode, language);
            const { xml, stats } = applySwapOnMainThread(
                task.studyStoryXml,
                bibleStoryXml,
                swapMode,
                shared,
                getDeserializedPlan(serializedPlan),
                language,
                studyVolume
            );
            return [{ storyKey: task.storyKey, xml, stats }];
        }

        const workerCount = bibleSwapWorkerCount(tasks.length);
        const workers = await getOrCreatePool(
            bibleStoryXml,
            swapMode,
            workerCount,
            serializedPlan,
            language,
            studyVolume
        );

        const results: BibleSwapApplyOutput[] = new Array(tasks.length);
        let nextTask = 0;

        await Promise.all(
            workers.map(async (w) => {
                while (true) {
                    const index = nextTask;
                    nextTask += 1;
                    if (index >= tasks.length) break;
                    const task = tasks[index];
                    const { xml, stats } = await w.swap(task.studyStoryXml);
                    results[index] = { storyKey: task.storyKey, xml, stats };
                }
            })
        );

        return results;
    } catch (err) {
        poolAvailable = false;
        disposeBibleSwapApplyPool();
        console.warn(
            "[BibleSwapApply] Worker pool failed; falling back to main thread:",
            err
        );
        return applyBibleSwapStoriesMainThread(
            bibleStoryXml,
            swapMode,
            tasks,
            serializedPlan,
            language,
            studyVolume
        );
    }
}
