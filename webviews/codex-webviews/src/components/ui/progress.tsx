import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "../../lib/utils";

function Progress({
    className,
    value,
    secondaryValue = 0,
    showPercentage = false,
    validationValues,
    requiredValidations,
    ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
    secondaryValue?: number;
    showPercentage?: boolean;
    validationValues?: number[];
    requiredValidations?: number;
}) {
    const translated = Math.max(0, Math.min(100, value || 0));
    const hasValidationLayers =
        Array.isArray(validationValues) && (validationValues?.length || 0) > 0;
    const safeValidationValues = hasValidationLayers
        ? (validationValues as number[]).map((v) => Math.max(0, Math.min(100, v)))
        : [];
    const n = hasValidationLayers ? requiredValidations || safeValidationValues.length : 0;

    const getOpacityForLevel = (index: number, totalLevels: number) => {
        if (totalLevels <= 0) return 0.3;
        const alpha = 0.18 + (index + 1) * (0.42 / totalLevels);
        return Math.min(0.6, Math.max(0.18, alpha));
    };

    return (
        <div className="w-full">
            <ProgressPrimitive.Root
                data-slot="progress"
                className={cn(
                    "bg-primary/20 relative w-full overflow-hidden rounded-sm",
                    showPercentage ? "h-2" : "h-1",
                    className
                )}
                {...props}
            >
                <ProgressPrimitive.Indicator
                    data-slot="progress-indicator"
                    className="bg-primary h-full w-full flex-1 transition-all"
                    style={{ transform: `translateX(-${100 - translated}%)` }}
                >
                    {hasValidationLayers ? (
                        <>
                            {safeValidationValues.map((v, i) => {
                                const clampedLevel = Math.min(translated, v);
                                const shift = Math.max(0, translated - clampedLevel);
                                const isLast = i === safeValidationValues.length - 1;
                                if (clampedLevel <= 0) return null;
                                return (
                                    <ProgressPrimitive.Indicator
                                        key={i}
                                        data-slot="progress-indicator"
                                        className="h-full w-full flex-1 transition-all"
                                        style={{
                                            backgroundColor: isLast
                                                ? "var(--vscode-editorWarning-foreground)"
                                                : `rgba(0, 0, 0, ${getOpacityForLevel(i, n)})`,
                                            transform: `translateX(-${shift}%)`,
                                        }}
                                    />
                                );
                            })}
                        </>
                    ) : secondaryValue ? (
                        <ProgressPrimitive.Indicator
                            data-slot="progress-indicator"
                            className="h-full w-full flex-1 transition-all"
                            style={{
                                backgroundColor: "var(--vscode-editorWarning-foreground)",
                                transform: `translateX(-${Math.max(
                                    0,
                                    translated - Math.max(0, Math.min(100, secondaryValue || 0))
                                )}%)`,
                            }}
                        />
                    ) : null}
                </ProgressPrimitive.Indicator>
            </ProgressPrimitive.Root>
            {showPercentage && (
                <div className="flex items-center mt-0.5 gap-2">
                    {hasValidationLayers ? (
                        // Fully validated on the left (gold)
                        (safeValidationValues[safeValidationValues.length - 1] || 0) > 0 ? (
                            <span
                                className="text-[10px] font-medium"
                                style={{ color: "var(--vscode-editorWarning-foreground)" }}
                            >
                                {Math.floor(
                                    safeValidationValues[safeValidationValues.length - 1] || 0
                                )}
                                %
                            </span>
                        ) : (
                            <span></span>
                        )
                    ) : // Back-compat: show secondaryValue on the left if present
                    secondaryValue > 0 ? (
                        <span
                            className="text-[10px] font-medium"
                            style={{ color: "var(--vscode-editorWarning-foreground)" }}
                        >
                            {Math.floor(secondaryValue || 0)}%
                        </span>
                    ) : (
                        <span></span>
                    )}
                    {/* Primary value (translated) on the right (blue) */}
                    <span className="text-[10px] font-medium text-primary">
                        {Math.floor(translated)}%
                    </span>
                </div>
            )}
        </div>
    );
}

export { Progress };
