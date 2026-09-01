import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    buildBibleVerseIndex,
    listPsalmChapterNumbersFromStory,
    listVerseKeys,
} from "../index";
import { listChapterContentVerseNumbers } from "../psalmVersification";

const BIBLE =
    "c:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Codex May 2026 - Bible Text Files/Portuguese Full Bible/18JOB-22SNG_porNVI23-FB-STD#2.idml";

async function loadLargestStory(path: string): Promise<string> {
    const zip = await JSZip.loadAsync(fs.readFileSync(path));
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
    return zip.file(bestKey!)!.async("string");
}

/** Walk PSA region and detect unclosed verse markers. */
function auditPsalmVerseClosures(storyXml: string): {
    unclosed: Array<{ chapter: string; verse: string }>;
    duplicateOpens: Array<{ chapter: string; verse: string; count: number }>;
    chapterMarkers: string[];
} {
    const unclosed: Array<{ chapter: string; verse: string }> = [];
    const openCounts = new Map<string, number>();
    const duplicateOpens: Array<{ chapter: string; verse: string; count: number }> =
        [];
    const chapterMarkers: string[] = [];

    let inPsa = false;
    let chapter = "";
    const openStack: Array<{ chapter: string; verse: string }> = [];

    const metaVRe =
        /CharacterStyle\/meta%3av[^>]*>[\s\S]*?<Content>(\d+)<\/Content>/g;

    const idx = storyXml.indexOf(">PSA</Content>");
    const region = idx >= 0 ? storyXml.slice(idx) : storyXml;

    const paraRe = /<ParagraphStyleRange AppliedParagraphStyle="([^"]+)"[\s\S]*?<\/ParagraphStyleRange>/g;
    let paraMatch;
    while ((paraMatch = paraRe.exec(region)) !== null) {
        const para = paraMatch[0];
        const style = paraMatch[1];

        if (/meta%3abk/.test(style)) {
            inPsa = true;
            chapter = "";
            continue;
        }
        if (!inPsa) continue;

        const chMatch = para.match(
            /CharacterStyle\/meta%3ac[^>]*>[\s\S]*?<Content>(\d+):?<\/Content>/
        );
        if (chMatch) {
            chapter = chMatch[1];
            chapterMarkers.push(chapter);
        }

        const markers: string[] = [];
        let m;
        metaVRe.lastIndex = 0;
        while ((m = metaVRe.exec(para)) !== null) {
            markers.push(m[1]);
        }

        for (const v of markers) {
            const key = `${chapter}|${v}`;
            const prev = openCounts.get(key) ?? 0;
            openCounts.set(key, prev + 1);

            if (openStack.length > 0 && openStack[openStack.length - 1].verse === v && openStack[openStack.length - 1].chapter === chapter) {
                openStack.pop();
            } else {
                openStack.push({ chapter, verse: v });
            }
        }
    }

    for (const [key, count] of openCounts) {
        if (count > 2) {
            const [ch, v] = key.split("|");
            duplicateOpens.push({ chapter: ch, verse: v, count });
        }
    }

    return { unclosed: openStack, duplicateOpens, chapterMarkers };
}

describe("Portuguese Bible structure audit", () => {
    it("reports PSA chapter markers, verse counts, and closure issues", async () => {
        const bibleXml = await loadLargestStory(BIBLE);
        const index = buildBibleVerseIndex(bibleXml);
        const audit = auditPsalmVerseClosures(bibleXml);
        const docChapters = listPsalmChapterNumbersFromStory(bibleXml);

        const psaChapterCounts: Record<string, number> = {};
        for (const key of listVerseKeys(index)) {
            if (!key.startsWith("PSA|")) continue;
            const [, ch] = key.split("|");
            psaChapterCounts[ch] = (psaChapterCounts[ch] ?? 0) + 1;
        }

        const psa1Text = index.get("PSA|1|1")?.text?.slice(0, 80);
        const psa26Text = index.get("PSA|2|6")?.text?.slice(0, 80);

        // eslint-disable-next-line no-console
        console.log({
            storyFileChars: bibleXml.length,
            psaChapterMarkerCount: docChapters.length,
            first15ChapterMarkersDocOrder: docChapters.slice(0, 15),
            first15ChapterMarkersAudit: audit.chapterMarkers.slice(0, 15),
            psa1ContentVerses: listChapterContentVerseNumbers(index, "PSA", "1"),
            psa2ContentVerses: listChapterContentVerseNumbers(index, "PSA", "2"),
            psa1v1Text: psa1Text,
            psa2v6Text: psa26Text,
            totalPsaChaptersInIndex: Object.keys(psaChapterCounts).length,
            psa1IndexedVerseCount: psaChapterCounts["1"],
            psa2IndexedVerseCount: psaChapterCounts["2"],
            unclosedVerseMarkers: audit.unclosed.slice(0, 10),
            duplicateOpenMarkers: audit.duplicateOpens.slice(0, 10),
        });

        expect(listChapterContentVerseNumbers(index, "PSA", "1")).toEqual([
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
        ]);
        expect(index.get("PSA|1|1")?.text?.length).toBeGreaterThan(10);
        expect(audit.unclosed.length).toBeLessThan(50);
    });
});
