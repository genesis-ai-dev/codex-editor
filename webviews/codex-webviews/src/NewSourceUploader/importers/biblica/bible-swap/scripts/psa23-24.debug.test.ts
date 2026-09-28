import { describe, it, expect } from "vitest";
import fs from "fs";
import {
    buildBibleChapterBlockIndex,
    buildBibleVerseIndex,
    buildVersificationPlan,
    resolveVersePlan,
    bibleSlicesForStudyRange,
    collectVersificationChanges,
    applyStructureSwapToStudyXml,
    applySurgicalSwapToStudyXml,
    applyBibleSwap,
    listVerseKeys,
} from "../index";
import { buildChapterSpanIndex } from "../chapterBlocks";
import { listChapterContentVerseNumbers } from "../psalmVersification";

const STUDY =
    "c:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/English IDML/JOB-SNG/Stories/Story_u363.xml";
const BIBLE =
    "c:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/BIBLE Files/Codex May 2026 - Bible Text Files/Portuguese Full Bible/18JOB-22SNG_porNVI23-FB-STD#2/Stories/Story_u4b2.xml";

function verseSnippet(
    index: ReturnType<typeof buildBibleVerseIndex>,
    ch: string,
    v: string
): string {
    return index.get(`PSA|${ch}|${v}`)?.text?.slice(0, 90).replace(/\s+/g, " ") ?? "";
}

function firstVerseInXml(xml: string, chapter: string, verse: string): string {
    const idx = xml.indexOf(">PSA</Content>");
    const sub = idx >= 0 ? xml.slice(idx) : xml;
    const chMarker = sub.search(new RegExp(`meta%3ac"><Content>${chapter}:`));
    if (chMarker < 0) return "";
    const region = sub.slice(chMarker, chMarker + 150000);
    const re = new RegExp(
        `meta%3av"><Content>${verse}</Content>[\\s\\S]{0,1200}?\\$ID\\/\\[No character style\\]"[^>]*>[\\s\\S]*?<Content>([^<]{15,100})`
    );
    return region.match(re)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

describe("PSA 23/24 duplicate debug", () => {
    it("diagnoses why PSA 24 gets PSA 23 text", async () => {
        if (!fs.existsSync(STUDY) || !fs.existsSync(BIBLE)) return;

        const studyXml = fs.readFileSync(STUDY, "utf8");
        const bibleXml = fs.readFileSync(BIBLE, "utf8");

        const studyIndex = buildBibleVerseIndex(studyXml);
        const bibleIndex = buildBibleVerseIndex(bibleXml);
        const plan = buildVersificationPlan(studyXml, bibleXml);
        const changes = collectVersificationChanges(plan, studyIndex, bibleIndex);

        const studySpans = buildChapterSpanIndex(studyXml);
        const bibleSpans = buildChapterSpanIndex(bibleXml);

        const ch23Plan = plan.structureChapters.get("PSA|23");
        const ch24Plan = plan.structureChapters.get("PSA|24");

        const study23Content = listChapterContentVerseNumbers(studyIndex, "PSA", "23");
        const study24Content = listChapterContentVerseNumbers(studyIndex, "PSA", "24");
        const bible23Content = listChapterContentVerseNumbers(bibleIndex, "PSA", "23");
        const bible24Content = listChapterContentVerseNumbers(bibleIndex, "PSA", "24");

        const span23 = studySpans.get("PSA|23");
        const span24 = studySpans.get("PSA|24");

        const slices23 =
            span23?.map((s) =>
                bibleSlicesForStudyRange(plan, "PSA", "23", s.firstVerse, s.lastVerse)
            ) ?? [];
        const slices24 =
            span24?.map((s) =>
                bibleSlicesForStudyRange(plan, "PSA", "24", s.firstVerse, s.lastVerse)
            ) ?? [];

        const inserts23 = plan.chapterInserts.get("PSA|23") ?? [];
        const inserts24 = plan.chapterInserts.get("PSA|24") ?? [];

        // eslint-disable-next-line no-console
        console.log("=== PSA 23/24 verse counts ===", {
            study23Content,
            study24Content,
            bible23Content,
            bible24Content,
            study23v1: verseSnippet(studyIndex, "23", "1"),
            study24v1: verseSnippet(studyIndex, "24", "1"),
            bible23v1: verseSnippet(bibleIndex, "23", "1"),
            bible24v1: verseSnippet(bibleIndex, "24", "1"),
        });

        // eslint-disable-next-line no-console
        console.log("=== Plan structure chapters ===", {
            ch23Plan,
            ch24Plan,
            inserts23: inserts23.slice(0, 5),
            inserts24: inserts24.slice(0, 5),
        });

        // eslint-disable-next-line no-console
        console.log("=== Study spans ===", {
            span23: span23?.map((s) => ({
                first: s.firstVerse,
                last: s.lastVerse,
                len: s.blockXml.length,
            })),
            span24: span24?.map((s) => ({
                first: s.firstVerse,
                last: s.lastVerse,
                len: s.blockXml.length,
            })),
            bibleSpan23: bibleSpans.get("PSA|23")?.map((s) => ({
                first: s.firstVerse,
                last: s.lastVerse,
            })),
            bibleSpan24: bibleSpans.get("PSA|24")?.map((s) => ({
                first: s.firstVerse,
                last: s.lastVerse,
            })),
        });

        // eslint-disable-next-line no-console
        console.log("=== Bible slices for swap ===", { slices23, slices24 });

        const redirects2324 = changes.redirected.filter(
            (r) => r.studyChapter === "23" || r.studyChapter === "24"
        );
        // eslint-disable-next-line no-console
        console.log("=== Redirects 23/24 ===", redirects2324.slice(0, 10));

        const bibleBlockIndex = buildBibleChapterBlockIndex(bibleXml);
        const structure = applyStructureSwapToStudyXml(studyXml, bibleBlockIndex, {
            bibleStoryXml: bibleXml,
            versificationPlan: plan,
        });
        const surgical = applySurgicalSwapToStudyXml(structure.xml, bibleIndex, {
            versificationPlan: plan,
        });
        const full = applyBibleSwap(studyXml, bibleXml, { mode: "structure" });

        // eslint-disable-next-line no-console
        console.log("=== After swap verse 1 snippets ===", {
            structure23: firstVerseInXml(structure.xml, "23", "1"),
            structure24: firstVerseInXml(structure.xml, "24", "1"),
            surgical23: firstVerseInXml(surgical.xml, "23", "1"),
            surgical24: firstVerseInXml(surgical.xml, "24", "1"),
            full23: firstVerseInXml(full.xml, "23", "1"),
            full24: firstVerseInXml(full.xml, "24", "1"),
            bible23: verseSnippet(bibleIndex, "23", "1"),
            bible24: verseSnippet(bibleIndex, "24", "1"),
            same2324:
                firstVerseInXml(full.xml, "23", "1") ===
                firstVerseInXml(full.xml, "24", "1"),
        });

        expect(bible23Content.length).toBeGreaterThan(0);
        expect(bible24Content.length).toBeGreaterThan(0);
        expect(study24Content.length).toBeGreaterThan(0);
        expect(span24?.length).toBeGreaterThan(0);
        expect(resolveVersePlan(plan, "PSA", "23", "1")?.bible).toEqual({
            book: "PSA",
            chapter: "23",
            verse: "1",
        });
        expect(resolveVersePlan(plan, "PSA", "24", "1")?.bible).toEqual({
            book: "PSA",
            chapter: "24",
            verse: "1",
        });
        expect(
            verseSnippet(bibleIndex, "23", "1").slice(0, 30)
        ).not.toBe(verseSnippet(bibleIndex, "24", "1").slice(0, 30));
    });
});
