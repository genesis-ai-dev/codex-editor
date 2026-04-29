/**
 * Single source of truth for translating a cell's audio availability state
 * into the UI mode rendered by:
 *   - the cell list ("AudioPlayButton")
 *   - the cell editor audio tab ("TextCellEditor")
 *   - the audio history modal ("AudioHistoryViewer")
 *
 * Three views, one mapping.  Anywhere a state is checked outside this file
 * either consumes one of these helpers or has a focused reason not to
 * (e.g. lock/source-text gating).
 */

export type AudioAvailability =
    | "available"
    | "available-local"
    | "available-pointer"
    | "available-cached"
    | "missing"
    | "deletedOnly"
    | "unselected"
    | "none";

export type AudioTabMode = "waveform" | "download" | "recorder";

const AVAILABLE_SET = new Set<AudioAvailability>([
    "available",
    "available-local",
    "available-pointer",
    "available-cached",
]);

/**
 * Decide which of the three editor-tab modes to render.
 *
 * Precedence:
 *   1. Active recording / explicit recorder request → "recorder"
 *      (must beat every other state so a state push during recording can't
 *      yank the user out mid-take).
 *   2. We have audio bytes in memory → "waveform" (regardless of state).
 *   3. State is one of the available-* variants → "download".
 *   4. Everything else (`none`, `unselected`, `deletedOnly`, `missing`,
 *      undefined) → "recorder".
 */
export const getAudioTabMode = ({
    state,
    hasAudioBlob,
    isRecording,
    showRecorder,
}: {
    state: AudioAvailability | string | undefined;
    hasAudioBlob: boolean;
    isRecording: boolean;
    showRecorder: boolean;
}): AudioTabMode => {
    if (isRecording || showRecorder) return "recorder";
    if (hasAudioBlob) return "waveform";
    if (state && AVAILABLE_SET.has(state as AudioAvailability)) return "download";
    return "recorder";
};

/**
 * Optional one-line hint rendered alongside the recorder UI when the user's
 * last selection points at an audio file the project no longer has on disk.
 * Returns null when no hint is appropriate.
 */
export const audioRecorderHint = (
    state: AudioAvailability | string | undefined
): string | null => {
    if (state === "missing") return "Selected recording is missing";
    return null;
};

/**
 * Cell-list icon resolution.  Mirrors the previous inline IIFE in
 * `AudioPlayButton` exactly so the refactor is behaviourally identical.
 */
export const getCellListIcon = ({
    state,
    hasAudioUrl,
    isLoading,
    isPlaying,
}: {
    state: AudioAvailability | string | undefined;
    hasAudioUrl: boolean;
    isLoading: boolean;
    isPlaying: boolean;
}): { iconClass: string; color: string; } => {
    if (state === "missing") {
        return {
            iconClass: "codicon-warning",
            color: "var(--vscode-errorForeground)",
        };
    }
    if (state === "available-pointer") {
        return {
            iconClass: isLoading
                ? "codicon-loading codicon-modifier-spin"
                : "codicon-cloud-download",
            color: "var(--vscode-charts-blue)",
        };
    }
    if (hasAudioUrl) {
        return {
            iconClass: isLoading
                ? "codicon-loading codicon-modifier-spin"
                : isPlaying
                    ? "codicon-debug-stop"
                    : "codicon-play",
            color: "var(--vscode-charts-blue)",
        };
    }
    if (
        state === "available-local" ||
        state === "available" ||
        state === "available-cached"
    ) {
        return {
            iconClass: isLoading
                ? "codicon-loading codicon-modifier-spin"
                : isPlaying
                    ? "codicon-debug-stop"
                    : "codicon-play",
            color: "var(--vscode-charts-blue)",
        };
    }
    // No selection (`unselected`, `deletedOnly`, `none`, undefined) → mic.
    // Same icon for every "nothing to play" state so the cell list doesn't
    // distinguish between "has audio history but nothing selected" and "no
    // audio at all" — both invite the user to record.
    return {
        iconClass: "codicon-mic",
        color: "var(--vscode-foreground)",
    };
};

/**
 * History-modal per-row play-button mode.  Pure factor of the inline ladder
 * previously in `AudioHistoryViewer`; behaviour is unchanged.
 *
 * Returns:
 *   - "loading"  → spinner / "Loading..." text
 *   - "error"    → red X-circle, click disabled (file missing / fetch failed)
 *   - "playing"  → currently playing this entry, click stops
 *   - "download" → bytes not yet on disk for this attachment id
 *   - "play"     → ready to play
 */
export type HistoryRowMode = "loading" | "error" | "playing" | "download" | "play";

export const getHistoryRowMode = ({
    entryState,
    hasBlobUrl,
    isPlaying,
    isLoading,
    hasError,
}: {
    entryState: string | undefined;
    hasBlobUrl: boolean;
    isPlaying: boolean;
    isLoading: boolean;
    hasError: boolean;
}): HistoryRowMode => {
    if (isLoading) return "loading";
    if (hasError) return "error";
    if (isPlaying) return "playing";
    const needsDownload =
        !hasBlobUrl &&
        entryState !== "available-local" &&
        entryState !== "available-cached";
    return needsDownload ? "download" : "play";
};
