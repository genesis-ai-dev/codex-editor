// In-webview cache for audio data URLs.
// Cell-level keys (cellId) store the currently-selected attachment's data.
// Attachment-level keys (attachment:${attachmentId}) persist across selection
// changes so previously downloaded audio can be restored without re-fetching.

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

export function getCachedAttachmentAudioDataUrl(attachmentId: string): string | undefined {
    return audioDataUrlCache.get(`attachment:${attachmentId}`);
}

export function setCachedAttachmentAudioDataUrl(attachmentId: string, dataUrl: string): void {
    audioDataUrlCache.set(`attachment:${attachmentId}`, dataUrl);
}


