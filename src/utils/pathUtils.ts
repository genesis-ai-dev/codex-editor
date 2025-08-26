/**
 * Cross-platform path helpers
 */

/**
 * Convert any Windows-style backslashes to POSIX-style forward slashes.
 * Keeps existing forward slashes intact and does not perform URL decoding.
 */
export function toPosixPath(inputPath: string): string {
    if (!inputPath) return inputPath;
    return inputPath.replace(/\\/g, "/");
}


