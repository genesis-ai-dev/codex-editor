/**
 * Inventory of paragraph styles in the English study files and the Portuguese
 * Bible files, with how many paragraphs carry verse markers. Used to confirm
 * which styles the chapter-block builder must treat as text / headings.
 */
import { describe, it } from "vitest";
import {
    PORTUGUESE_VOLUMES,
    loadMainStory,
    volumeFilesExist,
    volumePaths,
} from "./portugueseFullValidation";
import { getParagraphIndex } from "../paragraphIndex";
import { getVerseNumbersInRegion } from "../chapterBlocks";
import { collectContentText } from "../surgicalSwap";

interface StyleStat {
    paragraphs: number;
    withVerseMarker: number;
    sample: string;
}

function inventory(xml: string): Map<string, StyleStat> {
    const out = new Map<string, StyleStat>();
    for (const para of getParagraphIndex(xml)) {
        const style = para.appliedParagraphStyle.replace(/^ParagraphStyle\//, "");
        const stat =
            out.get(style) ??
            { paragraphs: 0, withVerseMarker: 0, sample: "" };
        stat.paragraphs++;
        if (getVerseNumbersInRegion(xml, para.bodyStart, para.bodyEnd).length > 0) {
            stat.withVerseMarker++;
        }
        if (!stat.sample) {
            stat.sample = collectContentText(xml, para.bodyStart, para.bodyEnd)
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 70);
        }
        out.set(style, stat);
    }
    return out;
}

function report(label: string, stats: Map<string, StyleStat>): void {
    console.log(`\n===== ${label} (${stats.size} styles)`);
    [...stats.entries()]
        .sort((a, b) => b[1].paragraphs - a[1].paragraphs)
        .forEach(([style, s]) => {
            console.log(
                `  ${style} | paras=${s.paragraphs} withVerse=${s.withVerseMarker} | ${s.sample}`
            );
        });
}

describe("Portuguese style inventory", () => {
    it("lists paragraph styles per volume", async () => {
        const studyTotals = new Map<string, StyleStat>();
        const bibleTotals = new Map<string, StyleStat>();

        const merge = (into: Map<string, StyleStat>, from: Map<string, StyleStat>) => {
            for (const [style, s] of from) {
                const cur =
                    into.get(style) ?? { paragraphs: 0, withVerseMarker: 0, sample: "" };
                cur.paragraphs += s.paragraphs;
                cur.withVerseMarker += s.withVerseMarker;
                if (!cur.sample) cur.sample = s.sample;
                into.set(style, cur);
            }
        };

        for (const pair of PORTUGUESE_VOLUMES) {
            if (!volumeFilesExist(pair)) continue;
            const { study, bible } = volumePaths(pair);
            merge(studyTotals, inventory(await loadMainStory(study)));
            merge(bibleTotals, inventory(await loadMainStory(bible)));
        }

        report("STUDY (English IDML, all volumes)", studyTotals);
        report("BIBLE (Portuguese, all volumes)", bibleTotals);
    }, 900000);
});
