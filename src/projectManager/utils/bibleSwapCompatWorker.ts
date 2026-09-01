/**
 * Worker thread entry: build a lightweight compat verse index off the
 * extension host main thread so Bible Swap analysis stays responsive.
 */

import { parentPort, workerData } from "worker_threads";
import {
    buildCompatVerseIndex,
    serializeCompatVerseIndex,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/compatVerseIndex";

interface WorkerInput {
    storyXml: string;
    indexBibleSubheaders?: boolean;
}

const input = workerData as WorkerInput;
const index = buildCompatVerseIndex(input.storyXml, {
    indexBibleSubheaders: input.indexBibleSubheaders ?? false,
});
parentPort?.postMessage(serializeCompatVerseIndex(index));
