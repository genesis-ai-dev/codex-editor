/**
 * Dumps the Bible chapter-boundary paragraph behind the remaining "Wrong Text"
 * failures: every character range with its style and text, the chapter markers
 * the span builder sees, and how `clipChapterBoundarySpans` splits it.
 *
 * BIBLE_SWAP_BOUNDARY="GEN-DEU:feriu o Nilo,JOS-EST:desfiladeiro de Micmás"
 */
import { describe, it } from "vitest";
import {
    PORTUGUESE_VOLUMES,
    loadMainStory,
    volumeFilesExist,
    volumePaths,
} from "./bibleSwapValidation";
import {
    iterateChapterMarkersInParagraph,
    readChapterTransitionFromParagraph,
    getVerseNumbersInRegion,
} from "../chapterBlocks";
import { getParagraphIndex } from "../paragraphIndex";
import { collectContentText, iterateCsrAbs } from "../surgicalSwap";

const DEFAULT =
    "GEN-DEU:feriu o Nilo|||JOS-EST:desfiladeiro de Micm|||JOS-EST:instalado nas suas cidades|||ACT-REV:o bem de muitos";

function plain(xml: string, from: number, to: number): string {
    return collectContentText(xml, from, to)
        .replace(/[\u00ad\u2011]/g, "")
        .replace(/\s+/g, " ");
}

describe("Portuguese boundary paragraph diagnostics", () => {
    const cases = (process.env.BIBLE_SWAP_BOUNDARY ?? DEFAULT)
        .split("|||")
        .map((raw) => raw.trim())
        .filter(Boolean)
        .map((raw) => {
            const idx = raw.indexOf(":");
            return { volume: raw.slice(0, idx), needle: raw.slice(idx + 1) };
        });

    const byVolume = new Map<string, string[]>();
    for (const c of cases) {
        byVolume.set(c.volume, [...(byVolume.get(c.volume) ?? []), c.needle]);
    }

    for (const [volume, needles] of byVolume) {
        it(`${volume}`, async () => {
            const pair = PORTUGUESE_VOLUMES.find((v) => v.volume === volume);
            if (!pair || !volumeFilesExist(pair)) return;
            const bibleXml = await loadMainStory(volumePaths(pair).bible);
            const paras = getParagraphIndex(bibleXml);

            for (const needle of needles) {
                const hit = paras.findIndex((p) =>
                    plain(bibleXml, p.bodyStart, p.bodyEnd).includes(needle)
                );
                console.log(`\n@@@@@@ ${volume} :: ${JSON.stringify(needle)} → paragraph ${hit}`);
                if (hit < 0) continue;

                for (let i = Math.max(0, hit - 1); i <= Math.min(paras.length - 1, hit + 1); i++) {
                    const para = paras[i];
                    const style = para.appliedParagraphStyle.replace(/^ParagraphStyle\//, "");
                    console.log(
                        `\n  --- paragraph[${i}] ${style} v=[${getVerseNumbersInRegion(bibleXml, para.bodyStart, para.bodyEnd).join(",")}] body=${para.bodyStart}-${para.bodyEnd}`
                    );
                    console.log(
                        `      chapterTransition=${readChapterTransitionFromParagraph(bibleXml, para.appliedParagraphStyle, para.bodyStart, para.bodyEnd, "")}`
                    );
                    console.log(
                        `      markers=${[
                            ...iterateChapterMarkersInParagraph(bibleXml, para.bodyStart, para.bodyEnd),
                        ]
                            .map((m) => `ch${m.chapter}@${m.absPos}`)
                            .join(" ")}`
                    );
                    for (const csr of iterateCsrAbs(bibleXml, para.bodyStart, para.bodyEnd)) {
                        const cs = csr.appliedCharacterStyle.replace(/^CharacterStyle\//, "");
                        const text = plain(bibleXml, csr.absBodyStart, csr.absBodyEnd);
                        console.log(
                            `      @${csr.absFullStart}-${csr.absFullEnd} ${cs} :: ${JSON.stringify(text.slice(0, 70))}`
                        );
                    }
                }
            }
        }, 900000);
    }
});
