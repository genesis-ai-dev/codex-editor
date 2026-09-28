/**
 * Worker: build full Bible verse index off the main thread.
 */

import { parentPort, workerData } from "worker_threads";
import { buildBibleVerseIndex } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/surgicalSwap";
import {
    serializeBibleVerseIndexForAnalysis,
    type SerializedBibleVerseIndex,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/bibleVerseIndexSerialize";

interface WorkerInput {
    storyXml: string;
    indexBibleSubheaders?: boolean;
}

const input = workerData as WorkerInput;
const index = buildBibleVerseIndex(input.storyXml);
const serialized: SerializedBibleVerseIndex = serializeBibleVerseIndexForAnalysis(index);
parentPort?.postMessage(serialized);
