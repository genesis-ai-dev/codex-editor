import { getProgressDisplay } from "../utils/progressUtils";

const MAX_VALIDATION_LEVELS = 15;

export function ProgressDots({
    audio,
    text,
    className,
    onlyShowCompleted = false,
}: {
    audio: {
        validatedPercent: number;
        completedPercent: number;
        validationLevels?: number[];
        requiredValidations?: number;
    };
    text: {
        validatedPercent: number;
        completedPercent: number;
        validationLevels?: number[];
        requiredValidations?: number;
    };
    className?: string;
    onlyShowCompleted?: boolean;
}) {
    const audioDisplay = getProgressDisplay(
        audio.validatedPercent,
        audio.completedPercent,
        "Audio",
        audio.validationLevels,
        audio.requiredValidations
    );
    const textDisplay = getProgressDisplay(
        text.validatedPercent,
        text.completedPercent,
        "Text",
        text.validationLevels,
        text.requiredValidations
    );

    const showAudioDot =
        !onlyShowCompleted || audio.validatedPercent >= 100 || audio.completedPercent >= 100;
    const showTextDot =
        !onlyShowCompleted || text.validatedPercent >= 100 || text.completedPercent >= 100;

    if (onlyShowCompleted && !showAudioDot && !showTextDot) {
        return null;
    }

    const getDotClassName = (colorClass: string) => {
        // For darker blue, we use inline styles instead of a class
        if (colorClass === "text-charts-blue-dark") {
            return "w-2 h-2 rounded-full";
        }
        return `w-2 h-2 rounded-full ${colorClass}`;
    };

    const getDotStyle = (
        colorClass: string,
        completedLevels: number,
        requiredValidations?: number
    ) => {
        if (colorClass === "text-charts-blue-dark") {
            // Calculate progressive darkness based on completed levels
            // More completed levels = darker dot
            // Brightness ranges from 0.95 (1 level) to 0.4 (all levels, up to MAX_VALIDATION_LEVELS)
            // This ensures visible differences even with the maximum of MAX_VALIDATION_LEVELS validation levels
            const maxLevels = Math.min(requiredValidations || 1, MAX_VALIDATION_LEVELS);
            const brightnessRange = 0.55; // 0.95 to 0.4
            const baseBrightness = 0.95;
            const brightness = Math.max(
                0.4, // Minimum darkness (for 15 levels)
                baseBrightness - brightnessRange * (completedLevels / maxLevels)
            );

            return {
                backgroundColor: "var(--vscode-charts-blue)",
                opacity: 1.0,
                filter: `brightness(${brightness})`,
            };
        }
        return { backgroundColor: "currentColor" };
    };

    return (
        <div className={`flex items-center gap-x-2 ${className || ""}`.trim()}>
            {showAudioDot && (
                <div
                    className={getDotClassName(audioDisplay.colorClass)}
                    style={getDotStyle(
                        audioDisplay.colorClass,
                        audioDisplay.completedValidationLevels || 0,
                        audio.requiredValidations
                    )}
                    title={audioDisplay.title}
                />
            )}
            {showTextDot && (
                <div
                    className={getDotClassName(textDisplay.colorClass)}
                    style={getDotStyle(
                        textDisplay.colorClass,
                        textDisplay.completedValidationLevels || 0,
                        text.requiredValidations
                    )}
                    title={textDisplay.title}
                />
            )}
        </div>
    );
}
