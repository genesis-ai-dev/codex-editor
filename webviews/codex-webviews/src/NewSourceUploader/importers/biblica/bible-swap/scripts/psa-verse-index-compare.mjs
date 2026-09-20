import fs from "fs";
import JSZip from "jszip";

// Minimal inline - import via dynamic from vitest not available; duplicate walk via regex on meta:v pairs

const STUDY =
    "c:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/English IDML/JOB-SNG.idml";
const BIBLE =
    "c:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Codex May 2026 - Bible Text Files/Portuguese Full Bible/18JOB-22SNG_porNVI23-FB-STD#2.idml";

async function loadStory(path) {
    const zip = await JSZip.loadAsync(fs.readFileSync(path));
    const stories = Object.keys(zip.files)
        .filter((n) => n.startsWith("Stories/") && n.endsWith(".xml"))
        .map((n) => ({ n, s: zip.files[n]._data?.uncompressedSize ?? 0 }))
        .sort((a, b) => b.s - a.s);
    return zip.file(stories[0].n).async("string");
}

// Use vitest-transpiled modules through a tiny runner
const { buildBibleVerseIndex, listVerseKeys } = await import(
    "../surgicalSwap.ts"
);

function chapterVerses(index, ch) {
    const verses = [];
    for (const k of listVerseKeys(index)) {
        const [b, c, v] = k.split("|");
        if (b !== "PSA" || c !== ch) continue;
        const e = index.get(k);
        verses.push({ v: +v, text: e?.text?.slice(0, 70) ?? "" });
    }
    verses.sort((a, b) => a.v - b.v);
    return verses;
}

const studyXml = await loadStory(STUDY);
const bibleXml = await loadStory(BIBLE);
const studyIdx = buildBibleVerseIndex(studyXml);
const bibleIdx = buildBibleVerseIndex(bibleXml);

for (const ch of [8, 9, 10, 23, 24, 25]) {
    const s = chapterVerses(studyIdx, String(ch));
    const b = chapterVerses(bibleIdx, String(ch));
    console.log(`\nPSA ${ch}: study ${s.length} verses, bible ${b.length} verses`);
    if (s.length) console.log("  study last:", s[s.length - 1]);
    if (b.length) console.log("  bible last:", b[b.length - 1]);
    if (s.length && b.length) {
        console.log("  study v1:", s[0].text);
        console.log("  bible v1:", b[0].text);
    }
}

// Find study v20 ch9 and ch8
for (const ch of [8, 9]) {
    const e = studyIdx.get(`PSA|${ch}|20`);
    if (e) console.log(`\nSTUDY PSA ${ch}:20 =`, e.text.slice(0, 100));
}
for (const ch of [8, 9, 10]) {
    const e = bibleIdx.get(`PSA|${ch}|20`);
    if (e) console.log(`BIBLE PSA ${ch}:20 =`, e.text.slice(0, 100));
}
