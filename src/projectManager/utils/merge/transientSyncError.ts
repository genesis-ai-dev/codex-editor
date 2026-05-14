/**
 * Cross-repo sentinel prefix for sync errors that originate in
 * frontier-authentication and are safe to retry. MUST stay in lock-step with
 * the same constant in frontier-authentication/src/git/GitService.ts.
 * If you change one, change the other. Both repos have tests that assert this
 * exact string — drift will be caught by the cross-repo smoke test.
 */
export const BLOB_READ_FAILED_PREFIX = "BLOB_READ_FAILED:";

/**
 * Error class for sync failures that are safe to retry automatically.
 *
 * Thrown by:
 * - merge/index.ts diagnostic when remote-changed files are missing from the conflict list
 * - merge/index.ts when conflict resolution produces failedFiles (e.g. empty isNew content)
 *
 * Errors from frontier-authentication arrive as plain Error instances and are
 * recognized by their message starting with BLOB_READ_FAILED_PREFIX, since the
 * class identity does not survive the extension boundary.
 */
export class TransientSyncError extends Error {
    constructor(message: string, public readonly details?: string[]) {
        super(message);
        this.name = "TransientSyncError";
    }
}

/**
 * Returns true if the error is a transient sync failure that should be retried
 * before surfacing to the user. Covers:
 *  - TransientSyncError class (codex-editor-thrown)
 *  - BLOB_READ_FAILED_PREFIX sentinel (frontier-auth-thrown, cross-extension)
 *  - Network errors and push-rejection errors (existing transient set preserved
 *    from the previous in-place classifier inside the completeMerge catch)
 */
export function isRetriableSyncError(err: unknown): boolean {
    if (err instanceof TransientSyncError) return true;
    if (!(err instanceof Error)) return false;
    const msg = err.message;
    return (
        msg.startsWith(BLOB_READ_FAILED_PREFIX) ||
        msg.includes("non-fast-forward") ||
        msg.includes("failed to push") ||
        msg.includes("Failed to push") ||
        msg.includes("timeout") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("network")
    );
}

/**
 * Errors that have already been surfaced to the user via a more specific dialog
 * are tagged with `userSurfaced = true` so the outer catch can skip its generic
 * "Sync failed" dialog and avoid double-popups. Use this helper to read the flag.
 */
export function isUserSurfacedError(err: unknown): boolean {
    return (
        err instanceof Error &&
        (err as Error & { userSurfaced?: boolean; }).userSurfaced === true
    );
}

/**
 * Mark an error as already-surfaced to the user. Mutates the error and returns it
 * so callers can write `throw markUserSurfaced(new Error(...))` in one line.
 */
export function markUserSurfaced<E extends Error>(err: E): E {
    (err as E & { userSurfaced?: boolean; }).userSurfaced = true;
    return err;
}
