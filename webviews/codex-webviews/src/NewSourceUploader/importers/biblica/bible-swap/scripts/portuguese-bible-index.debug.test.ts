import { describe, it, expect } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    buildVersificationPlan,
    buildBibleVerseIndex,
    listPsalmChapterNumbersFromStory,
    sortedPsalmChapterNumbers,
    resolveVersePlan,
    listVerseKeys,
    collectVersificationChanges,
} from "../index";
import { listChapterContentVerseNumbers, listChapterVerseNumbers } from "../psalmVersification";
import { buildChapterSpanIndex } from "../chapterBlocks";

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

function chapterVerseSummary(
    index: ReturnType<typeof buildBibleVerseIndex>,
    chapter: string
): Array<{ verse: string; isSubheader: boolean; text: string }> {
    const all = listChapterVerseNumbers(index, "PSA", chapter);
    return all.map((v) => {
        const entry = index.get(`PSA|${chapter}|${v}` as const);
        return {
            verse: v,
            isSubheader: Boolean(entry?.isSubheader),
            text: (entry?.text ?? "").slice(0, 70).replace(/\s+/g, " "),
        };
    });
}

describe("Portuguese Bible PSA indexing debug", () => {
    it("audits Bible PSA 1/2 indexing and PSA 1:1 plan mapping", async () => {
        const studyXml = await loadLargestStory(STUDY);
        const bibleXml = await loadLargestStory(BIBLE);
        if (!studyXml || !bibleXml) return;

        const bibleIndex = buildBibleVerseIndex(bibleXml);
        const studyIndex = buildBibleVerseIndex(studyXml);

        const psa1All = chapterVerseSummary(bibleIndex, "1");
        const psa2All = chapterVerseSummary(bibleIndex, "2");
        const psa1Content = listChapterContentVerseNumbers(bibleIndex, "PSA", "1");
        const psa2Content = listChapterContentVerseNumbers(bibleIndex, "PSA", "2");

        const studyPsa1 = chapterVerseSummary(studyIndex, "1");
        const studyPsa42Count = listVerseKeys(studyIndex).filter((k) =>
            k.startsWith("PSA|42|")
        ).length;

        const plan = buildVersificationPlan(studyXml, bibleXml);
        const p11 = resolveVersePlan(plan, "PSA", "1", "1");
        const p12 = resolveVersePlan(plan, "PSA", "1", "2");
        const p16 = resolveVersePlan(plan, "PSA", "1", "6");

        const sorted = sortedPsalmChapterNumbers(studyXml, studyIndex, bibleIndex);
        const docOrder = listPsalmChapterNumbersFromStory(studyXml);

        const bibleSpans = buildChapterSpanIndex(bibleXml);
        const studySpans = buildChapterSpanIndex(studyXml);

        const changes = collectVersificationChanges(plan, studyIndex, bibleIndex);
        const psa1Redirects = changes.redirected.filter((r) => r.studyChapter === "1");

        // eslint-disable-next-line no-console
        console.log("=== BIBLE PSA 1 (all verses) ===");
        // eslint-disable-next-line no-console
        console.log(psa1All);
        // eslint-disable-next-line no-console
        console.log("Bible PSA 1 content verses:", psa1Content);
        // eslint-disable-next-line no-console
        console.log("=== BIBLE PSA 2 (all verses) ===");
        // eslint-disable-next-line no-console
        console.log(psa2All.slice(0, 15));
        // eslint-disable-next-line no-console
        console.log("Bible PSA 2 content verses:", psa2Content.slice(0, 15));

        // eslint-disable-next-line no-console
        console.log("=== STUDY PSA 1 ===");
        // eslint-disable-next-line no-console
        console.log(studyPsa1);
        // eslint-disable-next-line no-console
        console.log("Study PSA 42 verse count:", studyPsa42Count);

        // eslint-disable-next-line no-console
        console.log("=== PLAN PSA 1 ===");
        // eslint-disable-next-line no-console
        console.log({ psa11: p11, psa12: p12, psa16: p16 });
        // eslint-disable-next-line no-console
        console.log("PSA 1 redirects in changes:", psa1Redirects.slice(0, 5));
        // eslint-disable-next-line no-console
        console.log("Plan stats:", plan.stats);

        // eslint-disable-next-line no-console
        console.log("Chapter order:", {
            sortedFirst10: sorted.slice(0, 10),
            docOrderFirst10: docOrder.slice(0, 10),
            bibleSpanPsa1: bibleSpans.get("PSA|1")?.[0],
            studySpanPsa1: studySpans.get("PSA|1")?.[0],
        });

        // Check for unclosed / duplicate verse keys in bible PSA 1-2
        const psa12Keys = listVerseKeys(bibleIndex).filter((k) => {
            const [, ch] = k.split("|");
            return ch === "1" || ch === "2";
        });
        // eslint-disable-next-line no-console
        console.log("Bible PSA 1-2 key count:", psa12Keys.length);

        expect(psa1Content.length).toBeGreaterThan(0);
        expect(p11).toEqual({
            action: "replace",
            bible: { book: "PSA", chapter: "1", verse: psa1Content[0] },
        });
    });
});
