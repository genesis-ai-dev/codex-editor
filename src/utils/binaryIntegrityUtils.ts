/**
 * Shared utilities for binary integrity verification across all external
 * tool managers (FFmpeg, Native SQLite, Git/dugite).
 *
 * Provides:
 *  - SHA-256 file hashing
 *  - Marker file read/write for storing known-good hashes
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const HASH_MARKER_FILENAME = "sha256.txt";

// ---------------------------------------------------------------------------
// SHA-256 hashing
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a file using streaming reads
 * to avoid loading multi-MB binaries entirely into memory.
 */
export const computeFileHash = (filePath: string): Promise<string> =>
    new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });

/**
 * Compute SHA-256 from an in-memory Buffer (useful when the bytes
 * are already loaded, e.g. after downloading a tarball).
 */
export const computeBufferHash = (data: Buffer): string =>
    crypto.createHash("sha256").update(data).digest("hex");

// ---------------------------------------------------------------------------
// Hash marker file helpers
// ---------------------------------------------------------------------------

/**
 * Write a `sha256.txt` marker file into `dir` containing the given hex hash.
 * Creates the directory if it doesn't exist.
 */
export const writeHashMarker = (dir: string, hash: string): void => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, HASH_MARKER_FILENAME), hash, "utf8");
};

/**
 * Read the `sha256.txt` marker file from `dir`.
 * Returns `null` if the file is missing or unreadable.
 */
export const readHashMarker = (dir: string): string | null => {
    try {
        return fs.readFileSync(path.join(dir, HASH_MARKER_FILENAME), "utf8").trim();
    } catch {
        return null;
    }
};

/**
 * Recompute the SHA-256 of `filePath` and compare it to the stored marker in
 * `markerDir`. Returns `true` when the hashes match, `false` if they differ
 * or if the marker is missing.
 */
export const verifyIntegrity = async (
    filePath: string,
    markerDir: string,
): Promise<boolean> => {
    const expected = readHashMarker(markerDir);
    if (!expected) {
        return false;
    }
    try {
        const actual = await computeFileHash(filePath);
        return actual === expected;
    } catch {
        return false;
    }
};

