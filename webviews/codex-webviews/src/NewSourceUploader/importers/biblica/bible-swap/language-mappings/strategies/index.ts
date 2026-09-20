import type { BibleSwapLanguageId, BibleSwapLanguageStrategy } from "./types";
import { anyLanguageStrategy } from "./any";
import { arabicStrategy } from "./arabic";
import { frenchStrategy } from "./french";
import { hindiStrategy } from "./hindi";
import { marathiStrategy } from "./marathi";
import { portugueseStrategy } from "./portuguese";
import { russianStrategy } from "./russian";
import { ukrainianStrategy } from "./ukrainian";

export const LANGUAGE_STRATEGIES: readonly BibleSwapLanguageStrategy[] = [
    anyLanguageStrategy,
    portugueseStrategy,
    russianStrategy,
    frenchStrategy,
    hindiStrategy,
    marathiStrategy,
    arabicStrategy,
    ukrainianStrategy,
];

const byId = new Map<string, BibleSwapLanguageStrategy>(
    LANGUAGE_STRATEGIES.map((s) => [s.id, s])
);

export function getBibleSwapLanguageStrategy(
    language: string | undefined
): BibleSwapLanguageStrategy {
    if (!language) return anyLanguageStrategy;
    return byId.get(language) ?? anyLanguageStrategy;
}

export function isMappedBibleSwapLanguageId(
    language: string | undefined
): language is Exclude<BibleSwapLanguageId, "any"> {
    const strategy = getBibleSwapLanguageStrategy(language);
    return strategy.id !== "any" && strategy.hasMappings;
}

export {
    anyLanguageStrategy,
    arabicStrategy,
    frenchStrategy,
    hindiStrategy,
    marathiStrategy,
    portugueseStrategy,
    russianStrategy,
    ukrainianStrategy,
};
export type {
    BibleSwapLanguageId,
    BibleSwapLanguageStrategy,
    BibleSwapMappedLanguageId,
    StudyVolumeId,
} from "./types";
export { ALL_STUDY_VOLUMES, resolveSwapModeForLanguage } from "./types";
