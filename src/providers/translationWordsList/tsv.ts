import { ChapterVerseRef, TwlTsvRow } from "./types";

export const parseTwlTsv = (tsv: string) => {
    const lines = tsv.split("\n");
    const headers = lines[0].split("\t");
    const data = lines.slice(1).map((line) => line.split("\t"));
    const parsedTsv = data.map((line) => {
        return headers.reduce(
            (acc, header, i) => {
                acc[header] = line[i];
                return acc;
            },
            {} as Record<string, string>
        );
    }) as TwlTsvRow[];

    return parsedTsv;
};

export const tsvToChapterVerseRef = (twlTsv: TwlTsvRow[]) => {
    const chapterVerseRef: ChapterVerseRef = {};
    twlTsv.forEach((row) => {
        const ref = row.Reference;
        const [chapter, verse] = ref.split(":");
        if (!chapterVerseRef[chapter]) {
            chapterVerseRef[chapter] = {};
        }

        // check if a verse is a range
        if (verse?.includes("-")) {
            const [startVerse, endVerse] = verse.split("-").map(Number);
            for (let i = startVerse; i <= endVerse; i++) {
                if (!chapterVerseRef[chapter][i]) {
                    chapterVerseRef[chapter][i] = [];
                }
                chapterVerseRef[chapter][i].push(row);
            }
            return;
        }

        if (!chapterVerseRef[chapter][verse]) {
            chapterVerseRef[chapter][verse] = [];
        }

        chapterVerseRef[chapter][verse].push(row);
    });
    return chapterVerseRef;
};
