import { DOCX_PARAGRAPH_MAPPING_VERSION } from "../cellMetadata";
import { extractParagraphText, type ParagraphRange } from "./ooxmlScanner";

export type ParagraphTranslation = {
    paragraphIndex: number;
    translation: string;
    sourceText: string;
    mappingVersion?: string;
    /** Candidate collapsed aliases from duplicated Choice/Fallback segment cycles. */
    aliasVariants?: Array<{ sourceText: string; translation: string }>;
};

export function normalizeDocxWitness(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/** Coalesce exact aliases while refusing contradictory cells at one split position. */
export function deduplicateDocxSegments<
    T extends { segmentIndex: number; text: string; source: string },
>(segments: T[]): T[] {
    const byIndex = new Map<number, T>();
    for (const segment of segments) {
        const existing = byIndex.get(segment.segmentIndex);
        if (!existing) {
            byIndex.set(segment.segmentIndex, segment);
            continue;
        }
        if (normalizeDocxWitness(existing.source) !== normalizeDocxWitness(segment.source)) {
            throw new Error(
                `Conflicting DOCX segments share segmentIndex ${segment.segmentIndex}.`,
            );
        }
        if (existing.text && segment.text && existing.text !== segment.text) {
            throw new Error(
                `Conflicting DOCX translations share segmentIndex ${segment.segmentIndex}.`,
            );
        }
        if (!existing.text && segment.text) {
            byIndex.set(segment.segmentIndex, segment);
        }
    }
    return [...byIndex.values()];
}

/**
 * Build an alternate witness for an old Choice/Fallback segment cycle. The
 * exporter uses it only when the original destination matches the shorter
 * source, so genuinely repeated paragraph text remains repeated.
 */
export function buildRepeatedSourceAliasVariants<
    T extends { text: string; source: string },
>(segments: T[]): Array<{ sourceText: string; translation: string }> {
    for (let period = 1; period <= Math.floor(segments.length / 2); period++) {
        if (segments.length % period !== 0) continue;
        const repeats = segments.every(
            (segment, index) =>
                normalizeDocxWitness(segment.source) ===
                normalizeDocxWitness(segments[index % period].source),
        );
        if (!repeats) continue;

        const chosenTranslations: string[] = [];
        let conflict = false;
        for (let index = 0; index < period; index++) {
            const translatedAliases = new Set(
                segments
                    .filter((_, segmentIndex) => segmentIndex % period === index)
                    .map((segment) => segment.text)
                    .filter(Boolean),
            );
            if (translatedAliases.size > 1) {
                conflict = true;
                break;
            }
            chosenTranslations.push([...translatedAliases][0] ?? segments[index].source);
        }
        if (conflict) continue;

        return [{
            sourceText: segments.slice(0, period).map((segment) => segment.source).join(" "),
            translation: chosenTranslations.join(" "),
        }];
    }
    return [];
}

const matchingPlanVariant = (
    plan: ParagraphTranslation,
    paragraphText: string,
): { sourceText: string; translation: string } | undefined => {
    if (normalizeDocxWitness(plan.sourceText) === paragraphText) return plan;
    return plan.aliasVariants?.find(
        (variant) => normalizeDocxWitness(variant.sourceText) === paragraphText,
    );
};

const scoreMapping = (
    bodyXml: string,
    ranges: ParagraphRange[],
    plans: Map<number, ParagraphTranslation>,
): number => {
    let score = 0;
    for (const plan of plans.values()) {
        const range = ranges[plan.paragraphIndex];
        if (!normalizeDocxWitness(plan.sourceText) || !range) continue;
        const source = normalizeDocxWitness(
            extractParagraphText(bodyXml.slice(range.start, range.end)),
        );
        if (matchingPlanVariant(plan, source)) score++;
    }
    return score;
};

export type ParagraphMappingMode = "current" | "legacy";

export function selectParagraphMappingMode(
    plans: Map<number, ParagraphTranslation>,
    currentBodyXml: string,
    currentRanges: ParagraphRange[],
    legacyBodyXml: string,
    legacyRanges: ParagraphRange[],
): ParagraphMappingMode {
    const allPlans = [...plans.values()];
    if (
        allPlans.length > 0 &&
        allPlans.every((plan) => plan.mappingVersion === DOCX_PARAGRAPH_MAPPING_VERSION)
    ) {
        return "current";
    }

    const currentScore = scoreMapping(currentBodyXml, currentRanges, plans);
    const legacyScore = scoreMapping(legacyBodyXml, legacyRanges, plans);
    console.log(`[Exporter] Coordinate witness scores: current=${currentScore}, legacy=${legacyScore}`);
    return legacyScore > currentScore ? "legacy" : "current";
}

export function resolveDocxTranslations(
    bodyXml: string,
    ranges: ParagraphRange[],
    plans: Map<number, ParagraphTranslation>,
): Map<number, string> {
    const paragraphTexts = ranges.map((range) =>
        normalizeDocxWitness(extractParagraphText(bodyXml.slice(range.start, range.end))),
    );
    const resolved = new Map<number, string>();

    for (const plan of [...plans.values()].sort((a, b) => a.paragraphIndex - b.paragraphIndex)) {
        let destination = plan.paragraphIndex;
        let selectedVariant = matchingPlanVariant(plan, paragraphTexts[destination]);

        if (normalizeDocxWitness(plan.sourceText) && !selectedVariant) {
            const candidates = paragraphTexts
                .map((text, index) => matchingPlanVariant(plan, text) && !resolved.has(index) ? index : -1)
                .filter((index) => index >= 0);
            if (candidates.length !== 1) {
                throw new Error(
                    `Cannot safely map DOCX paragraph ${plan.paragraphIndex}: ` +
                    `stored source text matched ${candidates.length} export destinations.`,
                );
            }
            destination = candidates[0];
            selectedVariant = matchingPlanVariant(plan, paragraphTexts[destination]);
        }

        if (!ranges[destination]) {
            throw new Error(
                `Cannot safely map DOCX paragraph ${plan.paragraphIndex}: destination is missing.`,
            );
        }
        const selectedTranslation = selectedVariant?.translation ?? plan.translation;
        const existing = resolved.get(destination);
        if (existing !== undefined && existing !== selectedTranslation) {
            throw new Error(`Conflicting translations map to DOCX paragraph ${destination}.`);
        }
        resolved.set(destination, selectedTranslation);
    }

    return resolved;
}
