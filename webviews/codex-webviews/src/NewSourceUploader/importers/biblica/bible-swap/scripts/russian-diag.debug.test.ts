import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
} from "../index";
import { buildBibleVerseIndex } from "../surgicalSwap";

const BASE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing";
const STUDY_ISA = `${BASE}/File Testing/automated_app/english_bsb/ISA-MAL.idml`;
const BIBLE_ISA = `${BASE}/BIBLE Files/Russian Full Bible/23ISA-39MAL_russian.idml`;
const STUDY_JOB = `${BASE}/File Testing/automated_app/english_bsb/JOB-SNG.idml`;
const BIBLE_JOB = `${BASE}/BIBLE Files/Russian Full Bible/18JOB-22SNG_russian.idml`;
const STUDY_ACT = `${BASE}/File Testing/automated_app/english_bsb/ACT-REV.idml`;
const BIBLE_ACT = `${BASE}/BIBLE Files/Russian Full Bible/44ACT-66REV_russian.idml`;

async function loadStoryForBook(idmlPath: string, book: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(idmlPath)));
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.includes(`>${book}<`) || t.includes(`>${book}</`)) return t;
    }
    return "";
}

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

describe("Russian export diagnostics", () => {
    it("confirms chapterInserts and OBA|1 keys after swap", async () => {
        const study = await loadMainStory(STUDY_ISA);
        const bible = await loadMainStory(BIBLE_ISA);
        const plan = buildVersificationPlan(study, bible);

        expect((plan.chapterInserts.get("DAN|3") ?? []).map((r) => r.verse)).toEqual([
            "31",
            "32",
            "33",
        ]);
        expect((plan.chapterInserts.get("JON|2") ?? []).map((r) => r.verse)).toEqual([
            "11",
        ]);

        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );
        const exportIndex = buildBibleVerseIndex(xml);
        expect(exportIndex.has("OBA|1|1")).toBe(true);
        expect(exportIndex.has("OBA|9|1")).toBe(false);
    }, 300000);

    it("logs SNG 1:1 study vs bible vs export text", async () => {
        const study = await loadMainStory(STUDY_JOB);
        const bible = await loadMainStory(BIBLE_JOB);
        const plan = buildVersificationPlan(study, bible);
        const studyIdx = buildBibleVerseIndex(study);
        const bibleIdx = buildBibleVerseIndex(bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );
        const exportIdx = buildBibleVerseIndex(xml);

        const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line
        log("SNG study", studyIdx.get("SNG|1|1")?.text?.slice(0, 80));
        log("SNG bible", bibleIdx.get("SNG|1|1")?.text?.slice(0, 80));
        log("SNG export", exportIdx.get("SNG|1|1")?.text?.slice(0, 80));
        log("PSA62 inserts", (plan.chapterInserts.get("PSA|62") ?? []).map((r) => r.verse));
    }, 300000);

    it("indexes PHM/2JN as chapter 1 in Russian bible (ignores ACE markers)", async () => {
        if (!fs.existsSync(BIBLE_ACT)) return;
        const phm = await loadStoryForBook(BIBLE_ACT, "PHM");
        const twoJn = await loadStoryForBook(BIBLE_ACT, "2JN");
        expect(phm.length).toBeGreaterThan(0);
        expect(twoJn.length).toBeGreaterThan(0);

        const phmIdx = buildBibleVerseIndex(phm);
        const twoIdx = buildBibleVerseIndex(twoJn);
        expect(phmIdx.has("PHM|1|1")).toBe(true);
        expect(phmIdx.has("PHM|3|1")).toBe(false);
        expect(twoIdx.has("2JN|1|1")).toBe(true);
        expect(twoIdx.has("2JN|5|1")).toBe(false);

        expect(buildBibleChapterBlockIndex(phm).get("PHM|1")).toBeDefined();
        expect(buildBibleChapterBlockIndex(twoJn).get("2JN|1")).toBeDefined();
    }, 120000);

    it("builds ACT/ROM trailing inserts for ACT-REV Russian bible", async () => {
        if (!fs.existsSync(STUDY_ACT) || !fs.existsSync(BIBLE_ACT)) return;
        const study = await loadMainStory(STUDY_ACT);
        const bible = await loadMainStory(BIBLE_ACT);
        const plan = buildVersificationPlan(study, bible);

        expect(plan.verseMap.get("PHM|3|1")?.action).toBe("replace");
        if (plan.verseMap.get("PHM|3|1")?.action === "replace") {
            expect(plan.verseMap.get("PHM|3|1")?.bible.chapter).toBe("1");
        }

        expect((plan.chapterInserts.get("ACT|8") ?? []).map((r) => r.verse)).toEqual(
            expect.arrayContaining(["36", "37"])
        );
        expect((plan.chapterInserts.get("ROM|12") ?? []).map((r) => r.verse)).toEqual(
            expect.arrayContaining(["21"])
        );
        expect((plan.chapterInserts.get("ROM|16") ?? []).map((r) => r.verse)).toEqual(
            expect.arrayContaining(["23", "24"])
        );
    }, 600000);
});
