import * as React from "react";

interface DualRingProgressProps {
    completionValue: number;
    validationValue: number;
    size?: number;
    className?: string;
}

function DualRingProgress({
    completionValue,
    validationValue,
    size = 32,
    className = "",
}: DualRingProgressProps) {
    const outerStrokeWidth = 3;
    const innerStrokeWidth = 2.5;
    const gap = 1;

    const outerRadius = (size - outerStrokeWidth) / 2;
    const innerRadius = outerRadius - outerStrokeWidth / 2 - gap - innerStrokeWidth / 2;

    const outerCircumference = outerRadius * 2 * Math.PI;
    const innerCircumference = innerRadius * 2 * Math.PI;

    const clampedCompletion = Math.max(0, Math.min(100, completionValue));
    const clampedValidation = Math.max(0, Math.min(100, validationValue));

    const outerOffset = outerCircumference - (clampedCompletion / 100) * outerCircumference;
    const innerOffset = innerCircumference - (clampedValidation / 100) * innerCircumference;

    const displayValue = Math.floor(clampedCompletion);

    return (
        <div
            className={`relative inline-flex items-center justify-center ${className}`}
            style={{ width: size, height: size }}
        >
            <svg width={size} height={size} className="transform -rotate-90">
                {/* Outer background circle (completion track) */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={outerRadius}
                    fill="transparent"
                    stroke="currentColor"
                    strokeWidth={outerStrokeWidth}
                    className="text-primary/20"
                />
                {/* Outer progress circle (completion - blue) */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={outerRadius}
                    fill="transparent"
                    stroke="currentColor"
                    strokeWidth={outerStrokeWidth}
                    strokeDasharray={outerCircumference}
                    strokeDashoffset={outerOffset}
                    strokeLinecap="round"
                    className="text-primary transition-all duration-300"
                />
                {/* Inner background circle (validation track) */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={innerRadius}
                    fill="transparent"
                    stroke="currentColor"
                    strokeWidth={innerStrokeWidth}
                    className="text-yellow-500/20"
                />
                {/* Inner progress circle (validation - gold) */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={innerRadius}
                    fill="transparent"
                    strokeWidth={innerStrokeWidth}
                    strokeDasharray={innerCircumference}
                    strokeDashoffset={innerOffset}
                    strokeLinecap="round"
                    className="transition-all duration-300"
                    style={{ stroke: "var(--vscode-editorWarning-foreground)" }}
                />
            </svg>
            {/* Percentage in center */}
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[9px] font-semibold text-vscode-foreground">
                    {displayValue}
                </span>
            </div>
        </div>
    );
}

export { DualRingProgress };
