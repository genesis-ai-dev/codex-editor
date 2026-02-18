export type ProgressColorClass =
    | "text-editor-warning-foreground"
    | "text-charts-blue"
    | "text-charts-blue-dark"
    | "text-muted-foreground/80"
    | "text-muted-foreground/25";

// Helper function to count completed validation levels
export function getCompletedValidationLevels(
    validationLevels?: number[],
    requiredValidations?: number
): number {
    if (!validationLevels || validationLevels.length === 0) return 0;
    if (!requiredValidations) return 0;

    // Count how many validation levels have 100% completion
    let completedLevels = 0;
    for (let i = 0; i < Math.min(validationLevels.length, requiredValidations); i++) {
        if (validationLevels[i] >= 100) {
            completedLevels++;
        } else {
            break; // Stop at first incomplete level
        }
    }
    return completedLevels;
}

// Returns a Tailwind-compatible text color class representing progress state
export function getProgressColor(
    validatedPercent: number,
    completedPercent: number,
    validationLevels?: number[],
    requiredValidations?: number
): ProgressColorClass {
    if (validatedPercent >= 100) return "text-editor-warning-foreground";
    if (completedPercent >= 100) {
        // Check if at least 1 validation level is complete
        const completedLevels = getCompletedValidationLevels(validationLevels, requiredValidations);
        if (completedLevels >= 1) {
            return "text-charts-blue-dark";
        }
        return "text-charts-blue";
    }
    if (validatedPercent > 0 && validatedPercent < 100) return "text-muted-foreground/80";
    // When there is some content/audio present but no validation yet, use the same partial color
    if (completedPercent > 0) return "text-muted-foreground/80";
    return "text-muted-foreground/25";
}


export type NormalizedSubsectionProgress = {
    textValidatedPercent: number;
    textCompletedPercent: number;
    audioValidatedPercent: number;
    audioCompletedPercent: number;
};

// Normalize the optional progress fields to percentages for text and audio
export function deriveSubsectionPercentages(progress: {
    isFullyTranslated: boolean;
    isFullyValidated: boolean;
    percentTranslationsCompleted?: number;
    percentTextValidatedTranslations?: number;
    percentAudioTranslationsCompleted?: number;
    percentAudioValidatedTranslations?: number;
}): NormalizedSubsectionProgress {
    const textValidatedPercent =
        (progress as any).percentTextValidatedTranslations !== undefined
            ? (progress as any).percentTextValidatedTranslations
            : progress.isFullyValidated
                ? 100
                : 0;

    const textCompletedPercent =
        (progress as any).percentTranslationsCompleted !== undefined
            ? (progress as any).percentTranslationsCompleted
            : progress.isFullyTranslated
                ? 100
                : 0;

    const audioValidatedPercent =
        (progress as any).percentAudioValidatedTranslations !== undefined
            ? (progress as any).percentAudioValidatedTranslations
            : 0;

    const audioCompletedPercent =
        (progress as any).percentAudioTranslationsCompleted !== undefined
            ? (progress as any).percentAudioTranslationsCompleted
            : 0;

    return {
        textValidatedPercent,
        textCompletedPercent,
        audioValidatedPercent,
        audioCompletedPercent,
    };
}

export function getProgressTitle(
    validatedPercent: number,
    completedPercent: number,
    label: "Audio" | "Text",
    validationLevels?: number[],
    requiredValidations?: number
): string {
    const completedLevels = getCompletedValidationLevels(validationLevels, requiredValidations);
    const validationLevelText = completedLevels > 0
        ? `; ${completedLevels} level${completedLevels === 1 ? '' : 's'} of validation complete`
        : '';

    // Round percentages to whole numbers (they should already be integers, but ensure consistency)
    const translationPercent = Math.round(completedPercent);
    const validationPercent = Math.round(validatedPercent);

    return `Translation: ${translationPercent}%\nValidation: ${validationPercent}%${validationLevelText}`;
}

export function getProgressDisplay(
    validatedPercent: number,
    completedPercent: number,
    label: "Audio" | "Text",
    validationLevels?: number[],
    requiredValidations?: number
) {
    const completedLevels = getCompletedValidationLevels(validationLevels, requiredValidations);
    return {
        colorClass: getProgressColor(validatedPercent, completedPercent, validationLevels, requiredValidations),
        title: getProgressTitle(validatedPercent, completedPercent, label, validationLevels, requiredValidations),
        completedValidationLevels: completedLevels,
    };
}


