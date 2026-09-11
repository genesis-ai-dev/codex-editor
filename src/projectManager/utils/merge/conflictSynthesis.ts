import { TransientSyncError } from "./transientSyncError";

/**
 * Canonical form for comparing paths returned by Frontier with its conflict
 * list: forward slashes, no leading "./" or "/", and Unicode NFC.
 */
export function normalizeSyncPath(filepath: string): string {
    let normalized = filepath.replace(/\\/g, "/");
    while (normalized.startsWith("./")) {
        normalized = normalized.slice(2);
    }
    return normalized.replace(/^\/+/, "").normalize("NFC");
}

export interface ConflictListInvariantOptions {
    /** The conflict list Frontier produced. */
    conflicts: Array<{ filepath?: string; }>;
    /** conflictsResponse.remoteChangedFilePaths when the Frontier version provides it. */
    changedPaths: unknown;
}

/**
 * Verify that Frontier returned every remote-changed path that still requires
 * client resolution. A mismatch is retried by the caller after a fresh sync.
 *
 * Never manufacture conflicts from diagnostic path lists. Frontier owns the
 * Git trees and index, so Codex cannot safely infer whether an omitted path is
 * a conflict, a one-sided change already applied by Frontier, or interrupted
 * merge residue. Guessing here caused thousands of remote files to be written
 * into the working tree and later committed as local work.
 */
export async function enforceConflictListInvariant(
    options: ConflictListInvariantOptions
): Promise<void> {
    const { conflicts, changedPaths } = options;
    if (!Array.isArray(changedPaths) || changedPaths.length === 0) return;

    const conflictPaths = new Set(
        conflicts
            .map((conflict) => conflict?.filepath)
            .filter((filepath): filepath is string => typeof filepath === "string")
            .map(normalizeSyncPath)
    );
    const missingFromConflicts = [...new Set(
        changedPaths
            .filter((filepath): filepath is string =>
                typeof filepath === "string" && filepath.length > 0
            )
            .map(normalizeSyncPath)
            .filter((filepath) => !conflictPaths.has(filepath))
    )];
    if (missingFromConflicts.length === 0) return;

    const sample = missingFromConflicts.slice(0, 5).join(", ");
    const extra = missingFromConflicts.length > 5
        ? ` (+${missingFromConflicts.length - 5} more)`
        : "";
    throw new TransientSyncError(
        `${missingFromConflicts.length} remote-changed file(s) were not in Frontier's conflict list. ` +
        `Sync stopped instead of guessing how to merge them. Missing: ${sample}${extra}`,
        missingFromConflicts
    );
}
