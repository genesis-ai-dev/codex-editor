import React, { useEffect, useRef } from "react";
import { animate, createTimeline } from "animejs";

export const LoadingBook: React.FC = () => {
    const timelineRef = useRef<any>(null);
    const linesTimelineRef = useRef<any>(null);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    useEffect(() => {
        if (prefersReducedMotion) {
            return; // Skip animations for users who prefer reduced motion
        }

        // Create book page turning animation timeline
        timelineRef.current = createTimeline({
            loop: true,
            // TypeScript doesn't know about all the anime.js options
            // @ts-expect-error - easing is supported by anime.js
            easing: "easeInOutSine",
        });

        // Add sequential page animations with proper timing offsets
        // This demonstrates the power of timeline's time positioning
        timelineRef.current
            // Start sequence - forward page turns
            .add("#page1", {
                rotateY: [0, 180],
                duration: 1500,
                delay: 500,
            })
            .add(
                "#page2",
                {
                    rotateY: [0, 180],
                    duration: 1500,
                },
                "+=300"
            ) // 300ms after previous animation ends
            .add(
                "#page3",
                {
                    rotateY: [0, 180],
                    duration: 1500,
                },
                "+=300"
            ) // 300ms after previous animation ends

            // Wait a bit at the end state
            .add({}, "+=500")

            // Reverse sequence - backward page turns
            .add("#page3", {
                rotateY: [180, 0],
                duration: 1500,
            })
            .add(
                "#page2",
                {
                    rotateY: [180, 0],
                    duration: 1500,
                },
                "+=300"
            ) // 300ms after previous animation ends
            .add(
                "#page1",
                {
                    rotateY: [180, 0],
                    duration: 1500,
                },
                "+=300"
            ); // 300ms after previous animation ends

        // Create book lines animation timeline
        linesTimelineRef.current = createTimeline({
            loop: true,
            // TypeScript doesn't know about all the anime.js options
            // @ts-expect-error - direction is supported by anime.js
            direction: "alternate",
            easing: "easeInOutSine",
        });

        // Animate each line with staggered delays
        linesTimelineRef.current.add(".book-line", {
            width: ["0%", "100%"],
            opacity: [0, 0.7],
            // TypeScript doesn't know the callback parameters
            delay: (_: number, i: number) => i * 200, // Stagger each line by 200ms
            duration: 1000,
            endDelay: 500,
        });

        return () => {
            // Clean up animations
            if (timelineRef.current) {
                timelineRef.current.pause();
            }
            if (linesTimelineRef.current) {
                linesTimelineRef.current.pause();
            }
        };
    }, [prefersReducedMotion]);

    return (
        <div className="logo-container">
            <div className="logo">
                <div className="book">
                    <div className="book-page" id="page1"></div>
                    <div className="book-page" id="page2"></div>
                    <div className="book-page" id="page3"></div>
                    <div className="book-lines">
                        <div className="book-line"></div>
                        <div className="book-line"></div>
                        <div className="book-line"></div>
                        <div className="book-line"></div>
                        <div className="book-line"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};
