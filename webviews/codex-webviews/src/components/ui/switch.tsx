import * as React from "react";
import { cn } from "../../lib/utils";

interface SwitchProps {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    className?: string;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
    ({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
        return (
            <label
                className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                    checked
                        ? "bg-primary border-primary"
                        : "bg-input border-border hover:border-border/60",
                    disabled && "cursor-not-allowed opacity-50",
                    className
                )}
            >
                <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={(e) => onCheckedChange?.(e.target.checked)}
                    disabled={disabled}
                    ref={ref}
                    {...props}
                />
                <span
                    className={cn(
                        "pointer-events-none block h-5 w-5 rounded-full shadow-lg ring-0 transition-transform",
                        checked
                            ? "translate-x-5 bg-white"
                            : "translate-x-0 bg-gray-400 dark:bg-gray-300"
                    )}
                />
            </label>
        );
    }
);
Switch.displayName = "Switch";

export { Switch };
