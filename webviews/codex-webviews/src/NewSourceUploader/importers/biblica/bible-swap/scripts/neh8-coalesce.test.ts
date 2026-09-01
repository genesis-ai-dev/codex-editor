import { describe, it, expect } from "vitest";
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
import { buildBibleVerseIndex } from "../surgicalSwap";
import { coalesceParagraphSplices } from "../structureSwap";
import { iterateParagraphs } from "../surgicalSwap";

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

describe("NEH coalesce bug", () => {
    it("identifies overlapping splices on shared paragraph boundaries", async () => {
        const study = await loadMainStory(STUDY);
        const bible = await loadMainStory(MR);
        const plan = buildVersificationPlan(study, bible);
        const bibleBlocks = buildBibleChapterBlockIndex(bible);
        const studySpans = buildChapterSpanIndex(study);

        const splices: Array<{ absStart: number; absEnd: number; replacement: string; label: string }> = [];

        for (const [key, spans] of studySpans) {
            if (!key.startsWith("NEH|")) continue;
            for (const span of spans) {
                const slices = bibleSlicesForStudyRange(
                    plan,
                    span.book,
                    span.chapter,
                    span.firstVerse,
                    span.lastVerse
                );
                const replacement = extractBibleXmlForSlices(
                    bibleBlocks,
                    span.book,
                    slices
                );
                splices.push({
                    absStart: span.absStart,
                    absEnd: span.absEnd,
                    replacement,
                    label: `${key} ${span.firstVerse}-${span.lastVerse}`,
                });
            }
        }

        const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line

        for (const sp of splices.filter((s) => s.label.includes("NEH|7") || s.label.includes("NEH|8"))) {
            let paraStart = -1;
            let paraEnd = -1;
            for (const para of iterateParagraphs(study)) {
                if (sp.absStart >= para.fullStart && sp.absStart < para.fullEnd) {
                    paraStart = para.fullStart;
                    paraEnd = para.fullEnd;
                    break;
                }
            }
            log(
                sp.label,
                `span=${sp.absStart}-${sp.absEnd}`,
                `para=${paraStart}-${paraEnd}`,
                `repCity=${sp.replacement.includes("शहर मोठे")}`,
                `repPlat=${sp.replacement.includes("मत्तिथ्याह")}`,
                `repLen=${sp.replacement.length}`
            );
        }

        const merged = coalesceParagraphSplices(
            study,
            splices.map(({ label: _l, ...s }) => s)
        );
        for (const sp of merged.filter(
            (s) => s.absStart > 9_400_000 && s.absStart < 9_600_000
        )) {
            const rep = sp.replacement;
            log(
                "merged",
                `${sp.absStart}-${sp.absEnd}`,
                `len=${rep.length}`,
                `city=${rep.includes("शहर मोठे")}`,
                `plat=${rep.includes("मत्तिथ्याह")}`,
                `census=${rep.includes("पारोश")}`
            );
        }

        const { xml } = applyStructureSwapToStudyXml(study, bibleBlocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
        });
        log("swap contains platform frame", xml.includes("चौकटी"));
        log(
            "rep218 contains frame",
            merged.find((s) => s.absStart === 9547104)?.replacement.includes("चौकटी")
        );

        expect(xml).toContain("चौकटी");
        const index = buildBibleVerseIndex(bible);
        const neh84 = index.get("NEH|8|4")?.text ?? "";
        const neh74 = index.get("NEH|7|4")?.text ?? "";
        expect(neh84.length).toBeGreaterThan(0);
        const lawPos = xml.indexOf(neh84.slice(0, Math.min(12, neh84.length)));
        const cityPos = xml.indexOf(neh74.slice(0, Math.min(12, neh74.length)));
        expect(lawPos).toBeGreaterThan(cityPos);
        expect(xml.slice(lawPos)).not.toContain("पारोश");
    }, 300000);
});
