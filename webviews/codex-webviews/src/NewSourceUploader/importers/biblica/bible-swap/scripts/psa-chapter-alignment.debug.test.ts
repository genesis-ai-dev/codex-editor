import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    buildBibleChapterBlockIndex,
    buildBibleVerseIndex,
    buildChapterBlockIndex,
    applyStructureSwapToStudyXml,
    listVerseKeys,
} from "../index";
import { buildChapterSpanIndex } from "../chapterBlocks";
import { biblePsalmChapterHasSubheaderV1 } from "../psalmVersification";

const STUDY =
    "c:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/English IDML/JOB-SNG.idml";
const BIBLE =
    "c:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Codex May 2026 - Bible Text Files/Portuguese Full Bible/18JOB-22SNG_porNVI23-FB-STD#2.idml";
const EXPORT =
    "c:/Users/marti/Downloads/forked-martin-portuguese-notes-rebuild-export-2026-06-11-1/JOB-SNG (1)_2026-06-11T20-05-21-451Z_biblica_translated_bible-swap.idml";

async function loadLargestStory(path: string): Promise<string> {
    const data = fs.readFileSync(path);
    const zip = await JSZip.loadAsync(data);
    let bestKey: string | null = null;
    let bestSize = -1;
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const file = zip.files[name];
        if (file.dir) continue;
        const size =
            (file as unknown as { _data?: { uncompressedSize?: number } })._data
                ?.uncompressedSize ?? 0;
        if (size > bestSize) {
            bestSize = size;
            bestKey = name;
        }
    }
    if (!bestKey) throw new Error(`No story in ${path}`);
    return zip.file(bestKey)!.async("string");
}

function psaChapterKeys(xml: string): string[] {
    return [...buildChapterSpanIndex(xml).keys()]
        .filter((k) => k.startsWith("PSA|"))
        .sort((a, b) => parseInt(a.split("|")[1], 10) - parseInt(b.split("|")[1], 10));
}

function firstVerseSnippet(xml: string, chapter: string, verse: string, len = 80): string {
    const re = new RegExp(
        `meta%3av"><Content>${verse}</Content>[\\s\\S]{0,800}?\\$ID\\/\\[No character style\\]"[^>]*>[\\s\\S]*?<Content>([^<]{10,${len}})`
    );
    const idx = xml.indexOf(">PSA</Content>");
    const sub = idx >= 0 ? xml.slice(idx) : xml;
    const chMarker = sub.search(new RegExp(`meta%3ac"><Content>${chapter}:`));
    if (chMarker < 0) return "";
    const region = sub.slice(chMarker, chMarker + 120000);
    const m = region.match(re);
    return m?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function chapterVerses(
    index: ReturnType<typeof buildBibleVerseIndex>,
    ch: string
): Array<{ v: number; text: string }> {
    const verses: Array<{ v: number; text: string }> = [];
    for (const k of listVerseKeys(index)) {
        const [b, c, v] = k.split("|");
        if (b !== "PSA" || c !== ch) continue;
        verses.push({
            v: parseInt(v, 10),
            text: index.get(k)?.text?.slice(0, 90) ?? "",
        });
    }
    verses.sort((a, b) => a.v - b.v);
    return verses;
}

describe("PSA chapter alignment debug (English study vs Portuguese Bible)", () => {
    it("compares chapter keys and PSA 9/23/24 regions", async () => {
        const studyXml = await loadLargestStory(STUDY);
        const bibleXml = await loadLargestStory(BIBLE);
        const exportXml = fs.existsSync(EXPORT)
            ? await loadLargestStory(EXPORT)
            : "";

        const studyKeys = psaChapterKeys(studyXml);
        const bibleKeys = psaChapterKeys(bibleXml);
        const studyIndex = buildChapterBlockIndex(studyXml);
        const bibleIndex = buildBibleChapterBlockIndex(bibleXml);
        const studyVerseIndex = buildBibleVerseIndex(studyXml);
        const bibleVerseIndex = buildBibleVerseIndex(bibleXml);

        // eslint-disable-next-line no-console
        console.log("PSA chapter counts", {
            study: studyKeys.length,
            bible: bibleKeys.length,
        });

        const mismatches: Array<{
            ch: string;
            studyVerses: number;
            bibleVerses: number;
            studyFirst?: string;
            bibleFirst?: string;
            subheaderV1: boolean;
        }> = [];

        for (let ch = 1; ch <= 30; ch++) {
            const key = `PSA|${ch}`;
            const sBlock = studyIndex.get(key);
            const bBlock = bibleIndex.get(key);
            if (!sBlock && !bBlock) continue;
            mismatches.push({
                ch: String(ch),
                studyVerses: sBlock?.lastVerse ?? 0,
                bibleVerses: bBlock?.lastVerse ?? 0,
                studyFirst: firstVerseSnippet(studyXml, String(ch), "1", 60),
                bibleFirst: firstVerseSnippet(bibleXml, String(ch), "1", 60),
                subheaderV1: biblePsalmChapterHasSubheaderV1(bibleVerseIndex, String(ch)),
            });
        }
        // eslint-disable-next-line no-console
        console.log("PSA ch 1-30 comparison", mismatches);

        for (const ch of [8, 9, 10, 23, 24, 25]) {
            const s = chapterVerses(studyVerseIndex, String(ch));
            const b = chapterVerses(bibleVerseIndex, String(ch));
            // eslint-disable-next-line no-console
            console.log(`PSA ${ch} verses`, {
                studyCount: s.length,
                bibleCount: b.length,
                studyLast: s[s.length - 1],
                bibleLast: b[b.length - 1],
                studyV1: s[0]?.text,
                bibleV1: b[0]?.text,
            });
        }

        const studySpans9 = buildChapterSpanIndex(studyXml).get("PSA|9");
        const studySpans8 = buildChapterSpanIndex(studyXml).get("PSA|8");
        // eslint-disable-next-line no-console
        console.log("Study spans PSA 8/9", {
            s8: studySpans8?.map((s) => ({
                first: s.firstVerse,
                last: s.lastVerse,
            })),
            s9: studySpans9?.map((s) => ({
                first: s.firstVerse,
                last: s.lastVerse,
            })),
        });

        if (exportXml) {
            // eslint-disable-next-line no-console
            console.log("Export PSA 9 v19-20 area", {
                v19: firstVerseSnippet(exportXml, "9", "19", 80),
                v20: firstVerseSnippet(exportXml, "9", "20", 80),
                v8in9: exportXml.includes("strike them with terror"),
                porTerror: exportXml.includes("Infundes-lhes terror") ||
                    exportXml.includes("terror"),
            });
            // eslint-disable-next-line no-console
            console.log("Export PSA 23 vs 24 headings", {
                study23: firstVerseSnippet(studyXml, "23", "1", 50),
                study24head: exportXml.includes("Psalm 24"),
                export24v1: firstVerseSnippet(exportXml, "24", "1", 80),
                bible23v1: firstVerseSnippet(bibleXml, "23", "1", 80),
            });
        }

        const { xml: swapped, stats } = applyStructureSwapToStudyXml(
            studyXml,
            bibleIndex,
            { bibleStoryXml: bibleXml }
        );
        // eslint-disable-next-line no-console
        console.log("Fresh swap PSA 9 v20", firstVerseSnippet(swapped, "9", "20", 100));
        // eslint-disable-next-line no-console
        console.log("Fresh swap still has English terror?", swapped.includes("strike them with terror"));
        // eslint-disable-next-line no-console
        console.log("Stats", {
            psalmSubheaderOffsets: stats.psalmSubheaderOffsets,
            psalmVersesInserted: stats.psalmVersesInserted,
            missing9: stats.missingFromBible.filter((m) => m.chapter === "9"),
        });

        expect(studyKeys.length).toBeGreaterThan(0);
        expect(bibleKeys.length).toBeGreaterThan(0);
    });
});
