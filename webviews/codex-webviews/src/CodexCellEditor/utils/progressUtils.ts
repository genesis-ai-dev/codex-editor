export type ProgressColorClass =
    | "text-editor-warning-foreground"
    | "text-charts-blue"
    | "text-muted-foreground/80"
    | "text-muted-foreground/25";

// Returns a Tailwind-compatible text color class representing progress state
export function getProgressColor(
    validatedPercent: number,
    completedPercent: number
): ProgressColorClass {
    if (validatedPercent >= 100) return "text-editor-warning-foreground";
    if (completedPercent >= 100) return "text-charts-blue";
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
    label: "Audio" | "Text"
): string {
    if (validatedPercent >= 100) {
        return `${label} fully validated`;
    }
    if (completedPercent >= 100) {
        return `${label} fully translated`;
    }
    if (validatedPercent > 0) {
        return `${label} partially validated`;
    }
    if (completedPercent > 0) {
        return `${label} present`;
    }
    return `No ${label.toLowerCase()} progress`;
}

export function getProgressDisplay(
    validatedPercent: number,
    completedPercent: number,
    label: "Audio" | "Text"
) {
    return {
        colorClass: getProgressColor(validatedPercent, completedPercent),
        title: getProgressTitle(validatedPercent, completedPercent, label),
    };
}


