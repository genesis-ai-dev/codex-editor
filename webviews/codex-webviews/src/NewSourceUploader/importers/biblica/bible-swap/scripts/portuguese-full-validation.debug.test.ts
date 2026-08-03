/**
 * Reproduces the Portuguese batch validation report locally for every study
 * volume and prints the remaining issues with enough context to fix them.
 */
import { describe, it } from "vitest";
import {
    PORTUGUESE_VOLUMES,
    issueKey,
    summarizeIssues,
    swapAndValidateVolume,
    volumeFilesExist,
} from "./portugueseFullValidation";
import { normalizeValidatorText, VALIDATOR_STATUS_LABELS } from "./validatorHarness";

const VOLUME_FILTER = process.env.BIBLE_SWAP_VOLUME;

describe("Portuguese full validation", () => {
    const volumes = VOLUME_FILTER
        ? PORTUGUESE_VOLUMES.filter((v) => v.volume === VOLUME_FILTER)
        : PORTUGUESE_VOLUMES;

    for (const pair of volumes) {
        it(`${pair.volume}`, async () => {
            if (!volumeFilesExist(pair)) {
                console.log(`SKIP ${pair.volume}: inputs missing`);
                return;
            }

            const { analysis } = await swapAndValidateVolume(pair);
            console.log(
                `\n===== ${pair.volume}: ${analysis.scorePercent}% accuracy, ${analysis.issueCount} issues =====`
            );
            console.log(
                `verses study=${analysis.verseCounts.study} bible=${analysis.verseCounts.bible} export=${analysis.verseCounts.export}`
            );
            console.log(summarizeIssues(analysis));

            for (const r of analysis.issues) {
                const bible = normalizeValidatorText(r.bibleText);
                const exported = normalizeValidatorText(r.exportText);
                let at = 0;
                while (at < bible.length && at < exported.length && bible[at] === exported[at]) {
                    at++;
                }
                console.log(
                    `\n--- ${issueKey(r)} [${VALIDATOR_STATUS_LABELS[r.status]}] bibleLen=${bible.length} exportLen=${exported.length} divergeAt=${at}`
                );
                console.log(`  common: …${bible.slice(Math.max(0, at - 60), at)}`);
                console.log(`  bible→: ${bible.slice(at, at + 120)}`);
                console.log(`  export→: ${exported.slice(at, at + 120)}`);
            }
        }, 900000);
    }
});
