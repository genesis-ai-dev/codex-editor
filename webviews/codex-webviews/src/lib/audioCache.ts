// Simple in-webview cache for audio data URLs keyed by cellId.
// We cache the base64 data URL so components can convert to Blob/URL without
// re-requesting from the extension.

const audioDataUrlCache: Map<string, string> = new Map();

export function getCachedAudioDataUrl(cellId: string): string | undefined {
    return audioDataUrlCache.get(cellId);
}

export function setCachedAudioDataUrl(cellId: string, dataUrl: string): void {
    audioDataUrlCache.set(cellId, dataUrl);
}

export function clearCachedAudio(cellId: string): void {
    audioDataUrlCache.delete(cellId);
}

export function clearAllCachedAudio(): void {
    audioDataUrlCache.clear();
}

export function hasCachedAudio(cellId: string): boolean {
    return audioDataUrlCache.has(cellId);
}


