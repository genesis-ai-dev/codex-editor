import type { BibleSwapLanguageStrategy } from "./types";
import { ALL_STUDY_VOLUMES } from "./types";
import { chapterBlockKey, verseKey } from "../../types";
import type { VersificationPlan } from "../../versificationPlan";

/**
 * Portuguese — near-perfect verse overlap with the preset Bible files.
 *
 * Structure mode is preferred: Portuguese Bible IDMLs share study-style
 * `p_dc1`/`p_dc2` chapter-boundary paragraphs, and Structure + clipped Bible
 * chapter blocks is what keeps NEH 7/8, 1SA 7, 2CO 2, JER 39, etc. clean.
 *
 * Precomputed plans cover trailing bible-only verses (RUT 4:22, 2CH 36:23, …).
 * `refinePlan` patches known HAB 3 gaps the offline generator missed
 * (study superscription 3:1 kept; bible 3:19 inserted).
 */
function refinePortuguesePlan(plan: VersificationPlan, volume: string): VersificationPlan {
    if (volume !== "ISA-MAL") return plan;

    // HAB 3 is the only chapter whose outer verses live in `head:d*`
    // superscription paragraphs, which the offline plan generator skipped:
    // 3:1 is the prayer's heading in both files (and carries chapter 3's meta:c
    // marker, so it must be replaced rather than removed), and the Portuguese
    // Bible closes the chapter with 3:19's second half in a trailing `head:d`
    // paragraph that the study has no verse for at all.
    const hab31 = verseKey("HAB", "3", "1");
    const existing = plan.verseMap.get(hab31);
    if (existing?.action !== "replace") {
        plan.verseMap.set(hab31, {
            action: "replace",
            bible: { book: "HAB", chapter: "3", verse: "1" },
        });
        plan.stats = {
            ...plan.stats,
            versesMapped: plan.stats.versesMapped + 1,
            versesRemoved:
                existing?.action === "remove"
                    ? Math.max(0, plan.stats.versesRemoved - 1)
                    : plan.stats.versesRemoved,
        };
    }

    const hab3 = chapterBlockKey("HAB", "3");
    const inserts = plan.chapterInserts.get(hab3) ?? [];
    if (!inserts.some((ref) => ref.chapter === "3" && ref.verse === "19")) {
        plan.chapterInserts.set(hab3, [
            ...inserts,
            { book: "HAB", chapter: "3", verse: "19" },
        ]);
        plan.stats = {
            ...plan.stats,
            versesInserted: plan.stats.versesInserted + 1,
        };
    }

    return plan;
}

export const portugueseStrategy: BibleSwapLanguageStrategy = {
    id: "portuguese",
    label: "Portuguese",
    hasMappings: true,
    availableVolumes: ALL_STUDY_VOLUMES,
    preferredMode: "structure",
    minUsableProjectedMatchPercent: 95,
    chapterBlockOptions: {
        retainSectionHeadings: true,
        retainSpeakerLabels: true,
        retainAcrosticHeadings: true,
        clipChapterBoundarySpans: true,
    },
    refinePlan: refinePortuguesePlan,
    description:
        "Preset Portuguese Bible. Structure recommended — clipped chapter blocks prevent boundary bleed; versification mapping drives inserts.",
};
