import { ObsTsv, storyParagraphRef } from "./types";

export const parseObsTsv = <T>(tsv: string) => {
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
    }) as (T extends object ? T : ObsTsv)[];

    return parsedTsv;
};

export const tsvToStoryParagraphRef = <
    T extends {
        Reference: string;
    },
>(
    obsTsv: T[]
) => {
    const storyParagraphRef: storyParagraphRef<T> = {};
    obsTsv.forEach((row) => {
        const ref = row.Reference;
        const [story, paragraph] = ref.split(":");
        if (!storyParagraphRef[story]) {
            storyParagraphRef[story] = {};
        }

        if (!storyParagraphRef[story][paragraph]) {
            storyParagraphRef[story][paragraph] = [];
        }

        storyParagraphRef[story][paragraph].push(row);
    });
    return storyParagraphRef;
};
