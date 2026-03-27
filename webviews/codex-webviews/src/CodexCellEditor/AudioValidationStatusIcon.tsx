import React, { useState, useEffect, useRef } from "react";

export interface ValidationStatusIconProps {
    isValidationInProgress: boolean;
    isDisabled: boolean;
    currentValidations: number;
    requiredValidations: number;
    isValidatedByCurrentUser: boolean;
    displayValidationText?: boolean;
    health?: number; // Health score (0-1) for radial progress when unverified
    showHealthRadial?: boolean; // Whether to show radial health progress (only for text validation)
    isPendingValidation?: boolean; // Whether validation is pending (for animation)
}

// Helper function to get health color for radial progress
const getHealthColor = (health: number): string => {
    if (health < 0.3) return "#ef4444"; // red-500
    if (health < 0.7) return "#eab308"; // yellow-500
    return "#22c55e"; // green-500
};

const ValidationStatusIcon: React.FC<ValidationStatusIconProps> = ({
    isValidationInProgress,
    isDisabled,
    currentValidations,
    requiredValidations,
    isValidatedByCurrentUser,
    displayValidationText,
    health,
    showHealthRadial = false, // Default to false - only show for text validation
    isPendingValidation = false,
}) => {
    const [animatedHealth, setAnimatedHealth] = useState<number | null>(null);
    const [showOptimisticCheckmark, setShowOptimisticCheckmark] = useState(false);

    // Debug logging for health prop changes
    useEffect(() => {
        console.log("[ValidationStatusIcon] Props update:", {
            health,
            currentValidations,
            isValidatedByCurrentUser,
            showHealthRadial,
            isPendingValidation,
            isUnverified: currentValidations === 0,
        });
    }, [
        health,
        currentValidations,
        isValidatedByCurrentUser,
        showHealthRadial,
        isPendingValidation,
    ]);
    const radialProgressRef = useRef<HTMLDivElement>(null);
    const animationFrameRef = useRef<number | null>(null);
    const animationStartTimeRef = useRef<number | null>(null);
    const animationStartHealthRef = useRef<number>(0);

    // Handle validation animation: animate health from current value to 1.0
    useEffect(() => {
        // When validation starts (pending), animate health to 100%
        // Continue animation even if validation completes (isValidatedByCurrentUser becomes true)
        if (
            isPendingValidation &&
            showHealthRadial &&
            health !== undefined &&
            health !== null &&
            animatedHealth === null
        ) {
            const startHealth = Math.max(0, Math.min(1, health));
            animationStartHealthRef.current = startHealth;
            animationStartTimeRef.current = Date.now();
            setAnimatedHealth(startHealth);

            const animate = () => {
                if (animationStartTimeRef.current === null) return;

                const elapsed = Date.now() - animationStartTimeRef.current;
                const duration = 400; // 400ms animation
                const progress = Math.min(elapsed / duration, 1);

                // Ease-out cubic for smooth animation
                const eased = 1 - Math.pow(1 - progress, 3);
                const newHealth =
                    animationStartHealthRef.current + (1 - animationStartHealthRef.current) * eased;

                setAnimatedHealth(newHealth);

                if (progress < 1) {
                    animationFrameRef.current = requestAnimationFrame(animate);
                } else {
                    // Animation complete - set to 1.0 and show optimistic checkmark after brief delay
                    setAnimatedHealth(1.0);
                    setTimeout(() => {
                        setAnimatedHealth(null);
                        // Show optimistic checkmark immediately after animation completes
                        // Backend will catch up, but UI should be responsive
                        setShowOptimisticCheckmark(true);
                    }, 150);
                }
            };

            animationFrameRef.current = requestAnimationFrame(animate);
        } else if (!isPendingValidation && !isValidatedByCurrentUser && animatedHealth !== null) {
            // Reset animation if validation is cancelled (pending becomes false but not validated)
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            animationStartTimeRef.current = null;
            setAnimatedHealth(null);
            setShowOptimisticCheckmark(false);
        }

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isPendingValidation, isValidatedByCurrentUser, showHealthRadial, health, animatedHealth]);

    // Clear optimistic checkmark when backend confirms validation
    useEffect(() => {
        if (isValidatedByCurrentUser && showOptimisticCheckmark) {
            setShowOptimisticCheckmark(false);
        }
    }, [isValidatedByCurrentUser, showOptimisticCheckmark]);

    if (isValidationInProgress) {
        return (
            <i
                className="codicon codicon-loading"
                style={{
                    fontSize: "14px",
                    color: isDisabled
                        ? "var(--vscode-disabledForeground)"
                        : "var(--vscode-descriptionForeground)",
                    animation: "spin 1.5s linear infinite",
                }}
            ></i>
        );
    }

    // Show radial progress only when unverified (currentValidations === 0) OR during validation animation
    // Once validated (currentValidations > 0) and animation complete, show checkmark instead
    // Also show optimistic checkmark after animation completes, even before backend confirms
    const isUnverified = currentValidations === 0 && !showOptimisticCheckmark;
    const showRadialDuringAnimation = animatedHealth !== null; // Show during entire animation including when it reaches 1.0

    if (isUnverified || showRadialDuringAnimation) {
        // Show radial progress when unverified, health is available, and showHealthRadial is true (text validation only)
        // Use animated health if validation is in progress, otherwise use actual health
        const effectiveHealth = animatedHealth !== null ? animatedHealth : health;
        const showRadialProgress =
            showHealthRadial &&
            effectiveHealth !== undefined &&
            effectiveHealth !== null &&
            (isUnverified || showRadialDuringAnimation);
        const normalizedHealth = showRadialProgress ? Math.max(0, Math.min(1, effectiveHealth)) : 0;
        const healthPercentage = showRadialProgress ? Math.round(normalizedHealth * 100) : 0;
        const healthColor = showRadialProgress ? getHealthColor(normalizedHealth) : undefined;

        // SVG circle parameters for radial progress
        // Use slightly larger size to accommodate the radial progress ring
        const iconSize = 12; // Original icon size
        const containerSize = 18; // Container size to fit radial progress
        const strokeWidth = 2.5;
        const radius = (containerSize - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - normalizedHealth * circumference;

        return (
            <div className="flex items-center justify-center text-sm font-light relative">
                {showRadialProgress ? (
                    <div
                        ref={radialProgressRef}
                        className="relative inline-flex items-center justify-center"
                        style={{ width: containerSize, height: containerSize }}
                    >
                        {/* Radial progress circle */}
                        <svg
                            width={containerSize}
                            height={containerSize}
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                transform: "rotate(-90deg)", // Start from top
                            }}
                        >
                            {/* Background circle */}
                            <circle
                                cx={containerSize / 2}
                                cy={containerSize / 2}
                                r={radius}
                                fill="none"
                                stroke="rgba(128, 128, 128, 0.15)"
                                strokeWidth={strokeWidth}
                            />
                            {/* Progress circle */}
                            <circle
                                cx={containerSize / 2}
                                cy={containerSize / 2}
                                r={radius}
                                fill="none"
                                stroke={healthColor}
                                strokeWidth={strokeWidth}
                                strokeDasharray={circumference}
                                strokeDashoffset={offset}
                                strokeLinecap="round"
                                style={{
                                    transition: "stroke-dashoffset 0.3s ease, stroke 0.3s ease",
                                }}
                            />
                        </svg>
                        {/* Icon in center */}
                        <i
                            className="codicon codicon-circle-outline"
                            style={{
                                fontSize: `${iconSize}px`,
                                color: isDisabled
                                    ? "var(--vscode-disabledForeground)"
                                    : "var(--vscode-descriptionForeground)",
                                position: "relative",
                                zIndex: 1,
                            }}
                        ></i>
                    </div>
                ) : (
                    <i
                        className="codicon codicon-circle-outline"
                        style={{
                            fontSize: `${iconSize}px`,
                            color: isDisabled
                                ? "var(--vscode-disabledForeground)"
                                : "var(--vscode-descriptionForeground)",
                        }}
                    ></i>
                )}
                {displayValidationText && <span className="ml-1">No validators</span>}
            </div>
        );
    }

    // Validated state: show fully-filled radial circle with a checkmark in the center
    const isFullyValidated = currentValidations >= requiredValidations;
    const shouldShowCheckmark = isValidatedByCurrentUser || showOptimisticCheckmark;
    const isValidated = isFullyValidated || shouldShowCheckmark || currentValidations > 0;

    const validatedContainerSize = 18;
    const validatedStrokeWidth = 2.5;
    const validatedRadius = (validatedContainerSize - validatedStrokeWidth) / 2;
    const validatedCircumference = 2 * Math.PI * validatedRadius;
    const validatedColor = "#22c55e"; // green-500, fully healthy

    return (
        <div className="flex items-center justify-center text-sm font-light relative">
            <div
                className="relative inline-flex items-center justify-center"
                style={{ width: validatedContainerSize, height: validatedContainerSize }}
            >
                {/* Full radial circle - 100% filled */}
                <svg
                    width={validatedContainerSize}
                    height={validatedContainerSize}
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        transform: "rotate(-90deg)",
                    }}
                >
                    {/* Background circle */}
                    <circle
                        cx={validatedContainerSize / 2}
                        cy={validatedContainerSize / 2}
                        r={validatedRadius}
                        fill="none"
                        stroke="rgba(128, 128, 128, 0.15)"
                        strokeWidth={validatedStrokeWidth}
                    />
                    {/* Full progress circle */}
                    <circle
                        cx={validatedContainerSize / 2}
                        cy={validatedContainerSize / 2}
                        r={validatedRadius}
                        fill="none"
                        stroke={isDisabled ? "var(--vscode-disabledForeground)" : validatedColor}
                        strokeWidth={validatedStrokeWidth}
                        strokeDasharray={validatedCircumference}
                        strokeDashoffset={0}
                        strokeLinecap="round"
                    />
                </svg>
                {/* Checkmark in center */}
                <i
                    className={`codicon ${isFullyValidated ? "codicon-check-all" : "codicon-check"}`}
                    style={{
                        fontSize: "10px",
                        color: isDisabled
                            ? "var(--vscode-disabledForeground)"
                            : validatedColor,
                        position: "relative",
                        zIndex: 1,
                        filter: "drop-shadow(0 0 0.5px rgba(0,0,0,0.3))",
                    }}
                ></i>
            </div>
            {displayValidationText && (
                <span className="ml-1">
                    {isFullyValidated ? "Fully validated" : "Validated"}
                </span>
            )}
        </div>
    );
};

export default ValidationStatusIcon;
