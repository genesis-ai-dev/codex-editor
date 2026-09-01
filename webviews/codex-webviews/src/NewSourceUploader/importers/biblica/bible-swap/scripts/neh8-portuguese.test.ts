import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
} from "../index";
import { buildBibleVerseIndex, listVerseKeys } from "../surgicalSwap";

const BASE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing";
const STUDY = `${BASE}/File Testing/automated_app/english_bsb/JOS-EST.idml`;
const BIBLE = `${BASE}/BIBLE Files/Portuguese Full Bible/06JOS-17EST_portuguese.idml`;

async function loadStoryForBook(idmlPath: string, book: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(idmlPath)));
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.includes(`>${book}<`) || t.includes(`>${book}</`)) return t;
    }
    return "";
}

describe("NEH 8 Portuguese integration", () => {
    it("NEH 8 law text replaces census bleed and does not invent verses past bible max", async () => {
        if (!fs.existsSync(STUDY) || !fs.existsSync(BIBLE)) return;

        const study = await loadStoryForBook(STUDY, "NEH");
        const bible = await loadStoryForBook(BIBLE, "NEH");
        expect(study.length).toBeGreaterThan(0);
        expect(bible.length).toBeGreaterThan(0);

        const bibleIdx = buildBibleVerseIndex(bible);
        const bibleMax8 = Math.max(
            ...listVerseKeys(bibleIdx)
                .filter((k) => k.startsWith("NEH|8|"))
                .map((k) => parseInt(k.split("|")[2], 10))
        );
        const neh84Bible = bibleIdx.get("NEH|8|4")?.text ?? "";
        const neh74Bible = bibleIdx.get("NEH|7|4")?.text ?? "";
        expect(neh84Bible.length).toBeGreaterThan(0);
        expect(neh74Bible.length).toBeGreaterThan(0);

        const plan = buildVersificationPlan(study, bible);
        const { xml } = applyStructureSwapToStudyXml(
            study,
            buildBibleChapterBlockIndex(bible),
            { bibleStoryXml: bible, versificationPlan: plan }
        );

        const exportIdx = buildBibleVerseIndex(xml);
        const neh84Export = exportIdx.get("NEH|8|4")?.text ?? "";
        expect(neh84Export.length).toBeGreaterThan(0);
        expect(neh84Export.slice(0, 20)).toBe(neh84Bible.slice(0, 20));
        expect(neh84Export).not.toBe(neh74Bible);

        const exportMax8 = Math.max(
            ...listVerseKeys(exportIdx)
                .filter((k) => k.startsWith("NEH|8|"))
                .map((k) => parseInt(k.split("|")[2], 10)),
            0
        );
        expect(exportMax8).toBeLessThanOrEqual(bibleMax8);
    }, 600000);
});
