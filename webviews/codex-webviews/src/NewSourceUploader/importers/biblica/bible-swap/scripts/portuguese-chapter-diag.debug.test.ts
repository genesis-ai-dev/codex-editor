/**
 * Prints the Bible chapter block, the study spans and the extracted slices for
 * specific chapters, so a validation failure can be traced to the paragraph that
 * was clipped, dropped or duplicated.
 *
 * Set BIBLE_SWAP_CASES="GEN-DEU:GEN:29,ISA-MAL:HAB:3" to pick cases.
 */
import { describe, it } from "vitest";
import {
    PORTUGUESE_VOLUMES,
    loadMainStory,
    loadMappingDocument,
    volumeFilesExist,
    volumePaths,
} from "./portugueseFullValidation";
import {
    bibleSlicesForStudyRange,
    buildBibleChapterBlockIndex,
    deserializeVersificationPlan,
    extractBibleXmlForSlices,
    getBibleSwapLanguageStrategy,
} from "../index";
import { buildChapterSpanIndex, getVerseNumbersInRegion } from "../chapterBlocks";
import { getParagraphIndex } from "../paragraphIndex";
import { collectContentText } from "../surgicalSwap";

const DEFAULT_CASES = "GEN-DEU:GEN:29,GEN-DEU:EXO:7,GEN-DEU:EXO:8,JOS-EST:1SA:14,JOS-EST:1KI:19,ISA-MAL:HAB:3";

interface DiagCase {
    volume: string;
    book: string;
    chapter: string;
}

function parseCases(): DiagCase[] {
    return (process.env.BIBLE_SWAP_CASES ?? DEFAULT_CASES)
        .split(",")
        .map((raw) => raw.trim())
        .filter(Boolean)
        .map((raw) => {
            const [volume, book, chapter] = raw.split(":");
            return { volume, book, chapter };
        });
}

function plainText(xml: string, from: number, to: number): string {
    return collectContentText(xml, from, to).replace(/\s+/g, " ").trim();
}

function describeParagraphs(xml: string, label: string): void {
    const paras = getParagraphIndex(xml);
    console.log(`  ${label}: ${paras.length} paragraphs`);
    paras.forEach((para, i) => {
        const verses = getVerseNumbersInRegion(xml, para.bodyStart, para.bodyEnd);
        const style = para.appliedParagraphStyle.replace(/^ParagraphStyle\//, "");
        console.log(
            `    [${i}] ${style} v=[${verses.join(",")}] :: ${plainText(
                xml,
                para.bodyStart,
                para.bodyEnd
            ).slice(0, 120)}`
        );
    });
}

describe("Portuguese chapter diagnostics", () => {
    const cases = parseCases();
    const byVolume = new Map<string, DiagCase[]>();
    for (const c of cases) {
        byVolume.set(c.volume, [...(byVolume.get(c.volume) ?? []), c]);
    }

    for (const [volume, volumeCases] of byVolume) {
        it(`${volume}: ${volumeCases.map((c) => `${c.book} ${c.chapter}`).join(", ")}`, async () => {
            const pair = PORTUGUESE_VOLUMES.find((v) => v.volume === volume);
            if (!pair || !volumeFilesExist(pair)) {
                console.log(`SKIP ${volume}`);
                return;
            }
            const { study, bible } = volumePaths(pair);
            const studyXml = await loadMainStory(study);
            const bibleXml = await loadMainStory(bible);
            const strategy = getBibleSwapLanguageStrategy("portuguese");
            const blocks = buildBibleChapterBlockIndex(bibleXml, strategy.chapterBlockOptions);
            const plan = deserializeVersificationPlan(
                loadMappingDocument("portuguese", volume).plan
            );
            const studySpans = buildChapterSpanIndex(studyXml);

            for (const needle of (process.env.BIBLE_SWAP_FIND ?? "")
                .split("|||")
                .filter(Boolean)) {
                const paras = getParagraphIndex(bibleXml);
                const hit = paras.findIndex((p) =>
                    plainText(bibleXml, p.bodyStart, p.bodyEnd).includes(needle)
                );
                console.log(`\n@@@@@@ raw bible paragraphs around ${JSON.stringify(needle)} (para ${hit})`);
                if (hit < 0) continue;
                for (let i = Math.max(0, hit - 3); i < Math.min(paras.length, hit + 5); i++) {
                    const para = paras[i];
                    console.log(
                        `    [${i}] ${para.appliedParagraphStyle.replace(/^ParagraphStyle\//, "")}` +
                            ` v=[${getVerseNumbersInRegion(bibleXml, para.bodyStart, para.bodyEnd).join(",")}]` +
                            ` @${para.fullStart}-${para.fullEnd} :: ${plainText(bibleXml, para.bodyStart, para.bodyEnd).slice(0, 140)}`
                    );
                }
            }

            for (const c of volumeCases) {
                const key = `${c.book}|${c.chapter}`;
                console.log(`\n########## ${volume} ${key} ##########`);

                const block = blocks.get(key);
                if (!block) {
                    console.log("  NO BIBLE BLOCK");
                } else {
                    console.log(
                        `  bible block verses ${block.firstVerse}-${block.lastVerse}, len ${block.blockXml.length}`
                    );
                    describeParagraphs(block.blockXml, "bible");
                }

                const spans = studySpans.get(key) ?? [];
                console.log(`  study spans (${spans.length}):`);
                for (const span of spans) {
                    const slices = bibleSlicesForStudyRange(
                        plan,
                        span.book,
                        span.chapter,
                        span.firstVerse,
                        span.lastVerse
                    );
                    const replacement = extractBibleXmlForSlices(
                        blocks,
                        span.book,
                        slices
                    );
                    console.log(
                        `    span v${span.firstVerse}-${span.lastVerse} @${span.absStart}-${span.absEnd}` +
                            ` slices=${slices
                                .map((s) => `${s.chapter}:${s.firstVerse}-${s.lastVerse}`)
                                .join("|")}`
                    );
                    console.log(
                        `      studyText : ${plainText(studyXml, span.absStart, span.absEnd).slice(0, 140)}`
                    );
                    console.log(
                        `      replacement: ${plainText(replacement, 0, replacement.length).slice(0, 200)}`
                    );
                }

                console.log(
                    `  plan structureChapter:`,
                    plan.structureChapters.get(key)
                );
                console.log(`  plan inserts:`, plan.chapterInserts.get(key));
            }
        }, 900000);
    }
});
