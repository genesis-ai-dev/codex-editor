/**
 * Diagnoses the remaining Marathi structure-swap gaps (EST 8/9, 1CO 10, 2TI 3,
 * 1TI 6): what the precomputed plan says for the chapter, which study spans the
 * structure swap sees, and which Bible slice each span resolves to.
 */
import { describe, it } from "vitest";
import {
    MARATHI_VOLUMES,
    loadMainStory,
    loadMappingDocument,
    volumeFilesExist,
    volumePaths,
} from "./bibleSwapValidation";
import {
    applyBibleSwapWithShared,
    buildBibleSwapSharedResources,
    deserializeVersificationPlan,
    bibleSlicesForStudyRange,
} from "../index";
import { buildBibleChapterBlockIndex } from "../structureSwap";
import { buildChapterSpanIndex, extractSliceByVerseRange } from "../chapterBlocks";
import { collectContentText } from "../surgicalSwap";
import { chapterBlockKey, verseKey } from "../types";
import { marathiStrategy } from "../language-mappings/strategies/marathi";
import { parseValidatorStory } from "./validatorHarness";

interface Target {
    volume: string;
    book: string;
    chapter: string;
    verses: string[];
}

const TARGETS: Target[] = [
    { volume: "JOS-EST", book: "EST", chapter: "8", verses: ["14", "15", "16", "17"] },
    { volume: "JOS-EST", book: "EST", chapter: "9", verses: ["19", "20", "31", "32"] },
    { volume: "ACT-REV", book: "1CO", chapter: "10", verses: ["4", "5", "6", "12", "13", "14"] },
    { volume: "ACT-REV", book: "2TI", chapter: "3", verses: ["8", "9", "10", "16", "17"] },
    { volume: "ACT-REV", book: "1TI", chapter: "6", verses: ["19", "20", "21"] },
];

const preview = (xml: string, max = 90) =>
    collectContentText(xml, 0, xml.length).replace(/\s+/g, " ").slice(0, max);

describe("Marathi plan gap diagnostics", () => {
    for (const volume of [...new Set(TARGETS.map((t) => t.volume))]) {
        it(`${volume}`, async () => {
            const pair = MARATHI_VOLUMES.find((v) => v.volume === volume);
            if (!pair || !volumeFilesExist(pair, "marathi")) return;

            const { study, bible } = volumePaths(pair, "marathi");
            const studyXml = await loadMainStory(study);
            const bibleXml = await loadMainStory(bible);
            const plan = deserializeVersificationPlan(
                loadMappingDocument("marathi", volume).plan
            );
            const shared = buildBibleSwapSharedResources(bibleXml, "structure", "marathi");
            const { xml: exportXml } = applyBibleSwapWithShared(
                studyXml,
                bibleXml,
                "structure",
                shared,
                { versificationPlan: plan, language: "marathi", studyVolume: volume }
            );

            const bibleBlocks = buildBibleChapterBlockIndex(
                bibleXml,
                marathiStrategy.chapterBlockOptions
            );
            const studySpans = buildChapterSpanIndex(studyXml, marathiStrategy.chapterBlockOptions);
            const bibleV = parseValidatorStory(bibleXml).verses;
            const exportV = parseValidatorStory(exportXml).verses;

            for (const t of TARGETS.filter((x) => x.volume === volume)) {
                const key = chapterBlockKey(t.book, t.chapter);
                console.log(`\n@@@@@@ ${volume} ${t.book} ${t.chapter}`);
                console.log(
                    `  plan.structureChapters=${JSON.stringify(plan.structureChapters.get(key) ?? null)}`
                );
                console.log(
                    `  plan.chapterInserts=${JSON.stringify(plan.chapterInserts.get(key) ?? [])}`
                );

                const block = bibleBlocks.get(key);
                console.log(
                    `  bibleBlock: ${block ? `verses ${block.firstVerse}-${block.lastVerse} len=${block.blockXml.length}` : "MISSING"}`
                );

                const spans = studySpans.get(key) ?? [];
                console.log(`  study spans (${spans.length}):`);
                for (const [i, span] of spans.entries()) {
                    const slices = bibleSlicesForStudyRange(
                        plan,
                        t.book,
                        t.chapter,
                        span.firstVerse,
                        span.lastVerse
                    );
                    console.log(
                        `    span[${i}] study ${span.firstVerse}-${span.lastVerse} len=${span.blockXml.length} → slices=${JSON.stringify(slices)}`
                    );
                    if (block) {
                        for (const s of slices) {
                            const sliceXml = extractSliceByVerseRange(
                                block.blockXml,
                                s.firstVerse,
                                s.lastVerse
                            );
                            console.log(
                                `        slice ${s.chapter}:${s.firstVerse}-${s.lastVerse} len=${sliceXml.length} :: ${JSON.stringify(preview(sliceXml))}`
                            );
                        }
                    }
                }

                for (const v of t.verses) {
                    const k = verseKey(t.book, t.chapter, v);
                    const vk = `${t.book}_${t.chapter}:${v}`;
                    console.log(
                        `  ${t.book} ${t.chapter}:${v} plan=${JSON.stringify(plan.verseMap.get(k) ?? null)}` +
                            ` bible=${JSON.stringify((bibleV[vk]?.text ?? "").slice(0, 30))}` +
                            ` export=${JSON.stringify((exportV[vk]?.text ?? "").slice(0, 30))}`
                    );
                }
            }
        }, 1800000);
    }
});
