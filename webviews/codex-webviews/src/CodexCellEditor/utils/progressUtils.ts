export type ProgressColorClass =
    | "text-editor-warning-foreground"
    | "text-charts-blue"
    | "text-muted-foreground/80"
    | "text-muted-foreground/25";

// Returns a Tailwind-compatible text color class representing progress state
export function getProgressColor(
    validatedPercent: number,
    completedPercent: number
): ProgressColorClass {
    if (validatedPercent >= 100) return "text-editor-warning-foreground";
    if (completedPercent >= 100) return "text-charts-blue";
    if (validatedPercent > 0 && validatedPercent < 100) return "text-muted-foreground/80";
    // When there is some content/audio present but no validation yet, use the same partial color
    if (completedPercent > 0) return "text-muted-foreground/80";
    return "text-muted-foreground/25";
}


