import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "../../lib/utils";

function Progress({
    className,
    value,
    secondaryValue = 0,
    showPercentage = false,
    ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
    secondaryValue?: number;
    showPercentage?: boolean;
}) {
    return (
        <div className="w-full">
            <ProgressPrimitive.Root
                data-slot="progress"
                className={cn(
                    "bg-primary/20 relative w-full overflow-hidden rounded-full",
                    showPercentage ? "h-6" : "h-2",
                    className
                )}
                {...props}
            >
                <ProgressPrimitive.Indicator
                    data-slot="progress-indicator"
                    className="bg-primary h-full w-full flex-1 transition-all"
                    style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
                >
                    {secondaryValue && (
                        <ProgressPrimitive.Indicator
                            data-slot="progress-indicator"
                            className="h-full w-full flex-1 transition-all"
                            style={{
                                backgroundColor: "var(--vscode-editorWarning-foreground)",
                                transform: `translateX(-${secondaryValue || 0}%)`,
                            }}
                        />
                    )}
                </ProgressPrimitive.Indicator>
            </ProgressPrimitive.Root>
            {showPercentage && (
                <div className="flex items-center mt-1 gap-2">
                    {/* Secondary value on the left */}
                    {secondaryValue > 0 ? (
                        <span
                            className="text-xs font-medium"
                            style={{ color: "var(--vscode-editorWarning-foreground)" }}
                        >
                            {Math.round(secondaryValue || 0)}%
                        </span>
                    ) : (
                        <span></span>
                    )}
                    {/* Primary value on the right */}
                    <span className="text-xs font-medium text-primary">
                        {Math.round(value || 0)}%
                    </span>
                </div>
            )}
        </div>
    );
}

export { Progress };
