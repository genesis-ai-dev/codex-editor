import type { CharacterGroupingOptions } from "../../types";

export const DEFAULT_IGNORED_CHARACTER_SUFFIXES = ["(ON)", "(Off)", "(Mixed)", "(Group)"];

/** Export-only normalization: remove configured literal suffixes, never notebook data. */
export function normalizeCharacterLabel(
    label: string | undefined,
    options: CharacterGroupingOptions = {}
): string {
    let result = label?.trim() || "";
    if (options.separateByCameraAngles) return result || "unlabeled";

    const suffixes = (options.ignoredCharacterSuffixes ?? DEFAULT_IGNORED_CHARACTER_SUFFIXES)
        .filter((suffix) => typeof suffix === "string" && suffix.trim().length > 0)
        .map((suffix) => options.matchCharacterMarkerCase ? suffix.trim() : suffix.trim().toLowerCase())
        .sort((a, b) => b.length - a.length);
    while (result) {
        const matchLabel = options.matchCharacterMarkerCase ? result : result.toLowerCase();
        const suffix = suffixes.find((candidate) => matchLabel.endsWith(candidate));
        if (!suffix) break;
        result = result.slice(0, -suffix.length).trimEnd();
    }
    return result || "unlabeled";
}
