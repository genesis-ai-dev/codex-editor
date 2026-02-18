import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

function Progress({
    className,
    value,
    secondaryValue = 0,
    showPercentage = false,
    showValidationLevelTicks = false,
    validationValues,
    requiredValidations,
    ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
    secondaryValue?: number;
    showPercentage?: boolean;
    showValidationLevelTicks?: boolean;
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
    const fullIndex = hasValidationLayers
        ? Math.max(0, Math.min(n, safeValidationValues.length) - 1)
        : 0;

    const getOpacityForLevel = (index: number, totalLevels: number) => {
        if (totalLevels <= 0) return 0.3;
        const alpha = 0.18 + (index + 1) * (0.42 / totalLevels);
        return Math.min(0.6, Math.max(0.18, alpha));
    };

    return (
        <div className="w-full">
            <ProgressPrimitive.Root
                data-slot="progress"
                className="bg-primary/20 relative w-full overflow-hidden rounded-full h-[8px]"
                {...props}
            >
                <ProgressPrimitive.Indicator
                    data-slot="progress-indicator"
                    className="bg-primary h-full w-full flex-1 transition-all relative"
                    style={{ transform: `translateX(-${100 - translated}%)` }}
                >
                    {hasValidationLayers ? (
                        <>
                            {safeValidationValues.map((v, i) => {
                                const clampedLevel = Math.min(translated, v);
                                const shift = Math.max(0, translated - clampedLevel);
                                const isFullLayer = i === fullIndex;
                                if (clampedLevel <= 0) return null;
                                return (
                                    <ProgressPrimitive.Indicator
                                        key={i}
                                        data-slot="progress-indicator"
                                        className="h-full w-full flex-1 transition-all absolute inset-0"
                                        style={{
                                            backgroundColor: isFullLayer
                                                ? "var(--vscode-editorWarning-foreground)"
                                                : `rgba(0, 0, 0, ${getOpacityForLevel(i, n)})`,
                                            opacity: 1,
                                            transform: `translateX(-${shift}%)`,
                                            zIndex: isFullLayer ? 100 : 10 + i,
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
                        (safeValidationValues[fullIndex] || 0) > 0 ? (
                            <span
                                className="text-[10px] font-medium"
                                style={{ color: "var(--vscode-editorWarning-foreground)" }}
                            >
                                {Math.floor(safeValidationValues[fullIndex] || 0)}%
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
            {hasValidationLayers && showValidationLevelTicks && (
                <div className="mt-0.5 flex flex-wrap gap-2 text-[9px]">
                    {safeValidationValues.map((v, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-x-1 font-medium"
                            style={{
                                color:
                                    i === fullIndex
                                        ? "var(--vscode-editorWarning-foreground)"
                                        : "var(--vscode-button-background)",
                            }}
                        >
                            {i + 1}
                            <i className="codicon codicon-check-all text-[4px] text-charts-green" />
                            {Math.floor(v)}%
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export { Progress };
