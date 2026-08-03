import type { BibleSwapLanguageStrategy } from "./types";
import { ALL_STUDY_VOLUMES } from "./types";

/**
 * Hindi — Devanagari layout benefits from Structure (paragraph/poetry XML).
 * ACT-REV bible starts at Romans (`45ROM-66REV`); Acts is removed by the plan.
 */
export const hindiStrategy: BibleSwapLanguageStrategy = {
    id: "hindi",
    label: "Hindi",
    hasMappings: true,
    availableVolumes: ALL_STUDY_VOLUMES,
    preferredMode: "structure",
    forceStructureVolumes: ["ACT-REV"],
    minUsableProjectedMatchPercent: 70,
    chapterBlockOptions: {
        retainSectionHeadings: true,
        retainSpeakerLabels: true,
        retainAcrosticHeadings: true,
    },
    description:
        "Preset Hindi Bible. Structure recommended for Devanagari layout; ACT-REV always uses Structure.",
};
