import React from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";

/**
 * Audio recorder button.  Three visual states sharing one button:
 *   - idle: theme primary, mic icon, gentle "breathing" halo
 *   - countdown: green tint, big digit, smooth draining SVG ring
 *   - recording: theme destructive, square stop icon, ring-pulse + ambient glow
 *
 * The live mic-level visualization is intentionally NOT in this component —
 * it lives in `RecorderWaveform.tsx` as a single-canvas scrolling waveform
 * rendered below the button.  Keeping them separate means this file stays
 * tiny and React-state-free during recording.
 *
 * Geometry:
 *   - Outer container is 128x128 so decorations (ring-pulse halo, countdown
 *     ring) can extend past the 96x96 button without being clipped.
 *   - The countdown SVG uses overflow: visible so the stroke renders cleanly
 *     even when the ring radius approaches the SVG bounds.
 */

const CONTAINER_DIAMETER = 128;
const BUTTON_DIAMETER = 96;
const COUNTDOWN_RING_RADIUS = 56; // 8px outside the button edge

export type RecorderState = "idle" | "countdown" | "recording";

export interface RecorderCircleProps {
    state: RecorderState;
    /** Current countdown value (e.g. 3, 2, 1). Required when state === "countdown". */
    countdown: number | null;
    /** The initial countdown number (e.g. 3) — used for the ring drain calculation. */
    countdownTotal?: number;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
}

export const RecorderCircle: React.FC<RecorderCircleProps> = ({
    state,
    countdown,
    countdownTotal = 3,
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
            {/* Recording: ring-pulse halo (sits between button and waveform).
                Uses overflow-visible parent so the halo can scale past the button
                edge without being clipped. */}
            {isRecording && (
                <span
                    aria-hidden="true"
                    className={cn(
                        "absolute rounded-full border-2 border-destructive/60 pointer-events-none",
                        "animate-[var(--animate-recorder-ring-pulse)]"
                    )}
                    style={{
                        width: BUTTON_DIAMETER,
                        height: BUTTON_DIAMETER,
                    }}
                />
            )}

            {/* Countdown: continuous draining ring.  Single CSS animation
                runs once over `countdownTotal` seconds with linear timing —
                this is what makes the ring sweep smoothly like an analog
                second hand instead of stepping per countdown digit.

                `pathLength="100"` normalizes the path so dasharray/offset can
                use a fixed [0, 100] range regardless of the actual radius —
                lets the keyframe live in tailwind.css independent of geometry.

                The SVG is conditionally rendered, so each entry into the
                countdown state remounts the circle and restarts the animation
                from t=0. */}
            {isCountdown && countdown !== null && (
                <svg
                    aria-hidden="true"
                    className="absolute pointer-events-none -rotate-90"
                    width={CONTAINER_DIAMETER}
                    height={CONTAINER_DIAMETER}
                    viewBox={`0 0 ${CONTAINER_DIAMETER} ${CONTAINER_DIAMETER}`}
                    style={{ overflow: "visible" }}
                >
                    <circle
                        cx={CONTAINER_DIAMETER / 2}
                        cy={CONTAINER_DIAMETER / 2}
                        r={COUNTDOWN_RING_RADIUS}
                        fill="none"
                        stroke="color-mix(in srgb, var(--primary) 55%, transparent)"
                        strokeWidth={3}
                        strokeLinecap="round"
                        pathLength={100}
                        strokeDasharray={100}
                        style={{
                            animation: `recorder-countdown-drain ${countdownTotal}s linear forwards`,
                        }}
                    />
                </svg>
            )}

            {/* The button itself.  Stays scale-stable; only halo/ring move. */}
            <Button
                onClick={onClick}
                disabled={disabled}
                title={title}
                className={cn(
                    "rounded-full text-2xl font-bold p-0",
                    "transition-all duration-150",
                    "hover:scale-105 active:scale-95",
                    isIdle &&
                        "bg-primary hover:bg-primary text-primary-foreground border-0 animate-[var(--animate-recorder-breathing)]",
                    // Countdown intentionally uses an emerald tint rather than a
                    // ShadCN token: ShadCN has no semantic "preparing/go" colour
                    // and the green is a UI convention, not a brand colour.
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
