import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    buildVersificationPlan,
    buildBibleVerseIndex,
    listPsalmChapterNumbersFromStory,
    resolveVersePlan,
    listVerseKeys,
} from "../index";

const STUDY =
    "c:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/English IDML/JOB-SNG.idml";
const BIBLE =
    "c:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Codex May 2026 - Bible Text Files/Portuguese Full Bible/18JOB-22SNG_porNVI23-FB-STD#2.idml";

async function loadLargestStory(path: string): Promise<string> {
    if (!fs.existsSync(path)) return "";
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
    if (!bestKey) return "";
    return zip.file(bestKey)!.async("string");
}

describe("PSA 1 redirect debug", () => {
    it("diagnoses why PSA 1:1 maps away from PSA 1:1", async () => {
        const studyXml = await loadLargestStory(STUDY);
        const bibleXml = await loadLargestStory(BIBLE);
        if (!studyXml || !bibleXml) return;

        const ordered = listPsalmChapterNumbersFromStory(studyXml);
        const idx1 = ordered.indexOf("1");
        const studyIdx = buildBibleVerseIndex(studyXml);

        const emptyBefore1 = ordered.slice(0, idx1).filter((ch) => {
            const count = listVerseKeys(studyIdx).filter((k) =>
                k.startsWith(`PSA|${ch}|`)
            ).length;
            return count === 0;
        });

        const plan = buildVersificationPlan(studyXml, bibleXml);
        const p11 = resolveVersePlan(plan, "PSA", "1", "1");
        const ch1Struct = plan.structureChapters.get("PSA|1");

        const ch42Verses = listVerseKeys(studyIdx)
            .filter((k) => k.startsWith("PSA|42|"))
            .map((k) => k.split("|")[2])
            .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

        const bibleIdx = buildBibleVerseIndex(bibleXml);
        const bibleCh42 = listVerseKeys(bibleIdx)
            .filter((k) => k.startsWith("PSA|42|"))
            .length;

        // eslint-disable-next-line no-console
        console.log({
            first15ChaptersDocOrder: ordered.slice(0, 15),
            chapter1IndexInDocOrder: idx1,
            chaptersBefore1: ordered.slice(0, idx1),
            emptyStudyChaptersBefore1: emptyBefore1,
            studyPsa42VerseCount: ch42Verses.length,
            studyPsa42Verses: ch42Verses,
            biblePsa42VerseCount: bibleCh42,
            studyPsa1VerseCount: listVerseKeys(studyIdx).filter((k) =>
                k.startsWith("PSA|1|")
            ).length,
            psa11Plan: p11,
            psa142Plan: resolveVersePlan(plan, "PSA", "42", "1"),
            psa1StructurePlan: ch1Struct,
        });

        expect(p11).toEqual({
            action: "replace",
            bible: { book: "PSA", chapter: "1", verse: "1" },
        });
    });
});
