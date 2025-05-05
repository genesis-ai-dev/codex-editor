import React, { useEffect, useState } from "react";
import { ActivationTiming } from "../types";
import { animate } from "animejs";

interface LoadingStagesProps {
    stages: ActivationTiming[];
}

export const LoadingStages: React.FC<LoadingStagesProps> = ({ stages }) => {
    const [stagesContainerTransform, setStagesContainerTransform] = useState("translateY(0px)");
    const MAX_VISIBLE_STAGES = 15;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    useEffect(() => {
        if (stages.length < 4) return;

        // Calculate scroll amount based on how many stages we have
        const scrollAmount = -Math.min(stages.length - 4, 7) * 32; // Each stage is about 32px high

        if (prefersReducedMotion) {
            setStagesContainerTransform(`translateY(${scrollAmount}px)`);
        } else {
            // Animate the scroll with v4 syntax
            animate("#loading-stages", {
                translateY: scrollAmount,
                easing: "easeOutQuad",
                duration: 600,
            });
        }
    }, [stages.length, prefersReducedMotion]);

    return (
        <div className="loading-area">
            <div className="loading-stages-container">
                <div
                    id="loading-stages"
                    className="loading-stages"
                    tabIndex={0}
                    role="log"
                    aria-label="Loading stages"
                    style={{ transform: stagesContainerTransform }}
                >
                    {stages.slice(0, MAX_VISIBLE_STAGES).map((stage, index) => {
                        const isLatestStage = index === stages.length - 1;
                        const isCompleted = !isLatestStage;
                        const isSyncStep = stage.step.includes("Project Synchronization");

                        return (
                            <div
                                key={`stage-${index}`}
                                id={`stage-${index}`}
                                className={`loading-stage visible ${
                                    isLatestStage ? "active" : ""
                                } ${isCompleted ? "completed" : ""} ${
                                    isSyncStep ? "sync-step" : ""
                                }`}
                            >
                                <div className="loading-indicator" aria-hidden="true">
                                    <svg viewBox="0 0 16 16">
                                        <circle
                                            className="loading-circle"
                                            cx="8"
                                            cy="8"
                                            r="6"
                                        ></circle>
                                        <polyline
                                            className="loading-check"
                                            points="4,8 7,11 12,5"
                                        ></polyline>
                                    </svg>
                                </div>
                                <div className="loading-stage-content">
                                    <span className={`stage-name ${isSyncStep ? "sync-text" : ""}`}>
                                        {stage.step}
                                    </span>
                                    <span className="stage-time">
                                        {stage.duration.toFixed(0)}ms
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="loading-stages-fade"></div>
            </div>
        </div>
    );
};
