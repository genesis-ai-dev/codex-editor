import type { BibleSwapLanguageStrategy } from "./types";
import { ALL_STUDY_VOLUMES } from "./types";

/**
 * French — NT split is MAT–JHN / ACT–REV (same as Portuguese/Russian).
 * JOB-SNG still has many chapter deltas (psalm/subheader alignment), so
 * Structure is forced there; keep bible psalm subheaders in blocks.
 */
export const frenchStrategy: BibleSwapLanguageStrategy = {
    id: "french",
    label: "French",
    hasMappings: true,
    availableVolumes: ALL_STUDY_VOLUMES,
    preferredMode: "structure",
    forceStructureVolumes: ["JOB-SNG"],
    minUsableProjectedMatchPercent: 70,
    chapterBlockOptions: {
        retainSectionHeadings: true,
        retainSpeakerLabels: true,
        retainAcrosticHeadings: true,
    },
    description:
        "Preset French Bible (MAT–JHN / ACT–REV). Structure recommended; JOB-SNG always uses Structure (Psalms).",
};
