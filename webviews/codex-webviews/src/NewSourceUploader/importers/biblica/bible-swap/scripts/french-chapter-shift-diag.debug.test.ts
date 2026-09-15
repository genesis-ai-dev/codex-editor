/**
 * Diagnoses the French chapter-division shifts (Hebrew vs English numbering).
 *
 * The French Bible follows the Hebrew chapter divisions for several prophets
 * (JOL 3/4, MAL 3/4, DAN 3/4, HOS 1/2, JON 1/2, ZEC 1/2, …), so the study and
 * Bible chapter *sets* differ even though the underlying verse sequence is the
 * same. This dumps, per book, the study vs Bible per-chapter verse counts and
 * checks whether a contiguous run of chapters has identical verse totals — the
 * precondition for realigning the run positionally instead of by chapter number.
 */
import { describe, it } from "vitest";
import {
    FRENCH_VOLUMES,
    loadMainStory,
    volumeFilesExist,
    volumePaths,
} from "./bibleSwapValidation";
import { buildBibleVerseIndex, listVerseKeys } from "../surgicalSwap";
import type { BibleVerseIndex } from "../surgicalSwap";

const num = (s: string) => parseInt(s, 10) || 0;

/** book -> chapter -> sorted verse numbers */
function chapterVerseCounts(index: BibleVerseIndex): Map<string, Map<string, number[]>> {
    const byBook = new Map<string, Map<string, number[]>>();
    for (const key of listVerseKeys(index)) {
        const [book, chapter, verse] = key.split("|");
        let chapters = byBook.get(book);
        if (!chapters) {
            chapters = new Map();
            byBook.set(book, chapters);
        }
        chapters.set(chapter, [...(chapters.get(chapter) ?? []), num(verse)]);
    }
    for (const chapters of byBook.values()) {
        for (const verses of chapters.values()) verses.sort((a, b) => a - b);
    }
    return byBook;
}

const chapterList = (chapters: Map<string, number[]>) =>
    [...chapters.keys()].sort((a, b) => num(a) - num(b));

const total = (chapters: Map<string, number[]>, keys: string[]) =>
    keys.reduce((sum, k) => sum + (chapters.get(k)?.length ?? 0), 0);

describe("French chapter-shift diagnostics", () => {
    for (const pair of FRENCH_VOLUMES) {
        it(`${pair.volume}`, async () => {
            if (!volumeFilesExist(pair, "french")) {
                console.log(`SKIP ${pair.volume}: inputs missing`);
                return;
            }
            const { study, bible } = volumePaths(pair, "french");
            const studyIdx = buildBibleVerseIndex(await loadMainStory(study));
            const bibleIdx = buildBibleVerseIndex(await loadMainStory(bible));

            const studyBooks = chapterVerseCounts(studyIdx);
            const bibleBooks = chapterVerseCounts(bibleIdx);

            for (const book of [...studyBooks.keys()].sort()) {
                const sCh = studyBooks.get(book)!;
                const bCh = bibleBooks.get(book) ?? new Map<string, number[]>();
                const sKeys = chapterList(sCh);
                const bKeys = chapterList(bCh);

                const sameChapterSet =
                    sKeys.length === bKeys.length && sKeys.every((k, i) => k === bKeys[i]);
                const sTotal = total(sCh, sKeys);
                const bTotal = total(bCh, bKeys);
                if (sameChapterSet && sTotal === bTotal) continue;

                console.log(
                    `\n@@@@@@ ${pair.volume} ${book}  studyChapters=${sKeys.length} bibleChapters=${bKeys.length}` +
                        `  studyVerses=${sTotal} bibleVerses=${bTotal}` +
                        `  bookTotalsMatch=${sTotal === bTotal}`
                );
                console.log(
                    `  study: ${sKeys.map((k) => `${k}(${sCh.get(k)!.length})`).join(" ")}`
                );
                console.log(
                    `  bible: ${bKeys.map((k) => `${k}(${bCh.get(k)!.length})`).join(" ")}`
                );
                console.log(`  studyOnlyChapters=${sKeys.filter((k) => !bCh.has(k)).join(",") || "-"}`);
                console.log(`  bibleOnlyChapters=${bKeys.filter((k) => !sCh.has(k)).join(",") || "-"}`);

                // Smallest contiguous chapter runs whose verse totals agree.
                const runs: string[] = [];
                let i = 0;
                let j = 0;
                let runStartI = 0;
                let runStartJ = 0;
                let sAcc = 0;
                let bAcc = 0;
                while (i < sKeys.length || j < bKeys.length) {
                    if (sAcc === bAcc && sAcc > 0) {
                        runs.push(
                            `study[${sKeys.slice(runStartI, i).join(",")}]=${sAcc} ↔ ` +
                                `bible[${bKeys.slice(runStartJ, j).join(",")}]=${bAcc}`
                        );
                        runStartI = i;
                        runStartJ = j;
                        sAcc = 0;
                        bAcc = 0;
                        continue;
                    }
                    if (sAcc <= bAcc && i < sKeys.length) {
                        sAcc += sCh.get(sKeys[i])!.length;
                        i++;
                    } else if (j < bKeys.length) {
                        bAcc += bCh.get(bKeys[j])!.length;
                        j++;
                    } else {
                        sAcc += sCh.get(sKeys[i])?.length ?? 0;
                        i++;
                    }
                }
                if (sAcc > 0 || bAcc > 0) {
                    runs.push(
                        `study[${sKeys.slice(runStartI).join(",")}]=${sAcc} ↔ ` +
                            `bible[${bKeys.slice(runStartJ).join(",")}]=${bAcc}` +
                            (sAcc === bAcc ? "" : "  <-- MISMATCH")
                    );
                }
                console.log(`  aligned runs:`);
                for (const r of runs) console.log(`    ${r}`);
            }
        }, 1800000);
    }
});
