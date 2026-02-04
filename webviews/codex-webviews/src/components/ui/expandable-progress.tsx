import * as React from "react";
import { useState } from "react";
import { DualRingProgress } from "./circular-progress";

interface ExpandableProgressProps {
    completionValue: number;
    validationValue: number;
    icon: React.ReactNode;
    label: string;
    className?: string;
}

function ExpandableProgress({
    completionValue,
    validationValue,
    icon,
    label,
    className = "",
}: ExpandableProgressProps) {
    const [isHovered, setIsHovered] = useState(false);

    const clampedCompletion = Math.max(0, Math.min(100, completionValue));
    const clampedValidation = Math.max(0, Math.min(100, validationValue));

    return (
        <div
            className={`relative flex items-center h-7 ${className}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Container that morphs between compact and expanded */}
            <div
                className={`flex items-center h-7 border transition-all duration-300 ease-in-out ${
                    isHovered
                        ? "w-[140px] px-2 gap-2 bg-card border-border rounded-md shadow-sm"
                        : "w-[52px] px-1.5 gap-1 bg-primary/10 border-primary/20 rounded-full"
                }`}
                title={`${label}: ${Math.floor(clampedCompletion)}% complete, ${Math.floor(clampedValidation)}% validated`}
            >
                {/* Icon */}
                <div className="h-3 w-3 flex items-center justify-center opacity-70 flex-shrink-0">
                    {icon}
                </div>

                {/* Compact: circular progress / Expanded: bar progress */}
                <div className="flex-1 flex items-center justify-center overflow-hidden">
                    {/* Circular progress - fades out on hover */}
                    <div
                        className={`transition-opacity duration-200 ${
                            isHovered ? "opacity-0 absolute" : "opacity-100"
                        }`}
                    >
                        <DualRingProgress
                            completionValue={clampedCompletion}
                            validationValue={clampedValidation}
                            size={24}
                        />
                    </div>

                    {/* Bar progress - fades in on hover */}
                    <div
                        className={`flex flex-col gap-px flex-1 min-w-0 transition-opacity duration-200 ${
                            isHovered ? "opacity-100" : "opacity-0 absolute"
                        }`}
                    >
                        {/* Completion bar */}
                        <div className="flex items-center gap-1.5">
                            <div className="flex-1 h-[5px] bg-primary/20 rounded-sm overflow-hidden">
                                <div
                                    className="h-full bg-primary rounded-sm transition-all duration-300"
                                    style={{ width: `${clampedCompletion}%` }}
                                />
                            </div>
                            <span className="text-[9px] font-semibold text-primary w-7 text-right flex-shrink-0">
                                {Math.floor(clampedCompletion)}%
                            </span>
                        </div>

                        {/* Validation bar */}
                        <div className="flex items-center gap-1.5">
                            <div
                                className="flex-1 h-[5px] rounded-sm overflow-hidden"
                                style={{ backgroundColor: "var(--vscode-editorWarning-foreground, #f59e0b)", opacity: 0.2 }}
                            >
                                <div
                                    className="h-full rounded-sm transition-all duration-300"
                                    style={{
                                        width: `${clampedValidation}%`,
                                        backgroundColor: "var(--vscode-editorWarning-foreground, #f59e0b)",
                                    }}
                                />
                            </div>
                            <span
                                className="text-[9px] font-semibold w-7 text-right flex-shrink-0"
                                style={{ color: "var(--vscode-editorWarning-foreground, #f59e0b)" }}
                            >
                                {Math.floor(clampedValidation)}%
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export { ExpandableProgress };
