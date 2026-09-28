/**
 * Regenerates the shipped versification mappings for one language against the
 * Bible IDMLs registered in `bibleSwapValidation.ts`.
 *
 *   BIBLE_SWAP_LANGUAGE=marathi npx vitest run .../regenerate-mappings.debug.test.ts
 *
 * Set BIBLE_SWAP_VOLUMES to a comma-separated list to rebuild only some volumes
 * (the language summary is then left untouched, since it would be incomplete).
 */
import { describe, it } from "vitest";
import { languageFixture, volumeFilesExist } from "./bibleSwapValidation";
import { generateMappingForVolume, writeLanguageSummary, writeMapping } from "./mappingGenerator";
import type { WrittenMapping } from "./mappingGenerator";

const LANGUAGE = process.env.BIBLE_SWAP_LANGUAGE;
const VOLUME_FILTER = process.env.BIBLE_SWAP_VOLUMES?.split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);

describe.skipIf(!LANGUAGE)(`regenerate mappings (${LANGUAGE})`, () => {
    it("writes mapping.json + mapping.md for every volume", async () => {
        const fixture = languageFixture(LANGUAGE!);
        const rows: WrittenMapping[] = [];

        for (const pair of fixture.volumes) {
            if (VOLUME_FILTER && !VOLUME_FILTER.includes(pair.volume)) continue;
            if (!volumeFilesExist(pair, fixture.language)) {
                console.log(`SKIP ${pair.volume}: inputs missing`);
                continue;
            }
            const generated = await generateMappingForVolume(fixture.language, pair);
            const row = writeMapping(fixture.language, generated);
            rows.push(row);
            console.log(
                `${row.volume.padEnd(9)} ${String(row.projectedMatchPercent).padStart(6)}%  ` +
                    `mapped=${row.versesMapped} removed=${row.versesRemoved} inserted=${row.versesInserted}  ` +
                    `bible=${row.bibleFile} (${row.elapsedSeconds}s)`
            );
        }

        if (VOLUME_FILTER) {
            console.log(`Partial run (${VOLUME_FILTER.join(",")}) — summary not rewritten`);
        } else {
            writeLanguageSummary(fixture.language, rows);
        }
    }, 1800000);
});
