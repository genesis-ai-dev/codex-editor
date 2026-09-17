import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
    bibleSlicesForStudyRange,
    extractBibleXmlForSlices,
} from "../index";
import {
    buildChapterSpanIndex,
    extractSliceByVerseRange,
} from "../chapterBlocks";
import { buildBibleVerseIndex, listVerseKeys } from "../surgicalSwap";

const STUDY =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/File Testing/automated_app/english_bsb/JOS-EST.idml";
const BIBLE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Portuguese Full Bible/06JOS-17EST_portuguese.idml";

async function loadStoryForBook(idmlPath: string, book: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(idmlPath)));
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.includes(`>${book}<`) || t.includes(`>${book}</`)) return t;
    }
    return "";
}

function verseKeysForChapter(idx: ReturnType<typeof buildBibleVerseIndex>, book: string, ch: string): number[] {
    return listVerseKeys(idx)
        .filter((k) => k.startsWith(`${book}|${ch}|`))
        .map((k) => parseInt(k.split("|")[2], 10))
        .sort((a, b) => a - b);
}

describe("JOS-EST Portuguese root-cause analysis", () => {
    it("categorizes whether bible file or swap logic causes the 69 issues", async () => {
        if (!fs.existsSync(STUDY) || !fs.existsSync(BIBLE)) return;

        const books = ["NEH", "1SA", "2CH", "RUT"] as const;
        const loaded: Record<string, { study: string; bible: string }> = {};
        for (const book of books) {
            loaded[book] = {
                study: await loadStoryForBook(STUDY, book),
                bible: await loadStoryForBook(BIBLE, book),
            };
        }

        const report: Record<string, unknown> = {};

        // --- NEH 7/8 (largest cluster: ~24 issues) ---
        const { study: studyNeh, bible: bibleNeh } = loaded.NEH;
        const bibleIdxNeh = buildBibleVerseIndex(bibleNeh);
        const studyIdxNeh = buildBibleVerseIndex(studyNeh);
        const bibleSpansNeh8 = buildChapterSpanIndex(bibleNeh).get("NEH|8") ?? [];
        const studySpansNeh8 = buildChapterSpanIndex(studyNeh).get("NEH|8") ?? [];
        const blocksNeh = buildBibleChapterBlockIndex(bibleNeh);
        const neh8Block = blocksNeh.get("NEH|8");
        const planNeh = buildVersificationPlan(studyNeh, bibleNeh);

        const neh74Bible = bibleIdxNeh.get("NEH|7|4")?.text ?? "";
        const neh84Bible = bibleIdxNeh.get("NEH|8|4")?.text ?? "";
        const slices218 = bibleSlicesForStudyRange(planNeh, "NEH", "8", 2, 18);
        const extracted218 = extractBibleXmlForSlices(blocksNeh, "NEH", slices218);
        const slice48 = neh8Block
            ? extractSliceByVerseRange(neh8Block.blockXml, 4, 8)
            : "";

        const { xml: exportNeh } = applyStructureSwapToStudyXml(
            studyNeh,
            blocksNeh,
            { bibleStoryXml: bibleNeh, versificationPlan: planNeh }
        );
        const exportIdxNeh = buildBibleVerseIndex(exportNeh);

        report.NEH = {
            bibleVerseIndex: {
                ch7_max: Math.max(...verseKeysForChapter(bibleIdxNeh, "NEH", "7"), 0),
                ch8_keys: verseKeysForChapter(bibleIdxNeh, "NEH", "8"),
                ch8_4_snippet: neh84Bible.slice(0, 35),
                ch7_4_snippet: neh74Bible.slice(0, 35),
                ch7_4_is_census: neh74Bible.includes("cidade") || neh74Bible.includes("espa"),
                ch8_4_is_law: neh84Bible.includes("Esdras") || neh84Bible.includes("plata"),
            },
            bibleSpanIndex_ch8: bibleSpansNeh8.map((s) => ({
                range: `${s.firstVerse}-${s.lastVerse}`,
                blockMaxVerse: Math.max(
                    ...[...s.blockXml.matchAll(/meta%3av"><Content>(\d+)/g)].map((m) =>
                        parseInt(m[1], 10)
                    ),
                    0
                ),
            })),
            mergedBlock_ch8: neh8Block
                ? {
                      range: `${neh8Block.firstVerse}-${neh8Block.lastVerse}`,
                      len: neh8Block.blockXml.length,
                  }
                : null,
            extractSlice_4_8: {
                len: slice48.length,
                hasLaw: slice48.includes(neh84Bible.slice(0, 12)),
                hasCensus: slice48.includes(neh74Bible.slice(0, 12)),
            },
            extractSlices_2_18: {
                len: extracted218.length,
                hasLaw: extracted218.includes(neh84Bible.slice(0, 12)),
                hasCensus: extracted218.includes(neh74Bible.slice(0, 12)),
            },
            studySpanIndex_ch8: studySpansNeh8.map(
                (s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}`
            ),
            exportAfterSwap: {
                ch8_keys: verseKeysForChapter(exportIdxNeh, "NEH", "8"),
                ch8_4_present: Boolean(exportIdxNeh.get("NEH|8|4")),
                ch8_4_snippet: exportIdxNeh.get("NEH|8|4")?.text?.slice(0, 35),
                ch7_4_snippet: exportIdxNeh.get("NEH|7|4")?.text?.slice(0, 35),
            },
            verdict:
                neh84Bible.length > 0 &&
                !verseKeysForChapter(bibleIdxNeh, "NEH", "8").includes(70)
                    ? "BIBLE_INDEX_OK — swap/block extraction fails"
                    : "BIBLE_FILE_ISSUE — verse index wrong for NEH 8",
        };

        // --- 1SA 7 (16 missing verses) ---
        const { study: study1sa, bible: bible1sa } = loaded["1SA"];
        const bibleIdx1sa = buildBibleVerseIndex(bible1sa);
        const plan1sa = buildVersificationPlan(study1sa, bible1sa);
        const studySpans1sa7 = buildChapterSpanIndex(study1sa).get("1SA|7") ?? [];
        const { xml: export1sa } = applyStructureSwapToStudyXml(
            study1sa,
            buildBibleChapterBlockIndex(bible1sa),
            { bibleStoryXml: bible1sa, versificationPlan: plan1sa }
        );
        const exportIdx1sa = buildBibleVerseIndex(export1sa);

        report["1SA_7"] = {
            bible_ch7_keys: verseKeysForChapter(bibleIdx1sa, "1SA", "7"),
            study_spans: studySpans1sa7.map(
                (s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}`
            ),
            export_ch7_keys: verseKeysForChapter(exportIdx1sa, "1SA", "7"),
            bible_7_2_snippet: bibleIdx1sa.get("1SA|7|2")?.text?.slice(0, 30),
            export_7_2_present: Boolean(exportIdx1sa.get("1SA|7|2")),
            verdict:
                verseKeysForChapter(bibleIdx1sa, "1SA", "7").length >= 17
                    ? "BIBLE_INDEX_OK — swap loses 1SA 7:2-17"
                    : "BIBLE_FILE_ISSUE",
        };

        // --- 2CH 36 (book end: ~23 issues) ---
        const { study: study2ch, bible: bible2ch } = loaded["2CH"];
        const bibleIdx2ch = buildBibleVerseIndex(bible2ch);
        const studyIdx2ch = buildBibleVerseIndex(study2ch);
        const plan2ch = buildVersificationPlan(study2ch, bible2ch);
        const studySpans36 = buildChapterSpanIndex(study2ch).get("2CH|36") ?? [];
        const bibleSpans36 = buildChapterSpanIndex(bible2ch).get("2CH|36") ?? [];
        const { xml: export2ch } = applyStructureSwapToStudyXml(
            study2ch,
            buildBibleChapterBlockIndex(bible2ch),
            { bibleStoryXml: bible2ch, versificationPlan: plan2ch }
        );
        const exportIdx2ch = buildBibleVerseIndex(export2ch);

        report["2CH_36"] = {
            study_ch36_max: Math.max(...verseKeysForChapter(studyIdx2ch, "2CH", "36"), 0),
            bible_ch36_keys: verseKeysForChapter(bibleIdx2ch, "2CH", "36"),
            export_ch36_keys: verseKeysForChapter(exportIdx2ch, "2CH", "36"),
            study_spans: studySpans36.map((s) => `${s.firstVerse}-${s.lastVerse}`),
            bible_spans: bibleSpans36.map((s) => `${s.firstVerse}-${s.lastVerse}`),
            bible_has_36_23: bibleIdx2ch.has("2CH|36|23"),
            study_has_36_23: studyIdx2ch.has("2CH|36|23"),
            export_has_36_26: exportIdx2ch.has("2CH|36|26"),
            verdict:
                bibleIdx2ch.has("2CH|36|2") && bibleIdx2ch.has("2CH|36|22")
                    ? "BIBLE_INDEX_OK — swap/chapter-end handling fails"
                    : "BIBLE_FILE_ISSUE",
        };

        // --- RUT 4:22 (1 issue - trailing insert) ---
        const { study: studyRut, bible: bibleRut } = loaded.RUT;
        const bibleIdxRut = buildBibleVerseIndex(bibleRut);
        const studyIdxRut = buildBibleVerseIndex(studyRut);
        report.RUT = {
            study_ch4_max: Math.max(...verseKeysForChapter(studyIdxRut, "RUT", "4"), 0),
            bible_ch4_max: Math.max(...verseKeysForChapter(bibleIdxRut, "RUT", "4"), 0),
            bible_has_4_22: bibleIdxRut.has("RUT|4|22"),
            study_has_4_22: studyIdxRut.has("RUT|4|22"),
            verdict:
                bibleIdxRut.has("RUT|4|22") && !studyIdxRut.has("RUT|4|22")
                    ? "GENUINE_MISMATCH — bible-only trailing verse, needs chapter insert"
                    : "OTHER",
        };

        // eslint-disable-next-line no-console
        console.log(JSON.stringify(report, null, 2));

        // Bible verse index must be healthy for NEH 8 law text
        expect(bibleIdxNeh.has("NEH|8|4")).toBe(true);
        expect(verseKeysForChapter(bibleIdxNeh, "NEH", "8").includes(70)).toBe(false);
        expect(bibleIdx1sa.has("1SA|7|2")).toBe(true);
    }, 600000);
});
