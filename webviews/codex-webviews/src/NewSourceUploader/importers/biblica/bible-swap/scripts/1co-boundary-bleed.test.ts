import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
} from "../index";
import { buildChapterSpanIndex } from "../chapterBlocks";
import { buildBibleVerseIndex } from "../surgicalSwap";

const BASE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/File Testing/automated_app";

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

describe("1CO boundary bleed", () => {
    it("does not bleed chapter 10 text into 1CO 11:14 on real Portuguese ACT-REV", async () => {
        const studyPath = `${BASE}/english_bsb/ACT-REV.idml`;
        const biblePath = `${BASE}/translated_bible/portuguese/44ACT-66REV_portuguese.idml`;
        if (!fs.existsSync(studyPath) || !fs.existsSync(biblePath)) return;

        const study = await loadMainStory(studyPath);
        const bible = await loadMainStory(biblePath);
        const plan = buildVersificationPlan(study, bible);
        const blocks = buildBibleChapterBlockIndex(bible);

        const { xml } = applyStructureSwapToStudyXml(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
        });

        const exportIdx = buildBibleVerseIndex(xml);
        const bibleIdx = buildBibleVerseIndex(bible);
        const v14Export = exportIdx.get("1CO|11|14")?.text ?? "";
        const v14Bible11 = bibleIdx.get("1CO|11|14")?.text ?? "";
        const v14Bible10 = bibleIdx.get("1CO|10|14")?.text ?? "";

        const studySpans = buildChapterSpanIndex(study);
        const ch10Boundary = (studySpans.get("1CO|10") ?? []).find(
            (s) => s.absStart === (studySpans.get("1CO|11") ?? [])[0]?.absStart
        );
        const ch11Boundary = (studySpans.get("1CO|11") ?? [])[0];

        expect(ch10Boundary?.firstVerse).toBe(33);
        expect(ch10Boundary?.lastVerse).toBe(33);
        expect(ch11Boundary?.firstVerse).toBe(1);
        expect(ch11Boundary?.lastVerse).toBe(1);
        expect(v14Export.slice(0, 20)).toBe(v14Bible11.slice(0, 20));
        expect(v14Export.slice(0, 20)).not.toBe(v14Bible10.slice(0, 20));
    }, 600000);
});
