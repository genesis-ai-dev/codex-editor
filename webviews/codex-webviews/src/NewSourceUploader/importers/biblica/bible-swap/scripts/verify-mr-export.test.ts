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
const STUDY_JOB = `${BASE}/English IDML/JOB-SNG.idml`;
const STUDY_JOS = `${BASE}/English IDML/JOS-EST.idml`;
const MR_JOB =
    `${BASE}/BIBLE Files/Codex May 2026 - Bible Text Files/Marathi Full Bible/mrMCV24-FB-MIN#2 Folder/18JOB-22SNG_mrMCV24-FB-MIN#2.idml`;
const MR_JOS =
    `${BASE}/BIBLE Files/Codex May 2026 - Bible Text Files/Marathi Full Bible/mrMCV24-FB-MIN#2 Folder/06JOS-17EST_mrMCV24-FB-MIN#2.idml`;

async function largestStory(path: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(path)));
    let xml = "";
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.length > xml.length) xml = t;
    }
    return xml;
}

describe("marathi export verification", () => {
    it("JOB-SNG: no English speaker labels and PSA 119 acrostic verses present", async () => {
        const study = await largestStory(STUDY_JOB);
        const bible = await largestStory(MR_JOB);
        const plan = buildVersificationPlan(study, bible);
        const index = buildBibleVerseIndex(bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        expect(xml).not.toContain("The king says,");
        expect(xml).not.toContain("The woman says,");
        for (const v of [8, 16, 24, 168]) {
            expect(index.has(`PSA|119|${v}`)).toBe(true);
        }
        const acrostic = index.get("PSA|119|8")?.text ?? "";
        expect(acrostic.length).toBeGreaterThan(0);
        expect(xml).toContain(acrostic.slice(0, Math.min(12, acrostic.length)));
    }, 300000);

    it("JOS-EST: NEH 8 free of census bleed and 1SA 7:2 heading preserved", async () => {
        const study = await largestStory(STUDY_JOS);
        const bible = await largestStory(MR_JOS);
        const plan = buildVersificationPlan(study, bible);
        const index = buildBibleVerseIndex(bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        const neh84 = index.get("NEH|8|4")?.text ?? "";
        const neh74 = index.get("NEH|7|4")?.text ?? "";
        const censusMarker = "पारोशचे वंशज";
        expect(neh84.length).toBeGreaterThan(0);
        expect(neh74.length).toBeGreaterThan(0);
        expect(xml).toContain(neh84.slice(0, Math.min(16, neh84.length)));
        expect(xml).toContain(neh74.slice(0, Math.min(16, neh74.length)));

        const lawPos = xml.indexOf(neh84.slice(0, Math.min(12, neh84.length)));
        const cityPos = xml.indexOf(neh74.slice(0, Math.min(12, neh74.length)));
        expect(lawPos).toBeGreaterThan(cityPos);
        expect(xml.slice(lawPos)).not.toContain(censusMarker);

        expect((plan.chapterInserts.get("NEH|8") ?? []).length).toBeLessThanOrEqual(
            18
        );
        expect(xml).toContain("मिस्पाह");
    }, 300000);
});
