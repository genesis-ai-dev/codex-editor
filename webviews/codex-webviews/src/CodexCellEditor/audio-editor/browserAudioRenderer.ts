import type { AudioEditorClip } from "./audioEditModel";

export const BROWSER_AUDIO_SAMPLE_RATE = 44100;
export const BROWSER_AUDIO_CHANNELS = 1;
const MAX_WAV_BYTES = 200 * 1024 * 1024;

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
function writeWavHeader(view: DataView, sampleCount: number, sampleRate: number): void {
    const dataSize = sampleCount * 2;
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, BROWSER_AUDIO_CHANNELS, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataSize, true);
}

/** Encodes normalized mono floating-point samples as little-endian PCM16 WAV. */
export function encodeMonoPcmWav(samples: Float32Array, sampleRate: number): Uint8Array {
    const output = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(output);
    writeWavHeader(view, samples.length, sampleRate);
    for (let index = 0; index < samples.length; index++) {
        const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
        view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Uint8Array(output);
}

/**
 * Reads one mono sample at an arbitrary source time. Linear interpolation
 * handles source files whose sample rate differs from the output sample rate.
 */
function readInterpolatedMonoSample(buffer: AudioBuffer, timeSec: number): number {
    const sourceIndex = Math.max(0, timeSec * buffer.sampleRate);
    const lower = Math.min(buffer.length - 1, Math.floor(sourceIndex));
    const upper = Math.min(buffer.length - 1, lower + 1);
    const fraction = sourceIndex - lower;
    let mixed = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        mixed += (samples[lower] ?? 0) * (1 - fraction) + (samples[upper] ?? 0) * fraction;
    }
    return mixed / Math.max(1, buffer.numberOfChannels);
}

/**
 * Decodes each unique source Blob with Web Audio, renders the non-destructive
 * clip list in timeline order, and returns a WAV attachment without FFmpeg.
 */
export async function renderAudioClipsInBrowser(
    clips: AudioEditorClip[]
): Promise<BrowserAudioRenderResult> {
    if (clips.length === 0) throw new Error("There is no audio to save.");
    const durationSec = clips.reduce(
        (total, clip) => total + Math.max(0, clip.endSec - clip.startSec),
        0
    );
    const sampleCount = Math.ceil(durationSec * BROWSER_AUDIO_SAMPLE_RATE);
    if (44 + sampleCount * 2 > MAX_WAV_BYTES) {
        throw new Error("The edited audio is too long to export safely. Please edit it in shorter sections.");
    }

    const AudioContextClass = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error("This VS Code environment does not support built-in audio processing.");
    const context = new AudioContextClass();
    try {
        // Decode each source once even when delete/insert operations split it into many clips.
        const inputs = new Map<string, Blob>();
        clips.forEach((clip) => inputs.set(clip.inputId, clip.audioBlob));
        const decoded = new Map<string, AudioBuffer>();
        await Promise.all([...inputs.entries()].map(async ([inputId, blob]) => {
            const bytes = await blob.arrayBuffer();
            decoded.set(inputId, await context.decodeAudioData(bytes.slice(0)));
        }));

        // Copy every source-time clip into one continuous output buffer.
        const samples = new Float32Array(sampleCount);
        let outputOffset = 0;
        for (const clip of clips) {
            const input = decoded.get(clip.inputId);
            if (!input) throw new Error(`Could not read the inserted audio: ${clip.label}`);
            const clipSamples = Math.max(
                0,
                Math.round((clip.endSec - clip.startSec) * BROWSER_AUDIO_SAMPLE_RATE)
            );
            for (let index = 0; index < clipSamples && outputOffset + index < samples.length; index++) {
                const sourceTime = clip.startSec + index / BROWSER_AUDIO_SAMPLE_RATE;
                samples[outputOffset + index] = readInterpolatedMonoSample(input, sourceTime);
            }
            outputOffset += clipSamples;
        }

        return {
            bytes: encodeMonoPcmWav(samples, BROWSER_AUDIO_SAMPLE_RATE),
            durationSec,
            sampleRate: BROWSER_AUDIO_SAMPLE_RATE,
            channels: BROWSER_AUDIO_CHANNELS,
            bitrateKbps: Math.round(BROWSER_AUDIO_SAMPLE_RATE * 16 / 1000),
        };
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("Could not")) throw error;
        throw new Error("Could not decode this audio format. Try a WAV, MP3, M4A, OGG, or WebM file.");
    } finally {
        await context.close().catch(() => undefined);
    }
}
