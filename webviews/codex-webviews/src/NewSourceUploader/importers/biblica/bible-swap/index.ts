/**
 * Bible Swap — public API
 *
 * Two replacement modes:
 *  - **surgical**: replace only prose `<Content>` inside Study CSRs (default)
 *  - **structure**: replace whole chapter text blocks with Bible paragraph XML
 */

export type {
    BibleSwapMode,
    BibleVerseIndex,
    ChapterBlockIndex,
    ChapterTextBlock,
    SwapStats,
    VerseEntry,
    VerseKey,
} from "./types";

export { verseKey, chapterBlockKey } from "./types";
export { PSA_BOOK_CODE } from "./psalmVersification";

export {
    buildBibleVerseIndex,
    applySurgicalSwapToStudyXml,
    scanStudyStoryForSwap,
    findStudyBookRegions,
    mergeStudyStoryScans,
    listVerseKeys,
    SKIPPED_BOOK_CODES,
} from "./surgicalSwap";
export type { StudyStoryScan, StudyBookRegion } from "./surgicalSwap";

export {
    buildBibleChapterBlockIndex,
    applyStructureSwapToStudyXml,
} from "./structureSwap";

export { buildChapterBlockIndex } from "./chapterBlocks";

export {
    buildCompatVerseIndex,
    serializeCompatVerseIndex,
    deserializeCompatVerseIndex,
} from "./compatVerseIndex";
export type { CompatVerseIndex, CompatVerseIndexSerialized } from "./compatVerseIndex";

export {
    buildVersificationPlan,
    buildVersificationPlanFromIndices,
    summarizeVersificationPlan,
    resolveVersePlan,
    bibleSlicesForStudyRange,
    extractBibleXmlForSlices,
    findStudyChapterInsertPosition,
    listPsalmChapterNumbersFromStory,
    sortedPsalmChapterNumbers,
    collectVersificationChanges,
    mergeVersificationChanges,
} from "./versificationPlan";
export type {
    VersificationPlan,
    VersificationPlanSummary,
    VersificationPlanStats,
    StructureChapterPlan,
    BibleVerseRef,
    BibleVerseSlice,
    VersePlanAction,
    BibleSwapVerseChange,
    BibleSwapVerseRedirect,
    BibleSwapStructureInsert,
    BibleSwapVersificationChanges,
} from "./versificationPlan";

export {
    ANY_BIBLE_SWAP_LANGUAGE,
    BIBLE_SWAP_LANGUAGES,
    isMappedBibleSwapLanguage,
    studyVolumeFromFileName,
    deserializeVersificationPlan,
    getBibleSwapLanguageStrategy,
    resolveSwapModeForLanguage,
    applyLanguagePlanRefinements,
} from "./language-mappings";
export type {
    BibleSwapLanguageOption,
    BibleSwapMappingDocument,
    SerializedVersificationPlan,
    BibleSwapLanguageStrategy,
} from "./language-mappings";

import type { BibleSwapMode, ChapterBlockIndex, SwapStats } from "./types";
import type { BibleVerseIndex } from "./types";
import { applySurgicalSwapToStudyXml, buildBibleVerseIndex, scanStudyStoryForSwap } from "./surgicalSwap";
import type { StudyStoryScan } from "./surgicalSwap";
import {
    applyStructureSwapToStudyXml,
    buildBibleChapterBlockIndex,
} from "./structureSwap";
import type { VersificationPlan } from "./versificationPlan";
import { buildVersificationPlanFromIndices } from "./versificationPlan";
import {
    applyLanguagePlanRefinements,
    getBibleSwapLanguageStrategy,
    resolveSwapModeForLanguage,
} from "./language-mappings";

/** Bible-side indexes built once and reused across many study Story XML files. */
export interface BibleSwapSharedResources {
    bibleVerseIndex: BibleVerseIndex;
    bibleChapterIndex?: ChapterBlockIndex;
}

export function buildBibleSwapSharedResources(
    bibleStoryXml: string,
    mode: BibleSwapMode = "surgical",
    language?: string
): BibleSwapSharedResources {
    const strategy = getBibleSwapLanguageStrategy(language);
    const bibleVerseIndex = buildBibleVerseIndex(bibleStoryXml);
    const bibleChapterIndex =
        mode === "structure"
            ? buildBibleChapterBlockIndex(bibleStoryXml, strategy.chapterBlockOptions)
            : undefined;
    return { bibleVerseIndex, bibleChapterIndex };
}

/**
 * Apply swap using pre-built Bible indexes (avoids re-parsing the Bible for each study story).
 * A precomputed `versificationPlan` (from a shipped language mapping) skips the
 * per-story plan derivation entirely; keys not present in this story are ignored.
 * When `language` is a mapped language, the strategy may force Structure mode for
 * specific volumes and refine the plan after load.
 */
export function applyBibleSwapWithShared(
    studyStoryXml: string,
    bibleStoryXml: string,
    mode: BibleSwapMode,
    shared: BibleSwapSharedResources,
    options?: {
        studyScan?: StudyStoryScan;
        versificationPlan?: VersificationPlan;
        language?: string;
        studyVolume?: string;
    }
): { xml: string; stats: SwapStats } {
    const studyScan = options?.studyScan ?? scanStudyStoryForSwap(studyStoryXml);
    const strategy = getBibleSwapLanguageStrategy(options?.language);
    const volume = options?.studyVolume ?? "";
    const effectiveMode = volume
        ? resolveSwapModeForLanguage(strategy, volume, mode)
        : mode;

    let versificationPlan =
        options?.versificationPlan ??
        buildVersificationPlanFromIndices(
            studyStoryXml,
            studyScan.studyIndex,
            shared.bibleVerseIndex
        );
    if (options?.language && options.versificationPlan && volume) {
        versificationPlan = applyLanguagePlanRefinements(
            options.language,
            volume,
            versificationPlan
        );
    }

    if (effectiveMode === "structure") {
        const chapterIndex =
            shared.bibleChapterIndex ??
            buildBibleChapterBlockIndex(bibleStoryXml, strategy.chapterBlockOptions);
        return applyStructureSwapToStudyXml(studyStoryXml, chapterIndex, {
            bibleStoryXml,
            versificationPlan,
            bibleVerseIndex: shared.bibleVerseIndex,
        });
    }

    return applySurgicalSwapToStudyXml(studyStoryXml, shared.bibleVerseIndex, {
        versificationPlan,
        studyScan,
    });
}

/** @deprecated Use applySurgicalSwapToStudyXml or applyBibleSwap with mode. */
export function applyBibleSwapToStudyXml(
    studyStoryXml: string,
    index: BibleVerseIndex
): { xml: string; stats: SwapStats } {
    return applySurgicalSwapToStudyXml(studyStoryXml, index);
}

/**
 * Apply Bible swap using the selected mode.
 */
export function applyBibleSwap(
    studyStoryXml: string,
    bibleStoryXml: string,
    mode: BibleSwapMode = "surgical"
): { xml: string; stats: SwapStats } {
    const shared = buildBibleSwapSharedResources(bibleStoryXml, mode);
    return applyBibleSwapWithShared(studyStoryXml, bibleStoryXml, mode, shared);
}
