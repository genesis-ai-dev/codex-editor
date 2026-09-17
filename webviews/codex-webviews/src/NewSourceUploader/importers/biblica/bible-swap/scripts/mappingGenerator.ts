/**
 * Offline generator for the shipped `{language}/{VOLUME}.mapping.json` plans.
 *
 * The Bible IDMLs per language are preset, so the versification plan is derived
 * once here and committed next to the swap code. Regenerate whenever a
 * language's Bible files are replaced — a plan built against an older set of
 * Bible volumes silently marks the missing books as "remove", which strips them
 * from the export.
 */
import fs from "fs";
import path from "path";
import {
    buildBibleVerseIndex,
    buildVersificationPlanFromIndices,
    getBibleSwapLanguageStrategy,
    listVerseKeys,
    summarizeVersificationPlan,
    type BibleSwapMappingDocument,
    type BibleVerseIndex,
    type SerializedVersificationPlan,
    type VersificationPlan,
} from "../index";
import { loadMainStory, languageFixture, volumePaths, type VolumePair } from "./bibleSwapValidation";

const MAPPING_ROOT = path.join(__dirname, "..", "language-mappings");

/** Inverse of `deserializeVersificationPlan`. */
export function serializeVersificationPlan(
    plan: VersificationPlan
): SerializedVersificationPlan {
    const verseMappings: SerializedVersificationPlan["verseMappings"] = [];
    for (const [key, action] of plan.verseMap) {
        const [book, chapter, verse] = key.split("|");
        const study = { book, chapter, verse, key };
        if (action.action === "replace") {
            verseMappings.push({
                study,
                action: "replace",
                bible: action.bible,
                crossChapter: action.bible.chapter !== chapter || undefined,
            });
        } else {
            verseMappings.push({ study, action: "remove" });
        }
    }

    const chapterRemaps: SerializedVersificationPlan["chapterRemaps"] = [];
    for (const [book, perBook] of plan.chapterRemaps) {
        for (const [studyChapter, bibleChapter] of perBook) {
            chapterRemaps.push({ book, studyChapter, bibleChapter });
        }
    }

    const chapterInserts: SerializedVersificationPlan["chapterInserts"] = [];
    for (const [key, refs] of plan.chapterInserts) {
        const [book, studyChapter] = key.split("|");
        chapterInserts.push({
            book,
            studyChapter,
            verses: refs.map((r) => ({ bibleChapter: r.chapter, bibleVerse: r.verse })),
        });
    }

    const structureChapters: SerializedVersificationPlan["structureChapters"] = [];
    for (const ch of plan.structureChapters.values()) {
        structureChapters.push({
            book: ch.studyBook,
            studyChapter: ch.studyChapter,
            studyVerseStart: ch.studyVerseStart,
            studyVerseEnd: ch.studyVerseEnd,
            insertOnly: ch.insertOnly,
            bibleSlices: ch.bibleSlices,
        });
    }

    return {
        verseMappings,
        chapterRemaps,
        chapterInserts,
        structureChapters,
        trailingInserts: plan.trailingInserts,
        stats: plan.stats,
    };
}

interface BookOverlap {
    book: string;
    studyVerseCount: number;
    bibleVerseCount: number;
    missingInBible: number;
    extraInBible: number;
    overlapPercent: number;
}

function booksOf(index: BibleVerseIndex): Map<string, Set<string>> {
    const byBook = new Map<string, Set<string>>();
    for (const key of listVerseKeys(index)) {
        const [book] = key.split("|");
        const set = byBook.get(book) ?? new Set<string>();
        set.add(key);
        byBook.set(book, set);
    }
    return byBook;
}

function compareOverlap(study: BibleVerseIndex, bible: BibleVerseIndex): BookOverlap[] {
    const studyBooks = booksOf(study);
    const bibleBooks = booksOf(bible);
    const overlaps: BookOverlap[] = [];

    for (const book of new Set([...studyBooks.keys(), ...bibleBooks.keys()])) {
        const studyKeys = studyBooks.get(book) ?? new Set<string>();
        const bibleKeys = bibleBooks.get(book) ?? new Set<string>();
        const shared = [...studyKeys].filter((k) => bibleKeys.has(k)).length;
        overlaps.push({
            book,
            studyVerseCount: studyKeys.size,
            bibleVerseCount: bibleKeys.size,
            missingInBible: studyKeys.size - shared,
            extraInBible: bibleKeys.size - shared,
            overlapPercent:
                studyKeys.size > 0
                    ? Math.round((shared / studyKeys.size) * 10000) / 100
                    : 0,
        });
    }

    return overlaps.sort(
        (a, b) => b.missingInBible + b.extraInBible - (a.missingInBible + a.extraInBible)
    );
}

export interface GeneratedMapping {
    volume: string;
    document: BibleSwapMappingDocument;
    overlaps: BookOverlap[];
    elapsedSeconds: number;
}

export async function generateMappingForVolume(
    language: string,
    pair: VolumePair
): Promise<GeneratedMapping> {
    const started = Date.now();
    const { study, bible } = volumePaths(pair, language);
    const studyXml = await loadMainStory(study);
    const studyIndex = buildBibleVerseIndex(studyXml);
    const bibleIndex = buildBibleVerseIndex(await loadMainStory(bible));

    const plan = buildVersificationPlanFromIndices(studyXml, studyIndex, bibleIndex);
    const studyVerseCount = listVerseKeys(studyIndex).length;
    const summary = summarizeVersificationPlan(plan, studyVerseCount);

    const document: BibleSwapMappingDocument = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        language,
        languageLabel: getBibleSwapLanguageStrategy(language).label,
        studyVolume: pair.volume,
        files: {
            study: { name: pair.studyFile, path: study },
            bible: { name: pair.bibleFile, path: bible },
        },
        versificationSummary: {
            projectedVerseMatchPercent: summary.projectedVerseMatchPercent,
            versesMapped: summary.versesMapped,
            versesRemoved: summary.versesRemoved,
            versesInserted: summary.versesInserted,
        },
        plan: serializeVersificationPlan(plan),
    };

    return {
        volume: pair.volume,
        document,
        overlaps: compareOverlap(studyIndex, bibleIndex),
        elapsedSeconds: Math.round((Date.now() - started) / 100) / 10,
    };
}

function renderMarkdown(generated: GeneratedMapping): string {
    const { document: doc, overlaps } = generated;
    const summary = doc.versificationSummary ?? {};
    const gaps = overlaps.filter((o) => o.missingInBible > 0 || o.extraInBible > 0);

    const lines = [
        `# Versification Mapping: ${doc.languageLabel} · ${doc.studyVolume}`,
        "",
        `Generated: ${doc.generatedAt}`,
        `Study: ${doc.files.study.name}`,
        `Bible: ${doc.files.bible.name}`,
        "",
        "## Summary",
        "",
        `- Projected match: **${summary.projectedVerseMatchPercent}%**`,
        `- Mapped: ${summary.versesMapped} · Removed: ${summary.versesRemoved} · Inserted: ${summary.versesInserted}`,
        `- Chapter remaps: ${doc.plan.chapterRemaps.length} · Chapter inserts: ${doc.plan.chapterInserts.length} · Trailing inserts: ${doc.plan.trailingInserts.length}`,
        "",
        "## Books with versification gaps",
        "",
        "| Book | Study | Bible | Missing | Extra | Overlap |",
        "|------|------:|------:|--------:|------:|--------:|",
        ...gaps
            .slice(0, 25)
            .map(
                (o) =>
                    `| ${o.book} | ${o.studyVerseCount} | ${o.bibleVerseCount} | ${o.missingInBible} | ${o.extraInBible} | ${o.overlapPercent}% |`
            ),
    ];

    if (gaps.length === 0) lines.push("| — | — | — | — | — | — |");
    return `${lines.join("\n")}\n`;
}

export interface WrittenMapping {
    volume: string;
    projectedMatchPercent: number;
    versesMapped: number;
    versesRemoved: number;
    versesInserted: number;
    bibleFile: string;
    elapsedSeconds: number;
}

/** Writes `{VOLUME}.mapping.json` + `.md` and returns the summary row. */
export function writeMapping(language: string, generated: GeneratedMapping): WrittenMapping {
    const dir = path.join(MAPPING_ROOT, language);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, `${generated.volume}.mapping.json`),
        `${JSON.stringify(generated.document, null, 2)}\n`,
        "utf-8"
    );
    fs.writeFileSync(
        path.join(dir, `${generated.volume}.mapping.md`),
        renderMarkdown(generated),
        "utf-8"
    );

    const summary = generated.document.versificationSummary ?? {};
    return {
        volume: generated.volume,
        projectedMatchPercent: summary.projectedVerseMatchPercent ?? 0,
        versesMapped: summary.versesMapped ?? 0,
        versesRemoved: summary.versesRemoved ?? 0,
        versesInserted: summary.versesInserted ?? 0,
        bibleFile: generated.document.files.bible.name,
        elapsedSeconds: generated.elapsedSeconds,
    };
}

export function writeLanguageSummary(language: string, rows: WrittenMapping[]): void {
    const strategy = getBibleSwapLanguageStrategy(language);
    const doc = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        language,
        languageLabel: strategy.label,
        volumeCount: rows.length,
        volumes: rows.map((r) => ({
            studyVolume: r.volume,
            studyFile: `${r.volume}.idml`,
            bibleFile: r.bibleFile,
            projectedMatchPercent: r.projectedMatchPercent,
            versesMapped: r.versesMapped,
            versesRemoved: r.versesRemoved,
            versesInserted: r.versesInserted,
            mappingFile: `${r.volume}.mapping.json`,
            elapsedSeconds: r.elapsedSeconds,
        })),
    };
    fs.writeFileSync(
        path.join(MAPPING_ROOT, language, "_language-summary.json"),
        `${JSON.stringify(doc, null, 2)}\n`,
        "utf-8"
    );
}

/** Regenerates every volume of a language against its currently registered Bible files. */
export async function regenerateLanguageMappings(language: string): Promise<WrittenMapping[]> {
    const rows: WrittenMapping[] = [];
    for (const pair of languageFixture(language).volumes) {
        const generated = await generateMappingForVolume(language, pair);
        rows.push(writeMapping(language, generated));
    }
    writeLanguageSummary(language, rows);
    return rows;
}
