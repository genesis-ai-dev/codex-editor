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
    const { timings, isComplete, sendMessage, syncDetails } = useVSCodeMessaging();
    const mainTimelineRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const stagesRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [syncInProgress, setSyncInProgress] = useState(false);
    const [syncMessage, setSyncMessage] = useState("");
    const [syncProgress, setSyncProgress] = useState(0);
    const [showScrollHint, setShowScrollHint] = useState(false);

    // Auto-scroll to latest stage when new stages are added
    useEffect(() => {
        if (stagesRef.current && timings.length > 0) {
            const stagesContainer = stagesRef.current;
            const shouldAutoScroll = stagesContainer.scrollHeight > stagesContainer.clientHeight;
            
            if (shouldAutoScroll) {
                setShowScrollHint(true);
                // Auto-scroll to bottom to show latest stage
                stagesContainer.scrollTo({
                    top: stagesContainer.scrollHeight,
                    behavior: 'smooth'
                });
                
                // Hide scroll hint after a few seconds
                setTimeout(() => setShowScrollHint(false), 3000);
            }
        }
    }, [timings.length]);

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
        const syncReservedPercentage = syncInProgress ? 15 : 0;
        const baseProgress = Math.min(
            85 - syncReservedPercentage,
            Math.floor((totalDuration / 5000) * 100)
        );

        // If sync is in progress and we have details, use sync progress to fill the reserved percentage
        if (syncInProgress && syncDetails) {
            const syncPercentage = syncDetails.progress || 0;
            setSyncProgress(syncPercentage);
            setSyncMessage(syncDetails.message || "Syncing files...");

            // Add sync progress contribution to total progress
            const syncContribution = (syncPercentage * syncReservedPercentage) / 100;
            setProgress(baseProgress + syncContribution);
        } else {
            setProgress(baseProgress);
        }
    }, [timings, syncInProgress, syncDetails]);

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
                          syncInProgress ? ` - ${syncMessage}` : ""
                      }`}
            </div>

            <SideElements />

            <div ref={containerRef} className="container scrollable" id="main-container">
                <LoadingBook />
                <h1>Loading Codex Editor</h1>
                <div className="current-step" id="current-step" aria-live="polite">
                    {syncInProgress ? (
                        <div className="sync-info">
                            <strong>{syncMessage}</strong>
                            {syncDetails && syncDetails.currentFile && (
                                <span className="sync-file">{syncDetails.currentFile}</span>
                            )}
                            {syncDetails && syncDetails.progress > 0 && (
                                <span className="sync-percentage">{syncDetails.progress}%</span>
                            )}
                        </div>
                    ) : latestTiming ? (
                        <>
                            <span>
                                {isSyncStep ? (
                                    <strong>{latestTiming.step}</strong>
                                ) : (
                                    latestTiming.step
                                )}
                            </span>
                            <span className="stage-time">{latestTiming.duration.toFixed(0)}ms</span>
                        </>
                    ) : (
                        "Initializing components..."
                    )}
                </div>
                <ProgressBar progress={progress} />
                
                {/* Scrollable stages section */}
                <div className="loading-stages-scroll-container">
                    {showScrollHint && (
                        <div className="scroll-hint" aria-live="polite">
                            <span>Scroll to see all loading stages</span>
                            <div className="scroll-hint-arrow">↓</div>
                        </div>
                    )}
                    <div 
                        ref={stagesRef}
                        className="loading-stages-scrollable"
                        tabIndex={0}
                        role="log"
                        aria-label="Loading stages - scrollable list"
                        onKeyDown={(e) => {
                            // Add keyboard navigation
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                stagesRef.current?.scrollBy({ top: 50, behavior: 'smooth' });
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                stagesRef.current?.scrollBy({ top: -50, behavior: 'smooth' });
                            } else if (e.key === 'Home') {
                                e.preventDefault();
                                stagesRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                            } else if (e.key === 'End') {
                                e.preventDefault();
                                stagesRef.current?.scrollTo({ top: stagesRef.current.scrollHeight, behavior: 'smooth' });
                            }
                        }}
                    >
                        <LoadingStages stages={timings} /> {/* Show ALL stages */}
                    </div>

                </div>
            </div>

            <Particles count={15} />
        </div>
    );
};

export default SplashScreen;
