"use client";

import React from "react";
import { getProgressDisplay } from "../utils/progressUtils";

export function ProgressDots({
    audio,
    text,
    className,
}: {
    audio: { validatedPercent: number; completedPercent: number };
    text: { validatedPercent: number; completedPercent: number };
    className?: string;
}) {
    const audioDisplay = getProgressDisplay(
        audio.validatedPercent,
        audio.completedPercent,
        "Audio"
    );
    const textDisplay = getProgressDisplay(text.validatedPercent, text.completedPercent, "Text");

    return (
        <div className={`flex items-center gap-x-2 ${className || ""}`.trim()}>
            <div
                className={`w-2 h-2 rounded-full ${audioDisplay.colorClass}`}
                style={{ backgroundColor: "currentColor" }}
                title={audioDisplay.title}
            />
            <div
                className={`w-2 h-2 rounded-full ${textDisplay.colorClass}`}
                style={{ backgroundColor: "currentColor" }}
                title={textDisplay.title}
            />
        </div>
    );
}
