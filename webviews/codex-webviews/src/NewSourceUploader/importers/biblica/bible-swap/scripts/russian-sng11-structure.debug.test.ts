import { describe, it } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import { buildBibleChapterBlockIndex } from "../structureSwap";
import { buildBibleVerseIndex } from "../surgicalSwap";
import { extractSliceByVerseRange } from "../chapterBlocks";

const BIBLE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Russian Full Bible/18JOB-22SNG_russian.idml";

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

describe("Russian SNG 1:1 structure", () => {
    it("locates missing middle content", async () => {
        if (!fs.existsSync(BIBLE)) return;
        const bible = await loadMainStory(BIBLE);
        const idx = buildBibleVerseIndex(bible);
        const e = idx.get("SNG|1|1");
        console.log("SNG11 text", e?.text);
        console.log("SNG11 sig", e?.paragraphSig);
        console.log(
            "chunks",
            e?.paragraphChunks?.map(
                (c) =>
                    `${c.paragraphStyle} :: ${c.proseSegments.join("|").slice(0, 100)}`
            )
        );

        for (const needle of ["отрадней", "Целуй меня", "Первая встреча", "Она"]) {
            const pos = bible.indexOf(needle);
            console.log("needle", needle, "pos", pos);
            if (pos < 0) continue;
            const win = bible.slice(Math.max(0, pos - 800), pos + 120);
            console.log(
                "  styles",
                [...win.matchAll(/AppliedParagraphStyle="([^"]+)"/g)].map((m) => m[1]).slice(-6)
            );
        }

        const blocks = buildBibleChapterBlockIndex(bible);
        const b = blocks.get("SNG|1");
        console.log({
            blockHasOtradney: b?.blockXml.includes("отрадней"),
            blockHasLuchshaya: b?.blockXml.includes("Лучшая"),
            blockHasTseluyMenya: b?.blockXml.includes("Целуй меня"),
            blockHasPervayaVstrecha: b?.blockXml.includes("Первая встреча"),
            blockHasOna: /Она\./.test(b?.blockXml ?? ""),
        });
        const slice = extractSliceByVerseRange(b!.blockXml, 1, 1);
        console.log(
            "slice contents",
            [...slice.matchAll(/<Content>([^<]*)<\/Content>/g)]
                .map((m) => m[1])
                .filter((t) => t.trim() && !/^\d+$/.test(t.trim()))
        );
        // verseSpanXml from index
        console.log(
            "verseSpan styles",
            [
                ...(e?.verseSpanXml ?? "").matchAll(
                    /AppliedParagraphStyle="([^"]+)"/g
                ),
            ].map((m) => m[1])
        );
        console.log(
            "verseSpan has Целуй меня",
            (e?.verseSpanXml ?? "").includes("Целуй меня")
        );
        console.log(
            "verseSpan has Первая",
            (e?.verseSpanXml ?? "").includes("Первая")
        );
    }, 180000);
});
