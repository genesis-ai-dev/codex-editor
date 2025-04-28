import React, { useEffect, useState } from "react";
import { animate } from "animejs";

interface Dot {
    id: number;
    left: string;
    top: string;
}

export const SideElements: React.FC = () => {
    const [leftDots, setLeftDots] = useState<Dot[]>([]);
    const [rightDots, setRightDots] = useState<Dot[]>([]);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Create side element dots
    const createSideElementDots = (count: number) => {
        return Array.from({ length: count }, (_, i) => ({
            id: i,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
        }));
    };

    // Helper function to get random value (replacing anime.random)
    const randomValue = (min: number, max: number) => min + Math.random() * (max - min);

    useEffect(() => {
        // Create dots for both sides
        setLeftDots(createSideElementDots(20));
        setRightDots(createSideElementDots(20));

        // Skip animations for users who prefer reduced motion
        if (prefersReducedMotion) return;

        // Animate the side element dots
        animate(".element-dot", {
            opacity: () => [0.1, randomValue(0.3, 0.7)],
            scale: () => [1, randomValue(1, 1.5)],
            // Create a custom staggered delay based on grid position
            delay: function (el, i) {
                // TypeScript doesn't know the right types, but this works at runtime
                const index = i as number;

                // Create a grid-like stagger effect
                const position = index % 100;
                const row = Math.floor(position / 10);
                const col = position % 10;

                // Calculate distance from center
                const centerRow = 5,
                    centerCol = 5;
                const distanceFromCenter = Math.sqrt(
                    Math.pow(row - centerRow, 2) + Math.pow(col - centerCol, 2)
                );

                // Delay based on distance (closer to center = earlier animation)
                return distanceFromCenter * 500;
            },
            duration: 2000,
            easing: "easeInOutQuad",
            direction: "alternate",
            loop: true,
        });

        // Handle window resize by recreating dots
        const handleResize = () => {
            if (!prefersReducedMotion) {
                setLeftDots(createSideElementDots(20));
                setRightDots(createSideElementDots(20));
            }
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [prefersReducedMotion]);

    return (
        <>
            <div className="side-element left-element">
                <div className="element-dots" id="left-dots">
                    {leftDots.map((dot) => (
                        <div
                            key={`left-${dot.id}`}
                            className="element-dot"
                            style={{
                                left: dot.left,
                                top: dot.top,
                            }}
                        />
                    ))}
                </div>
            </div>

            <div className="side-element right-element">
                <div className="element-dots" id="right-dots">
                    {rightDots.map((dot) => (
                        <div
                            key={`right-${dot.id}`}
                            className="element-dot"
                            style={{
                                left: dot.left,
                                top: dot.top,
                            }}
                        />
                    ))}
                </div>
            </div>
        </>
    );
};
