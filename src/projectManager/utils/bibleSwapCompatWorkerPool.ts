/**
 * Pool helper: run compat verse indexing in worker threads when available.
 */

import * as path from "path";
import { Worker } from "worker_threads";
import { bibleSwapWorkerCount, runWithConcurrency } from "./bibleSwapConcurrency";
import type {
    CompatVerseIndex,
    CompatVerseIndexSerialized,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/compatVerseIndex";
import {
    buildCompatVerseIndex,
    deserializeCompatVerseIndex,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/compatVerseIndex";

export interface CompatIndexTask {
    storyXml: string;
    indexBibleSubheaders?: boolean;
}

/** Minimum Story XML size where worker thread startup is worth the overhead. */
const WORKER_MIN_XML_CHARS = 50_000;

let workersAvailable = true;

function workerScriptPath(): string {
    return path.join(__dirname, "bibleSwapCompatWorker.js");
}

function buildCompatVerseIndexInWorker(task: CompatIndexTask): Promise<CompatVerseIndex> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerScriptPath(), {
            workerData: {
                storyXml: task.storyXml,
                indexBibleSubheaders: task.indexBibleSubheaders ?? false,
            },
        });

        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            void worker.terminate();
            fn();
        };

        worker.once("message", (msg: CompatVerseIndexSerialized) => {
            finish(() => resolve(deserializeCompatVerseIndex(msg)));
        });
        worker.once("error", (err) => {
            finish(() => reject(err));
        });
        worker.once("exit", (code) => {
            if (code !== 0) {
                finish(() =>
                    reject(new Error(`Bible swap compat worker exited with code ${code}`))
                );
            }
        });
    });
}

/**
 * Build one compat index, using a worker thread for large Story XML payloads.
 */
export async function buildCompatVerseIndexAsync(
    task: CompatIndexTask
): Promise<CompatVerseIndex> {
    const useWorker =
        workersAvailable && task.storyXml.length >= WORKER_MIN_XML_CHARS;

    if (!useWorker) {
        return buildCompatVerseIndex(task.storyXml, {
            indexBibleSubheaders: task.indexBibleSubheaders,
        });
    }

    try {
        return await buildCompatVerseIndexInWorker(task);
    } catch (err) {
        workersAvailable = false;
        console.warn(
            "[BibleSwapCompatibility] Worker indexing failed; falling back to main thread:",
            err
        );
        return buildCompatVerseIndex(task.storyXml, {
            indexBibleSubheaders: task.indexBibleSubheaders,
        });
    }
}

/**
 * Build multiple compat indexes in parallel (I/O already done — CPU-bound parse).
 */
export async function buildCompatVerseIndexesParallel(
    tasks: CompatIndexTask[]
): Promise<CompatVerseIndex[]> {
    const concurrency = bibleSwapWorkerCount(tasks.length);
    return runWithConcurrency(tasks, concurrency, (task) =>
        buildCompatVerseIndexAsync(task)
    );
}
