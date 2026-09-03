/** Pure LFS pointer parsing shared by project storage and export. */
export interface LFSPointer {
    oid: string;
    size: number;
    version: string;
}

export function parsePointerContent(content: string): LFSPointer | null {
    try {
        // Check for version
        const versionMatch = content.match(/version (https:\/\/git-lfs\.github\.com\/spec\/v\d+)/);
        if (!versionMatch) {
            return null;
        }

        // Extract OID
        const oidMatch = content.match(/oid sha256:([a-f0-9]{64})/i);
        if (!oidMatch) {
            return null;
        }

        // Extract size
        const sizeMatch = content.match(/size (\d+)/);
        if (!sizeMatch) {
            return null;
        }

        return {
            version: versionMatch[1],
            oid: oidMatch[1],
            size: parseInt(sizeMatch[1], 10),
        };
    } catch {
        return null;
    }
}

export function isLfsPointerContent(data: Uint8Array): boolean {
    if (data.length > 400) {
        return false;
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
    return text.includes('version https://git-lfs.github.com/spec/v1');
}
