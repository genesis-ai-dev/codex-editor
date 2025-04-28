import React, { useEffect, useState } from "react";
import { animate, utils } from "animejs";

interface ParticlesProps {
    count: number;
}

interface Particle {
    id: number;
    size: number;
}

export const Particles: React.FC<ParticlesProps> = ({ count }) => {
    const [particles, setParticles] = useState<Particle[]>([]);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    useEffect(() => {
        // Create particles
        const newParticles = Array.from({ length: count }, (_, i) => ({
            id: i,
            size: 3 + Math.random() * 3, // Random size between 3 and 6px
        }));

        setParticles(newParticles);

        // Skip animations for users who prefer reduced motion
        if (prefersReducedMotion) return;

        // Define a random function that works with our setup
        // This replaces anime.random
        const randomValue = (min: number, max: number) => min + Math.random() * (max - min);

        // Animate particles
        animate(".particle", {
            translateX: () => [
                randomValue(-window.innerWidth / 3, window.innerWidth / 3),
                randomValue(-window.innerWidth / 3, window.innerWidth / 3),
            ],
            translateY: () => [
                randomValue(-window.innerHeight / 3, window.innerHeight / 3),
                randomValue(-window.innerHeight / 3, window.innerHeight / 3),
            ],
            scale: () => [randomValue(0.2, 1), randomValue(0.2, 1)],
            opacity: [0, 0.4, 0],
            duration: () => randomValue(15000, 25000),
            delay: () => randomValue(0, 5000),
            easing: "easeInOutQuad",
            loop: true,
        });

        // Handle window resize by recreating particles
        const handleResize = () => {
            // Only recreate if not in reduced motion mode
            if (!prefersReducedMotion) {
                setParticles([]); // Clear existing

                // Re-create after DOM has updated
                setTimeout(() => {
                    setParticles(newParticles);
                }, 0);
            }
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [count, prefersReducedMotion]);

    return (
        <div className="particles" aria-hidden="true">
            {particles.map((particle) => (
                <div
                    key={particle.id}
                    className="particle"
                    style={{
                        width: `${particle.size}px`,
                        height: `${particle.size}px`,
                    }}
                />
            ))}
        </div>
    );
};
