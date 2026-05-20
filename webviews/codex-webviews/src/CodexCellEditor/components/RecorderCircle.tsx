import React from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";

/**
 * Audio recorder button.  Three visual states sharing one button:
 *   - idle: theme primary, mic icon, expanding ring-pulse halo
 *   - countdown: green tint, big animated digit (no halo)
 *   - recording: theme destructive, square stop icon, expanding ring-pulse halo
 *
 * Idle and recording share the same outward "pulse" halo as an attention cue.
 * Countdown deliberately omits the halo: the per-digit scale/fade already
 * draws the eye each second, and stacking a continuous halo on top of it
 * reads as visual noise during the "preparing" beat.  The live mic-level
 * visualization is intentionally NOT in this component — it lives in
 * `RecorderWaveform.tsx` as a single-canvas scrolling waveform rendered
 * below the button.
 *
 * Geometry:
 *   - Outer container is 128x128 so the ring-pulse halo can scale past the
 *     96x96 button edge without being clipped.
 */

const CONTAINER_DIAMETER = 128;
const BUTTON_DIAMETER = 96;

export type RecorderState = "idle" | "countdown" | "recording";

export interface RecorderCircleProps {
    state: RecorderState;
    /** Current countdown value (e.g. 3, 2, 1). Required when state === "countdown". */
    countdown: number | null;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
}

export const RecorderCircle: React.FC<RecorderCircleProps> = ({
    state,
    countdown,
    onClick,
    disabled = false,
    title,
}) => {
    const isRecording = state === "recording";
    const isCountdown = state === "countdown";
    const isIdle = state === "idle";

    return (
        <div
            className="relative inline-flex items-center justify-center"
            style={{ width: CONTAINER_DIAMETER, height: CONTAINER_DIAMETER }}
        >
            {/* Ring-pulse halo for idle ("mic ready") and recording.  Skipped
                during countdown so the per-digit animation isn't competing with
                a continuous expanding ring.  The parent's overflow-visible lets
                the halo expand past the button edge. */}
            {!isCountdown && (
                <span
                    aria-hidden="true"
                    className={cn(
                        "absolute rounded-full border-2 pointer-events-none",
                        "animate-[var(--animate-recorder-ring-pulse)]",
                        isIdle && "border-primary/60",
                        isRecording && "border-destructive/60"
                    )}
                    style={{
                        width: BUTTON_DIAMETER,
                        height: BUTTON_DIAMETER,
                    }}
                />
            )}

            {/* The button itself.  Stays scale-stable; only the halo moves. */}
            <Button
                onClick={onClick}
                disabled={disabled}
                title={title}
                className={cn(
                    "rounded-full text-2xl font-bold p-0",
                    "transition-all duration-150",
                    "hover:scale-105 active:scale-95",
                    isIdle &&
                        "bg-primary hover:bg-primary text-primary-foreground border-0",
                    isCountdown &&
                        "bg-emerald-600 hover:bg-emerald-600 text-white border-0",
                    isRecording &&
                        "bg-destructive hover:bg-destructive text-destructive-foreground border-0 animate-[var(--animate-recorder-glow-breathing)]",
                    disabled && "opacity-50 cursor-not-allowed"
                )}
                style={{ width: BUTTON_DIAMETER, height: BUTTON_DIAMETER }}
            >
                {isRecording && <Square className="h-8 w-8" />}
                {isCountdown && countdown !== null && (
                    <span
                        // `key={countdown}` re-mounts the span for each digit,
                        // restarting the fade-in/hold/fade-out cycle.  The
                        // animation duration matches the 1s interval between
                        // ticks so each digit completes its breath before the
                        // next one mounts.
                        key={countdown}
                        className="inline-block animate-[var(--animate-recorder-countdown-digit)]"
                    >
                        {countdown}
                    </span>
                )}
                {isIdle && <Mic className="h-8 w-8" />}
            </Button>
        </div>
    );
};
