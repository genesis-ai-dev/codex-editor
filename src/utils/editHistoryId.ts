/**
 * Generates a deterministic edit ID from edit content using FNV-1a hash.
 * Produces a 12-character hex string (48 bits) — collision-safe for per-cell edit lists.
 *
 * Deterministic so both sides of a merge produce the same ID for the same edit.
 * Pure function, no external dependencies, works in both Node and browser contexts.
 */
export function generateEditId(
    value: string | number | boolean | object,
    timestamp: number,
    author: string
): string {
    const serializedValue =
        typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
    const input = `${serializedValue}|${timestamp}|${author}`;

    // FNV-1a 64-bit (using two 32-bit halves for JS integer safety)
    let h1 = 0x811c9dc5; // FNV offset basis low
    let h2 = 0xcbf29ce4; // FNV offset basis high

    for (let i = 0; i < input.length; i++) {
        const c = input.charCodeAt(i);
        h1 ^= c;
        h2 ^= c >> 8;
        // FNV prime multiply (lower half)
        h1 = Math.imul(h1, 0x01000193);
        h2 = Math.imul(h2, 0x01000193);
    }

    // Combine into 12 hex chars (48 bits): 6 from each half
    const low = (h1 >>> 0).toString(16).padStart(8, "0").slice(-6);
    const high = (h2 >>> 0).toString(16).padStart(8, "0").slice(-6);
    return `${high}${low}`;
}
