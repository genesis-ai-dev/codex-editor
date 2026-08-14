import { useCallback, useEffect, useRef, useState } from "react";
import { getAudioEditorDuration, type AudioEditorClip } from "./audioEditModel";
import { getAudioContextClass } from "./audioFileUtils";

export interface PlaybackScheduleEntry {
    inputId: string;
    label: string;
    /** Seconds after playback start when this clip begins sounding. */
    startAtSec: number;
    /** Offset into the source buffer, in source seconds. */
    sourceOffsetSec: number;
    durationSec: number;
}

/**
 * Maps the non-destructive clip list to buffer-source start times, mirroring
 * the timeline order the offline render uses. Clips entirely before
 * `fromSec` are skipped; a clip containing it starts partway through.
 */
export function computePlaybackSchedule(
    clips: AudioEditorClip[],
    fromSec = 0
): PlaybackScheduleEntry[] {
    const entries: PlaybackScheduleEntry[] = [];
    let timelineStartSec = 0;
    for (const clip of clips) {
        const clipDurationSec = Math.max(0, clip.endSec - clip.startSec);
        const timelineEndSec = timelineStartSec + clipDurationSec;
        if (clipDurationSec > 0 && timelineEndSec > fromSec) {
            const skipSec = Math.max(0, fromSec - timelineStartSec);
            entries.push({
                inputId: clip.inputId,
                label: clip.label,
                startAtSec: Math.max(0, timelineStartSec - fromSec),
                sourceOffsetSec: clip.startSec + skipSec,
                durationSec: clipDurationSec - skipSec,
            });
        }
        timelineStartSec = timelineEndSec;
    }
    return entries;
}

/**
 * Live preview of the edited timeline through Web Audio. Sources are decoded
 * once and cached until an underlying input changes; playback stops
 * automatically at the end, on any edit, and on unmount.
 */
export function useAudioTimelinePlayback(clips: AudioEditorClip[]) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [playheadSec, setPlayheadSec] = useState<number | null>(null);
    const clipsRef = useRef(clips);
    clipsRef.current = clips;
    const contextRef = useRef<AudioContext | null>(null);
    const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
    const decodedRef = useRef<{ signature: string; buffers: Map<string, AudioBuffer> }>({
        signature: "",
        buffers: new Map(),
    });
    const rafRef = useRef(0);
    const playTokenRef = useRef(0);

    const stop = useCallback(() => {
        playTokenRef.current += 1;
        cancelAnimationFrame(rafRef.current);
        sourcesRef.current.forEach((source) => {
            try {
                source.stop();
            } catch {
                // source may not have started yet
            }
        });
        sourcesRef.current = [];
        setIsPlaying(false);
        setPlayheadSec(null);
    }, []);

    // Any timeline change invalidates what is currently audible.
    useEffect(() => stop, [clips, stop]);

    useEffect(() => () => {
        stop();
        contextRef.current?.close().catch(() => undefined);
        contextRef.current = null;
    }, [stop]);

    const play = useCallback(async (fromSec = 0) => {
        stop();
        const token = playTokenRef.current;
        const currentClips = clipsRef.current;
        const totalDurationSec = getAudioEditorDuration(currentClips);
        if (totalDurationSec <= 0 || fromSec >= totalDurationSec) return;

        const AudioContextClass = getAudioContextClass();
        if (!AudioContextClass) {
            throw new Error("This VS Code environment does not support audio playback.");
        }
        if (!contextRef.current) contextRef.current = new AudioContextClass();
        const context = contextRef.current;
        if (context.state === "suspended") await context.resume().catch(() => undefined);

        // Decode each unique input once; split clips share their source buffer.
        const inputs = new Map<string, Blob>();
        currentClips.forEach((clip) => inputs.set(clip.inputId, clip.audioBlob));
        const signature = [...inputs.entries()]
            .map(([inputId, blob]) => `${inputId}:${blob.size}:${blob.type}`)
            .join("|");
        if (decodedRef.current.signature !== signature) {
            const buffers = new Map<string, AudioBuffer>();
            try {
                await Promise.all([...inputs.entries()].map(async ([inputId, blob]) => {
                    const bytes = await blob.arrayBuffer();
                    buffers.set(inputId, await context.decodeAudioData(bytes.slice(0)));
                }));
            } catch {
                throw new Error("Could not decode this audio for playback.");
            }
            decodedRef.current = { signature, buffers };
        }
        if (playTokenRef.current !== token) return; // stopped while decoding

        // Slight lead time so every source starts on schedule, not in the past.
        const baseTime = context.currentTime + 0.05;
        const sources: AudioBufferSourceNode[] = [];
        for (const entry of computePlaybackSchedule(currentClips, fromSec)) {
            const buffer = decodedRef.current.buffers.get(entry.inputId);
            if (!buffer) throw new Error(`Could not read the audio for: ${entry.label}`);
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            source.start(baseTime + entry.startAtSec, entry.sourceOffsetSec, entry.durationSec);
            sources.push(source);
        }
        sourcesRef.current = sources;
        setIsPlaying(true);
        setPlayheadSec(fromSec);

        const tick = () => {
            if (playTokenRef.current !== token) return;
            const positionSec = fromSec + (context.currentTime - baseTime);
            if (positionSec >= totalDurationSec) {
                stop();
                return;
            }
            setPlayheadSec(Math.max(fromSec, positionSec));
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
    }, [stop]);

    return { isPlaying, playheadSec, play, stop };
}
