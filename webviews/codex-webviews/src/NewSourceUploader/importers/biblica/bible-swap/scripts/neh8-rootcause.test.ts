import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    applyBibleSwap,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
    bibleSlicesForStudyRange,
    extractBibleXmlForSlices,
} from "../index";
import { buildChapterSpanIndex, extractSliceByVerseRange } from "../chapterBlocks";
import { buildBibleVerseIndex } from "../surgicalSwap";

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

describe("NEH 8 root cause", () => {
    it("traces span-2 replacement slices and bible block spans", async () => {
        const study = await loadMainStory(STUDY);
        const bible = await loadMainStory(MR);
        const bibleBlocks = buildBibleChapterBlockIndex(bible);
        const bibleSpans = buildChapterSpanIndex(bible, {
            retainSectionHeadings: true,
            retainSpeakerLabels: true,
            retainAcrosticHeadings: true,
        });
        const plan = buildVersificationPlan(study, bible);
        const studySpans = buildChapterSpanIndex(study).get("NEH|8") ?? [];

        const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line

        const neh8BibleSpans = bibleSpans.get("NEH|8") ?? [];
        log("bible NEH|8 span count", neh8BibleSpans.length);
        for (const [i, s] of neh8BibleSpans.entries()) {
            log(
                `  bible span ${i}: v${s.firstVerse}-${s.lastVerse} census=${s.blockXml.includes("पारोश")} len=${s.blockXml.length}`
            );
        }

        const neh7BibleSpans = bibleSpans.get("NEH|7") ?? [];
        log("bible NEH|7 span count", neh7BibleSpans.length);
        for (const [i, s] of neh7BibleSpans.entries()) {
            log(
                `  bible span ${i}: v${s.firstVerse}-${s.lastVerse} census=${s.blockXml.includes("पारोश")} len=${s.blockXml.length}`
            );
        }

        for (const [i, span] of studySpans.entries()) {
            const slices = bibleSlicesForStudyRange(
                plan,
                span.book,
                span.chapter,
                span.firstVerse,
                span.lastVerse
            );
            log(`study span ${i} ${span.firstVerse}-${span.lastVerse} slices:`, slices);
            const replacement = extractBibleXmlForSlices(
                bibleBlocks,
                span.book,
                slices
            );
            log(
                `  replacement len=${replacement.length} census=${replacement.includes("पारोश")} law=${replacement.includes("शहर")}`
            );
            if (replacement.includes("पारोश")) {
                log("  BAD replacement snippet:", replacement.slice(0, 300));
            }
        }

        const rep218 = extractBibleXmlForSlices(
            bibleBlocks,
            "NEH",
            bibleSlicesForStudyRange(plan, "NEH", "8", 2, 18)
        );
        const idx = buildBibleVerseIndex(bible);
        log("NEH|7|4 text", idx.get("NEH|7|4")?.text?.slice(0, 50));
        log("NEH|8|4 text", idx.get("NEH|8|4")?.text?.slice(0, 50));
        log("rep 2-18 has city", rep218.includes("शहर मोठे"));
        log("rep 2-18 has platform", rep218.includes("मत्तिथ्याह"));

        const neh8Block = bibleBlocks.get("NEH|8")!;
        const slice48 = extractSliceByVerseRange(neh8Block.blockXml, 4, 8);
        log(
            "direct slice NEH|8 block 4-8:",
            "census=",
            slice48.includes("पारोश"),
            "law=",
            slice48.includes("शहर")
        );

        const { xml: swapped } = applyBibleSwap(study, bible, "structure");
        const exported = await loadMainStory(
            "C:/Users/marti/Downloads/importer-testing-u3w4xkrafqr9918ur85-rebuild-export-2026-07-01-1/JOS-EST_2026-07-01T13-21-16-010Z_biblica_translated_bible-swap.idml"
        );

        const census = "पारोशचे वंशज";
        const law = "शहर मोठे";
        let pos = 0;
        const swappedHits: number[] = [];
        while ((pos = swapped.indexOf(census, pos)) >= 0) {
            swappedHits.push(pos);
            pos++;
        }
        log("census hits in fresh swap", swappedHits);
        log("census hits in user export", (() => {
            const h: number[] = [];
            let p = 0;
            while ((p = exported.indexOf(census, p)) >= 0) {
                h.push(p);
                p++;
            }
            return h;
        })());

        const lawAfter8484000 = swapped.slice(8484000, 8495000);
        log("fresh swap 8484k region census", lawAfter8484000.includes(census), "law", lawAfter8484000.includes(law));
        const lawAfter8484000Exp = exported.slice(8484000, 8495000);
        log("user export 8484k region census", lawAfter8484000Exp.includes(census), "law", lawAfter8484000Exp.includes(law));

        expect(swappedHits.length).toBeLessThanOrEqual(2);
        expect(lawAfter8484000.includes(census)).toBe(false);
    }, 300000);
});
