import React, { useEffect, useState } from "react";
import { ActivationTiming } from "../types";
import { animate } from "animejs";

interface LoadingStagesProps {
    stages: ActivationTiming[];
}

export const LoadingStages: React.FC<LoadingStagesProps> = ({ stages }) => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [dotCycle, setDotCycle] = useState(0); // 0: ".", 1: "..", 2: "..."
    const [dotStages, setDotStages] = useState<Set<number>>(new Set());
    
    // Track stages that should show dots instead of timing
    useEffect(() => {
        const newDotStages = new Set<number>();
        
        stages.forEach((stage, index) => {
            const isLatestStage = index === stages.length - 1;
            const isCompleted = !isLatestStage;
            
            // Show dots for any stage that is:
            // 1. The current/latest stage (actively running)
            // 2. Any non-completed stage that has 0 duration (never got updated)
            if (isLatestStage || (!isCompleted && stage.duration === 0)) {
                newDotStages.add(index);
            }
        });
        
        setDotStages(newDotStages);
    }, [stages]);

    // Animate dots for active stages
    useEffect(() => {
        if (dotStages.size === 0) return;
        
        const interval = setInterval(() => {
            setDotCycle(prev => (prev + 1) % 3);
        }, 500); // Change dots every 500ms
        
        return () => clearInterval(interval);
    }, [dotStages.size]);

    const getDotAnimation = (stageIndex: number) => {
        if (!dotStages.has(stageIndex)) return "";
        
        switch (dotCycle) {
            case 0: return ".";
            case 1: return "..";
            case 2: return "...";
            default: return ".";
        }
    };

    // Group stages by categories for visual organization
    const groupedStages = stages.reduce((acc, stage) => {
        let category = "initialization";

        if (stage.step.includes("Sync") || stage.step.includes("sync")) {
            category = "synchronization";
        } else if (stage.step.includes("Index") || stage.step.includes("index")) {
            category = "indexing";
        } else if (
            stage.step.includes("UI") ||
            stage.step.includes("Webview") ||
            stage.step.includes("Component")
        ) {
            category = "ui";
        }

        if (!acc[category]) {
            acc[category] = [];
        }

        acc[category].push(stage);
        return acc;
    }, {} as Record<string, ActivationTiming[]>);

    return (
        <div className="loading-area">
            <div className="loading-stages-list">
                {stages.map((stage, index) => {
                    const isLatestStage = index === stages.length - 1;
                    const isCompleted = !isLatestStage;
                    const isSyncStep = stage.step.includes("Project Synchronization");
                    const isIndexStep = stage.step.includes("Index");
                    const showDots = dotStages.has(index);

                    // Add animation delay based on index for staggered entrance
                    const animationDelay = prefersReducedMotion ? 0 : index * 70;

                    // Determine stage icon and appearance
                    let stageIcon = "⚙️";
                    if (isSyncStep) stageIcon = "🔄";
                    if (isIndexStep) stageIcon = "📑";
                    if (stage.step.includes("Webview")) stageIcon = "🖥️";
                    if (stage.step.includes("Complete")) stageIcon = "✅";

                    return (
                        <div
                            key={`stage-${stage.startTime}-${index}`}
                            id={`stage-${index}`}
                            className={`loading-stage visible ${
                                isLatestStage ? "active" : ""
                            } ${isCompleted ? "completed" : ""} ${
                                isSyncStep ? "sync-step" : ""
                            } ${showDots ? "active-with-dots" : ""}`}
                            style={{
                                animationDelay: `${animationDelay}ms`,
                                opacity: isCompleted ? 0.7 : 1,
                            }}
                        >
                            <div className="loading-indicator" aria-hidden="true">
                                <svg viewBox="0 0 16 16">
                                    <circle
                                        className={`loading-circle ${isLatestStage && !isCompleted ? "spinning" : ""}`}
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
                                    {showDots ? 
                                        getDotAnimation(index) : 
                                        `${Math.max(0, Math.round(stage.duration))}ms`
                                    }
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
