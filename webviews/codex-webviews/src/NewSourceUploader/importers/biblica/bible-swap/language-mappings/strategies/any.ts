import type { BibleSwapLanguageStrategy } from "./types";

/**
 * Analyze-at-export path — no shipped mappings. Keeps the historical behaviour
 * for arbitrary Bible IDMLs that are not one of the preset language files.
 */
export const anyLanguageStrategy: BibleSwapLanguageStrategy = {
    id: "any",
    label: "Any language (analyze at export)",
    hasMappings: false,
    availableVolumes: [],
    preferredMode: "auto",
    minUsableProjectedMatchPercent: 0,
    description:
        "Build the versification plan from the selected Bible IDML at export time.",
};
