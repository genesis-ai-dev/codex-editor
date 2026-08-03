import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildBibleVerseIndex,
    buildVersificationPlan,
    verseKey,
} from "../index";
import { biblePsalmChapterHasSubheaderV1 } from "../psalmVersification";
import {
    buildChapterSpanIndex,
    extractSliceByVerseRange,
} from "../chapterBlocks";

const BASE =
    "c:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/file testing/export-test";

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

describe("structureSwap real JOB-SNG debug", () => {
    it("diagnoses PSA chapter 2 span and slice", async () => {
        const studyXml = await loadLargestStory(`${BASE}/JOB-SNG.idml`);
        const bibleXml = await loadLargestStory(
            `${BASE}/18JOB-22SNG_rusNRT23-FB_lux#2.idml`
        );
        const bibleIndex = buildBibleChapterBlockIndex(bibleXml);
        const bibleVerseIndex = buildBibleVerseIndex(bibleXml);
        const hasSubheader = biblePsalmChapterHasSubheaderV1(bibleVerseIndex, "2");
        const v1Entry = bibleVerseIndex.get(verseKey("PSA", "2", "1"));
        // eslint-disable-next-line no-console
        console.log("PSA|2 bible subheader v1", { hasSubheader, isSubheader: v1Entry?.isSubheader });
        const studySpans = buildChapterSpanIndex(studyXml);
        const bibleBlock = bibleIndex.get("PSA|2");
        const spans = studySpans.get("PSA|2");
        const psaKeys = [...studySpans.keys()].filter((k) => k.startsWith("PSA|"));
        // eslint-disable-next-line no-console
        console.log("PSA study span keys sample", psaKeys.slice(0, 15));

        expect(bibleBlock).toBeDefined();
        expect(spans?.length ?? 0).toBeGreaterThan(0);

        const span = spans![0];
        const slice = extractSliceByVerseRange(
            bibleBlock!.blockXml,
            span.firstVerse,
            span.lastVerse
        );

        // eslint-disable-next-line no-console
        console.log("PSA|2 study span", {
            count: spans!.length,
            firstVerse: span.firstVerse,
            lastVerse: span.lastVerse,
            spanLen: span.blockXml.length,
        });
        // eslint-disable-next-line no-console
        console.log("PSA|2 bible block", {
            firstVerse: bibleBlock!.firstVerse,
            lastVerse: bibleBlock!.lastVerse,
            blockLen: bibleBlock!.blockXml.length,
        });
        // eslint-disable-next-line no-console
        console.log("PSA|2 slice len", slice.length);

        const offsetSlice = extractSliceByVerseRange(
            bibleBlock!.blockXml,
            span.firstVerse + (hasSubheader ? 1 : 0),
            span.lastVerse + (hasSubheader ? 1 : 0)
        );
        // eslint-disable-next-line no-console
        console.log("PSA|2 offset slice len", offsetSlice.length, "vs naive", slice.length);

        const plan = buildVersificationPlan(studyXml, bibleXml);
        const { xml, stats } = applyStructureSwapToStudyXml(studyXml, bibleIndex, {
            bibleStoryXml: bibleXml,
            versificationPlan: plan,
        });
        // eslint-disable-next-line no-console
        console.log("swap stats sample", {
            psalmSubheaderOffsets: stats.psalmSubheaderOffsets,
            replacedCount: stats.replacedCount,
            missingPsa2: stats.missingFromBible.filter((m) => m.chapter === "2").length,
        });

        const psalm2Label = xml.indexOf("Psalm 2");
        expect(psalm2Label).toBeGreaterThanOrEqual(0);
        const region = xml.slice(psalm2Label, psalm2Label + 80000);
        const verses = [
            ...region.matchAll(/meta%3av"><Content>(\d+)<\/Content>/g),
        ].map((m) => m[1]);
        // eslint-disable-next-line no-console
        console.log("PSA|2 export verse markers", verses.length, [...new Set(verses)].slice(0, 15));

        expect(slice.length).toBeGreaterThan(0);
        expect(verses.length).toBeGreaterThan(0);
        expect(stats.replacedCount).toBeGreaterThan(0);
    });
});
