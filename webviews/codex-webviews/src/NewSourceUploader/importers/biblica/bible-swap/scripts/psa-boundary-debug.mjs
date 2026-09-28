import fs from "fs";
import JSZip from "jszip";

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

function region(xml, book, fromCh, toCh) {
    const bk = xml.indexOf(`<Content>${book}</Content>`);
    const sub = xml.slice(bk);
    const start = sub.search(new RegExp(`meta%3ac"><Content>${fromCh}:`));
    const end = sub.search(new RegExp(`meta%3ac"><Content>${toCh}:`));
    return sub.slice(start, end > start ? end : start + 150000);
}

function verseTexts(chunk) {
    const out = [];
    const re = /meta%3av"><Content>(\d+)<\/Content>[\s\S]*?\$ID\/\[No character style\]"[^>]*>[\s\S]*?<Content>([^<]{5,120})/g;
    let m;
    while ((m = re.exec(chunk))) {
        out.push({ v: m[1], t: m[2].replace(/\s+/g, " ").trim() });
    }
    return out;
}

const study = await loadStory(STUDY);
const bible = await loadStory(BIBLE);

console.log("=== STUDY PSA 8-10 ===");
for (const ch of ["8", "9", "10"]) {
    const chunk = region(study, "PSA", ch, String(+ch + 1));
    const verses = verseTexts(chunk);
    console.log(`ch${ch} (${verses.length} verses)`, verses.slice(0, 3), "...", verses.slice(-3));
}

console.log("\n=== BIBLE PSA 8-10 ===");
for (const ch of ["8", "9", "10"]) {
    const chunk = region(bible, "PSA", ch, String(+ch + 1));
    const verses = verseTexts(chunk);
    console.log(`ch${ch} (${verses.length} verses)`, verses.slice(0, 3), "...", verses.slice(-3));
}

console.log("\n=== STUDY PSA 22-26 ===");
for (const ch of ["22", "23", "24", "25", "26"]) {
    const chunk = region(study, "PSA", ch, String(+ch + 1));
    const verses = verseTexts(chunk);
    console.log(`ch${ch} (${verses.length} verses)`, verses[0], verses[verses.length - 1]);
}

console.log("\n=== BIBLE PSA 22-26 ===");
for (const ch of ["22", "23", "24", "25", "26"]) {
    const chunk = region(bible, "PSA", ch, String(+ch + 1));
    const verses = verseTexts(chunk);
    console.log(`ch${ch} (${verses.length} verses)`, verses[0], verses[verses.length - 1]);
}
