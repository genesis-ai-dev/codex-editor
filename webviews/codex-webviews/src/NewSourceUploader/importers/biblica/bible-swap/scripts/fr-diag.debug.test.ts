import { describe, it } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import { buildBibleChapterBlockIndex } from "../structureSwap";
import { buildBibleVerseIndex } from "../surgicalSwap";
import { buildVersificationPlan } from "../index";

const STUDY =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/English IDML/JOB-SNG.idml";
const FR =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Codex May 2026 - Bible Text Files/French Full Bible/freBDS15u24-STD-FB_20240717_Packaged/18JOB-22SNG_freBDS15u24-STD-FB.idml";

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

describe("french chapter pollution diag", () => {
    it("dumps block/index/plan for problem chapters", async () => {
        const study = await largestStory(STUDY);
        const bible = await largestStory(FR);

        const blockIndex = buildBibleChapterBlockIndex(bible);
        const verseIndex = buildBibleVerseIndex(bible);
        const plan = buildVersificationPlan(study, bible);

        const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line

        for (const ch of ["22", "23", "24", "51", "52", "74", "75", "120"]) {
            const key = `PSA|${ch}`;
            const block = blockIndex.get(`PSA|${ch}`);
            // verses in verseIndex for this chapter
            const vIdx: number[] = [];
            for (const k of verseIndex.keys()) {
                const [b, c, v] = k.split("|");
                if (b === "PSA" && c === ch) vIdx.push(Number(v));
            }
            vIdx.sort((a, b) => a - b);
            const inserts = (plan.chapterInserts.get(key) ?? []).map((r) => r.verse);
            log(
                `PSA ${ch}: blockRange=${block ? `${block.firstVerse}-${block.lastVerse}` : "none"} | verseIdx=[${vIdx.length > 14 ? vIdx.slice(0, 4).join(",") + "..." + vIdx.slice(-3).join(",") : vIdx.join(",")}] (${vIdx.length}) | inserts=[${inserts.join(",")}]`
            );
        }
    }, 180000);
});
