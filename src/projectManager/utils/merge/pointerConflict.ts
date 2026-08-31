import type { ConflictFile } from "./types";

/** Pointer IDs refer to immutable media; choosing one arbitrarily can lose audio. */
export function resolvePointerConflict(conflict: ConflictFile): string {
    if (conflict.ours === conflict.theirs) return conflict.ours;
    if (conflict.ours === conflict.base) return conflict.theirs;
    if (conflict.theirs === conflict.base) return conflict.ours;
    throw new Error(
        `Both sides changed media pointer ${conflict.filepath}. ` +
        "Sync stopped without choosing or overwriting either recording."
    );
}
