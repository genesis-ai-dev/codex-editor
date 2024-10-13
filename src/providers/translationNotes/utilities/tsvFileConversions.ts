import { parseReferenceToList } from "bible-reference-range";
import type { ScriptureTSV, TSVRow } from "../../../../types/TsvTypes";

type TsvObject = {
    [key: string]: string;
};

/**
 * Converts a TSV string into a ScriptureTSV object.
 * @param tsv The TSV string to convert.
 * @returns A ScriptureTSV object.
 */
export const tsvStringToScriptureTSV: (tsv: string) => ScriptureTSV = (tsv) =>
    tsvFlatArrayToScriptureTSV(tsvStringToFlatArray(tsv) as TSVRow[]);

/**
 * Converts a TSV string to an array of TsvObject, with each object representing a row.
 * @param tsv The TSV string to convert.
 * @returns An array of TsvObject.
 */
export const tsvStringToFlatArray: (tsv: string) => TsvObject[] = (tsv) => {
    if (!tsv) {
        return [];
    }

    const lines = tsv.trim().split("\n");
    const [headerLine, ...dataLines] = lines;
    const headers = headerLine.split("\t");

    return dataLines.map((line) => {
        const values = line.split("\t");
        return headers.reduce(
            (obj, header, index) => ({
                ...obj,
                [header]: values[index] ?? "",
            }),
            {}
        );
    });
};

/**
 * Converts a flat array of TSV rows into a structured ScriptureTSV object.
 * @param flatTsvArray The array of TSV rows to convert.
 * @returns A ScriptureTSV object.
 */
export const tsvFlatArrayToScriptureTSV = (flatTsvArray: TSVRow[]): ScriptureTSV => {
    const tsvItems: TSVRow[] = Array.isArray(flatTsvArray) ? flatTsvArray : [];
    return tsvItems.reduce((scriptureTsv, note) => {
        const referenceList = note.Reference
            ? parseReferenceToList(note.Reference)
            : [{ chapter: note.Chapter || "", verse: note.Verse || "" }];

        return referenceList.reduce((acc, refChunk) => {
            return mapNoteToChaptersVerses(note, refChunk, acc);
        }, scriptureTsv);
    }, {} as ScriptureTSV);
};

/**
 * Maps a TSV row to its corresponding chapters and verses within the ScriptureTSV object.
 * @param note The TSV row to map.
 * @param refChunk The reference chunk indicating chapter and verse(s).
 * @param scriptureTsv The ScriptureTSV object being constructed.
 * @returns The updated ScriptureTSV object with the note mapped.
 */
function mapNoteToChaptersVerses(
    note: TSVRow,
    refChunk: { chapter: number; verse: number; endVerse?: number },
    scriptureTsv: ScriptureTSV
): ScriptureTSV {
    const { chapter, verse: startVerse, endVerse = startVerse } = refChunk;
    const verses = range(startVerse, endVerse);

    const updatedScriptureTsv = { ...scriptureTsv };
    verses.forEach((verse) => {
        const verseStr = verse.toString();
        if (!updatedScriptureTsv[chapter]) {
            updatedScriptureTsv[chapter] = {};
        }
        if (!updatedScriptureTsv[chapter][verseStr]) {
            updatedScriptureTsv[chapter][verseStr] = [];
        }
        updatedScriptureTsv[chapter][verseStr].push(note);
    });

    return updatedScriptureTsv;
}

/**
 * Generates an array of numbers between two bounds, inclusive.
 * @param start The start of the range.
 * @param end The end of the range.
 * @returns An array of numbers from start to end, inclusive.
 */
function range(start: number, end: number): number[] {
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
