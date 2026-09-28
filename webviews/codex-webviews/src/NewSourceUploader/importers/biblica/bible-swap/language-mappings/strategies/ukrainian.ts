import type { BibleSwapLanguageStrategy } from "./types";

/**
 * Ukrainian — only ACT-REV and MAT-JOHN mapping files exist today, and both
 * currently project 0% verse match (bible indexes did not align when the
 * mappings were generated). Those volumes are marked unusable so the loader
 * refuses the plan and falls back to analyze-at-export until remapped.
 * OT volumes have no mapping files yet.
 */
export const ukrainianStrategy: BibleSwapLanguageStrategy = {
    id: "ukrainian",
    label: "Ukrainian",
    hasMappings: true,
    availableVolumes: ["ACT-REV", "MAT-JOHN"],
    unusableVolumes: ["ACT-REV", "MAT-JOHN"],
    preferredMode: "structure",
    minUsableProjectedMatchPercent: 50,
    chapterBlockOptions: {
        retainSectionHeadings: true,
        retainSpeakerLabels: true,
        retainAcrosticHeadings: true,
    },
    description:
        "Preset Ukrainian Bible. OT volumes not mapped yet; NT mappings currently fall back to analyze-at-export until remapped.",
};
