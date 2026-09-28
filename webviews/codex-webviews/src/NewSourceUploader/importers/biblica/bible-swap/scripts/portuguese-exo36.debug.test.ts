import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
    bibleSlicesForStudyRange,
} from "../index";
import { buildChapterSpanIndex } from "../chapterBlocks";
import {
    buildBibleVerseIndex,
    listVerseKeys,
} from "../surgicalSwap";
import { buildStructureSwapSplices } from "../structureSwap";

const STUDY =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/English IDML/GEN-DEU.idml";
const BIBLE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Portuguese Full Bible/01GEN-05DEU_portuguese.idml";

async function loadMainStory(path: string): Promise<string> {
    if (!fs.existsSync(path)) return "";
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(path)));
    let xml = "";
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.length > xml.length) xml = t;
    }
    return xml;
}

describe("Portuguese EXO 35->36 boundary (real GEN-DEU)", () => {
    it("diagnoses structure swap around EXO 36", async () => {
        const study = await loadMainStory(STUDY);
        const bible = await loadMainStory(BIBLE);
        if (!study || !bible) {
            console.log("SKIP: fixture files not on disk");
            return;
        }

        const studyIdx = buildBibleVerseIndex(study);
        const bibleIdx = buildBibleVerseIndex(bible);
        const spans = buildChapterSpanIndex(study);
        const blocks = buildBibleChapterBlockIndex(bible);
        const exoPlan = buildVersificationPlan(study, bible);

        const inserts35 = (exoPlan.chapterInserts.get("EXO|35") ?? []).map((r) => r.verse);
        const exo36Spans = spans.get("EXO|36") ?? [];
        const exo35Spans = spans.get("EXO|35") ?? [];

        const exo36Keys = listVerseKeys(studyIdx).filter((k) => k.startsWith("EXO|36|"));
        const exo36InPlan = exo36Keys.filter(
            (k) => exoPlan.verseMap.get(k)?.action === "replace"
        );

        const spanDiag = exo36Spans.map((sp, i) => {
            const slices = bibleSlicesForStudyRange(
                exoPlan,
                sp.book,
                sp.chapter,
                sp.firstVerse,
                sp.lastVerse
            );
            return {
                i,
                range: `${sp.firstVerse}-${sp.lastVerse}`,
                abs: `${sp.absStart}-${sp.absEnd}`,
                sliceCount: slices.length,
                slices: slices.map((s) => `${s.chapter}:${s.firstVerse}-${s.lastVerse}`),
            };
        });

        const { splices: rawSplices, mergedSplices, stats } = buildStructureSwapSplices(
            study,
            blocks,
            {
                bibleStoryXml: bible,
                versificationPlan: exoPlan,
            }
        );
        const lo = exo36Spans[0]?.absStart ?? 0;
        const hi = exo36Spans[exo36Spans.length - 1]?.absEnd ?? 0;
        const rawBoundary = rawSplices.filter(
            (s) => s.absEnd > lo && s.absStart < hi && s.absStart !== s.absEnd
        );
        const inRange = mergedSplices.filter((s) => s.absEnd > lo && s.absStart < hi);

        const { xml } = applyStructureSwapToStudyXml(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: exoPlan,
        });

        const swappedIdx = buildBibleVerseIndex(xml);
        const exo36After = listVerseKeys(swappedIdx).filter((k) => k.startsWith("EXO|36|"));
        const exo35High = listVerseKeys(swappedIdx)
            .filter((k) => k.startsWith("EXO|35|"))
            .map((k) => +k.split("|")[2])
            .filter((v) => v >= 30)
            .sort((a, b) => a - b);

        const bible35 = listVerseKeys(bibleIdx).filter((k) => k.startsWith("EXO|35|"));
        const study35 = listVerseKeys(studyIdx).filter((k) => k.startsWith("EXO|35|"));

        // eslint-disable-next-line no-console
        console.log({
            inserts35,
            bible35Max: bible35.map((k) => k.split("|")[2]).sort((a, b) => +a - +b).slice(-3),
            study35Max: study35.map((k) => k.split("|")[2]).sort((a, b) => +a - +b).slice(-3),
            exo35SpanCount: exo35Spans.length,
            exo35Last: exo35Spans[exo35Spans.length - 1]
                ? `${exo35Spans[exo35Spans.length - 1].firstVerse}-${exo35Spans[exo35Spans.length - 1].lastVerse} @ ${exo35Spans[exo35Spans.length - 1].absStart}-${exo35Spans[exo35Spans.length - 1].absEnd}`
                : "none",
            exo36SpanCount: exo36Spans.length,
            exo36StudyKeys: exo36Keys.length,
            exo36ReplaceInPlan: exo36InPlan.length,
            spanDiag,
            rawBoundary: rawBoundary.map((s) => ({
                ch: s.studyChapter,
                repLen: s.replacement.length,
            })),
            inRangeSplices: inRange.map((s) => ({
                ch: s.studyChapter,
                abs: `${s.absStart}-${s.absEnd}`,
                repLen: s.replacement.length,
                empty: !s.replacement,
                metaV: (s.replacement.match(/meta%3av/g) ?? []).length,
            })),
            regionKeys: exo36After.length,
            exo35HighVerses: exo35High,
            has361: swappedIdx.has("EXO|36|1"),
            has3637: swappedIdx.has("EXO|36|37"),
            swapped361: swappedIdx.get("EXO|36|1")?.text?.slice(0, 40),
            missingFromBible: stats.missingFromBible.filter((m) => m.book === "EXO" && m.chapter === "36"),
        });

        expect(exo36InPlan.length).toBeGreaterThan(30);
        expect(exo36After.length).toBeGreaterThan(30);
        expect(swappedIdx.has("EXO|36|1")).toBe(true);
    });
});
