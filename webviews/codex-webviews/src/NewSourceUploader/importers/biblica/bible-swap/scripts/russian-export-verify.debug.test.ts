import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
    buildInsertSlicesFromRefs,
    extractBibleXmlForSlices,
} from "../index";
import { buildBibleVerseIndex } from "../surgicalSwap";
import { buildStructureSwapSplices } from "../structureSwap";

const BASE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing";
const STUDY_ISA = `${BASE}/File Testing/automated_app/english_bsb/ISA-MAL.idml`;
const BIBLE_ISA = `${BASE}/BIBLE Files/Russian Full Bible/23ISA-39MAL_russian.idml`;
const EXPORT_ISA = `${BASE}/File Testing/automated_app/exported/russian/ISA-MAL_bible-swap.idml`;
const STUDY_JOB = `${BASE}/File Testing/automated_app/english_bsb/JOB-SNG.idml`;
const BIBLE_JOB = `${BASE}/BIBLE Files/Russian Full Bible/18JOB-22SNG_russian.idml`;
const EXPORT_JOB = `${BASE}/File Testing/automated_app/exported/russian/JOB-SNG_bible-swap.idml`;

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

describe("Russian export post-fix verification", () => {
    it("diagnoses why DAN 3:31-33 inserts are missing from export", async () => {
        const study = await loadMainStory(STUDY_ISA);
        const bible = await loadMainStory(BIBLE_ISA);
        const exportXml = await loadMainStory(EXPORT_ISA);
        const plan = buildVersificationPlan(study, bible);
        const blocks = buildBibleChapterBlockIndex(bible);
        const bibleIdx = buildBibleVerseIndex(bible);
        const exportIdx = buildBibleVerseIndex(exportXml);

        const inserts = plan.chapterInserts.get("DAN|3") ?? [];
        expect(inserts.map((r) => r.verse)).toEqual(["31", "32", "33"]);

        const insertSlices = buildInsertSlicesFromRefs(inserts);
        const insertXml = extractBibleXmlForSlices(blocks, "DAN", insertSlices);
        expect(insertXml.length).toBeGreaterThan(0);

        const { mergedSplices } = buildStructureSwapSplices(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
        });
        const danInsertSplice = mergedSplices.find(
            (s) =>
                s.replacement.includes(
                    bibleIdx.get("DAN|3|31")?.text?.slice(0, 20) ?? "___NEVER___"
                )
        );

        const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line
        log("insertXml len", insertXml.length);
        log("insertXml has v31", insertXml.includes(bibleIdx.get("DAN|3|31")?.text?.slice(0, 15) ?? ""));
        log("danInsertSplice found", Boolean(danInsertSplice));
        log("export has DAN|3|31", exportIdx.has("DAN|3|31"));
        log("export DAN|3|31 text", exportIdx.get("DAN|3|31")?.text?.slice(0, 50));
        log("bible DAN|3|31 text", bibleIdx.get("DAN|3|31")?.text?.slice(0, 50));

        const fresh = applyStructureSwapToStudyXml(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
        }).xml;
        const freshIdx = buildBibleVerseIndex(fresh);
        log("fresh swap has DAN|3|31", freshIdx.has("DAN|3|31"));
        expect(freshIdx.has("DAN|3|31")).toBe(true);
    }, 600000);

    it("diagnoses SNG 1:1 and PSA 62:13 on exported file", async () => {
        const study = await loadMainStory(STUDY_JOB);
        const bible = await loadMainStory(BIBLE_JOB);
        const exportXml = await loadMainStory(EXPORT_JOB);
        const plan = buildVersificationPlan(study, bible);
        const bibleIdx = buildBibleVerseIndex(bible);
        const exportIdx = buildBibleVerseIndex(exportXml);

        const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line
        log("PSA62 inserts", (plan.chapterInserts.get("PSA|62") ?? []).map((r) => r.verse));
        log("SNG bible v1", bibleIdx.get("SNG|1|1")?.text?.slice(0, 60));
        log("SNG export v1", exportIdx.get("SNG|1|1")?.text?.slice(0, 60));
        log("PSA62 bible v13", bibleIdx.get("PSA|62|13")?.text?.slice(0, 40));
        log("PSA62 export v13", exportIdx.get("PSA|62|13")?.text?.slice(0, 40));
    }, 600000);
});
