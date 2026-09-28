import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
    bibleSlicesForStudyRange,
    extractBibleXmlForSlices,
} from "../index";
import { buildChapterSpanIndex } from "../chapterBlocks";
import { buildBibleVerseIndex, listVerseKeys } from "../surgicalSwap";
import { buildStructureSwapSplices } from "../structureSwap";

const BASE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing";

async function loadMainStory(path: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(path)));
    let xml = "";
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.length > xml.length) xml = t;
    }
    return xml;
}

async function loadStoryForBook(idmlPath: string, book: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(idmlPath)));
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.includes(`>${book}<`) || t.includes(`>${book}</`)) return t;
    }
    return "";
}

function psrBalance(xml: string): { open: number; close: number } {
    return {
        open: (xml.match(/<ParagraphStyleRange/g) ?? []).length,
        close: (xml.match(/<\/ParagraphStyleRange>/g) ?? []).length,
    };
}

function diagBook(
    label: string,
    study: string,
    bible: string,
    exportXml: string,
    book: string
) {
    const studyIdx = buildBibleVerseIndex(study);
    const bibleIdx = buildBibleVerseIndex(bible);
    const exportIdx = buildBibleVerseIndex(exportXml);
    const plan = buildVersificationPlan(study, bible);

    const studyChs = [
        ...new Set(
            listVerseKeys(studyIdx)
                .filter((k) => k.startsWith(`${book}|`))
                .map((k) => k.split("|")[1])
        ),
    ];
    const bibleChs = [
        ...new Set(
            listVerseKeys(bibleIdx)
                .filter((k) => k.startsWith(`${book}|`))
                .map((k) => k.split("|")[1])
        ),
    ];
    const exportChs = [
        ...new Set(
            listVerseKeys(exportIdx)
                .filter((k) => k.startsWith(`${book}|`))
                .map((k) => k.split("|")[1])
        ),
    ];

    const sampleKey = (idx: ReturnType<typeof buildBibleVerseIndex>, ch: string, v: string) =>
        idx.get(`${book}|${ch}|${v}`)?.text?.slice(0, 50) ?? "(missing)";

    // eslint-disable-next-line no-console
    console.log(`\n=== ${label} ${book} ===`);
    // eslint-disable-next-line no-console
    console.log({ studyChs, bibleChs, exportChs });
    // eslint-disable-next-line no-console
    console.log("plan PHM3->bible", plan.verseMap.get(`${book}|3|1`));
    // eslint-disable-next-line no-console
    console.log("export v1", {
        ch1: sampleKey(exportIdx, "1", "1"),
        ch3: sampleKey(exportIdx, "3", "1"),
        ch5: sampleKey(exportIdx, "5", "1"),
        ch9: sampleKey(exportIdx, "9", "1"),
    });
    // eslint-disable-next-line no-console
    console.log("bible v1", {
        ch1: sampleKey(bibleIdx, "1", "1"),
    });
    // eslint-disable-next-line no-console
    console.log("blocks", {
        bible1: buildBibleChapterBlockIndex(bible).has(`${book}|1`),
        bible3: buildBibleChapterBlockIndex(bible).has(`${book}|3`),
    });
}

describe("Portuguese batch diagnostics", () => {
    it("diagnoses ACT-REV PHM/2JN/2CO issues", async () => {
        const studyPath = `${BASE}/File Testing/automated_app/english_bsb/ACT-REV.idml`;
        const biblePath = `${BASE}/BIBLE Files/Portuguese Full Bible/44ACT-66REV_portuguese.idml`;
        if (!fs.existsSync(studyPath) || !fs.existsSync(biblePath)) return;

        const study = await loadMainStory(studyPath);
        const bible = await loadMainStory(biblePath);
        const blocks = buildBibleChapterBlockIndex(bible);
        const plan = buildVersificationPlan(study, bible);
        const { xml, stats } = applyStructureSwapToStudyXml(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
        });

        const phmBible = await loadStoryForBook(biblePath, "PHM");
        const phmIdx = buildBibleVerseIndex(phmBible);
        // eslint-disable-next-line no-console
        console.log("PHM bible keys ch", [
            ...new Set(
                listVerseKeys(phmIdx)
                    .filter((k) => k.startsWith("PHM|"))
                    .map((k) => k.split("|")[1])
            ),
        ]);
        // eslint-disable-next-line no-console
        console.log("PHM plan 3:1", plan.verseMap.get("PHM|3|1"));
        // eslint-disable-next-line no-console
        console.log("2JN plan 5:1", plan.verseMap.get("2JN|5|1"));
        // eslint-disable-next-line no-console
        console.log("2CO inserts ch2", (plan.chapterInserts.get("2CO|2") ?? []).map((r) => r.verse).slice(0, 10));
        // eslint-disable-next-line no-console
        console.log("swap stats", stats);
        // eslint-disable-next-line no-console
        console.log("psr balance", psrBalance(xml));

        diagBook("ACT-REV", study, bible, xml, "PHM");
        diagBook("ACT-REV", study, bible, xml, "2JN");
        diagBook("ACT-REV", study, bible, xml, "2CO");

        const exportIdx = buildBibleVerseIndex(xml);
        expect(exportIdx.has("PHM|1|1") || exportIdx.has("PHM|3|1")).toBe(true);
    }, 600000);

    it("diagnoses ISA-MAL OBA/HAB/LAM issues", async () => {
        const studyPath = `${BASE}/File Testing/automated_app/english_bsb/ISA-MAL.idml`;
        const biblePath = `${BASE}/BIBLE Files/Portuguese Full Bible/23ISA-39MAL_portuguese.idml`;
        if (!fs.existsSync(studyPath) || !fs.existsSync(biblePath)) return;

        const study = await loadMainStory(studyPath);
        const bible = await loadMainStory(biblePath);
        const blocks = buildBibleChapterBlockIndex(bible);
        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
        });

        // eslint-disable-next-line no-console
        console.log("OBA plan 9:1", plan.verseMap.get("OBA|9|1"));
        // eslint-disable-next-line no-console
        console.log("HAB plan 3:1", plan.verseMap.get("HAB|3|1"));
        diagBook("ISA-MAL", study, bible, xml, "OBA");
        diagBook("ISA-MAL", study, bible, xml, "HAB");

        const exportIdx = buildBibleVerseIndex(xml);
        // eslint-disable-next-line no-console
        console.log("LAM 1:22", {
            study: buildBibleVerseIndex(study).get("LAM|1|22")?.text?.slice(0, 40),
            bible: buildBibleVerseIndex(bible).get("LAM|1|22")?.text?.slice(0, 40),
            export: exportIdx.get("LAM|1|22")?.text?.slice(0, 40),
        });
        // eslint-disable-next-line no-console
        console.log("HAB 3:1", {
            studyPlan: plan.verseMap.get("HAB|3|1"),
            bibleHas: buildBibleVerseIndex(bible).has("HAB|3|1"),
            bibleText: buildBibleVerseIndex(bible).get("HAB|3|1")?.text?.slice(0, 50),
            exportHas: exportIdx.has("HAB|3|1"),
            exportText: exportIdx.get("HAB|3|1")?.text?.slice(0, 50),
            studyText: buildBibleVerseIndex(study).get("HAB|3|1")?.text?.slice(0, 50),
        });
        const lamSpans = buildChapterSpanIndex(study).get("LAM|1") ?? [];
        // eslint-disable-next-line no-console
        console.log(
            "LAM|1 spans",
            lamSpans.map((s) => `${s.firstVerse}-${s.lastVerse}`)
        );
        // eslint-disable-next-line no-console
        console.log("LAM 1:22 plan", plan.verseMap.get("LAM|1|22"));
    }, 600000);

    it("diagnoses JOS-EST NEH 8 issues", async () => {
        const studyPath = `${BASE}/File Testing/automated_app/english_bsb/JOS-EST.idml`;
        const biblePath = `${BASE}/BIBLE Files/Portuguese Full Bible/06JOS-17EST_portuguese.idml`;
        if (!fs.existsSync(studyPath) || !fs.existsSync(biblePath)) return;

        const study = await loadMainStory(studyPath);
        const bible = await loadMainStory(biblePath);
        const plan = buildVersificationPlan(study, bible);
        const blocks = buildBibleChapterBlockIndex(bible);
        const studySpans = buildChapterSpanIndex(study);

        const neh8Spans = studySpans.get("NEH|8") ?? [];
        // eslint-disable-next-line no-console
        console.log(
            "NEH|8 spans",
            neh8Spans.map((s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}`)
        );
        // eslint-disable-next-line no-console
        console.log(
            "NEH|8 inserts",
            (plan.chapterInserts.get("NEH|8") ?? []).map((r) => r.verse).slice(0, 20)
        );
        // eslint-disable-next-line no-console
        console.log(
            "NEH|8 bible max verse",
            Math.max(
                ...listVerseKeys(buildBibleVerseIndex(bible))
                    .filter((k) => k.startsWith("NEH|8|"))
                    .map((k) => parseInt(k.split("|")[2], 10))
            )
        );

        const { mergedSplices } = buildStructureSwapSplices(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
        });
        const nehSplices = mergedSplices.filter((s) => {
            const para = study.slice(s.absStart, Math.min(s.absStart + 120, s.absEnd));
            return para.includes("NEH") || s.replacement.length > 50000;
        });
        // eslint-disable-next-line no-console
        console.log(
            "large splices",
            mergedSplices
                .filter((s) => s.replacement.length > 30000)
                .map((s) => ({ len: s.replacement.length, abs: `${s.absStart}-${s.absEnd}` }))
        );

        const { xml } = applyStructureSwapToStudyXml(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
        });
        const exportIdx = buildBibleVerseIndex(xml);
        const neh8Keys = listVerseKeys(exportIdx).filter((k) => k.startsWith("NEH|8|"));
        // eslint-disable-next-line no-console
        console.log("export NEH|8 verse count", neh8Keys.length);
        // eslint-disable-next-line no-console
        console.log("NEH 8:18 export", exportIdx.get("NEH|8|18")?.text?.slice(0, 40));
        // eslint-disable-next-line no-console
        console.log("NEH 8:19 export", exportIdx.get("NEH|8|19")?.text?.slice(0, 40));
    }, 600000);
});
