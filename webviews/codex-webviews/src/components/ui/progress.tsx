import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";

function Progress({
    className,
    value,
    secondaryValue = 0,
    showPercentage = false,
    showTooltips = false,
    validationValues,
    requiredValidations,
    ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
    secondaryValue?: number;
    showPercentage?: boolean;
    showTooltips?: boolean;
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

    // Build tooltip zones for each validation level segment
    const tooltipZones = React.useMemo(() => {
        if (!showTooltips || !hasValidationLayers) return null;

        const zones: { left: number; width: number; label: string }[] = [];

        // Sort validation values by percentage (ascending) to build non-overlapping zones
        const sorted = safeValidationValues
            .map((v, i) => ({ value: Math.min(translated, v), index: i }))
            .sort((a, b) => a.value - b.value);

        let prevEnd = 0;
        for (const { value: segEnd, index: origIdx } of sorted) {
            if (segEnd <= prevEnd) continue;
            const isRequired = origIdx === fullIndex;
            zones.push({
                left: prevEnd,
                width: segEnd - prevEnd,
                label: `Level ${origIdx + 1}: ${Math.floor(safeValidationValues[origIdx])}%${isRequired ? " (required)" : ""}`,
            });
            prevEnd = segEnd;
        }

        // Add "completed but not validated" zone
        if (translated > prevEnd) {
            zones.push({
                left: prevEnd,
                width: translated - prevEnd,
                label: `Completed (not validated): ${Math.floor(translated - prevEnd)}%`,
            });
        }

        return zones;
    }, [showTooltips, hasValidationLayers, safeValidationValues, translated, fullIndex]);

    return (
        <div className="w-full">
            <div className="relative">
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

                {/* Tooltip overlay zones */}
                {tooltipZones && tooltipZones.length > 0 && (
                    <div className="absolute inset-0 flex" style={{ zIndex: 200 }}>
                        {tooltipZones.map((zone, i) => (
                            <Tooltip key={i}>
                                <TooltipTrigger asChild>
                                    <div
                                        className="h-full cursor-default"
                                        style={{
                                            position: "absolute",
                                            left: `${zone.left}%`,
                                            width: `${zone.width}%`,
                                        }}
                                    />
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={4}>
                                    {zone.label}
                                </TooltipContent>
                            </Tooltip>
                        ))}
                    </div>
                )}
            </div>
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
        </div>
    );
}

export { Progress };
