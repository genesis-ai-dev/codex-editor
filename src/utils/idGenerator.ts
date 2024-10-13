const idCache: Map<string, string> = new Map();

export function generateUniqueId(baseName: string): string {
    if (idCache.has(baseName)) {
        return idCache.get(baseName)!;
    }
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
    const newId = `${baseName}-${timestamp}`;
    idCache.set(baseName, newId);
    return newId;
}

export function clearIdCache() {
    idCache.clear();
}
