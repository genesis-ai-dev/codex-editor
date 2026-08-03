import type { BibleSwapLanguageStrategy } from "./types";
import { ALL_STUDY_VOLUMES } from "./types";

/**
 * French — most volumes are high match, but:
 *  - ACT-REV bible file starts at Romans (`45ROM-66REV`), so Acts is absent
 *  - JOB-SNG has many chapter deltas (psalm/subheader alignment)
 * Prefer Structure for those volumes; keep bible psalm subheaders in blocks.
 */
export const frenchStrategy: BibleSwapLanguageStrategy = {
    id: "french",
    label: "French",
    hasMappings: true,
    availableVolumes: ALL_STUDY_VOLUMES,
    preferredMode: "structure",
    forceStructureVolumes: ["ACT-REV", "JOB-SNG"],
    minUsableProjectedMatchPercent: 70,
    chapterBlockOptions: {
        retainSectionHeadings: true,
        retainSpeakerLabels: true,
        retainAcrosticHeadings: true,
    },
    description:
        "Preset French Bible. Structure recommended; ACT-REV and JOB-SNG always use Structure (volume split / Psalms).",
};
