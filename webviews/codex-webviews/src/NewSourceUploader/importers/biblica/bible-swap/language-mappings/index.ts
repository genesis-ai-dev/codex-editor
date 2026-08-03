/**
 * Language mappings for Bible Swap.
 *
 * The Biblica Bible IDML files per language are preset and never change, so
 * the versification plan (study verse → bible verse alignment) for each
 * (language, study volume) pair is precomputed offline and shipped as
 * `{language}/{VOLUME}.mapping.json` next to this file. At export time the
 * user picks a supported language and the swap applies the stored plan
 * directly instead of re-deriving it from both IDMLs — the "Any" language
 * option keeps the original analyze-at-export behaviour.
 *
 * Per-language swap behaviour (preferred mode, forced structure volumes,
 * chapter-block flags, usability thresholds) lives in `./strategies`.
 */

import { chapterBlockKey, verseKey } from "../types";
import type {
    BibleVerseRef,
    BibleVerseSlice,
    VersificationPlan,
    VersificationPlanStats,
} from "../versificationPlan";
import {
    getBibleSwapLanguageStrategy,
    isMappedBibleSwapLanguageId,
    LANGUAGE_STRATEGIES,
    resolveSwapModeForLanguage,
    type BibleSwapLanguageStrategy,
} from "./strategies";

export {
    getBibleSwapLanguageStrategy,
    isMappedBibleSwapLanguageId,
    LANGUAGE_STRATEGIES,
    resolveSwapModeForLanguage,
};
export type {
    BibleSwapLanguageId,
    BibleSwapLanguageStrategy,
    BibleSwapMappedLanguageId,
    StudyVolumeId,
} from "./strategies";
export { ALL_STUDY_VOLUMES } from "./strategies";

/** Language choices offered in the export UI. "any" = analyze at export time. */
export interface BibleSwapLanguageOption {
    id: string;
    label: string;
    /** True when precomputed mapping files exist for this language. */
    hasMappings: boolean;
    description: string;
}

export const ANY_BIBLE_SWAP_LANGUAGE = "any";

export const BIBLE_SWAP_LANGUAGES: readonly BibleSwapLanguageOption[] =
    LANGUAGE_STRATEGIES.map((s) => ({
        id: s.id,
        label: s.label,
        hasMappings: s.hasMappings,
        description: s.description,
    }));

export function isMappedBibleSwapLanguage(language: string | undefined): boolean {
    return isMappedBibleSwapLanguageId(language);
}

/** `JOS-EST.idml` / `JOS-EST.codex` / `JOS-EST` → `JOS-EST`. */
export function studyVolumeFromFileName(fileName: string): string {
    const base = fileName.replace(/^.*[\\/]/, "");
    return base.replace(/\.(idml|codex)$/i, "").toUpperCase();
}

/**
 * Whether a loaded mapping document is safe to apply for this language/volume.
 * Rejects empty plans and volumes marked unusable on the strategy.
 */
export function isUsableMappingPlan(
    strategy: BibleSwapLanguageStrategy,
    volume: string,
    plan: SerializedVersificationPlan,
    projectedMatchPercent?: number
): boolean {
    if (strategy.unusableVolumes?.some((v) => v === volume)) {
        return false;
    }
    if (!strategy.availableVolumes.some((v) => v === volume)) {
        return false;
    }
    const replaceCount = plan.verseMappings.filter((m) => m.action === "replace").length;
    if (replaceCount === 0) {
        return false;
    }
    if (
        typeof projectedMatchPercent === "number" &&
        projectedMatchPercent < strategy.minUsableProjectedMatchPercent
    ) {
        return false;
    }
    return true;
}

/**
 * Apply language-specific plan refinements after deserialization.
 */
export function applyLanguagePlanRefinements(
    language: string | undefined,
    volume: string,
    plan: VersificationPlan
): VersificationPlan {
    const strategy = getBibleSwapLanguageStrategy(language);
    return strategy.refinePlan ? strategy.refinePlan(plan, volume) : plan;
}

// ---------------------------------------------------------------------------
// Serialized mapping document (subset we consume at swap time)
// ---------------------------------------------------------------------------

export interface SerializedVerseMapping {
    study: { book: string; chapter: string; verse: string; key: string };
    action: "replace" | "remove";
    bible?: BibleVerseRef;
    crossChapter?: boolean;
}

export interface SerializedChapterRemap {
    book: string;
    studyChapter: string;
    bibleChapter: string;
}

export interface SerializedChapterInsert {
    book: string;
    studyChapter: string;
    verses: Array<{ bibleChapter: string; bibleVerse: string }>;
}

export interface SerializedStructureChapter {
    book: string;
    studyChapter: string;
    studyVerseStart: number;
    studyVerseEnd: number;
    insertOnly: boolean;
    bibleSlices: BibleVerseSlice[];
}

export interface SerializedVersificationPlan {
    verseMappings: SerializedVerseMapping[];
    chapterRemaps: SerializedChapterRemap[];
    chapterInserts: SerializedChapterInsert[];
    structureChapters: SerializedStructureChapter[];
    trailingInserts: BibleVerseRef[];
    stats: VersificationPlanStats;
}

/** Full `{VOLUME}.mapping.json` document (fields we care about). */
export interface BibleSwapMappingDocument {
    schemaVersion: number;
    generatedAt: string;
    language: string;
    languageLabel: string;
    studyVolume: string;
    files: {
        study: { name: string; path: string };
        bible: { name: string; path: string };
    };
    versificationSummary?: {
        projectedVerseMatchPercent?: number;
        versesMapped?: number;
        versesRemoved?: number;
        versesInserted?: number;
    };
    plan: SerializedVersificationPlan;
}

// ---------------------------------------------------------------------------
// Deserialization back into the runtime VersificationPlan
// ---------------------------------------------------------------------------

export function deserializeVersificationPlan(
    serialized: SerializedVersificationPlan
): VersificationPlan {
    const verseMap: VersificationPlan["verseMap"] = new Map();
    for (const m of serialized.verseMappings) {
        const key = verseKey(m.study.book, m.study.chapter, m.study.verse);
        if (m.action === "replace" && m.bible) {
            verseMap.set(key, { action: "replace", bible: m.bible });
        } else if (m.action === "remove") {
            verseMap.set(key, { action: "remove" });
        }
    }

    const chapterRemaps: VersificationPlan["chapterRemaps"] = new Map();
    for (const r of serialized.chapterRemaps) {
        const perBook = chapterRemaps.get(r.book) ?? new Map<string, string>();
        perBook.set(r.studyChapter, r.bibleChapter);
        chapterRemaps.set(r.book, perBook);
    }

    const chapterInserts: VersificationPlan["chapterInserts"] = new Map();
    for (const ins of serialized.chapterInserts) {
        const key = chapterBlockKey(ins.book, ins.studyChapter);
        chapterInserts.set(
            key,
            ins.verses.map((v) => ({
                book: ins.book,
                chapter: v.bibleChapter,
                verse: v.bibleVerse,
            }))
        );
    }

    const structureChapters: VersificationPlan["structureChapters"] = new Map();
    for (const ch of serialized.structureChapters) {
        structureChapters.set(chapterBlockKey(ch.book, ch.studyChapter), {
            studyBook: ch.book,
            studyChapter: ch.studyChapter,
            studyVerseStart: ch.studyVerseStart,
            studyVerseEnd: ch.studyVerseEnd,
            bibleSlices: ch.bibleSlices,
            insertOnly: ch.insertOnly,
        });
    }

    return {
        verseMap,
        structureChapters,
        chapterInserts,
        trailingInserts: serialized.trailingInserts ?? [],
        chapterRemaps,
        stats: serialized.stats,
    };
}
