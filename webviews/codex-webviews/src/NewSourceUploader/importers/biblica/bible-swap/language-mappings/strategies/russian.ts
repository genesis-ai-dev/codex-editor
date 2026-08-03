import type { BibleSwapLanguageStrategy } from "./types";
import { ALL_STUDY_VOLUMES } from "./types";

/**
 * Russian — strong overlap on most volumes, but JOB-SNG (Psalms) has heavy
 * versification deltas (~84% projected match, hundreds of remove/insert).
 * Force Structure on JOB-SNG so chapter blocks follow the Russian Bible stream
 * and precomputed plan inserts (e.g. PSA 8:10, PSA 110:8–10) append to chapter
 * content. Retains `head:ms*` / `head:sp*` so SNG speaker/section lines stay
 * inside verse slices.
 */
export const russianStrategy: BibleSwapLanguageStrategy = {
    id: "russian",
    label: "Russian",
    hasMappings: true,
    availableVolumes: ALL_STUDY_VOLUMES,
    preferredMode: "structure",
    forceStructureVolumes: ["JOB-SNG"],
    minUsableProjectedMatchPercent: 80,
    chapterBlockOptions: {
        retainSectionHeadings: true,
        retainSpeakerLabels: true,
        retainAcrosticHeadings: true,
    },
    description:
        "Preset Russian Bible. Structure recommended; JOB-SNG always uses Structure so versification plan replace/add/remove is applied to chapter blocks.",
};
