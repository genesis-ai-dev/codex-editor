/**
 * Worker: build versification plan + change list for one Study story XML.
 */

import { parentPort, workerData } from "worker_threads";
import { buildBibleVerseIndex } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/surgicalSwap";
import {
    buildVersificationPlanFromIndices,
    collectVersificationChanges,
    type VersificationPlanStats,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/versificationPlan";
import type { BibleSwapVersificationChanges } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/versificationPlan";
import {
    deserializeBibleVerseIndexForAnalysis,
    type SerializedBibleVerseIndex,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/bibleVerseIndexSerialize";
import { listVerseKeys } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/surgicalSwap";

interface WorkerInput {
    studyStoryXml: string;
    bibleIndexSerialized: SerializedBibleVerseIndex;
}

interface WorkerOutput {
    stats: VersificationPlanStats;
    studyVerseCount: number;
    changes: BibleSwapVersificationChanges;
}

const input = workerData as WorkerInput;
const bibleIndex = deserializeBibleVerseIndexForAnalysis(input.bibleIndexSerialized);
const studyIndex = buildBibleVerseIndex(input.studyStoryXml);
const plan = buildVersificationPlanFromIndices(
    input.studyStoryXml,
    studyIndex,
    bibleIndex
);
const changes = collectVersificationChanges(plan, studyIndex, bibleIndex);

const output: WorkerOutput = {
    stats: plan.stats,
    studyVerseCount: listVerseKeys(studyIndex).length,
    changes,
};
parentPort?.postMessage(output);
