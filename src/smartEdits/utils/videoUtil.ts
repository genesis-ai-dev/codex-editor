import fs from "fs/promises";
import path from "path";
import german_urls from "../staticResources/bibleProjectLinks/bp_de";
import french_urls from "../staticResources/bibleProjectLinks/bp_fr";
import english_urls from "../staticResources/bibleProjectLinks/bp_en";

export interface VideoEntry {
    videoId: string;
    title: string;
    range: string;
}

export async function findRelevantVideos(
    verseReference: string,
    languages: string[] = ["en", "de", "fr"]
): Promise<VideoEntry[]> {
    const [book, chapter, verse] = parseVerseReference(verseReference);
    const relevantVideos: VideoEntry[] = [];

    const urlMaps = {
        en: english_urls,
        de: german_urls,
        fr: french_urls,
    };

    for (const lang of languages) {
        const urls = urlMaps[lang as keyof typeof urlMaps];
        if (!urls) {
            console.warn(`No URLs found for language ${lang}. Skipping.`);
            continue;
        }

        const entries: VideoEntry[] = urls.map((entry) => ({
            ...entry,
            videoId: entry.url.split("v=")[1],
            url: undefined,
        }));

        for (const entry of entries) {
            if (isVideoRelevant(entry.range, book, chapter, verse)) {
                relevantVideos.push(entry);
            }
        }
    }

    console.log("RelevantVideos: ", relevantVideos);
    return relevantVideos;
}

function parseVerseReference(reference: string): [string, number, number] {
    const match = reference.match(/^(\d?\s?[A-Za-z]+)\s*(\d+)(?::(\d+))?$/);
    if (!match) throw new Error("Invalid verse reference format");

    const [, book, chapter, verse] = match;
    return [normalizeBookName(book), parseInt(chapter), verse ? parseInt(verse) : 1];
}

function normalizeBookName(book: string): string {
    // Add more normalizations as needed
    const normalizations: { [key: string]: string } = {
        Gen: "GEN",
        Genesis: "GEN",
        Exo: "EXO",
        Exodus: "EXO",
        // ... add more books
        Rev: "REV",
        Revelation: "REV",
    };

    const normalized = book.trim().replace(/\s+/g, "").toUpperCase();
    return normalizations[normalized] || normalized;
}

function isVideoRelevant(range: string, book: string, chapter: number, verse: number): boolean {
    const ranges = range.split(",").map((r) => r.trim());

    for (const r of ranges) {
        if (r === "TOTAL") return true;

        const [rangeBook, rangeChapters] = r.split(" ");
        if (rangeBook !== book) continue;

        if (rangeChapters === "ALL") return true;

        const [start, end] = rangeChapters.split("-").map(Number);
        if (end) {
            if (chapter >= start && chapter <= end) return true;
        } else {
            if (chapter === start) return true;
        }
    }

    return false;
}
