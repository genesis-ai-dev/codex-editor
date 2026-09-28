/**
 * Reproduces the batch validation report locally for every study volume of one
 * language and prints the remaining issues with enough context to fix them.
 *
 *   BIBLE_SWAP_LANGUAGE=hindi npx vitest run .../full-validation.debug.test.ts
 *
 * Set BIBLE_SWAP_VOLUME to score a single volume.
 */
import { describe, it } from "vitest";
import {
    issueKey,
    languageFixture,
    summarizeIssues,
    swapAndValidateVolume,
    volumeFilesExist,
} from "./bibleSwapValidation";
import { normalizeValidatorText, VALIDATOR_STATUS_LABELS } from "./validatorHarness";

const LANGUAGE = process.env.BIBLE_SWAP_LANGUAGE;
const VOLUME_FILTER = process.env.BIBLE_SWAP_VOLUME;
const MAX_ISSUE_DETAILS = Number(process.env.BIBLE_SWAP_MAX_DETAILS ?? 40);

describe.skipIf(!LANGUAGE)(`full validation (${LANGUAGE})`, () => {
    const fixture = languageFixture(LANGUAGE ?? "portuguese");
    const volumes = VOLUME_FILTER
        ? fixture.volumes.filter((v) => v.volume === VOLUME_FILTER)
        : fixture.volumes;

    for (const pair of volumes) {
        it(`${pair.volume}`, async () => {
            if (!volumeFilesExist(pair, fixture.language)) {
                console.log(`SKIP ${pair.volume}: inputs missing`);
                return;
            }

            const { analysis } = await swapAndValidateVolume(pair, fixture.language);
            console.log(
                `\n===== ${pair.volume}: ${analysis.scorePercent}% accuracy, ${analysis.issueCount} issues =====`
            );
            console.log(
                `verses study=${analysis.verseCounts.study} bible=${analysis.verseCounts.bible} export=${analysis.verseCounts.export}`
            );
            console.log(summarizeIssues(analysis));

            for (const r of analysis.issues.slice(0, MAX_ISSUE_DETAILS)) {
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
