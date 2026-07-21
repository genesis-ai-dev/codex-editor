import type { AudioTrimRange } from "./audioTrimMath";

/** Minimum duration enforced by Keep mode and near-edge insertion handling. */
export const MIN_AUDIO_CLIP_DURATION_SEC = 0.1;
/** Stable input ID used for the attachment that was already present in the cell. */
export const PRIMARY_AUDIO_INPUT_ID = "primary";

/** A non-destructive slice of an underlying audio Blob on the edited timeline. */
export interface AudioEditorClip {
    id: string;
    inputId: string;
    label: string;
    audioBlob: Blob;
    audioUrl: string;
    fileExtension: string;
    sourceDurationSec: number;
    startSec: number;
    endSec: number;
    isPrimary: boolean;
}

/** Complete non-destructive state stored by the editor's undo history. */
export interface AudioEditorDraft {
    clips: AudioEditorClip[];
}

const createClipId = (prefix: string): string =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Creates a full-length timeline clip for an original or inserted audio input. */
export function createAudioEditorClip(options: {
    inputId: string;
    label: string;
    audioBlob: Blob;
    audioUrl: string;
    fileExtension: string;
    durationSec: number;
    isPrimary?: boolean;
}): AudioEditorClip {
    return {
        id: createClipId("clip"),
        inputId: options.inputId,
        label: options.label,
        audioBlob: options.audioBlob,
        audioUrl: options.audioUrl,
        fileExtension: options.fileExtension,
        sourceDurationSec: options.durationSec,
        startSec: 0,
        endSec: options.durationSec,
        isPrimary: options.isPrimary ?? false,
    };
}

/** Narrows a clip to the source-time interval covered by a selection. */
export function trimAudioEditorClip(
    clip: AudioEditorClip,
    selection: AudioTrimRange
): AudioEditorClip {
    const startSec = Math.max(clip.startSec, selection.startSec);
    const endSec = Math.min(clip.endSec, selection.endSec);
    if (endSec - startSec < MIN_AUDIO_CLIP_DURATION_SEC) return clip;
    return { ...clip, startSec, endSec };
}

/**
 * Removes a source-time interval from one clip and returns the remaining left
 * and right pieces. Both pieces continue to reference the same source Blob.
 */
export function splitClipRemovingSelection(
    clip: AudioEditorClip,
    selection: AudioTrimRange
): AudioEditorClip[] {
    const removeStart = Math.max(clip.startSec, selection.startSec);
    const removeEnd = Math.min(clip.endSec, selection.endSec);
    // Delete accepts every positive-width selection, including ranges below 0.10 seconds.
    if (removeEnd <= removeStart) return [clip];

    const result: AudioEditorClip[] = [];
    if (removeStart > clip.startSec) {
        result.push({
            ...clip,
            id: createClipId("clip-left"),
            label: `${clip.label} · left`,
            endSec: removeStart,
        });
    }
    if (clip.endSec > removeEnd) {
        result.push({
            ...clip,
            id: createClipId("clip-right"),
            label: `${clip.label} · right`,
            startSec: removeEnd,
        });
    }
    return result;
}

/** Returns the sum of every visible clip duration on the edited timeline. */
export const getAudioEditorDuration = (clips: AudioEditorClip[]): number =>
    clips.reduce((total, clip) => total + Math.max(0, clip.endSec - clip.startSec), 0);

export interface AudioTimelinePosition {
    clipIndex: number;
    globalClipStartSec: number;
    sourceTimeSec: number;
}

/** Maps a global timeline time to a clip and its source-audio time. */
export function locateAudioTimelinePosition(
    clips: AudioEditorClip[],
    timelineTimeSec: number
): AudioTimelinePosition | null {
    if (clips.length === 0) return null;
    const totalDuration = getAudioEditorDuration(clips);
    const target = Math.min(totalDuration, Math.max(0, timelineTimeSec));
    let globalClipStartSec = 0;

    for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
        const clip = clips[clipIndex];
        const clipDuration = Math.max(0, clip.endSec - clip.startSec);
        const isLast = clipIndex === clips.length - 1;
        if (target < globalClipStartSec + clipDuration || isLast) {
            const offset = Math.min(clipDuration, Math.max(0, target - globalClipStartSec));
            return {
                clipIndex,
                globalClipStartSec,
                sourceTimeSec: clip.startSec + offset,
            };
        }
        globalClipStartSec += clipDuration;
    }
    return null;
}

/** Returns the global timeline time at which a clip begins. */
export function getAudioClipGlobalStart(
    clips: AudioEditorClip[],
    clipIndex: number
): number {
    return clips
        .slice(0, Math.max(0, clipIndex))
        .reduce((total, clip) => total + Math.max(0, clip.endSec - clip.startSec), 0);
}

/**
 * Inserts clips at a global timeline position. When the position is inside an
 * existing clip, that clip is split non-destructively around the insertion.
 */
export function insertAudioClipsAtTimelinePosition(
    clips: AudioEditorClip[],
    additions: AudioEditorClip[],
    timelineTimeSec: number
): AudioEditorClip[] {
    if (clips.length === 0) return [...additions];
    const located = locateAudioTimelinePosition(clips, timelineTimeSec);
    if (!located) return [...clips, ...additions];
    const clip = clips[located.clipIndex];
    const offset = located.sourceTimeSec - clip.startSec;
    const clipDuration = clip.endSec - clip.startSec;

    if (offset < MIN_AUDIO_CLIP_DURATION_SEC) {
        return [
            ...clips.slice(0, located.clipIndex),
            ...additions,
            ...clips.slice(located.clipIndex),
        ];
    }
    if (clipDuration - offset < MIN_AUDIO_CLIP_DURATION_SEC) {
        return [
            ...clips.slice(0, located.clipIndex + 1),
            ...additions,
            ...clips.slice(located.clipIndex + 1),
        ];
    }

    const left: AudioEditorClip = {
        ...clip,
        id: createClipId("clip-left"),
        label: `${clip.label} · left`,
        endSec: located.sourceTimeSec,
    };
    const right: AudioEditorClip = {
        ...clip,
        id: createClipId("clip-right"),
        label: `${clip.label} · right`,
        startSec: located.sourceTimeSec,
    };
    return [
        ...clips.slice(0, located.clipIndex),
        left,
        ...additions,
        right,
        ...clips.slice(located.clipIndex + 1),
    ];
}

/** Removes one global range, including ranges that cross clip boundaries. */
export function deleteAudioTimelineRange(
    clips: AudioEditorClip[],
    selection: AudioTrimRange
): AudioEditorClip[] {
    const startSec = Math.min(selection.startSec, selection.endSec);
    const endSec = Math.max(selection.startSec, selection.endSec);
    if (endSec <= startSec) return clips;

    const result: AudioEditorClip[] = [];
    let globalClipStart = 0;
    for (const clip of clips) {
        const clipDuration = Math.max(0, clip.endSec - clip.startSec);
        const globalClipEnd = globalClipStart + clipDuration;
        const overlapStart = Math.max(startSec, globalClipStart);
        const overlapEnd = Math.min(endSec, globalClipEnd);
        if (overlapEnd <= overlapStart) {
            result.push(clip);
        } else {
            result.push(
                ...splitClipRemovingSelection(clip, {
                    startSec: clip.startSec + overlapStart - globalClipStart,
                    endSec: clip.startSec + overlapEnd - globalClipStart,
                })
            );
        }
        globalClipStart = globalClipEnd;
    }
    return result;
}

/** Keeps only one global range, including portions from multiple clips. */
export function keepAudioTimelineRange(
    clips: AudioEditorClip[],
    selection: AudioTrimRange
): AudioEditorClip[] {
    const startSec = Math.min(selection.startSec, selection.endSec);
    const endSec = Math.max(selection.startSec, selection.endSec);
    if (endSec - startSec < MIN_AUDIO_CLIP_DURATION_SEC) return clips;

    const result: AudioEditorClip[] = [];
    let globalClipStart = 0;
    for (const clip of clips) {
        const clipDuration = Math.max(0, clip.endSec - clip.startSec);
        const globalClipEnd = globalClipStart + clipDuration;
        const overlapStart = Math.max(startSec, globalClipStart);
        const overlapEnd = Math.min(endSec, globalClipEnd);
        if (overlapEnd - overlapStart >= MIN_AUDIO_CLIP_DURATION_SEC) {
            result.push(
                trimAudioEditorClip(clip, {
                    startSec: clip.startSec + overlapStart - globalClipStart,
                    endSec: clip.startSec + overlapEnd - globalClipStart,
                })
            );
        }
        globalClipStart = globalClipEnd;
    }
    return result;
}
