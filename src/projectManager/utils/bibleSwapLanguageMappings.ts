/**
 * Node-side loader for precomputed Bible Swap language mappings.
 *
 * Mapping JSONs live in the source tree under
 * `webviews/.../biblica/bible-swap/language-mappings/{language}/` and are
 * copied by webpack to `out/bibleSwapLanguageMappings/{language}/` so the
 * packaged extension (and the worker bundles, which share `out/`) can read
 * them with plain `fs` at runtime.
 */

import * as fs from "fs";
import * as path from "path";
import type {
    BibleSwapMappingDocument,
    SerializedVersificationPlan,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/language-mappings";
import {
    getBibleSwapLanguageStrategy,
    isMappedBibleSwapLanguage,
    isUsableMappingPlan,
    studyVolumeFromFileName,
} from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/bible-swap/language-mappings";

/** Candidate roots: webpack copy target first, then the dev source tree. */
function mappingRootCandidates(): string[] {
    return [
        path.join(__dirname, "bibleSwapLanguageMappings"),
        path.join(
            __dirname,
            "..",
            "webviews",
            "codex-webviews",
            "src",
            "NewSourceUploader",
            "importers",
            "biblica",
            "bible-swap",
            "language-mappings"
        ),
    ];
}

const planCache = new Map<string, SerializedVersificationPlan | null>();

function readMappingDocument(
    language: string,
    volume: string
): BibleSwapMappingDocument | null {
    for (const root of mappingRootCandidates()) {
        const file = path.join(root, language, `${volume}.mapping.json`);
        try {
            if (!fs.existsSync(file)) continue;
            const raw = fs.readFileSync(file, "utf-8");
            return JSON.parse(raw) as BibleSwapMappingDocument;
        } catch (err) {
            console.warn(
                `[BibleSwapMappings] Failed to read ${file}: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }
    return null;
}

/**
 * Load the precomputed versification plan for a language + study volume
 * (volume comes from the study file name, e.g. `JOS-EST.idml` → `JOS-EST`).
 * Returns null when the language is "any"/unknown, the volume is marked
 * unusable on the language strategy, or no usable mapping file exists.
 */
export function loadBibleSwapMappingPlan(
    language: string | undefined,
    studyFileName: string
): { volume: string; plan: SerializedVersificationPlan; language: string } | null {
    if (!language || !isMappedBibleSwapLanguage(language)) return null;

    const volume = studyVolumeFromFileName(studyFileName);
    const cacheKey = `${language}|${volume}`;
    if (planCache.has(cacheKey)) {
        const cached = planCache.get(cacheKey) ?? null;
        return cached ? { volume, plan: cached, language } : null;
    }

    const strategy = getBibleSwapLanguageStrategy(language);
    const doc = readMappingDocument(language, volume);
    if (!doc?.plan) {
        planCache.set(cacheKey, null);
        console.warn(
            `[BibleSwapMappings] No mapping found for language "${language}", volume "${volume}" — falling back to analyze-at-export.`
        );
        return null;
    }

    const projected =
        doc.versificationSummary?.projectedVerseMatchPercent ??
        (doc.plan.stats.versesMapped > 0
            ? undefined
            : 0);

    if (!isUsableMappingPlan(strategy, volume, doc.plan, projected)) {
        planCache.set(cacheKey, null);
        console.warn(
            `[BibleSwapMappings] Mapping for ${language}/${volume} is marked unusable ` +
                `(projectedMatch=${projected ?? "n/a"}, replaceCount=${doc.plan.verseMappings.filter((m) => m.action === "replace").length}) — ` +
                `falling back to analyze-at-export.`
        );
        return null;
    }

    planCache.set(cacheKey, doc.plan);
    console.log(
        `[BibleSwapMappings] Loaded precomputed plan for ${language}/${volume} ` +
            `(${doc.plan.verseMappings.length} verse mappings, ${doc.plan.structureChapters.length} structure chapters, ` +
            `strategy=${strategy.id})`
    );
    return { volume, plan: doc.plan, language };
}
