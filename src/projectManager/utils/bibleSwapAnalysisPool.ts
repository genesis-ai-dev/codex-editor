/**
 * Parallel Bible Swap analysis helpers (worker threads + progress).
 */

import * as path from "path";
import { Worker } from "worker_threads";
import type {
    BibleSwapVersificationChanges,
    VersificationPlanStats,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/versificationPlan";
import type { SerializedBibleVerseIndex } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/bibleVerseIndexSerialize";
import {
    buildCompatVerseIndexAsync,
    type CompatIndexTask,
} from "./bibleSwapCompatWorkerPool";
import { bibleSwapWorkerCount, runWithConcurrency } from "./bibleSwapConcurrency";

export interface BibleSwapAnalysisProgress {
    stage: "loading" | "indexing" | "planning" | "summarizing";
    percent: number;
    message: string;
    current?: number;
    total?: number;
}

export type BibleSwapProgressCallback = (progress: BibleSwapAnalysisProgress) => void;

export interface VersificationPlanWorkerResult {
    stats: VersificationPlanStats;
    studyVerseCount: number;
    changes: BibleSwapVersificationChanges;
}

let workersAvailable = true;

function verseIndexWorkerPath(): string {
    return path.join(__dirname, "bibleSwapVerseIndexWorker.js");
}

function planWorkerPath(): string {
    return path.join(__dirname, "bibleSwapPlanWorker.js");
}

function runWorker<TInput, TOutput>(scriptPath: string, workerData: TInput): Promise<TOutput> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(scriptPath, { workerData });
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            void worker.terminate();
            fn();
        };

        worker.once("message", (msg: TOutput) => {
            finish(() => resolve(msg));
        });
        worker.once("error", (err) => {
            finish(() => reject(err));
        });
        worker.once("exit", (code) => {
            if (code !== 0) {
                finish(() =>
                    reject(new Error(`Bible swap worker exited with code ${code}`))
                );
            }
        });
    });
}

export async function buildSerializedBibleVerseIndex(
    bibleStoryXml: string
): Promise<SerializedBibleVerseIndex> {
    if (!workersAvailable || bibleStoryXml.length < 10_000) {
        const { buildBibleVerseIndex } = await import(
            "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/surgicalSwap"
        );
        const { serializeBibleVerseIndexForAnalysis } = await import(
            "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/bibleVerseIndexSerialize"
        );
        return serializeBibleVerseIndexForAnalysis(
            buildBibleVerseIndex(bibleStoryXml)
        );
    }

    try {
        return await runWorker<
            { storyXml: string; indexBibleSubheaders?: boolean },
            SerializedBibleVerseIndex
        >(verseIndexWorkerPath(), {
            storyXml: bibleStoryXml,
            indexBibleSubheaders: true,
        });
    } catch (err) {
        workersAvailable = false;
        console.warn(
            "[BibleSwapAnalysis] Verse index worker failed; falling back to main thread:",
            err
        );
        return buildSerializedBibleVerseIndex(bibleStoryXml);
    }
}

export async function buildVersificationPlanInWorker(
    studyStoryXml: string,
    bibleIndexSerialized: SerializedBibleVerseIndex
): Promise<VersificationPlanWorkerResult> {
    const {
        buildVersificationPlanFromIndices,
        collectVersificationChanges,
    } = await import(
        "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/versificationPlan"
    );
    const { buildBibleVerseIndex, listVerseKeys } = await import(
        "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/surgicalSwap"
    );
    const { deserializeBibleVerseIndexForAnalysis } = await import(
        "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/bibleVerseIndexSerialize"
    );

    const fallback = (): VersificationPlanWorkerResult => {
        const bibleIndex = deserializeBibleVerseIndexForAnalysis(bibleIndexSerialized);
        const studyIndex = buildBibleVerseIndex(studyStoryXml);
        const plan = buildVersificationPlanFromIndices(
            studyStoryXml,
            studyIndex,
            bibleIndex
        );
        return {
            stats: plan.stats,
            studyVerseCount: listVerseKeys(studyIndex).length,
            changes: collectVersificationChanges(plan, studyIndex, bibleIndex),
        };
    };

    if (!workersAvailable || studyStoryXml.length < 10_000) {
        return fallback();
    }

    try {
        return await runWorker<
            { studyStoryXml: string; bibleIndexSerialized: SerializedBibleVerseIndex },
            VersificationPlanWorkerResult
        >(planWorkerPath(), { studyStoryXml, bibleIndexSerialized });
    } catch (err) {
        workersAvailable = false;
        console.warn(
            "[BibleSwapAnalysis] Plan worker failed; falling back to main thread:",
            err
        );
        return fallback();
    }
}

export async function buildCompatVerseIndexesWithProgress(
    tasks: CompatIndexTask[],
    onProgress?: BibleSwapProgressCallback
): Promise<import("../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/compatVerseIndex").CompatVerseIndex[]> {
    const total = tasks.length;
    let completed = 0;

    const concurrency = bibleSwapWorkerCount(total);

    const results = await runWithConcurrency(tasks, concurrency, async (task) => {
        const index = await buildCompatVerseIndexAsync(task);
        completed++;
        onProgress?.({
            stage: "indexing",
            percent: 25 + Math.round((completed / total) * 20),
            message: `Indexed ${completed} of ${total} files`,
            current: completed,
            total,
        });
        return index;
    });

    return results;
}

export async function buildVersificationPlansParallel(
    studyStoryXmls: string[],
    bibleIndexSerialized: SerializedBibleVerseIndex,
    onProgress?: BibleSwapProgressCallback
): Promise<VersificationPlanWorkerResult[]> {
    const total = studyStoryXmls.length;
    if (total === 0) return [];

    let completed = 0;
    const concurrency = bibleSwapWorkerCount(total);

    const results = await runWithConcurrency(
        studyStoryXmls,
        concurrency,
        async (studyStoryXml) => {
            const result = await buildVersificationPlanInWorker(
                studyStoryXml,
                bibleIndexSerialized
            );
            completed++;
            onProgress?.({
                stage: "planning",
                percent: 50 + Math.round((completed / total) * 40),
                message: `Planned ${completed} of ${total} study files`,
                current: completed,
                total,
            });
            return result;
        }
    );

    return results;
}
