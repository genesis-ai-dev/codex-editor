/**
 * LAM 1:22 Portuguese acrostic slice diagnostic.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
    deserializeVersificationPlan,
    bibleSlicesForStudyRange,
    extractBibleXmlForSlices,
    type BibleSwapMappingDocument,
} from "../index";
import { buildChapterSpanIndex, extractSliceByVerseRange } from "../chapterBlocks";
import { buildBibleVerseIndex, listVerseKeys } from "../surgicalSwap";
import { buildStructureSwapSplices, coalesceParagraphSplices, normalizeOverlappingSplices } from "../structureSwap";

const BASE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/File Testing/automated_app";
const STUDY = `${BASE}/english_bsb/ISA-MAL.idml`;
const BIBLE = `${BASE}/translated_bible/portuguese/23ISA-39MAL_portuguese.idml`;
const MAP = path.join(__dirname, "..", "language-mappings", "portuguese", "ISA-MAL.mapping.json");

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

describe("Portuguese LAM 1:22", () => {
    it("extracts and swaps the acrostic closing verse", async () => {
        if (!fs.existsSync(STUDY) || !fs.existsSync(BIBLE)) return;
        const study = await loadMainStory(STUDY);
        const bible = await loadMainStory(BIBLE);
        const plan = deserializeVersificationPlan(
            (JSON.parse(fs.readFileSync(MAP, "utf-8")) as BibleSwapMappingDocument).plan
        );
        const blocks = buildBibleChapterBlockIndex(bible);
        const bibleIdx = buildBibleVerseIndex(bible);

        const studySpans = buildChapterSpanIndex(study).get("LAM|1") ?? [];
        const bibleSpans = buildChapterSpanIndex(bible, {
            retainSectionHeadings: true,
            retainAcrosticHeadings: true,
            clipChapterBoundarySpans: true,
        }).get("LAM|1") ?? [];

        console.log(
            "study LAM1 spans",
            studySpans.map((s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}`)
        );
        console.log(
            "bible LAM1 spans",
            bibleSpans.map(
                (s) =>
                    `${s.firstVerse}-${s.lastVerse} acrostic=${/head%3aq|head:q|Álef|Alef|ת|Taw/i.test(s.blockXml)} len=${s.blockXml.length}`
            )
        );

        const block = blocks.get("LAM|1");
        console.log("merged LAM1", {
            first: block?.firstVerse,
            last: block?.lastVerse,
            has22text: block?.blockXml.includes("maldade"),
            len: block?.blockXml.length,
        });

        const slice22 = block ? extractSliceByVerseRange(block.blockXml, 22, 22) : "";
        console.log("slice 22", {
            len: slice22.length,
            snippet: slice22.replace(/\s+/g, " ").slice(0, 200),
            hasMaldade: slice22.includes("maldade"),
        });

        const slices = bibleSlicesForStudyRange(plan, "LAM", "1", 22, 22);
        console.log("plan slices for 22", slices);
        const xml22 = extractBibleXmlForSlices(blocks, "LAM", slices);
        console.log("extract slices 22", {
            len: xml22.length,
            hasMaldade: xml22.includes("maldade"),
        });

        // Last study span covering 22
        const last = studySpans[studySpans.length - 1];
        if (last) {
            const spanSlices = bibleSlicesForStudyRange(
                plan,
                last.book,
                last.chapter,
                last.firstVerse,
                last.lastVerse
            );
            console.log("last study span", last.firstVerse, last.lastVerse, "slices", spanSlices);
            const rep = extractBibleXmlForSlices(blocks, "LAM", spanSlices);
            console.log("last span replacement has 22?", {
                len: rep.length,
                hasMaldade: rep.includes("maldade"),
                verseMarks: [...rep.matchAll(/<Content>\s*(\d+)\s*<\/Content>/g)]
                    .map((m) => m[1])
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .slice(-8),
            });
            // Check trailing PSR balance and whether verse 22 is near the end
            const open = (rep.match(/<ParagraphStyleRange/g) ?? []).length;
            const close = (rep.match(/<\/ParagraphStyleRange>/g) ?? []).length;
            const maldadeInRep = rep.lastIndexOf("maldade");
            console.log("rep PSR balance", { open, close, maldadeFromEnd: rep.length - maldadeInRep });
            console.log("rep tail", rep.slice(-400).replace(/\s+/g, " "));
        }

        const built = buildStructureSwapSplices(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
            bibleVerseIndex: bibleIdx,
        });
        const lamSplices = built.splices.filter(
            (s) => s.absStart >= 5460000 && s.absStart <= 5610000
        );
        console.log(
            "LAM region raw splices",
            lamSplices.map((s) => ({
                ch: s.studyChapter,
                range: `${s.absStart}-${s.absEnd}`,
                repLen: s.replacement.length,
                hasQueToda: /Que toda/.test(s.replacement),
                hasMaldade: s.replacement.includes("maldade"),
                hasV22marker: /meta%3av[\s\S]{0,40}<Content>\s*22\s*</.test(s.replacement),
                tail: s.replacement.slice(-120).replace(/\s+/g, " "),
            }))
        );
        const lamMerged = built.mergedSplices.filter(
            (s) => s.absStart >= 5460000 && s.absStart <= 5610000
        );
        console.log(
            "LAM mergedSplices (actual apply input)",
            lamMerged.map((s) => ({
                ch: s.studyChapter,
                range: `${s.absStart}-${s.absEnd}`,
                repLen: s.replacement.length,
                hasQueToda: /Que toda/.test(s.replacement),
                hasMaldade: s.replacement.includes("maldade"),
                hasV22marker: /meta%3av[\s\S]{0,40}<Content>\s*22\s*</.test(s.replacement),
            }))
        );
        console.log(
            "plan removes touching LAM",
            [...plan.verseMap.entries()]
                .filter(([k, a]) => k.startsWith("LAM|") && a.action === "remove")
                .map(([k]) => k)
        );

        // Detect overlapping merged splices that would skip LAM1 on apply
        const sortedMerged = [...built.mergedSplices].sort(
            (a, b) => a.absStart - b.absStart
        );
        let cursor = 0;
        let lam1Applied = false;
        let skippedBy: { start: number; end: number; ch?: string } | null = null;
        for (const sp of sortedMerged) {
            if (sp.absStart === 5469155) {
                if (sp.absStart < cursor) {
                    skippedBy = { start: cursor, end: sp.absEnd, ch: sp.studyChapter };
                } else {
                    lam1Applied = true;
                }
            }
            if (sp.absStart < cursor) continue;
            cursor = Math.max(cursor, sp.absEnd);
        }
        console.log("LAM1 apply check", { lam1Applied, skippedBy, cursorAfter: cursor });

        const overlappingLam1 = sortedMerged.filter(
            (s) =>
                s.absStart < 5533510 &&
                s.absEnd > 5469155 &&
                !(s.absStart === 5469155 && s.absEnd === 5533510)
        );
        console.log(
            "splices overlapping LAM1 span",
            overlappingLam1.map((s) => ({
                ch: s.studyChapter,
                range: `${s.absStart}-${s.absEnd}`,
                repLen: s.replacement.length,
                hasQue: /Que toda/.test(s.replacement),
            }))
        );

        const { xml } = applyStructureSwapToStudyXml(study, blocks, {
            bibleStoryXml: bible,
            versificationPlan: plan,
            bibleVerseIndex: bibleIdx,
        });
        console.log("export has Que toda?", /Que toda/.test(xml));
        console.log("export Que toda pos", xml.search(/Que toda/));
        console.log("bible 21 full", bibleIdx.get("LAM|1|21")?.text);
        console.log("bible 22 full", bibleIdx.get("LAM|1|22")?.text);
        console.log(
            "slice22 meta:v22 count",
            (slice22.match(/meta%3av[\s\S]{0,40}<Content>\s*22\s*</g) ?? []).length,
            "cv:v22 count",
            (slice22.match(/cv%3av[\s\S]{0,40}<Content>\s*22\s*</g) ?? []).length
        );
        console.log("slice22 full text contents", [...slice22.matchAll(/<Content>([^<]*)<\/Content>/g)].map(m => m[1]).filter(t => t.trim()));
        // Count meta:v 22 after LAM region start (post-apply approx)
        {
            const re22 = /CharacterStyle\/meta%3av[\s\S]{0,120}?<Content>\s*22\s*<\/Content>/g;
            let m: RegExpExecArray | null;
            let late = 0;
            const positions: number[] = [];
            while ((m = re22.exec(xml)) !== null) {
                if (m.index > 5_000_000) {
                    late++;
                    positions.push(m.index);
                }
            }
            console.log("meta:v 22 after 5M", { late, positions: positions.slice(0, 8) });
        }
        // Locate the swapped LAM 1 region by searching for verse 1 + 21 text
        const v1 = bibleIdx.get("LAM|1|1")?.text?.slice(0, 25) ?? "";
        const v21 = bibleIdx.get("LAM|1|21")?.text?.slice(0, 25) ?? "";
        const v22 = bibleIdx.get("LAM|1|22")?.text?.slice(0, 25) ?? "";
        const p1 = v1 ? xml.indexOf(v1.slice(0, 15)) : -1;
        const p21 = v21 ? xml.indexOf(v21.slice(0, 15)) : -1;
        const p22 = v22 ? xml.indexOf(v22.slice(0, 15)) : -1;
        console.log("export positions", { p1, p21, p22, v22snip: v22 });
        const after21 = p21 >= 0 ? xml.slice(p21, p21 + 20000) : "";
        console.log("after p21 has gemidos?", after21.includes("gemidos"));
        console.log("after p21 has Que toda?", /Que toda/.test(after21));
        console.log("after p21 has maldade?", after21.includes("maldade"));
        console.log(
            "after p21 meta:v nums",
            [...after21.matchAll(/meta%3av[\s\S]{0,40}<Content>\s*(\d+)/g)]
                .map((m) => m[1])
                .slice(0, 15)
        );
        const permissive22 = [
            ...(block?.blockXml.matchAll(
                /CharacterStyle\/(?:meta%3av|meta:v|cv%3av|cv:v)[^>]*>[\s\S]{0,200}?<Content>([^<]*)<\/Content>/gi
            ) ?? []),
        ]
            .map((m) => m[1].trim())
            .filter((t) => /22/.test(t));
        console.log("permissive verse-22 marker contents", permissive22);
        // Walk-equivalent: does bible story contain the same single-marker pattern?
        const bibleLam1Start = bibleIdx.get("LAM|1|1")?.verseSpanXml?.slice(0, 80);
        console.log("bible 22 verseSpanXml len", bibleIdx.get("LAM|1|22")?.verseSpanXml?.length);
        console.log(
            "bible 22 verseSpan has cv/meta",
            {
                cv: /cv%3av/.test(bibleIdx.get("LAM|1|22")?.verseSpanXml ?? ""),
                meta: /meta%3av/.test(bibleIdx.get("LAM|1|22")?.verseSpanXml ?? ""),
                que: /Que toda/.test(bibleIdx.get("LAM|1|22")?.verseSpanXml ?? ""),
                spanSnippet: (bibleIdx.get("LAM|1|22")?.verseSpanXml ?? "")
                    .replace(/\s+/g, " ")
                    .slice(0, 250),
            }
        );
        // Index bible block with book+chapter markers
        const wrappedBlock =
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/meta%3abook">` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">` +
            `<Content>LAM</Content></CharacterStyleRange></ParagraphStyleRange>` +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>1.</Content></CharacterStyleRange>` +
            `</ParagraphStyleRange>` +
            (block?.blockXml ?? "");
        const blockIdx = buildBibleVerseIndex(wrappedBlock);
        console.log(
            "wrapped block keys",
            listVerseKeys(blockIdx).filter((k) => k.startsWith("LAM|1|")).slice(-5)
        );
        console.log("wrapped block 22", blockIdx.get("LAM|1|22")?.text?.slice(0, 40));

        // Simulate chapter 2 after the block (like real bible)
        const withCh2 =
            wrappedBlock +
            `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/text%3ap">` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3ac"><Content>2.</Content></CharacterStyleRange>` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/meta%3av"><Content>1</Content></CharacterStyleRange>` +
            `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>ch2v1</Content></CharacterStyleRange>` +
            `</ParagraphStyleRange>`;
        const withCh2Idx = buildBibleVerseIndex(withCh2);
        console.log(
            "block+ch2 keys tail",
            listVerseKeys(withCh2Idx).filter((k) => k.startsWith("LAM|")).slice(-6)
        );
        console.log("block+ch2 has 22?", withCh2Idx.get("LAM|1|22")?.text?.slice(0, 40));
        if (p21 >= 0) {
            console.log(
                "export after v21 (600 chars)",
                xml.slice(p21, p21 + 600).replace(/\s+/g, " ")
            );
            // How far after p21 until chapter 2 / next book marker?
            const ch2 = after21.search(/meta%3ac[\s\S]{0,40}<Content>\s*2\s*[.:]/);
            const gem = after21.indexOf("gemidos");
            console.log("after p21 offsets", { ch2, gem, len: after21.length });
            if (gem >= 0) {
                console.log(
                    "around gemidos",
                    after21.slice(Math.max(0, gem - 300), gem + 80).replace(/\s+/g, " ")
                );
            }
        }
        const exportIdx = buildBibleVerseIndex(xml);
        const keys = listVerseKeys(exportIdx).filter((k) => k.startsWith("LAM|1|"));
        console.log("export LAM1 keys", keys);
        console.log("export 22", exportIdx.get("LAM|1|22")?.text?.slice(0, 60));
        console.log("export has maldade?", xml.includes("maldade"));
        console.log("export LAM2 keys", listVerseKeys(exportIdx).filter((k) => k.startsWith("LAM|2|")));
        console.log("export has meta:v 22 near LAM?", /meta%3av[\s\S]{0,40}<Content>\s*22\s*</.test(xml));
        // Count meta:v 22 occurrences and surrounding chapter context
        const re = /CharacterStyle\/meta%3av[\s\S]{0,120}?<Content>\s*22\s*<\/Content>/g;
        let m: RegExpExecArray | null;
        let n = 0;
        while ((m = re.exec(xml)) && n < 5) {
            const pos = m.index;
            const window = xml.slice(Math.max(0, pos - 1500), pos + 200);
            const ch = [...window.matchAll(/meta%3ac[\s\S]{0,80}?<Content>([^<]+)/g)].map((x) => x[1]);
            const bookish = /LAM|Lam|Lament/i.test(window);
            console.log(`meta:v 22 #${n} at ${pos} recent meta:c=${ch.slice(-2)} lamContext=${bookish}`);
            n++;
        }
        // Compare bible vs export verse entry shapes for 21 and 22
        console.log("bible 21 entry", {
            text: bibleIdx.get("LAM|1|21")?.text?.slice(0, 40),
            structure: bibleIdx.get("LAM|1|21")?.structure,
        });
        console.log("bible 22 entry", {
            text: bibleIdx.get("LAM|1|22")?.text?.slice(0, 40),
            structure: bibleIdx.get("LAM|1|22")?.structure,
            isSubheader: bibleIdx.get("LAM|1|22")?.isSubheader,
        });
        // Find how bible indexes verse 22 - look at raw marker neighborhood
        const b22 = bible.indexOf(bibleIdx.get("LAM|1|22")?.text?.slice(0, 30) ?? "___");
        if (b22 >= 0) {
            console.log(
                "bible around 22 text",
                bible.slice(Math.max(0, b22 - 400), b22 + 80).replace(/\s+/g, " ")
            );
        }

        const studySpans2 = buildChapterSpanIndex(study).get("LAM|2") ?? [];
        console.log(
            "study LAM2 spans",
            studySpans2.map((s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}-${s.absEnd}`)
        );
        console.log(
            "study LAM1 span end",
            studySpans.map((s) => `${s.firstVerse}-${s.lastVerse}@${s.absStart}-${s.absEnd}`)
        );

        // Find maldade position relative to LAM meta:c markers in export
        const maldadePos = xml.indexOf("maldade");
        if (maldadePos >= 0) {
            const before = xml.slice(Math.max(0, maldadePos - 800), maldadePos);
            const metaCs = [...before.matchAll(/meta%3ac[\s\S]{0,80}?<Content>([^<]+)/g)].map(
                (m) => m[1]
            );
            const metaVs = [...before.matchAll(/meta%3av[\s\S]{0,80}?<Content>([^<]+)/g)]
                .map((m) => m[1])
                .slice(-5);
            console.log("before maldade meta:c", metaCs.slice(-3), "meta:v", metaVs);
        }

        expect(slice22.length).toBeGreaterThan(0);
        expect(exportIdx.get("LAM|1|22")?.text?.slice(0, 20)).toBe(
            bibleIdx.get("LAM|1|22")?.text?.slice(0, 20)
        );
    }, 300000);
});
