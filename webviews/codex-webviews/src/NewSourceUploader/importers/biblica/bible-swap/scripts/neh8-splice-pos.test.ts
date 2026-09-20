import { describe, it } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
    applyStructureSwapToStudyXml,
    bibleSlicesForStudyRange,
    extractBibleXmlForSlices,
} from "../index";
import { buildChapterSpanIndex } from "../chapterBlocks";

const STUDY =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/English IDML/JOS-EST.idml";
const MR =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Codex May 2026 - Bible Text Files/Marathi Full Bible/mrMCV24-FB-MIN#2 Folder/06JOS-17EST_mrMCV24-FB-MIN#2.idml";

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

describe("NEH splice positions", () => {
    it("logs NEH 7/8 study span positions and splice replacements", async () => {
        const study = await loadMainStory(STUDY);
        const bible = await loadMainStory(MR);
        const plan = buildVersificationPlan(study, bible);
        const bibleBlocks = buildBibleChapterBlockIndex(bible);
        const studySpans = buildChapterSpanIndex(study);

        const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line

        for (const ch of ["7", "8"]) {
            const spans = studySpans.get(`NEH|${ch}`) ?? [];
            log(`NEH|${ch} spans`, spans.length);
            for (const s of spans) {
                log(`  ${s.firstVerse}-${s.lastVerse} abs=${s.absStart}-${s.absEnd}`);
                const slices = bibleSlicesForStudyRange(
                    plan,
                    s.book,
                    s.chapter,
                    s.firstVerse,
                    s.lastVerse
                );
                const rep = extractBibleXmlForSlices(bibleBlocks, s.book, slices);
                log(`    slices`, slices, `rep census=${rep.includes("पारोश")} len=${rep.length}`);
            }
        }

        const { xml } = applyStructureSwapToStudyXml(study, bibleBlocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
        });

        const neh8 = studySpans.get("NEH|8") ?? [];
        if (neh8[1]) {
            const s = neh8[1];
            const before = study.slice(s.absStart, Math.min(s.absStart + 200, s.absEnd));
            const after = xml.slice(s.absStart, Math.min(s.absStart + 200, s.absEnd));
            log("span2 before", before.replace(/\s+/g, " ").slice(0, 150));
            log("span2 after (same offsets!)", after.replace(/\s+/g, " ").slice(0, 150));
        }
    }, 300000);
});
