/**
 * Focused: Portuguese Bible NEH 7/8 chapter-block indexing.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import { buildBibleChapterBlockIndex } from "../index";
import {
    buildChapterSpanIndex,
    extractSliceByVerseRange,
    iterateChapterMarkersInParagraph,
} from "../chapterBlocks";
import { buildBibleVerseIndex } from "../surgicalSwap";
import { getParagraphIndex } from "../paragraphIndex";

const BIBLE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/File Testing/automated_app/translated_bible/portuguese/06JOS-17EST_portuguese.idml";

async function loadMainStory(idmlPath: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(idmlPath)));
    let xml = "";
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.length > xml.length) xml = t;
    }
    return xml;
}

describe("Portuguese bible NEH 7/8 block index", () => {
    it("keeps NEH 7 and NEH 8 bible blocks cleanly separated", async () => {
        if (!fs.existsSync(BIBLE)) return;
        const bible = await loadMainStory(BIBLE);
        const idx = buildBibleVerseIndex(bible);
        console.log("verse index NEH7 max", Math.max(...[...idx.keys()].filter(k => k.startsWith("NEH|7|")).map(k => +k.split("|")[2])));
        console.log("verse index NEH8 keys", [...idx.keys()].filter(k => k.startsWith("NEH|8|")).sort((a,b)=>+a.split("|")[2]-+b.split("|")[2]));
        console.log("NEH7:73", idx.get("NEH|7|73")?.text?.slice(0, 50));
        console.log("NEH8:1", idx.get("NEH|8|1")?.text?.slice(0, 50));
        console.log("NEH8:4", idx.get("NEH|8|4")?.text?.slice(0, 50));

        // Find meta:c 7 and 8 near NEH in bible
        let hits: Array<{ ch: string; pos: number; style: string; snippet: string }> = [];
        for (const para of getParagraphIndex(bible)) {
            if (!/NEH|Neh|neemias|Neemias/i.test(bible.slice(Math.max(0, para.fullStart - 5000), para.fullStart + 500)) && hits.length === 0) {
                // skip until we're near NEH - use book marker detection loosely
            }
            const markers = [...iterateChapterMarkersInParagraph(bible, para.bodyStart, para.bodyEnd)];
            for (const m of markers) {
                if (m.chapter === "7" || m.chapter === "8") {
                    hits.push({
                        ch: m.chapter,
                        pos: m.absPos,
                        style: para.appliedParagraphStyle.slice(-40),
                        snippet: bible.slice(para.fullStart, para.fullStart + 200).replace(/\s+/g, " "),
                    });
                }
            }
        }
        // Filter to NEH region using verse index positions if available
        const neh7v4 = idx.get("NEH|7|4");
        const neh8v1 = idx.get("NEH|8|1");
        console.log("NEH7:4 content pos", neh7v4?.contentPositions?.[0]);
        console.log("NEH8:1 content pos", neh8v1?.contentPositions?.[0]);

        const spans = buildChapterSpanIndex(bible, {
            retainSectionHeadings: true,
            retainSpeakerLabels: true,
            retainAcrosticHeadings: true,
        });
        const s7 = spans.get("NEH|7") ?? [];
        const s8 = spans.get("NEH|8") ?? [];
        console.log(
            "bible spans NEH7",
            s7.map((s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}-${s.absEnd} esdras=${s.blockXml.includes("Esdras")} cidade=${s.blockXml.includes("cidade")}`)
        );
        console.log(
            "bible spans NEH8",
            s8.map((s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}-${s.absEnd} esdras=${s.blockXml.includes("Esdras")} cidade=${s.blockXml.includes("cidade")}`)
        );

        const blocks = buildBibleChapterBlockIndex(bible);
        const b7 = blocks.get("NEH|7");
        const b8 = blocks.get("NEH|8");
        console.log("merged NEH7", {
            first: b7?.firstVerse,
            last: b7?.lastVerse,
            esdras: b7?.blockXml.includes("Esdras"),
            cidade: b7?.blockXml.includes("cidade"),
            len: b7?.blockXml.length,
        });
        console.log("merged NEH8", {
            first: b8?.firstVerse,
            last: b8?.lastVerse,
            esdras: b8?.blockXml.includes("Esdras"),
            cidade: b8?.blockXml.includes("cidade"),
            len: b8?.blockXml.length,
        });

        if (b7) {
            const slice73 = extractSliceByVerseRange(b7.blockXml, 73, 73);
            console.log("slice NEH7 73", {
                len: slice73.length,
                esdras: slice73.includes("Esdras"),
                snippet: slice73.replace(/\s+/g, " ").slice(0, 160),
            });
            const slice4_73 = extractSliceByVerseRange(b7.blockXml, 4, 73);
            console.log("slice NEH7 4-73", {
                len: slice4_73.length,
                esdras: slice4_73.includes("Esdras"),
            });
        }
        if (b8) {
            const slice2_18 = extractSliceByVerseRange(b8.blockXml, 2, 18);
            console.log("slice NEH8 2-18", {
                len: slice2_18.length,
                esdras: slice2_18.includes("Esdras"),
                cidade: slice2_18.includes("cidade"),
            });
        }

        expect(b7?.blockXml.includes("Esdras") ?? true).toBe(false);
        expect(b8?.lastVerse).toBeLessThanOrEqual(18);
        expect(b8?.blockXml.includes("cidade era grande") ?? false).toBe(false);
    }, 300000);
});
