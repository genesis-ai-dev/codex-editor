/**
 * Web Audio API-based audio processing utilities.
 * Fallback for when FFmpeg is unavailable — leverages Chromium's built-in audio decoders.
 */

export interface AudioSegment {
    startSec: number;
    endSec: number;
}

export interface ProcessedAudioResult {
    durationSec: number;
    peaks: number[];
    segments: AudioSegment[];
}

let sharedAudioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext => {
    if (!sharedAudioContext || sharedAudioContext.state === "closed") {
        sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return sharedAudioContext;
};

/**
 * Decode an audio ArrayBuffer into an AudioBuffer using the Web Audio API.
 * Supports all formats Chromium can decode: MP3, WAV, FLAC, OGG, AAC/M4A, WebM.
 */
export const decodeAudio = async (arrayBuffer: ArrayBuffer): Promise<AudioBuffer> => {
    const ctx = getAudioContext();
    return ctx.decodeAudioData(arrayBuffer);
};

/**
 * Generate waveform peak amplitudes for visualization.
 * Downsamples decoded audio to `targetPoints` buckets and keeps the max absolute
 * amplitude per bucket (same algorithm as the FFmpeg-based peak generator).
 */
export const generatePeaks = (audioBuffer: AudioBuffer, targetPoints: number = 2000): number[] => {
    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;
    const numBuckets = Math.max(1, targetPoints);
    const samplesPerBucket = Math.max(1, Math.ceil(totalSamples / numBuckets));
    const peaks = new Array<number>(numBuckets).fill(0);

    for (let i = 0; i < totalSamples; i++) {
        const bucket = Math.min(numBuckets - 1, Math.floor(i / samplesPerBucket));
        const abs = Math.abs(channelData[i]);
        if (abs > peaks[bucket]) {
            peaks[bucket] = abs;
        }
    }

    return peaks;
};

/**
 * Detect silence regions by scanning decoded PCM samples.
 *
 * Converts `thresholdDb` (e.g. -40) to a linear amplitude and scans the mono
 * channel for consecutive runs that stay below the threshold. Runs shorter than
 * `minDuration` seconds are ignored. Returns non-silent audio segments (the
 * same structure as the FFmpeg silencedetect-based implementation).
 */
export const detectSilenceFromBuffer = (
    audioBuffer: AudioBuffer,
    thresholdDb: number = -40,
    minDuration: number = 0.5,
): AudioSegment[] => {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const totalSamples = channelData.length;
    const duration = audioBuffer.duration;

    const thresholdLinear = Math.pow(10, thresholdDb / 20);
    const minSamples = Math.floor(minDuration * sampleRate);

    const silenceRegions: Array<{ start: number; end: number }> = [];
    let silenceStart: number | null = null;

    for (let i = 0; i < totalSamples; i++) {
        const isSilent = Math.abs(channelData[i]) < thresholdLinear;

        if (isSilent && silenceStart === null) {
            silenceStart = i;
        } else if (!isSilent && silenceStart !== null) {
            const silenceLength = i - silenceStart;
            if (silenceLength >= minSamples) {
                silenceRegions.push({
                    start: silenceStart / sampleRate,
                    end: i / sampleRate,
                });
            }
            silenceStart = null;
        }
    }
    if (silenceStart !== null) {
        const silenceLength = totalSamples - silenceStart;
        if (silenceLength >= minSamples) {
            silenceRegions.push({
                start: silenceStart / sampleRate,
                end: duration,
            });
        }
    }

    const breakpoints: number[] = [0];
    for (const region of silenceRegions) {
        breakpoints.push((region.start + region.end) / 2);
    }
    breakpoints.push(duration);

    breakpoints.sort((a, b) => a - b);
    const uniqueBreakpoints = breakpoints.filter(
        (bp, i) => i === 0 || bp - breakpoints[i - 1] >= 0.01,
    );

    let segments: AudioSegment[] = [];
    for (let i = 0; i < uniqueBreakpoints.length - 1; i++) {
        segments.push({
            startSec: uniqueBreakpoints[i],
            endSec: uniqueBreakpoints[i + 1],
        });
    }

    if (segments.length === 0) {
        segments.push({ startSec: 0, endSec: duration });
    }

    const MAX_SEGMENT_LENGTH = 30;
    const finalSegments: AudioSegment[] = [];
    for (const seg of segments) {
        const segDuration = seg.endSec - seg.startSec;
        if (segDuration <= MAX_SEGMENT_LENGTH) {
            finalSegments.push(seg);
        } else {
            let currentStart = seg.startSec;
            while (currentStart < seg.endSec) {
                const currentEnd = Math.min(currentStart + MAX_SEGMENT_LENGTH, seg.endSec);
                finalSegments.push({ startSec: currentStart, endSec: currentEnd });
                currentStart = currentEnd;
            }
        }
    }

    return finalSegments;
};

/**
 * Encode a slice of an AudioBuffer as a WAV file (PCM s16le, mono, 44100 Hz).
 * Returns the WAV bytes as a Uint8Array.
 *
 * Matches the output format of the FFmpeg `extractSegment`:
 *   -acodec pcm_s16le -ar 44100 -ac 1
 */
export const encodeWavSegment = (
    audioBuffer: AudioBuffer,
    startSec: number,
    endSec: number,
): Uint8Array => {
    const sampleRate = 44100;
    const numChannels = 1;
    const bitsPerSample = 16;

    const srcRate = audioBuffer.sampleRate;
    const srcData = audioBuffer.getChannelData(0);

    const startSample = Math.max(0, Math.floor(startSec * srcRate));
    const endSample = Math.min(srcData.length, Math.ceil(endSec * srcRate));

    const ratio = sampleRate / srcRate;
    const outLength = Math.floor((endSample - startSample) * ratio);
    const pcmData = new Int16Array(outLength);

    for (let i = 0; i < outLength; i++) {
        const srcIndex = startSample + i / ratio;
        const lo = Math.floor(srcIndex);
        const hi = Math.min(lo + 1, srcData.length - 1);
        const frac = srcIndex - lo;
        const sample = srcData[lo] * (1 - frac) + srcData[hi] * frac;
        pcmData[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    }

    const dataSize = pcmData.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, "WAVE");

    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);

    writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    const output = new Uint8Array(buffer);
    output.set(new Uint8Array(pcmData.buffer), 44);

    return output;
};

const writeString = (view: DataView, offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
};

/**
 * Full processing pipeline: decode -> peaks + silence -> segments.
 * Convenience wrapper used by the AudioImporter webview.
 */
export const processAudioBuffer = (
    audioBuffer: AudioBuffer,
    thresholdDb: number = -40,
    minDuration: number = 0.5,
): ProcessedAudioResult => {
    const durationSec = audioBuffer.duration;
    const targetPoints = Math.max(1000, Math.min(8000, Math.floor(durationSec * 50)));
    const peaks = generatePeaks(audioBuffer, targetPoints);
    const segments = detectSilenceFromBuffer(audioBuffer, thresholdDb, minDuration);

    return { durationSec, peaks, segments };
};

/**
 * Convert a Uint8Array to a base64 string (works in webview context).
 */
export const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

/**
 * Decode a base64 data-URL (e.g. `data:audio/mpeg;base64,...`) into an ArrayBuffer
 * without using `fetch()`, which is blocked by the webview CSP for data: URIs.
 */
export const base64DataUrlToArrayBuffer = (dataUrl: string): ArrayBuffer => {
    const base64 = dataUrl.split(",")[1];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};
