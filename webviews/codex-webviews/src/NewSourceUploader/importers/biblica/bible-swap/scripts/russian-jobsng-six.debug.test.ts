/**
 * Russian JOB-SNG — the 6 validation failures from 2026-07-27.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    deserializeVersificationPlan,
    extractBibleXmlForSlices,
    type BibleSwapMappingDocument,
} from "../index";
import { buildBibleVerseIndex } from "../surgicalSwap";
import { buildStructureSwapSplices } from "../structureSwap";
import { buildChapterSpanIndex, extractSliceByVerseRange } from "../chapterBlocks";
import { buildInsertSlicesFromRefs } from "../versificationPlan";

const BASE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing";
const STUDY = `${BASE}/File Testing/automated_app/english_bsb/JOB-SNG.idml`;
const BIBLE = `${BASE}/BIBLE Files/Russian Full Bible/18JOB-22SNG_russian.idml`;
const MAP = path.join(
    __dirname,
    "..",
    "language-mappings",
    "russian",
    "JOB-SNG.mapping.json"
);

async function loadMainStory(idmlPath: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(idmlPath)));
    let xml = "";
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const t = await zip.file(name)!.async("string");
        if (t.length > xml.length) xml = t;
    }
    return xml;
}

describe("Russian JOB-SNG six validation issues", () => {
    it("applies plan inserts and SNG 1:1 correctly", async () => {
        if (!fs.existsSync(STUDY) || !fs.existsSync(BIBLE)) return;

        const study = await loadMainStory(STUDY);
        const bible = await loadMainStory(BIBLE);
        const plan = deserializeVersificationPlan(
            (JSON.parse(fs.readFileSync(MAP, "utf-8")) as BibleSwapMappingDocument).plan
        );
        const bibleIdx = buildBibleVerseIndex(bible);
        const blocks = buildBibleChapterBlockIndex(bible);

        const keys = [
            "PSA|8|10",
            "PSA|110|8",
            "PSA|110|9",
            "PSA|110|10",
            "PSA|62|13",
            "SNG|1|1",
            "SNG|1|2",
        ];
        for (const k of keys) {
            const e = bibleIdx.get(k);
            console.log(k, {
                has: !!e,
                isSubheader: e?.isSubheader,
                text: e?.text?.slice(0, 60),
                sig: e?.paragraphSig,
            });
        }

        console.log(
            "plan inserts",
            {
                psa8: plan.chapterInserts.get("PSA|8"),
                psa110: plan.chapterInserts.get("PSA|110"),
                psa62: plan.chapterInserts.get("PSA|62"),
                psa111: plan.chapterInserts.get("PSA|111"),
            }
        );

        for (const [ch, verses] of [
            ["8", [10]],
            ["110", [8, 9, 10]],
        ] as const) {
            const block = blocks.get(`PSA|${ch}`);
            console.log(`PSA ${ch} block`, {
                range: `${block?.firstVerse}-${block?.lastVerse}`,
                len: block?.blockXml.length,
            });
            for (const v of verses) {
                const slice = block
                    ? extractSliceByVerseRange(block.blockXml, v, v)
                    : "";
                console.log(`  slice ${v}`, {
                    len: slice.length,
                    snip: slice.replace(/\s+/g, " ").slice(0, 120),
                });
            }
            const insertXml = extractBibleXmlForSlices(
                blocks,
                "PSA",
                buildInsertSlicesFromRefs(
                    (plan.chapterInserts.get(`PSA|${ch}`) ?? []).map((r) => ({
                        book: "PSA",
                        chapter: r.chapter,
                        verse: r.verse,
                    }))
                )
            );
            console.log(`  insertXml PSA ${ch}`, {
                len: insertXml.length,
                hasText: insertXml.length > 50,
            });
        }

        const sngBlock = blocks.get("SNG|1");
        const sngSpans = buildChapterSpanIndex(study).get("SNG|1") ?? [];
        console.log("SNG1 study spans", sngSpans.map((s) => `${s.firstVerse}-${s.lastVerse}`));
        console.log("SNG1 bible block", {
            range: `${sngBlock?.firstVerse}-${sngBlock?.lastVerse}`,
            hasPervaya: /Первая/.test(sngBlock?.blockXml ?? ""),
            hasTseluy: /Целуй/.test(sngBlock?.blockXml ?? ""),
            hasLuchshaya: /Лучшая/.test(sngBlock?.blockXml ?? ""),
        });
        const sng1slice = sngBlock
            ? extractSliceByVerseRange(sngBlock.blockXml, 1, 1)
            : "";
        console.log("SNG1 slice", {
            len: sng1slice.length,
            hasPervaya: /Первая/.test(sng1slice),
            hasTseluy: /Целуй/.test(sng1slice),
            hasVed: /ведь любовь/.test(sng1slice),
            speakers: [
                ...(sng1slice.matchAll(/head%3asp|head:sp/g) ?? []),
            ].length,
            heads: [...(sng1slice.matchAll(/head%3a/g) ?? [])].length,
        });

        const built = buildStructureSwapSplices(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
            bibleVerseIndex: bibleIdx,
        });
        const psa110Splices = built.mergedSplices.filter((s) => {
            const rep = s.replacement;
            return (
                /PSA|110/.test(String(s.studyChapter)) ||
                /Вечно тверды/.test(rep) ||
                (s.studyChapter === "110" && rep.length > 0)
            );
        });
        console.log(
            "PSA110-related splices",
            built.mergedSplices
                .filter((s) => s.studyChapter === "110" || /Вечно тверды/.test(s.replacement))
                .map((s) => ({
                    ch: s.studyChapter,
                    range: `${s.absStart}-${s.absEnd}`,
                    len: s.replacement.length,
                    has8: /Вечно тверды/.test(s.replacement),
                    has9: /искупление/.test(s.replacement),
                    has10: /Начало мудрости/.test(s.replacement),
                }))
        );
        console.log(
            "PSA8 splices",
            built.mergedSplices
                .filter(
                    (s) =>
                        s.studyChapter === "8" ||
                        /величественно имя/.test(s.replacement)
                )
                .map((s) => ({
                    ch: s.studyChapter,
                    range: `${s.absStart}-${s.absEnd}`,
                    len: s.replacement.length,
                    has10: /величественно имя/.test(s.replacement),
                }))
        );

        const { xml, stats } = applyStructureSwapToStudyXml(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
            bibleVerseIndex: bibleIdx,
        });
        console.log("swap stats", stats);
        const exportIdx = buildBibleVerseIndex(xml);

        for (const k of keys) {
            console.log("export", k, exportIdx.get(k)?.text?.slice(0, 70));
        }
        console.log("raw export has Вечно тверды?", xml.includes("Вечно тверды"));
        console.log("raw export has величественно?", xml.includes("величественно"));
        console.log("raw export has Целуй?", xml.includes("Целуй"));
        console.log("raw export has Первая?", xml.includes("Первая"));
        console.log(
            "PSA110 export keys",
            [...exportIdx.keys()].filter((k) => k.startsWith("PSA|110|"))
        );
        console.log(
            "PSA8 export keys",
            [...exportIdx.keys()].filter((k) => k.startsWith("PSA|8|"))
        );

        // Where do Первая/Целуй live in the bible story?
        const tseluy = bible.indexOf("Целуй");
        const pervaya = bible.indexOf("Первая");
        if (tseluy >= 0) {
            const win = bible.slice(Math.max(0, tseluy - 200), tseluy + 80);
            const style = win.match(/AppliedParagraphStyle="([^"]+)"/g);
            console.log("bible around Целуй styles", style?.slice(-3), win.replace(/\s+/g, " ").slice(0, 250));
        }
        if (pervaya >= 0) {
            const win = bible.slice(Math.max(0, pervaya - 200), pervaya + 80);
            const style = win.match(/AppliedParagraphStyle="([^"]+)"/g);
            console.log("bible around Первая styles", style?.slice(-3), win.replace(/\s+/g, " ").slice(0, 250));
        }

        expect(exportIdx.get("PSA|110|8")?.text).toContain("Вечно тверды");
        expect(exportIdx.get("PSA|110|9")?.text).toContain("искупление");
        expect(exportIdx.get("PSA|110|10")?.text).toContain("Начало мудрости");
        expect(exportIdx.get("PSA|8|10")?.text).toContain("величественно");
        expect(exportIdx.get("SNG|1|1")?.text).toContain("Лучшая");
        expect(exportIdx.get("SNG|1|1")?.text).toContain("Целуй");
        expect(exportIdx.get("SNG|1|1")?.text).toContain("отрадней");
        expect(xml).toContain("Псалом 62");
        expect(xml).not.toMatch(/Psalm 62\s*For the director/i);
    }, 600000);
});
