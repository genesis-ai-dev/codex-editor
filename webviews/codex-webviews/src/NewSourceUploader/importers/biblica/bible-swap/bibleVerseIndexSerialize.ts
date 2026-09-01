/**
 * Compact serialize/deserialize for passing a Bible verse index between worker
 * threads during compatibility analysis (plan building + change previews).
 */

import type { BibleVerseIndex, VerseEntry, VerseKey } from "./types";

export interface SerializedVerseEntry {
    text: string;
    isSubheader?: boolean;
    paragraphSig?: string;
}

export interface SerializedBibleVerseIndex {
    entries: Array<[VerseKey, SerializedVerseEntry]>;
}

export function serializeBibleVerseIndexForAnalysis(
    index: BibleVerseIndex
): SerializedBibleVerseIndex {
    const entries: Array<[VerseKey, SerializedVerseEntry]> = [];
    for (const [key, entry] of index.entries()) {
        entries.push([
            key,
            {
                text: entry.text,
                isSubheader: entry.isSubheader,
                paragraphSig: entry.paragraphSig,
            },
        ]);
    }
    return { entries };
}

export function deserializeBibleVerseIndexForAnalysis(
    data: SerializedBibleVerseIndex
): BibleVerseIndex {
    const index: BibleVerseIndex = new Map();
    for (const [key, serialized] of data.entries) {
        const entry: VerseEntry = {
            text: serialized.text,
            segments: [serialized.text],
            paragraphSig: serialized.paragraphSig ?? "",
            paragraphChunks: [],
            verseSpanXml: "",
            isSubheader: serialized.isSubheader ?? false,
        };
        index.set(key, entry);
    }
    return index;
}
