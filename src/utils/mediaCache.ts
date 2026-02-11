const MAX_CACHE_BYTES = 200 * 1024 * 1024; // 200 MB in-memory cap

type CacheEntry = {
    data: Uint8Array;
    size: number;
};

const lfsCache = new Map<string, CacheEntry>();
let currentBytes = 0;

export function getCachedLfsBytes(oid: string): Uint8Array | undefined {
    const entry = lfsCache.get(oid);
    if (!entry) return undefined;
    // Refresh LRU order
    lfsCache.delete(oid);
    lfsCache.set(oid, entry);
    return entry.data;
}

export function setCachedLfsBytes(oid: string, data: Uint8Array): void {
    if (!oid || !data) return;
    const size = data.byteLength ?? data.length ?? 0;
    if (size <= 0) return;
    if (size > MAX_CACHE_BYTES) {
        return; // Too large to cache
    }

    const existing = lfsCache.get(oid);
    if (existing) {
        currentBytes -= existing.size;
        lfsCache.delete(oid);
    }

    lfsCache.set(oid, { data, size });
    currentBytes += size;

    // Evict oldest entries until under cap
    while (currentBytes > MAX_CACHE_BYTES) {
        const oldestKey = lfsCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        const oldest = lfsCache.get(oldestKey);
        lfsCache.delete(oldestKey);
        if (oldest) currentBytes -= oldest.size;
    }
}

export function clearLfsCache(): void {
    lfsCache.clear();
    currentBytes = 0;
}
