/**
 * Per-language Bible Swap strategy.
 *
 * Precomputed versification mappings capture the verse alignment for each
 * preset Bible IDML. Strategies layer language-specific swap behaviour on top:
 * preferred mode, volume availability, chapter-block indexing flags, and
 * optional plan refinements.
 */

import type { BuildChapterBlockOptions } from "../../chapterBlocks";
import type { BibleSwapMode } from "../../types";
import type { VersificationPlan } from "../../versificationPlan";

export type BibleSwapMappedLanguageId =
    | "portuguese"
    | "russian"
    | "french"
    | "hindi"
    | "marathi"
    | "arabic"
    | "ukrainian";

export type BibleSwapLanguageId = "any" | BibleSwapMappedLanguageId;

export const ALL_STUDY_VOLUMES = [
    "GEN-DEU",
    "JOS-EST",
    "JOB-SNG",
    "ISA-MAL",
    "MAT-JOHN",
    "ACT-REV",
] as const;

export type StudyVolumeId = (typeof ALL_STUDY_VOLUMES)[number];

export interface BibleSwapLanguageStrategy {
    id: BibleSwapLanguageId;
    label: string;
    /**
     * When true, export loads a shipped `{volume}.mapping.json` instead of
     * deriving the versification plan at export time.
     */
    hasMappings: boolean;
    /** Volumes that have a usable precomputed mapping file. */
    availableVolumes: readonly StudyVolumeId[];
    /**
     * Volumes that exist on disk but must not be applied (broken / empty
     * indexes). Loader falls back to analyze-at-export for these.
     */
    unusableVolumes?: readonly StudyVolumeId[];
    /**
     * Default mode suggestion for the UI. "auto" leaves Surgical/Structure
     * to the user; strategies may still force structure for specific volumes.
     */
    preferredMode: BibleSwapMode | "auto";
    /** Volumes that always run structure swap (heavy versification deltas). */
    forceStructureVolumes?: readonly StudyVolumeId[];
    /**
     * Minimum projected match % for a loaded plan to be considered usable.
     * Below this, the loader rejects the plan and falls back to analyze-at-export.
     */
    minUsableProjectedMatchPercent: number;
    /** Chapter-block build overrides when indexing the Bible for structure swap. */
    chapterBlockOptions?: BuildChapterBlockOptions;
    /** Short note shown under the language pill in the export UI. */
    description: string;
    /**
     * Optional plan refinement after deserialization (language-specific
     * post-processing). Default is identity.
     */
    refinePlan?: (plan: VersificationPlan, volume: string) => VersificationPlan;
}

export function resolveSwapModeForLanguage(
    strategy: BibleSwapLanguageStrategy,
    volume: string,
    userMode: BibleSwapMode
): BibleSwapMode {
    if (strategy.forceStructureVolumes?.includes(volume as StudyVolumeId)) {
        return "structure";
    }
    if (strategy.preferredMode === "surgical" || strategy.preferredMode === "structure") {
        // User selection still wins unless volume is force-structure.
        return userMode;
    }
    return userMode;
}
