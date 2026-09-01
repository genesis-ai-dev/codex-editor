import type { BibleSwapLanguageStrategy } from "./types";
import { ALL_STUDY_VOLUMES } from "./types";

/**
 * Hindi — Devanagari layout benefits from Structure (paragraph/poetry XML).
 * NT split is MAT–JHN / ACT–REV (same as Portuguese/Russian/French/Marathi).
 */
export const hindiStrategy: BibleSwapLanguageStrategy = {
    id: "hindi",
    label: "Hindi",
    hasMappings: true,
    availableVolumes: ALL_STUDY_VOLUMES,
    preferredMode: "structure",
    forceStructureVolumes: [],
    minUsableProjectedMatchPercent: 70,
    chapterBlockOptions: {
        retainSectionHeadings: true,
        retainSpeakerLabels: true,
        retainAcrosticHeadings: true,
    },
    description:
        "Preset Hindi Bible (MAT–JHN / ACT–REV). Structure recommended for Devanagari layout.",
};
