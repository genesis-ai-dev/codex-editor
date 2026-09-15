/**
 * Worker thread entry: build Bible indexes once, then swap many study stories.
 */

import { parentPort, workerData } from "worker_threads";
import type { BibleSwapMode, SwapStats } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/types";
import type { SerializedVersificationPlan } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/index";
import {
    applyBibleSwapWithShared,
    buildBibleSwapSharedResources,
    deserializeVersificationPlan,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/index";

interface WorkerInit {
    bibleStoryXml: string;
    swapMode: BibleSwapMode;
    /** Precomputed language-mapping plan; skips per-story plan derivation. */
    serializedPlan?: SerializedVersificationPlan;
    language?: string;
    studyVolume?: string;
}

interface SwapMessage {
    type: "swap";
    studyStoryXml: string;
}

const { bibleStoryXml, swapMode, serializedPlan, language, studyVolume } =
    workerData as WorkerInit;
const shared = buildBibleSwapSharedResources(bibleStoryXml, swapMode, language);
const versificationPlan = serializedPlan
    ? deserializeVersificationPlan(serializedPlan)
    : undefined;

parentPort?.postMessage({ type: "ready" });

parentPort?.on("message", (msg: SwapMessage) => {
    if (msg.type !== "swap") return;
    const result = applyBibleSwapWithShared(
        msg.studyStoryXml,
        bibleStoryXml,
        swapMode,
        shared,
        { versificationPlan, language, studyVolume }
    );
    parentPort?.postMessage({
        type: "result",
        xml: result.xml,
        stats: result.stats,
    });
});

export type BibleSwapApplyWorkerResult = { xml: string; stats: SwapStats };
