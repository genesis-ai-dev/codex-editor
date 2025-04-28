import React, { useEffect, useRef } from "react";
import { animate } from "animejs";

interface ProgressBarProps {
    progress: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress }) => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const progressBarRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!progressBarRef.current) return;

        animate(progressBarRef.current, {
            width: `${progress}%`,
            easing: "easeInOutQuad",
            duration: 800,
            complete: function () {
                // Add shimmer effect after width animation
                if (!prefersReducedMotion && progressBarRef.current) {
                    animate(".progress-bar-shimmer", {
                        translateX: ["0%", "200%"],
                        easing: "easeInOutSine",
                        duration: 1200,
                        loop: false,
                    });
                }
            },
        });
    }, [progress, prefersReducedMotion]);

    return (
        <div className="progress-container" aria-hidden="true">
            <div ref={progressBarRef} className="progress-bar" style={{ width: "0%" }}>
                <div className="progress-bar-shimmer"></div>
            </div>
        </div>
    );
};
