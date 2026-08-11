import { estimateWavBytes, MAX_AUDIO_ATTACHMENT_BYTES, maxWavDurationSec } from "@sharedUtils";
import {
    resolveAudioRenderFormat,
    type AudioEditorClip,
    type AudioRenderFormat,
} from "./audioEditModel";

export interface BrowserAudioRenderResult {
    bytes: Uint8Array;
    durationSec: number;
    sampleRate: number;
    channels: number;
    bitrateKbps: number;
}

/** Writes an ASCII chunk identifier into a WAV DataView. */
function writeAscii(view: DataView, offset: number, value: string): void {
    for (let index = 0; index < value.length; index++) {
        view.setUint8(offset + index, value.charCodeAt(index));
    }
}

/** Writes the standard 44-byte PCM WAV header used by the saved attachment. */
function writeWavHeader(
    view: DataView,
    frameCount: number,
    sampleRate: number,
    channels: number
): void {
    const blockAlign = channels * 2;
    const dataSize = frameCount * blockAlign;
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);
}

/** Encodes per-channel floating-point samples as interleaved PCM16 WAV. */
export function encodePcmWav(channelData: Float32Array[], sampleRate: number): Uint8Array {
    const channels = Math.max(1, channelData.length);
    const frameCount = channelData[0]?.length ?? 0;
    const output = new ArrayBuffer(44 + frameCount * channels * 2);
    const view = new DataView(output);
    writeWavHeader(view, frameCount, sampleRate, channels);
    let offset = 44;
    for (let frame = 0; frame < frameCount; frame++) {
        for (let channel = 0; channel < channels; channel++) {
            const raw = channelData[channel]?.[frame] ?? 0;
            const sample = Math.max(-1, Math.min(1, raw));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }
    return new Uint8Array(output);
}

function getAudioContextClass(): typeof AudioContext | undefined {
    return (
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    );
}

function getOfflineAudioContextClass(): typeof OfflineAudioContext | undefined {
    return (
        window.OfflineAudioContext ||
        (window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext })
            .webkitOfflineAudioContext
    );
}

/** Error message for edits whose WAV output would exceed the attachment cap. */
export function audioTooLongMessage(format: AudioRenderFormat): string {
    const limitSec = maxWavDurationSec(format.sampleRate, format.channels);
    const minutes = Math.floor(limitSec / 60);
    return `The edited audio would be larger than the 50 MB attachment limit (about ${minutes} minutes at this quality). Please edit it in shorter sections.`;
}

/**
 * Decodes each unique source Blob once, renders the non-destructive clip list
 * in timeline order with an OfflineAudioContext (off the main thread, with
 * the browser's resampler), and returns a WAV attachment. The output keeps
 * the primary source's sample rate and the widest source channel count.
 */
export async function renderAudioClipsInBrowser(
    clips: AudioEditorClip[]
): Promise<BrowserAudioRenderResult> {
    if (clips.length === 0) throw new Error("There is no audio to save.");
    const durationSec = clips.reduce(
        (total, clip) => total + Math.max(0, clip.endSec - clip.startSec),
        0
    );
    if (durationSec <= 0) throw new Error("There is no audio to save.");

    const AudioContextClass = getAudioContextClass();
    const OfflineAudioContextClass = getOfflineAudioContextClass();
    if (!AudioContextClass || !OfflineAudioContextClass) {
        throw new Error("This VS Code environment does not support built-in audio processing.");
    }

    // Decode each source once even when delete/insert operations split it into many clips.
    const context = new AudioContextClass();
    const decoded = new Map<string, AudioBuffer>();
    try {
        const inputs = new Map<string, Blob>();
        clips.forEach((clip) => inputs.set(clip.inputId, clip.audioBlob));
        await Promise.all([...inputs.entries()].map(async ([inputId, blob]) => {
            const bytes = await blob.arrayBuffer();
            decoded.set(inputId, await context.decodeAudioData(bytes.slice(0)));
        }));
    } catch {
        throw new Error("Could not decode this audio format. Try a WAV, MP3, M4A, OGG, or WebM file.");
    } finally {
        await context.close().catch(() => undefined);
    }

    const format = resolveAudioRenderFormat(
        clips.map((clip) => {
            const buffer = decoded.get(clip.inputId);
            return {
                sampleRate: buffer?.sampleRate,
                channels: buffer?.numberOfChannels,
                isPrimary: clip.isPrimary,
            };
        })
    );
    if (estimateWavBytes(durationSec, format.sampleRate, format.channels) > MAX_AUDIO_ATTACHMENT_BYTES) {
        throw new Error(audioTooLongMessage(format));
    }

    const frameCount = Math.ceil(durationSec * format.sampleRate);
    const offline = new OfflineAudioContextClass(format.channels, frameCount, format.sampleRate);
    let timelineOffsetSec = 0;
    for (const clip of clips) {
        const input = decoded.get(clip.inputId);
        if (!input) throw new Error(`Could not read the inserted audio: ${clip.label}`);
        const clipDurationSec = Math.max(0, clip.endSec - clip.startSec);
        if (clipDurationSec <= 0) continue;
        const source = offline.createBufferSource();
        source.buffer = input;
        source.connect(offline.destination);
        source.start(timelineOffsetSec, clip.startSec, clipDurationSec);
        timelineOffsetSec += clipDurationSec;
    }

    const rendered = await offline.startRendering();
    const channelData = Array.from(
        { length: rendered.numberOfChannels },
        (_, channel) => rendered.getChannelData(channel)
    );
    return {
        bytes: encodePcmWav(channelData, format.sampleRate),
        durationSec,
        sampleRate: format.sampleRate,
        channels: format.channels,
        bitrateKbps: Math.round((format.sampleRate * 16 * format.channels) / 1000),
    };
}
