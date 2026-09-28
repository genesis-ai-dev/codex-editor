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

function locate(xml, label, needle) {
    const idx = xml.indexOf(needle);
    if (idx < 0) {
        console.log("NOT FOUND", label, needle);
        return;
    }
    const ctx = xml.slice(Math.max(0, idx - 2000), idx + 600);
    const chMarkers = [...ctx.matchAll(/meta%3ac"><Content>(\d+):/g)].map((m) => m[1]);
    const vMarkers = [...ctx.matchAll(/meta%3av"><Content>(\d+)<\/Content>/g)].map((m) => m[1]);
    const headCl = [...ctx.matchAll(/head%3acl"[^>]*>[\s\S]*?<Content>Psalm (\d+)<\/Content>/g)].map(
        (m) => m[1]
    );
    console.log(`\n${label}: "${needle.slice(0, 40)}..."`);
    console.log("  chapter markers before:", chMarkers.slice(-4));
    console.log("  head:cl Psalm N before:", headCl.slice(-2));
    console.log("  verse markers before:", vMarkers.slice(-6));
}

const study = await loadStory(STUDY);
const bible = await loadStory(BIBLE);

locate(study, "STUDY", "strike them with terror");
locate(bible, "BIBLE", "Infundes-lhes terror");
locate(study, "STUDY", "The Lord is my shepherd");
locate(bible, "BIBLE", "meu pastor");
locate(study, "STUDY", "Let the nations know they are only human");
locate(bible, "BIBLE", "nações que não passam de simples mortais");
