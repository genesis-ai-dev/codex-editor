/**
 * Portuguese precomputed-plan diagnostic for the 2026-07-27 validation clusters.
 * Uses shipped language mapping + automated_app IDMLs.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    deserializeVersificationPlan,
    bibleSlicesForStudyRange,
    extractBibleXmlForSlices,
    type BibleSwapMappingDocument,
} from "../index";
import { buildBibleVerseIndex, listVerseKeys } from "../surgicalSwap";
import { buildChapterSpanIndex } from "../chapterBlocks";
import { buildStructureSwapSplices, coalesceParagraphSplices, normalizeOverlappingSplices } from "../structureSwap";

const BASE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/File Testing/automated_app";
const STUDY_JOS = `${BASE}/english_bsb/JOS-EST.idml`;
const BIBLE_JOS = `${BASE}/translated_bible/portuguese/06JOS-17EST_portuguese.idml`;
const STUDY_ISA = `${BASE}/english_bsb/ISA-MAL.idml`;
const BIBLE_ISA = `${BASE}/translated_bible/portuguese/23ISA-39MAL_portuguese.idml`;
const STUDY_ACT = `${BASE}/english_bsb/ACT-REV.idml`;
const BIBLE_ACT = `${BASE}/translated_bible/portuguese/44ACT-66REV_portuguese.idml`;

const MAP_ROOT = path.join(__dirname, "..", "language-mappings", "portuguese");

function loadPlan(volume: string) {
    const doc = JSON.parse(
        fs.readFileSync(path.join(MAP_ROOT, `${volume}.mapping.json`), "utf-8")
    ) as BibleSwapMappingDocument;
    return deserializeVersificationPlan(doc.plan);
}

async function loadMainStory(idmlPath: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(idmlPath)));
    let xml = "";
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.length > xml.length) xml = t;
    }
    return xml;
}

function chapterVerses(
    idx: ReturnType<typeof buildBibleVerseIndex>,
    book: string,
    ch: string
): number[] {
    return listVerseKeys(idx)
        .filter((k) => k.startsWith(`${book}|${ch}|`))
        .map((k) => parseInt(k.split("|")[2], 10))
        .sort((a, b) => a - b);
}

describe("Portuguese precomputed plan validation clusters", () => {
    it("JOS-EST: NEH 8 / 1SA 7 / RUT 4:22 / 2CH 36 with precomputed plan", async () => {
        if (!fs.existsSync(STUDY_JOS) || !fs.existsSync(BIBLE_JOS)) return;

        const study = await loadMainStory(STUDY_JOS);
        const bible = await loadMainStory(BIBLE_JOS);
        const plan = loadPlan("JOS-EST");
        const blocks = buildBibleChapterBlockIndex(bible);
        const bibleIdx = buildBibleVerseIndex(bible);

        const studySpansNeh8 = buildChapterSpanIndex(study).get("NEH|8") ?? [];
        const studySpansNeh7 = buildChapterSpanIndex(study).get("NEH|7") ?? [];
        console.log(
            "NEH7 spans",
            studySpansNeh7.map(
                (s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}-${s.absEnd}`
            )
        );
        console.log(
            "NEH8 spans",
            studySpansNeh8.map(
                (s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}-${s.absEnd}`
            )
        );
        const nehBoundary = 9544763;
        const overlap7 = studySpansNeh7.filter(
            (s) => s.absStart < nehBoundary + 10000 && s.absEnd > nehBoundary - 1000
        );
        console.log(
            "NEH7 spans overlapping boundary",
            overlap7.map((s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}-${s.absEnd}`)
        );
        console.log("RUT4 inserts", plan.chapterInserts.get("RUT|4"));
        console.log("2CH36 inserts", plan.chapterInserts.get("2CH|36"));

        const neh7Block = blocks.get("NEH|7");
        const neh8Block = blocks.get("NEH|8");
        console.log("bible NEH7 block", {
            range: `${neh7Block?.firstVerse}-${neh7Block?.lastVerse}`,
            len: neh7Block?.blockXml.length,
            hasEsdras: neh7Block?.blockXml.includes("Esdras"),
            hasCidade: neh7Block?.blockXml.includes("cidade era grande"),
            maxMetaV: Math.max(
                0,
                ...[...(neh7Block?.blockXml.matchAll(/meta%3av"><Content>(\d+)/g) ?? [])].map(
                    (m) => parseInt(m[1], 10)
                ),
                ...[...(neh7Block?.blockXml.matchAll(/meta:v"><Content>(\d+)/g) ?? [])].map((m) =>
                    parseInt(m[1], 10)
                )
            ),
        });
        console.log("bible NEH8 block", {
            range: `${neh8Block?.firstVerse}-${neh8Block?.lastVerse}`,
            len: neh8Block?.blockXml.length,
            hasEsdras: neh8Block?.blockXml.includes("Esdras"),
            hasCidade: neh8Block?.blockXml.includes("cidade era grande"),
        });
        const slices773 = bibleSlicesForStudyRange(plan, "NEH", "7", 4, 73);
        const slices73 = bibleSlicesForStudyRange(plan, "NEH", "7", 73, 73);
        const slices218 = bibleSlicesForStudyRange(plan, "NEH", "8", 2, 18);
        console.log("slices 7:4-73", slices773);
        console.log("slices 7:73", slices73);
        console.log("slices 8:2-18", slices218);
        const xml773 = extractBibleXmlForSlices(blocks, "NEH", slices773);
        const xml73 = extractBibleXmlForSlices(blocks, "NEH", slices73);
        const xml218 = extractBibleXmlForSlices(blocks, "NEH", slices218);
        console.log("extract 7:4-73", {
            len: xml773.length,
            hasEsdras: xml773.includes("Esdras"),
            hasCidade: xml773.includes("cidade era grande"),
        });
        console.log("extract 7:73", {
            len: xml73.length,
            hasEsdras: xml73.includes("Esdras"),
            snippet: xml73.replace(/\s+/g, " ").slice(0, 120),
        });
        console.log("extract 8:2-18", {
            len: xml218.length,
            hasEsdras: xml218.includes("Esdras"),
            hasCidade: xml218.includes("cidade era grande"),
        });

        const built = buildStructureSwapSplices(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
            bibleVerseIndex: bibleIdx,
        });
        const nehSplices = built.splices.filter(
            (s) => s.absStart >= 9400000 && s.absStart <= 9700000
        );
        console.log(
            "NEH region splices",
            nehSplices.map((s) => ({
                ch: s.studyChapter,
                range: `${s.absStart}-${s.absEnd}`,
                repLen: s.replacement.length,
                hasEsdras: s.replacement.includes("Esdras"),
                hasCidade: s.replacement.includes("cidade era grande"),
                verseMarks: [
                    ...s.replacement.matchAll(/meta%3av"><Content>(\d+)/g),
                ]
                    .map((m) => m[1])
                    .slice(0, 12),
            }))
        );
        const coalesced = coalesceParagraphSplices(study, built.splices);
        const norm = normalizeOverlappingSplices(coalesced);
        const nehNorm = norm.filter(
            (s) => s.absStart >= 9400000 && s.absStart <= 9700000
        );
        console.log(
            "NEH after coalesce+normalize",
            nehNorm.map((s) => ({
                ch: s.studyChapter,
                range: `${s.absStart}-${s.absEnd}`,
                repLen: s.replacement.length,
                verses: [
                    ...s.replacement.matchAll(/meta%3av"><Content>(\d+)/g),
                ]
                    .map((m) => m[1])
                    .slice(0, 15),
            }))
        );

        const { xml } = applyStructureSwapToStudyXml(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
            bibleVerseIndex: bibleIdx,
        });
        const exportIdx = buildBibleVerseIndex(xml);

        const neh8 = chapterVerses(exportIdx, "NEH", "8");
        const neh7 = chapterVerses(exportIdx, "NEH", "7");
        const sa7 = chapterVerses(exportIdx, "1SA", "7");
        const ch36 = chapterVerses(exportIdx, "2CH", "36");
        console.log("export NEH7", neh7.slice(0, 5), "... max", Math.max(...neh7, 0));
        console.log("export NEH8", neh8);
        console.log("export 1SA7", sa7);
        console.log("export 2CH36", ch36);
        console.log("RUT 4:22 export?", Boolean(exportIdx.get("RUT|4|22")));
        console.log("RUT 4:22 bible?", Boolean(bibleIdx.get("RUT|4|22")));
        console.log(
            "NEH8:4 export snippet",
            exportIdx.get("NEH|8|4")?.text?.slice(0, 40)
        );
        console.log(
            "NEH8:4 bible snippet",
            bibleIdx.get("NEH|8|4")?.text?.slice(0, 40)
        );
        console.log(
            "NEH7:4 bible snippet",
            bibleIdx.get("NEH|7|4")?.text?.slice(0, 40)
        );

        expect(exportIdx.get("NEH|8|4")?.text?.slice(0, 20)).toBe(
            bibleIdx.get("NEH|8|4")?.text?.slice(0, 20)
        );
        expect(Math.max(...neh8, 0)).toBeLessThanOrEqual(18);
        expect(sa7).toContain(2);
        expect(sa7).toContain(17);
        expect(exportIdx.get("RUT|4|22")).toBeTruthy();
        expect(ch36).toContain(23);
        expect(ch36).not.toContain(26);
    }, 600000);

    it("ISA-MAL: LAM 1:22 / JON 2 / HAB 3 / JER 39 with precomputed plan", async () => {
        if (!fs.existsSync(STUDY_ISA) || !fs.existsSync(BIBLE_ISA)) return;

        const study = await loadMainStory(STUDY_ISA);
        const bible = await loadMainStory(BIBLE_ISA);
        const plan = loadPlan("ISA-MAL");
        const blocks = buildBibleChapterBlockIndex(bible);
        const bibleIdx = buildBibleVerseIndex(bible);

        console.log("HAB3 plan verses", [...plan.verseMap.keys()].filter((k) => k.startsWith("HAB|3|")));
        console.log("HAB3 inserts", plan.chapterInserts.get("HAB|3"));
        console.log("bible HAB3", chapterVerses(bibleIdx, "HAB", "3"));
        console.log("bible LAM1", chapterVerses(bibleIdx, "LAM", "1"));

        const { xml } = applyStructureSwapToStudyXml(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
            bibleVerseIndex: bibleIdx,
        });
        const exportIdx = buildBibleVerseIndex(xml);

        console.log("export LAM1", chapterVerses(exportIdx, "LAM", "1"));
        console.log("export JON2", chapterVerses(exportIdx, "JON", "2"));
        console.log("export HAB3", chapterVerses(exportIdx, "HAB", "3"));
        console.log("export JER39", chapterVerses(exportIdx, "JER", "39"));
        console.log("LAM1:22 export?", exportIdx.get("LAM|1|22")?.text?.slice(0, 40));
        console.log("LAM1:22 bible?", bibleIdx.get("LAM|1|22")?.text?.slice(0, 40));
        console.log("HAB3:1 export?", exportIdx.get("HAB|3|1")?.text?.slice(0, 40));
        console.log("HAB3:19 bible?", bibleIdx.get("HAB|3|19")?.text?.slice(0, 40));
        console.log("HAB3:19 export?", exportIdx.get("HAB|3|19")?.text?.slice(0, 40));

        expect(exportIdx.get("LAM|1|22")?.text?.slice(0, 15)).toBe(
            bibleIdx.get("LAM|1|22")?.text?.slice(0, 15)
        );
        expect(chapterVerses(exportIdx, "JON", "2")).toContain(2);
        expect(chapterVerses(exportIdx, "JER", "39")).toContain(5);
        expect(Math.max(...chapterVerses(exportIdx, "JER", "39"), 0)).toBeLessThan(27);
    }, 600000);

    it("ACT-REV: 2CO 2 / 1CO 11 with precomputed plan", async () => {
        if (!fs.existsSync(STUDY_ACT) || !fs.existsSync(BIBLE_ACT)) return;

        const study = await loadMainStory(STUDY_ACT);
        const bible = await loadMainStory(BIBLE_ACT);
        const plan = loadPlan("ACT-REV");
        const blocks = buildBibleChapterBlockIndex(bible);
        const bibleIdx = buildBibleVerseIndex(bible);

        const { xml } = applyStructureSwapToStudyXml(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
            bibleVerseIndex: bibleIdx,
        });
        const exportIdx = buildBibleVerseIndex(xml);

        console.log("export 2CO2", chapterVerses(exportIdx, "2CO", "2"));
        console.log(
            "1CO11:14 export",
            exportIdx.get("1CO|11|14")?.text?.slice(0, 40)
        );
        console.log(
            "1CO11:14 bible",
            bibleIdx.get("1CO|11|14")?.text?.slice(0, 40)
        );
        console.log(
            "1CO10:14 bible",
            bibleIdx.get("1CO|10|14")?.text?.slice(0, 40)
        );

        expect(chapterVerses(exportIdx, "2CO", "2")).toContain(5);
        expect(chapterVerses(exportIdx, "2CO", "2")).toContain(17);
        expect(chapterVerses(exportIdx, "2CO", "2")).not.toContain(23);
        expect(exportIdx.get("1CO|11|14")?.text?.slice(0, 20)).toBe(
            bibleIdx.get("1CO|11|14")?.text?.slice(0, 20)
        );
    }, 600000);
});
