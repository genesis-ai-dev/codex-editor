import React, { useState } from "react";

interface HealthIndicatorProps {
    health: number | undefined;
    className?: string;
    show?: boolean;
}

/**
 * Displays a small health indicator bar showing the translation quality score.
 * - Red (0-30%): Low confidence / unverified
 * - Yellow (30-70%): Medium confidence
 * - Green (70-100%): High confidence / verified
 */
const HealthIndicator: React.FC<HealthIndicatorProps> = ({ health, className = "", show = true }) => {
    const [isHovered, setIsHovered] = useState(false);

    // Don't render if health is undefined or show is false
    if (health === undefined || !show) {
        return null;
    }

    // Clamp health to 0-1 range
    const normalizedHealth = Math.max(0, Math.min(1, health));
    const percentage = Math.round(normalizedHealth * 100);

    // Determine color based on health level
    const getColor = (h: number): string => {
        if (h < 0.3) return "#ef4444"; // red-500
        if (h < 0.7) return "#eab308"; // yellow-500
        return "#22c55e"; // green-500
    };

    const getBackgroundColor = (h: number): string => {
        if (h < 0.3) return "rgba(239, 68, 68, 0.2)"; // red with opacity
        if (h < 0.7) return "rgba(234, 179, 8, 0.2)"; // yellow with opacity
        return "rgba(34, 197, 94, 0.2)"; // green with opacity
    };

    const getLabel = (h: number): string => {
        if (h >= 1.0) return "Validated";
        if (h >= 0.7) return "High confidence";
        if (h >= 0.3) return "Medium confidence";
        return "Unverified";
    };

    const color = getColor(normalizedHealth);
    const backgroundColor = getBackgroundColor(normalizedHealth);

    return (
        <div
            className={`flex items-center gap-1 cursor-help ${className}`}
            title={`Health: ${percentage}% - ${getLabel(normalizedHealth)}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div
                style={{
                    width: "24px",
                    height: "6px",
                    borderRadius: "3px",
                    backgroundColor: backgroundColor,
                    overflow: "hidden",
                    position: "relative",
                }}
            >
                <div
                    style={{
                        width: `${percentage}%`,
                        height: "100%",
                        backgroundColor: color,
                        borderRadius: "3px",
                        transition: "width 0.3s ease",
                    }}
                />
            </div>
            <span
                style={{
                    fontSize: "9px",
                    color: color,
                    fontWeight: 500,
                    minWidth: "24px",
                    textAlign: "right",
                    opacity: isHovered ? 1 : 0,
                    transition: "opacity 0.15s ease",
                }}
            >
                {percentage}%
            </span>
        </div>
    );
};

export default HealthIndicator;
