const ALLOWED_AUDIO_EXTENSIONS = new Set(["webm", "wav", "mp3", "m4a", "ogg", "aac", "flac"]);

/** Resolves a safe extension from the file name, then falls back to its MIME type. */
export function audioFileExtension(fileName: string, mimeType: string): string {
    const named = fileName.split(".").pop()?.toLowerCase();
    if (named && ALLOWED_AUDIO_EXTENSIONS.has(named)) return named;
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
    if (mimeType.includes("ogg")) return "ogg";
    return "webm";
}

/** AudioContext constructor for this webview, if the runtime provides one. */
export function getAudioContextClass(): typeof AudioContext | undefined {
    return (
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    );
}

export interface DecodedAudioInfo {
    durationSec: number;
    sampleRate: number;
    channels: number;
}

/** Decodes an inserted file to obtain its playable duration and format. */
export async function decodeAudioInfo(audioBlob: Blob): Promise<DecodedAudioInfo> {
    const AudioContextClass = getAudioContextClass();
    if (!AudioContextClass) throw new Error("Audio decoding is not available.");
    const context = new AudioContextClass();
    try {
        const bytes = await audioBlob.arrayBuffer();
        const decoded = await context.decodeAudioData(bytes.slice(0));
        if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) {
            throw new Error("The audio file has no playable duration.");
        }
        return {
            durationSec: decoded.duration,
            sampleRate: decoded.sampleRate,
            channels: decoded.numberOfChannels,
        };
    } finally {
        await context.close().catch(() => undefined);
    }
}

/** Converts a Blob to a data URL for transport through the existing webview protocol. */
export function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read the added audio file."));
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.readAsDataURL(blob);
    });
}
