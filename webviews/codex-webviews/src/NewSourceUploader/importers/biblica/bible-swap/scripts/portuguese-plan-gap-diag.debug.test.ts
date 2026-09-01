/**
 * Diagnoses the plan-driven Portuguese failures (RUT 4:22 insert, LAM 1:22
 * dropped verse, HAB 3:1/3:19): what the precomputed plan says for the chapter,
 * what the Bible chapter block holds, and what the export ends up with.
 */
import { describe, it } from "vitest";
import {
    PORTUGUESE_VOLUMES,
    loadMainStory,
    loadMappingDocument,
    volumeFilesExist,
    volumePaths,
} from "./bibleSwapValidation";
import { parseValidatorStory } from "./validatorHarness";
import {
    applyBibleSwapWithShared,
    buildBibleSwapSharedResources,
    deserializeVersificationPlan,
} from "../index";
import { buildBibleChapterBlockIndex } from "../structureSwap";
import { extractSliceByVerseRange, getVerseNumbersInRegion } from "../chapterBlocks";
import { buildBibleVerseIndex } from "../surgicalSwap";
import { getParagraphIndex } from "../paragraphIndex";
import { collectContentText } from "../surgicalSwap";
import { chapterBlockKey, verseKey } from "../types";
import { portugueseStrategy } from "../language-mappings/strategies/portuguese";

interface Target {
    volume: string;
    book: string;
    chapter: string;
    verses: string[];
    /** Bible text expected in the export; located in the swapped XML for context. */
    needle: string;
}

const TARGETS: Target[] = [
    {
        volume: "JOS-EST",
        book: "RUT",
        chapter: "4",
        verses: ["20", "21", "22"],
        needle: "gerou Jess",
    },
    {
        volume: "ISA-MAL",
        book: "LAM",
        chapter: "1",
        verses: ["20", "21", "22"],
        needle: "toda a maldade deles",
    },
    {
        volume: "ISA-MAL",
        book: "HAB",
        chapter: "3",
        verses: ["1", "2", "18", "19"],
        needle: "instrumentos de cordas",
    },
];

describe("Portuguese plan gap diagnostics", () => {
    const volumes = [...new Set(TARGETS.map((t) => t.volume))];

    for (const volume of volumes) {
        it(`${volume}`, async () => {
            const pair = PORTUGUESE_VOLUMES.find((v) => v.volume === volume);
            if (!pair || !volumeFilesExist(pair)) return;

            const { study, bible } = volumePaths(pair);
            const studyXml = await loadMainStory(study);
            const bibleXml = await loadMainStory(bible);
            const plan = deserializeVersificationPlan(
                loadMappingDocument("portuguese", volume).plan
            );
            const strategy = portugueseStrategy;
            const shared = buildBibleSwapSharedResources(bibleXml, "structure", "portuguese");
            const { xml: exportXml } = applyBibleSwapWithShared(
                studyXml,
                bibleXml,
                "structure",
                shared,
                { versificationPlan: plan, language: "portuguese", studyVolume: volume }
            );

            const bibleBlocks = buildBibleChapterBlockIndex(
                bibleXml,
                strategy.chapterBlockOptions
            );
            const bibleIndex = buildBibleVerseIndex(bibleXml);
            const studyV = parseValidatorStory(studyXml).verses;
            const bibleV = parseValidatorStory(bibleXml).verses;
            const exportV = parseValidatorStory(exportXml).verses;

            for (const t of TARGETS.filter((x) => x.volume === volume)) {
                const key = chapterBlockKey(t.book, t.chapter);
                console.log(`\n@@@@@@ ${volume} ${t.book} ${t.chapter}`);
                console.log(
                    `  plan.chapterInserts[${key}]=${JSON.stringify(plan.chapterInserts.get(key) ?? [])}`
                );
                console.log(
                    `  plan.structureChapters[${key}]=${JSON.stringify(plan.structureChapters.get(key) ?? null)}`
                );
                const block = bibleBlocks.get(key);
                console.log(
                    `  bibleBlock: ${block ? `verses ${block.firstVerse}-${block.lastVerse} len=${block.blockXml.length}` : "MISSING"}`
                );
                if (block) {
                    const paras = getParagraphIndex(block.blockXml);
                    paras.forEach((p, i) => {
                        const style = p.appliedParagraphStyle.replace(/^ParagraphStyle\//, "");
                        const text = collectContentText(block.blockXml, p.bodyStart, p.bodyEnd)
                            .replace(/\s+/g, " ")
                            .slice(0, 60);
                        if (i < 2 || i >= paras.length - 4) {
                            console.log(`    block para[${i}] ${style} :: ${JSON.stringify(text)}`);
                        }
                    });
                }

                if (block) {
                    const mainSlice = extractSliceByVerseRange(
                        block.blockXml,
                        Number(t.verses[0]),
                        Number(t.verses[t.verses.length - 1]) - 1
                    );
                    const lastVerse = Number(t.verses[t.verses.length - 1]);
                    const tailSlice = extractSliceByVerseRange(
                        block.blockXml,
                        lastVerse,
                        lastVerse
                    );
                    const tail = (xml: string) =>
                        collectContentText(xml, 0, xml.length)
                            .replace(/[\u00ad\u2011]/g, "")
                            .replace(/\s+/g, " ")
                            .slice(-90);
                    console.log(`  slice(..${lastVerse - 1}) tail=${JSON.stringify(tail(mainSlice))}`);
                    console.log(`  slice(${lastVerse}) len=${tailSlice.length} text=${JSON.stringify(tail(tailSlice))}`);
                }

                const exportParas = getParagraphIndex(exportXml);
                const hitIdx = exportParas.findIndex((p) =>
                    collectContentText(exportXml, p.bodyStart, p.bodyEnd)
                        .replace(/[\u00ad\u2011]/g, "")
                        .includes(t.needle)
                );
                console.log(`  export needle ${JSON.stringify(t.needle)} → paragraph ${hitIdx}`);
                for (let i = Math.max(0, hitIdx - 1); hitIdx >= 0 && i <= Math.min(exportParas.length - 1, hitIdx + 1); i++) {
                    const p = exportParas[i];
                    console.log(
                        `    export para[${i}] ${p.appliedParagraphStyle.replace(/^ParagraphStyle\//, "")} v=[${getVerseNumbersInRegion(exportXml, p.bodyStart, p.bodyEnd).join(",")}] :: ${JSON.stringify(
                            collectContentText(exportXml, p.bodyStart, p.bodyEnd)
                                .replace(/[\u00ad\u2011]/g, "")
                                .replace(/\s+/g, " ")
                                .slice(0, 110)
                        )}`
                    );
                }

                for (const v of t.verses) {
                    const k = verseKey(t.book, t.chapter, v);
                    const vk = `${t.book}_${t.chapter}:${v}`;
                    const idx = bibleIndex.get(k);
                    console.log(
                        `  ${t.book} ${t.chapter}:${v} plan=${JSON.stringify(plan.verseMap.get(k) ?? null)}`
                    );
                    console.log(
                        `      bibleIndex=${idx ? `subheader=${idx.isSubheader} text=${JSON.stringify(idx.text.slice(0, 50))}` : "MISSING"}`
                    );
                    console.log(
                        `      validator study=${JSON.stringify((studyV[vk]?.text ?? "").slice(0, 45))}`
                    );
                    console.log(
                        `      validator bible=${JSON.stringify((bibleV[vk]?.text ?? "").slice(0, 45))} paraStyle=${bibleV[vk]?.paraStyle ?? "-"}`
                    );
                    console.log(
                        `      validator export=${JSON.stringify((exportV[vk]?.text ?? "").slice(0, 45))} paraStyle=${exportV[vk]?.paraStyle ?? "-"}`
                    );
                }
            }
        }, 1800000);
    }
});
