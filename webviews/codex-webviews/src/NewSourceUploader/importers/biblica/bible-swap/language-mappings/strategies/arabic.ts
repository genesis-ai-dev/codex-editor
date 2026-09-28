import type { BibleSwapLanguageStrategy } from "./types";
import { ALL_STUDY_VOLUMES } from "./types";

/**
 * Arabic — RTL layout benefits from Structure (paragraph/poetry XML).
 * NT split is MAT–JHN / ACT–REV (same as Portuguese/Russian/French/…).
 * Note: Gospels file is named `40MAT_34JHN_Arabic.idml` (ends at John).
 */
export const arabicStrategy: BibleSwapLanguageStrategy = {
    id: "arabic",
    label: "Arabic",
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
        "Preset Arabic Bible (MAT–JHN / ACT–REV). Structure recommended for RTL layout.",
};
