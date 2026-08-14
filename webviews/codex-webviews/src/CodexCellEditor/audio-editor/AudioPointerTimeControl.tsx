import React from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { formatAudioEditTime } from "./audioTrimMath";

interface AudioPointerTimeControlProps {
    label: string;
    valueSec: number;
    minSec: number;
    maxSec: number;
    colorClass: string;
    disabled?: boolean;
    onChange: (valueSec: number) => void;
}

const NUDGE_SEC = 0.01;

/** Precise numeric control shared by the Start, End, and Insert pointers. */
export function AudioPointerTimeControl({
    label,
    valueSec,
    minSec,
    maxSec,
    colorClass,
    disabled = false,
    onChange,
}: AudioPointerTimeControlProps) {
    // Clamp keyboard edits and nudge buttons to the constraints of the active mode.
    const clamp = (value: number) => Math.min(maxSec, Math.max(minSec, value));
    const update = (value: number) => onChange(Number(clamp(value).toFixed(2)));

    return (
        <div className="rounded-md border border-[var(--vscode-panel-border)] bg-muted/20 p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
                <span className={`text-xs font-medium ${colorClass}`}>{label}</span>
                <span className="font-mono text-sm font-semibold">{formatAudioEditTime(valueSec)}</span>
            </div>
            <div className="flex items-center gap-1.5">
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={disabled || valueSec <= minSec}
                    onClick={() => update(valueSec - NUDGE_SEC)}
                    title="Move backward by 0.01 seconds"
                >
                    <Minus className="h-3.5 w-3.5" />
                </Button>
                <Input
                    type="number"
                    min={minSec}
                    max={maxSec}
                    step={NUDGE_SEC}
                    value={valueSec.toFixed(2)}
                    disabled={disabled}
                    onChange={(event) => update(Number(event.target.value))}
                    className="h-8 min-w-0 text-center font-mono"
                    aria-label={`${label} in seconds`}
                />
                <span className="text-xs text-muted-foreground">sec</span>
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={disabled || valueSec >= maxSec}
                    onClick={() => update(valueSec + NUDGE_SEC)}
                    title="Move forward by 0.01 seconds"
                >
                    <Plus className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
}
