import { describe, it } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    buildVersificationPlan,
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    bibleSlicesForStudyRange,
} from "../index";
import { buildChapterSpanIndex, extractSliceByVerseRange } from "../chapterBlocks";
import { buildBibleVerseIndex } from "../surgicalSwap";
import { buildStructureSwapSplices } from "../structureSwap";

const BASE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing";
const STUDY = `${BASE}/File Testing/automated_app/english_bsb/ISA-MAL.idml`;
const BIBLE = `${BASE}/BIBLE Files/Portuguese Full Bible/23ISA-39MAL_portuguese.idml`;

async function loadStoryForBook(idmlPath: string, book: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(idmlPath)));
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.includes(`>${book}<`) || t.includes(`>${book}</`)) return t;
    }
    return "";
}

describe("LAM/HAB quick diag", () => {
    it("LAM 1:22 and HAB 3:1 root cause", async () => {
        if (!fs.existsSync(STUDY) || !fs.existsSync(BIBLE)) return;

        const studyLam = await loadStoryForBook(STUDY, "LAM");
        const bibleLam = await loadStoryForBook(BIBLE, "LAM");
        const studyHab = await loadStoryForBook(STUDY, "HAB");
        const bibleHab = await loadStoryForBook(BIBLE, "HAB");

        const lamPlan = buildVersificationPlan(studyLam, bibleLam);
        const habPlan = buildVersificationPlan(studyHab, bibleHab);
        const lamSpans = buildChapterSpanIndex(studyLam).get("LAM|1") ?? [];
        const habSpans = buildChapterSpanIndex(studyHab).get("HAB|3") ?? [];

        const spanWith22 = lamSpans.find(
            (s) => s.firstVerse <= 22 && s.lastVerse >= 22
        );
        const slices22 = spanWith22
            ? bibleSlicesForStudyRange(
                  lamPlan,
                  "LAM",
                  "1",
                  spanWith22.firstVerse,
                  spanWith22.lastVerse
              )
            : [];

        const { mergedSplices } = buildStructureSwapSplices(
            studyLam,
            buildBibleChapterBlockIndex(bibleLam),
            { bibleStoryXml: bibleLam, versificationPlan: lamPlan }
        );
        const spliceFor22 = mergedSplices.find((sp) => {
            if (!spanWith22) return false;
            return sp.absStart <= spanWith22.absStart && sp.absEnd >= spanWith22.absEnd;
        });

        const { xml: lamXml } = applyStructureSwapToStudyXml(
            studyLam,
            buildBibleChapterBlockIndex(bibleLam),
            { bibleStoryXml: bibleLam, versificationPlan: lamPlan }
        );

        const habIdx = buildBibleVerseIndex(bibleHab);
        const hab3Keys = [...habIdx.keys()].filter((k) => k.startsWith("HAB|3|"));

        const lamBlock = buildBibleChapterBlockIndex(bibleLam).get("LAM|1");
        const slice122 = lamBlock
            ? extractSliceByVerseRange(lamBlock.blockXml, 1, 22)
            : "";
        const v22Text = buildBibleVerseIndex(bibleLam).get("LAM|1|22")?.text ?? "";
        const lamSpansBible = buildChapterSpanIndex(bibleLam).get("LAM|1") ?? [];

        const slice122Only = lamBlock
            ? extractSliceByVerseRange(lamBlock.blockXml, 22, 22)
            : "";
        const slice121Only = lamBlock
            ? extractSliceByVerseRange(lamBlock.blockXml, 1, 21)
            : "";

        // eslint-disable-next-line no-console
        console.log({
            lamBlockRange: lamBlock
                ? `${lamBlock.firstVerse}-${lamBlock.lastVerse}`
                : null,
            lamBibleSpans: lamSpansBible.map((s) => `${s.firstVerse}-${s.lastVerse}`),
            slice121Has22: slice121Only.includes(v22Text.slice(0, 15)),
            slice122OnlyLen: slice122Only.length,
            slice122OnlyHas22: slice122Only.includes(v22Text.slice(0, 15)),
            slice122OnlySnippet: slice122Only.replace(/\s+/g, " ").slice(0, 120),
            lamSpans: lamSpans.map((s) => `${s.firstVerse}-${s.lastVerse}`),
            lam122Plan: lamPlan.verseMap.get("LAM|1|22"),
            slices22,
            spliceFor22Len: spliceFor22?.replacement.length,
            splicePsr: spliceFor22
                ? {
                      o: (spliceFor22.replacement.match(/<ParagraphStyleRange/g) ?? [])
                          .length,
                      c: (spliceFor22.replacement.match(/<\/ParagraphStyleRange>/g) ?? [])
                          .length,
                  }
                : null,
            lamExportKeys: [...buildBibleVerseIndex(lamXml).keys()]
                .filter((k) => k.startsWith("LAM|1|"))
                .map((k) => k.split("|")[2])
                .slice(-5),
            lamExport22: buildBibleVerseIndex(lamXml).get("LAM|1|22")?.text?.slice(0, 40),
            lamPsrBalance: {
                o: (lamXml.match(/<ParagraphStyleRange/g) ?? []).length,
                c: (lamXml.match(/<\/ParagraphStyleRange>/g) ?? []).length,
            },
            lamHas22Text: lamXml.includes(v22Text.slice(0, 20)),
            slice122Len: slice122.length,
            slice122Has22: slice122.includes(v22Text.slice(0, 20)),
            slice122Psr: {
                o: (slice122.match(/<ParagraphStyleRange/g) ?? []).length,
                c: (slice122.match(/<\/ParagraphStyleRange>/g) ?? []).length,
            },
            hab3Plan1: habPlan.verseMap.get("HAB|3|1"),
            hab3BibleKeys: hab3Keys.slice(0, 8),
            hab3Bible1: habIdx.get("HAB|3|1"),
            habSpans: habSpans.map((s) => `${s.firstVerse}-${s.lastVerse}`),
        });
    }, 120000);
});
