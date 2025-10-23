import { getProgressDisplay } from "../utils/progressUtils";

export function ProgressDots({
    audio,
    text,
    className,
    onlyShowCompleted = false,
}: {
    audio: { validatedPercent: number; completedPercent: number };
    text: { validatedPercent: number; completedPercent: number };
    className?: string;
    onlyShowCompleted?: boolean;
}) {
    const audioDisplay = getProgressDisplay(
        audio.validatedPercent,
        audio.completedPercent,
        "Audio"
    );
    const textDisplay = getProgressDisplay(text.validatedPercent, text.completedPercent, "Text");

    const showAudioDot =
        !onlyShowCompleted || audio.validatedPercent >= 100 || audio.completedPercent >= 100;
    const showTextDot =
        !onlyShowCompleted || text.validatedPercent >= 100 || text.completedPercent >= 100;

    if (onlyShowCompleted && !showAudioDot && !showTextDot) {
        return null;
    }

    return (
        <div className={`flex items-center gap-x-2 ${className || ""}`.trim()}>
            {showAudioDot && (
                <div
                    className={`w-2 h-2 rounded-full ${audioDisplay.colorClass}`}
                    style={{ backgroundColor: "currentColor" }}
                    title={audioDisplay.title}
                />
            )}
            {showTextDot && (
                <div
                    className={`w-2 h-2 rounded-full ${textDisplay.colorClass}`}
                    style={{ backgroundColor: "currentColor" }}
                    title={textDisplay.title}
                />
            )}
        </div>
    );
}
