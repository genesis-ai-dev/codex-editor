/** Default minimum range used when an operation must produce playable audio. */
export const MIN_AUDIO_TRIM_DURATION_SEC = 0.1;

export interface AudioTrimRange {
    startSec: number;
    endSec: number;
}

const finiteOr = (value: number, fallback: number): number =>
    Number.isFinite(value) ? value : fallback;

/** Clamps an arbitrary time value to the inclusive audio duration. */
export const clampAudioTime = (value: number, durationSec: number): number => {
    const duration = Math.max(0, finiteOr(durationSec, 0));
    return Math.min(duration, Math.max(0, finiteOr(value, 0)));
};

/**
 * Orders and clamps two pointer values. Callers may pass a zero minimum to
 * allow Start and End to overlap in Delete mode.
 */
export const normalizeAudioTrimRange = (
    values: readonly number[],
    durationSec: number,
    minimumDurationSec = MIN_AUDIO_TRIM_DURATION_SEC
): AudioTrimRange => {
    const duration = Math.max(0, finiteOr(durationSec, 0));
    if (duration === 0) return { startSec: 0, endSec: 0 };

    const first = clampAudioTime(values[0] ?? 0, duration);
    const second = clampAudioTime(values[1] ?? duration, duration);
    let startSec = Math.min(first, second);
    let endSec = Math.max(first, second);
    const minimum = Math.min(Math.max(0, finiteOr(minimumDurationSec, 0)), duration);

    if (endSec - startSec < minimum) {
        if (startSec + minimum <= duration) {
            endSec = startSec + minimum;
        } else {
            startSec = Math.max(0, endSec - minimum);
        }
    }

    return { startSec, endSec };
};

/** Moves the Start pointer without allowing it to cross the End pointer. */
export const updateAudioTrimStart = (
    value: number,
    currentEndSec: number,
    durationSec: number,
    minimumDurationSec = MIN_AUDIO_TRIM_DURATION_SEC
): AudioTrimRange => {
    const duration = Math.max(0, finiteOr(durationSec, 0));
    const endSec = clampAudioTime(currentEndSec, duration);
    const minimum = Math.min(Math.max(0, finiteOr(minimumDurationSec, 0)), duration);
    const maximumStart = Math.max(0, endSec - minimum);
    return {
        startSec: Math.min(clampAudioTime(value, duration), maximumStart),
        endSec,
    };
};

/** Moves the End pointer without allowing it to cross the Start pointer. */
export const updateAudioTrimEnd = (
    value: number,
    currentStartSec: number,
    durationSec: number,
    minimumDurationSec = MIN_AUDIO_TRIM_DURATION_SEC
): AudioTrimRange => {
    const duration = Math.max(0, finiteOr(durationSec, 0));
    const startSec = clampAudioTime(currentStartSec, duration);
    const minimum = Math.min(Math.max(0, finiteOr(minimumDurationSec, 0)), duration);
    const minimumEnd = Math.min(duration, startSec + minimum);
    return {
        startSec,
        endSec: Math.max(clampAudioTime(value, duration), minimumEnd),
    };
};

/** Reports whether the pointers still cover the complete source duration. */
export const isWholeAudioSelected = (
    range: AudioTrimRange,
    durationSec: number,
    toleranceSec = 0.01
): boolean =>
    range.startSec <= toleranceSec &&
    Math.abs(range.endSec - durationSec) <= toleranceSec;

/** Formats seconds as M:SS.hh for pointer labels and precise controls. */
export const formatAudioEditTime = (seconds: number): string => {
    const safeSeconds = Math.max(0, finiteOr(seconds, 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds - minutes * 60;
    return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
};
