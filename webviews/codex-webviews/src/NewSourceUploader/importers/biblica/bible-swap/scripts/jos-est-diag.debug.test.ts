import { describe, it } from "vitest";
import fs from "fs";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    buildVersificationPlan,
    bibleSlicesForStudyRange,
} from "../index";
import { buildChapterSpanIndex, extractSliceByVerseRange } from "../chapterBlocks";
import { extractBibleXmlForSlices } from "../versificationPlan";
import { buildStructureSwapSplices } from "../structureSwap";
import { buildBibleVerseIndex, listVerseKeys } from "../surgicalSwap";

const STUDY =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/File Testing/automated_app/english_bsb/JOS-EST.idml";
const BIBLE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/File Testing/automated_app/translated_bible/portuguese/06JOS-17EST_portuguese.idml";

async function loadStoryForBook(idmlPath: string, book: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(idmlPath)));
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.includes(`>${book}<`) || t.includes(`>${book}</`)) return t;
    }
    return "";
}

describe("JOS-EST diag", () => {
    it("NEH 8 and 1SA 7 span/splice trace", async () => {
        if (!fs.existsSync(STUDY) || !fs.existsSync(BIBLE)) return;

        const studyNeh = await loadStoryForBook(STUDY, "NEH");
        const bibleNeh = await loadStoryForBook(BIBLE, "NEH");
        const study1sa = await loadStoryForBook(STUDY, "1SA");
        const bible1sa = await loadStoryForBook(BIBLE, "1SA");

        const planNeh = buildVersificationPlan(studyNeh, bibleNeh);
        const blocksNeh = buildBibleChapterBlockIndex(bibleNeh);
        const neh8Spans = buildChapterSpanIndex(studyNeh).get("NEH|8") ?? [];
        const neh7Spans = buildChapterSpanIndex(studyNeh).get("NEH|7") ?? [];

        const { mergedSplices, stats } = buildStructureSwapSplices(
            studyNeh,
            blocksNeh,
            { bibleStoryXml: bibleNeh, versificationPlan: planNeh }
        );

        const { xml } = applyStructureSwapToStudyXml(studyNeh, blocksNeh, {
            bibleStoryXml: bibleNeh,
            versificationPlan: planNeh,
        });
        const exportIdx = buildBibleVerseIndex(xml);
        const bibleIdx = buildBibleVerseIndex(bibleNeh);

        const neh8Splices = mergedSplices.filter((s) =>
            neh8Spans.some((sp) => sp.absStart === s.absStart && sp.absEnd === s.absEnd)
        );

        const plan1sa = buildVersificationPlan(study1sa, bible1sa);
        const { xml: xml1sa } = applyStructureSwapToStudyXml(
            study1sa,
            buildBibleChapterBlockIndex(bible1sa),
            { bibleStoryXml: bible1sa, versificationPlan: plan1sa }
        );
        const export1sa = buildBibleVerseIndex(xml1sa);

        const censusSnippet = bibleIdx.get("NEH|7|6")?.text?.slice(0, 25) ?? "";
        const lawSnippet = bibleIdx.get("NEH|8|4")?.text?.slice(0, 25) ?? "";
        const bible8Spans = buildChapterSpanIndex(bibleNeh).get("NEH|8") ?? [];
        const bible8SpanDetails = bible8Spans.map((s) => ({
            range: `${s.firstVerse}-${s.lastVerse}`,
            blockMax: Math.max(
                ...[...s.blockXml.matchAll(/meta%3av"><Content>(\d+)/g)].map((m) =>
                    parseInt(m[1], 10)
                ),
                0
            ),
            hasLaw: s.blockXml.includes(lawSnippet.slice(0, 12)),
            hasCensus: s.blockXml.includes(censusSnippet.slice(0, 12)),
        }));
        const bible7Spans = buildChapterSpanIndex(bibleNeh).get("NEH|7") ?? [];
        const neh8Block = blocksNeh.get("NEH|8");
        const slices218 = bibleSlicesForStudyRange(planNeh, "NEH", "8", 2, 18);
        const direct218 = neh8Block
            ? extractBibleXmlForSlices(blocksNeh, "NEH", slices218)
            : "";
        const slice48 = neh8Block
            ? extractSliceByVerseRange(neh8Block.blockXml, 4, 8)
            : "";

        const boundarySplice = mergedSplices.find((s) => s.absStart === 9544763);
        const span218Splice = mergedSplices.find((s) => s.absStart === 9547104);

        const sa7Spans = buildChapterSpanIndex(study1sa).get("1SA|7") ?? [];
        const { mergedSplices: sa7Splices } = buildStructureSwapSplices(
            study1sa,
            buildBibleChapterBlockIndex(bible1sa),
            { bibleStoryXml: bible1sa, versificationPlan: plan1sa }
        );

        // eslint-disable-next-line no-console
        console.log({
            xmlHasLaw: xml.includes(lawSnippet.slice(0, 15)),
            xmlHasCensus: xml.includes(censusSnippet.slice(0, 15)),
            exportNeh7High: listVerseKeys(exportIdx)
                .filter((k) => k.startsWith("NEH|7|"))
                .map((k) => parseInt(k.split("|")[2], 10))
                .filter((v) => v >= 60),
            boundaryMetaC7: (boundarySplice?.replacement.match(/meta%3ac/g) ?? []).length,
            boundaryMetaC8: (boundarySplice?.replacement.match(/meta%3ac"><Content>8/g) ?? []).length,
            span218HasLaw: span218Splice?.replacement.includes(lawSnippet.slice(0, 15)),
            span218RepLen: span218Splice?.replacement.length,
            direct218HasLaw: direct218.includes(lawSnippet.slice(0, 15)),
            direct218HasCensus: direct218.includes(censusSnippet.slice(0, 15)),
            slice48HasLaw: slice48.includes(lawSnippet.slice(0, 15)),
            slice48HasCensus: slice48.includes(censusSnippet.slice(0, 15)),
            bible8BlockRange: neh8Block
                ? `${neh8Block.firstVerse}-${neh8Block.lastVerse}`
                : null,
            bible8Spans: bible8Spans.map((s) => `${s.firstVerse}-${s.lastVerse}`),
            bible8SpanDetails,
            bible7SpansTail: bible7Spans.slice(-2).map((s) => `${s.firstVerse}-${s.lastVerse}`),
            slices218,
            sa7Spans: sa7Spans.map((s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}`),
            sa7Splices: sa7Splices
                .filter((s) => sa7Spans.some((sp) => sp.absStart === s.absStart))
                .map((s) => ({
                    abs: `${s.absStart}-${s.absEnd}`,
                    ch: s.studyChapter,
                    repLen: s.replacement.length,
                })),
            export1sa72: export1sa.get("1SA|7|2")?.text?.slice(0, 30),
            bible1sa72: buildBibleVerseIndex(bible1sa).get("1SA|7|2")?.text?.slice(0, 30),
        });

        // eslint-disable-next-line no-console
        console.log({
            neh7Spans: neh7Spans.map((s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}`),
            neh8Spans: neh8Spans.map((s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}`),
            neh8SpanSlices: neh8Spans.map((s) =>
                bibleSlicesForStudyRange(
                    planNeh,
                    s.book,
                    s.chapter,
                    s.firstVerse,
                    s.lastVerse
                )
            ),
            neh8Splices: neh8Splices.map((s) => ({
                abs: `${s.absStart}-${s.absEnd}`,
                ch: s.studyChapter,
                repLen: s.replacement.length,
            })),
            neh8Missing: stats.missingFromBible.filter((m) => m.chapter === "8"),
            exportNeh8Keys: listVerseKeys(exportIdx)
                .filter((k) => k.startsWith("NEH|8|"))
                .map((k) => k.split("|")[2])
                .slice(0, 25),
            exportMaxNeh8: Math.max(
                ...listVerseKeys(exportIdx)
                    .filter((k) => k.startsWith("NEH|8|"))
                    .map((k) => parseInt(k.split("|")[2], 10)),
                0
            ),
            neh84Export: exportIdx.get("NEH|8|4")?.text?.slice(0, 40),
            neh84Bible: bibleIdx.get("NEH|8|4")?.text?.slice(0, 40),
            neh74Export: exportIdx.get("NEH|7|4")?.text?.slice(0, 40),
            export1sa7: listVerseKeys(export1sa)
                .filter((k) => k.startsWith("1SA|7|"))
                .map((k) => k.split("|")[2]),
        });
    }, 600000);
});
