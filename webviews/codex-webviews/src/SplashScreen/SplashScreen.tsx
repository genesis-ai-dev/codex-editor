import React, { useEffect, useState, useRef } from "react";
import { LoadingBook } from "./components/LoadingBook";
import { LoadingStages } from "./components/LoadingStages";
import { ProgressBar } from "./components/ProgressBar";
import { Particles } from "./components/Particles";
import { SideElements } from "./components/SideElements";
import { useVSCodeMessaging } from "./hooks/useVSCodeMessaging";
import { animate, createTimeline } from "animejs";
import "./SplashScreen.css";

export const SplashScreen: React.FC = () => {
    const [progress, setProgress] = useState(0);
    const { timings, isComplete, sendMessage } = useVSCodeMessaging();
    const mainTimelineRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [syncInProgress, setSyncInProgress] = useState(false);

    // Set up main timeline for coordinated animations
    useEffect(() => {
        if (prefersReducedMotion) return;

        // Create the main timeline with the v4 API
        mainTimelineRef.current = createTimeline({
            // @ts-expect-error - easing is supported by anime.js
            easing: "easeOutCubic",
            duration: 800,
        });

        // Sequence entrance animations
        mainTimelineRef.current
            .add(containerRef.current, {
                opacity: [0, 1],
                translateY: [10, 0],
            })
            .add(
                ".side-element",
                {
                    opacity: [0, 0.6],
                    duration: 600,
                },
                "-=400"
            )
            .add(
                ".particle",
                {
                    opacity: [0, 0.2],
                    duration: 800,
                    // Custom stagger implementation
                    delay: (_: any, i: number) => i * 100,
                },
                "-=300"
            );

        return () => {
            if (mainTimelineRef.current) {
                // Stop animations if component unmounts
                mainTimelineRef.current.pause();
            }
        };
    }, [prefersReducedMotion]);

    useEffect(() => {
        if (timings.length === 0) return;

        // Check if sync operation is in progress
        const syncStarted = timings.some((t) =>
            t.step.includes("Starting Project Synchronization")
        );
        const syncCompleted = timings.some(
            (t) =>
                t.step.includes("Project Synchronization Complete") ||
                t.step.includes("Project Synchronization Skipped") ||
                t.step.includes("Project Synchronization Failed")
        );

        setSyncInProgress(syncStarted && !syncCompleted);

        // Calculate total elapsed time
        const totalDuration = timings.reduce((sum, stage) => sum + stage.duration, 0);

        // Calculate overall progress percentage (cap at 99% until complete)
        // Reserve the last 10% for sync operation if in progress
        const syncReservedPercentage = syncInProgress ? 10 : 0;
        const maxProgress = 99 - syncReservedPercentage;
        const newProgress = Math.min(maxProgress, Math.floor((totalDuration / 5000) * 100));
        setProgress(newProgress);
    }, [timings, syncInProgress]);

    useEffect(() => {
        if (isComplete) {
            // Show 100% progress
            setProgress(100);

            // Create completion timeline
            const completionTimeline = createTimeline({
                // @ts-expect-error - easing is supported by anime.js
                easing: "easeOutQuad",
                duration: 600,
            });

            // Fade out the splash screen after a delay
            setTimeout(() => {
                if (!prefersReducedMotion) {
                    completionTimeline.add("body", {
                        opacity: [1, 0],
                        complete: function () {
                            // Notify extension that animation is complete
                            sendMessage({ command: "animationComplete" });
                        },
                    });
                } else {
                    // Skip animation for reduced motion
                    sendMessage({ command: "animationComplete" });
                }
            }, 500);
        }
    }, [isComplete, sendMessage, prefersReducedMotion]);

    const latestTiming = timings.length > 0 ? timings[timings.length - 1] : null;
    const isSyncStep = latestTiming && latestTiming.step.includes("Project Synchronization");

    return (
        <div className="splash-screen-container">
            <div aria-live="polite" className="accessibility-info" id="a11y-status">
                {isComplete
                    ? "Codex Editor has finished loading."
                    : `Codex Editor is loading. Current progress: ${progress}%${
                          syncInProgress ? " - Syncing project files..." : ""
                      }`}
            </div>

            <SideElements />

            <div ref={containerRef} className="container" id="main-container">
                <LoadingBook />
                <h1>Loading Codex Editor</h1>

                <div className="current-step" id="current-step" aria-live="polite">
                    {latestTiming ? (
                        <>
                            <span>
                                {isSyncStep ? (
                                    <strong>{latestTiming.step}</strong>
                                ) : (
                                    `Loading: ${latestTiming.step}`
                                )}
                            </span>
                            <span className="stage-time">{latestTiming.duration.toFixed(0)}ms</span>
                        </>
                    ) : (
                        "Initializing components..."
                    )}
                </div>

                <ProgressBar progress={progress} />
                <LoadingStages stages={timings} />
            </div>

            <Particles count={15} />
        </div>
    );
};

export default SplashScreen;
