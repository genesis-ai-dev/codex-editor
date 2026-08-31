import type { FileEditHistory } from "../../../types";
import { EditType } from "../../../types/enums";
import { EditMapUtils } from "../../utils/editMapUtils";
import type { ReimportMergeStats } from "./reimportMerge";

/** Keep the existing pair's identity and the user's presentation settings. */
const PRESERVED_KEYS = new Set([
    "id", "fileDisplayName", "sourceFsPath", "codexFsPath", "navigation",
    "sourceCreatedAt", "corpusMarker", "textDirection", "videoUrl",
    "lineNumbersEnabled", "lineNumbersEnabledSource",
]);

const ORIGINAL_REFERENCE_KEYS = [
    "originalName", "originalFileName", "originalFileHash", "originalFileRequestedName",
] as const;

/** A local reimport must follow edits already observed, even after clock skew. */
export function reimportTimestamp(...metadata: (Record<string, unknown> | undefined)[]): number {
    return metadata.reduce((latest, item) => {
        const edits: FileEditHistory[] = Array.isArray(item?.edits) ? item.edits : [];
        return edits.reduce((time, edit) => Number.isFinite(edit?.timestamp)
            ? Math.max(time, edit.timestamp + 1) : time, latest);
    }, Date.now());
}

/** Record file metadata changes in the same history used by notebook sync. */
export function mergeReimportedMetadata(
    existing: Record<string, unknown> = {},
    incoming: Record<string, unknown> = {},
    timestamp: number,
    stats: ReimportMergeStats,
): Record<string, unknown> {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
        if (key === "edits" || value === undefined) continue;
        if (PRESERVED_KEYS.has(key) && existing[key] !== undefined) continue;
        merged[key] = value;
    }

    // Both names are read by exporters and legacy notebooks. They must agree.
    const originalName = incoming.originalFileName || incoming.originalName;
    if (typeof originalName === "string") {
        merged.originalName = merged.originalFileName = originalName;
        // A legacy caller can supply a changed name without a hash. Do not
        // associate the new original with the previous original's known hash.
        const oldName = existing.originalFileName || existing.originalName;
        if (originalName !== oldName && !incoming.originalFileHash) {
            merged.originalFileHash = "";
        }
    }
    merged.importContext = {
        ...((existing.importContext as Record<string, unknown>) ?? {}),
        ...((incoming.importContext as Record<string, unknown>) ?? {}),
        lastReimport: { timestamp: new Date(timestamp).toISOString(), stats },
    };

    // Incoming parse history describes a new notebook; preserve the existing
    // notebook's history and append only the changes actually applied to it.
    const edits: FileEditHistory[] = Array.isArray(existing.edits) ? [...existing.edits] : [];
    const changed = (key: string) => JSON.stringify(existing[key]) !== JSON.stringify(merged[key]);
    const referenceChanged = ORIGINAL_REFERENCE_KEYS.some(changed);
    const referenceKeys = new Set<string>(ORIGINAL_REFERENCE_KEYS);
    for (const [key, value] of Object.entries(merged)) {
        if (key === "edits" || value === undefined) continue;
        // Stamp the whole reference together, including unchanged members:
        // an older filename edit must not win alongside this new hash.
        if (!changed(key) && !(referenceChanged && referenceKeys.has(key))) continue;
        edits.push({
            editMap: EditMapUtils.metadataField(key),
            value: value as FileEditHistory["value"],
            timestamp,
            type: EditType.MIGRATION,
            author: "system",
        });
    }
    merged.edits = edits;
    return merged;
}
