/**
 * Consolidated ID and UUID utilities
 * Combines: idGenerator, uuidUtils
 */

// ============================================================================
// Cached unique ID generation (timestamp-based)
// ============================================================================

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

// ============================================================================
// UUID generation (hash-based)
// ============================================================================

/**
 * Generates a deterministic UUID from a cell ID using SHA-256 hashing.
 * This ensures the same cell ID always produces the same UUID, preventing merge conflicts.
 *
 * Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *
 * @param originalId The original cell ID (e.g., "GEN 1:1")
 * @returns A UUID-formatted string (e.g., "590e4641-0a20-4655-a7fd-c1eb116e757c")
 */
export async function generateCellIdFromHash(originalId: string): Promise<string> {
    if (!originalId || originalId.trim() === "") {
        throw new Error("Original cell ID cannot be empty");
    }

    let hash: string;

    // Try Web Crypto API first (works in browsers and Node.js 15+)
    const webCrypto = globalThis.crypto || (globalThis as unknown as { crypto: Crypto }).crypto;
    if (webCrypto && webCrypto.subtle) {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(originalId);
            const hashBuffer = await webCrypto.subtle.digest("SHA-256", data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
        } catch (error) {
            console.error("[idUtils] Web Crypto API failed, trying Node.js crypto:", error);
            // Fall through to Node.js crypto
            hash = await useNodeCrypto(originalId);
        }
    } else {
        // Fall back to Node.js crypto (for VS Code extension environment)
        hash = await useNodeCrypto(originalId);
    }

    // Convert hash to UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    // Take first 32 hex characters (128 bits) and format as UUID
    const uuid = [
        hash.substring(0, 8), // 8 hex chars
        hash.substring(8, 12), // 4 hex chars
        hash.substring(12, 16), // 4 hex chars
        hash.substring(16, 20), // 4 hex chars
        hash.substring(20, 32), // 12 hex chars
    ].join("-");

    return uuid;
}

/**
 * Fallback function to use Node.js crypto module when Web Crypto API is not available.
 * This is only used in Node.js environments (VS Code extension).
 */
async function useNodeCrypto(originalId: string): Promise<string> {
    // Dynamic import to avoid bundling Node.js crypto in browser builds
    try {
        const nodeCrypto = await import("crypto");
        const hash = nodeCrypto.createHash("sha256").update(originalId).digest("hex");
        return hash;
    } catch (error) {
        console.error("[idUtils] Failed to use Node.js crypto:", error);
        throw new Error("No crypto implementation available (neither Web Crypto API nor Node.js crypto)");
    }
}

/**
 * Checks if a string is a UUID (in the format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
 * @param id The ID to check
 * @returns True if the ID is a UUID format
 */
export function isUuidFormat(id: string): boolean {
    if (!id) return false;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
}
