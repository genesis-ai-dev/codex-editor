import type {
    MilestoneSubdivisionPlacement,
    SubdivisionInfo,
} from "../../../../types";

/**
 * Stable key used for the implicit first subdivision of a milestone. Kept public so
 * target-side name override maps can reference it without repeating the literal.
 */
export const FIRST_SUBDIVISION_KEY = "__start__";

export interface ResolveSubdivisionsOptions {
    /**
     * Ordered IDs of the milestone's root content cells (non-milestone, non-paratext,
     * non-deleted cells without a `parentId`). These form the pagination axis that
     * subdivision anchors are resolved against.
     */
    rootContentCellIds: string[];
    /**
     * User-defined break anchors. Typically sourced from
     * `milestoneCell.metadata.data.subdivisions` on the source document. The
     * implicit first subdivision (starting at root index 0) is never listed here —
     * only subsequent breaks.
     */
    placements?: MilestoneSubdivisionPlacement[];
    /**
     * Target-side display name overrides, keyed by subdivision key (typically
     * `startCellId`, or `FIRST_SUBDIVISION_KEY` for the implicit first subdivision).
     */
    nameOverrides?: { [key: string]: string; };
    /**
     * Arithmetic fallback chunk size, used when there are no custom placements.
     * When custom placements exist, this value is ignored.
     */
    cellsPerPage: number;
    /**
     * Default display name for the implicit first subdivision when no custom name is
     * set. Defaults to undefined (callers typically format a numbered fallback like
     * "1–50").
     */
    firstSubdivisionDefaultName?: string;
}

/**
 * Resolves a milestone's root-content-cell range into a list of `SubdivisionInfo`
 * items ready for rendering.
 *
 * Behaviour:
 * - When `placements` is empty/undefined, returns arithmetic chunks of
 *   `cellsPerPage`. This matches the legacy 50-cell pagination exactly when
 *   `cellsPerPage === 50`.
 * - Placements with a `startCellId` that no longer exists in `rootContentCellIds`
 *   are silently pruned (the anchored cell was deleted, merged away, etc.).
 * - Placements are sorted by their resolved root-index so callers don't need to
 *   keep them ordered on disk.
 * - Duplicate placements pointing at the same root index are collapsed.
 * - When the last subdivision has a user-assigned name and additional root cells
 *   exist beyond it in a way not covered by a subsequent placement, no trailing
 *   auto-subdivision is added (the named subdivision absorbs the tail, consistent
 *   with expected naming semantics). When the last subdivision is unnamed, the
 *   tail is likewise absorbed. A trailing auto-subdivision is emitted ONLY when
 *   the only placements are the implicit first one and no root content cells
 *   remain uncovered — i.e. never. The tail-append semantics for new cells after
 *   the last explicit named break are handled at write time, not at resolve time.
 *
 * @returns Ordered, non-overlapping, fully-covering list of subdivisions. Always
 * contains at least one item when `rootContentCellIds.length > 0`; returns an
 * empty array when the milestone has zero root content cells.
 */
export function resolveSubdivisions(
    opts: ResolveSubdivisionsOptions
): SubdivisionInfo[] {
    const {
        rootContentCellIds,
        placements,
        nameOverrides,
        cellsPerPage,
        firstSubdivisionDefaultName,
    } = opts;

    const totalRoots = rootContentCellIds.length;
    if (totalRoots === 0) {
        return [];
    }

    const resolveOverride = (key: string): string | undefined => {
        if (!nameOverrides) return undefined;
        const value = nameOverrides[key];
        return typeof value === "string" && value.length > 0 ? value : undefined;
    };

    // No custom placements → arithmetic chunking (preserves legacy behavior).
    if (!placements || placements.length === 0) {
        const pageSize = Math.max(1, cellsPerPage);
        const pages = Math.max(1, Math.ceil(totalRoots / pageSize));
        const result: SubdivisionInfo[] = [];
        for (let i = 0; i < pages; i++) {
            const startRootIndex = i * pageSize;
            const endRootIndex = Math.min(startRootIndex + pageSize, totalRoots);
            const startCellId = rootContentCellIds[startRootIndex];
            const key = i === 0 ? FIRST_SUBDIVISION_KEY : startCellId ?? `auto-${i}`;
            result.push({
                index: i,
                startRootIndex,
                endRootIndex,
                key,
                startCellId,
                name: i === 0 ? resolveOverride(FIRST_SUBDIVISION_KEY) ?? firstSubdivisionDefaultName : resolveOverride(key),
                source: "auto",
            });
        }
        return result;
    }

    // Map from rootCellId → root index for fast anchor resolution.
    const rootIdToIndex = new Map<string, number>();
    for (let i = 0; i < rootContentCellIds.length; i++) {
        rootIdToIndex.set(rootContentCellIds[i], i);
    }

    // Resolve each placement → { rootIndex, name }. Skip anchors that reference a
    // non-existent root cell or that resolve to index 0 (those collide with the
    // implicit first subdivision; keep the placement's name for the first one).
    interface ResolvedAnchor { rootIndex: number; name?: string; key: string; startCellId?: string; }
    const resolved: ResolvedAnchor[] = [];
    let firstSubdivisionName: string | undefined;
    const seenIndices = new Set<number>();
    for (const placement of placements) {
        if (!placement || typeof placement.startCellId !== "string") continue;
        const rootIndex = rootIdToIndex.get(placement.startCellId);
        if (rootIndex === undefined) continue; // stale anchor — silently pruned
        if (rootIndex === 0) {
            // User anchored the "first break" at the first root cell — treat its
            // name as naming the implicit first subdivision.
            if (!firstSubdivisionName && placement.name) {
                firstSubdivisionName = placement.name;
            }
            continue;
        }
        if (seenIndices.has(rootIndex)) continue;
        seenIndices.add(rootIndex);
        resolved.push({
            rootIndex,
            name: placement.name,
            key: placement.startCellId,
            startCellId: placement.startCellId,
        });
    }

    // Sort by root index so users aren't forced to write placements in order.
    resolved.sort((a, b) => a.rootIndex - b.rootIndex);

    // Compose the subdivision list: implicit first + each resolved break.
    const result: SubdivisionInfo[] = [];
    const firstEnd = resolved.length > 0 ? resolved[0].rootIndex : totalRoots;
    const firstStartCellId = rootContentCellIds[0];
    result.push({
        index: 0,
        startRootIndex: 0,
        endRootIndex: firstEnd,
        key: FIRST_SUBDIVISION_KEY,
        startCellId: firstStartCellId,
        name:
            resolveOverride(FIRST_SUBDIVISION_KEY) ??
            firstSubdivisionName ??
            firstSubdivisionDefaultName,
        source: resolved.length > 0 ? "custom" : "auto",
    });

    for (let i = 0; i < resolved.length; i++) {
        const anchor = resolved[i];
        const next = resolved[i + 1];
        const endRootIndex = next ? next.rootIndex : totalRoots;
        result.push({
            index: i + 1,
            startRootIndex: anchor.rootIndex,
            endRootIndex,
            key: anchor.key,
            startCellId: anchor.startCellId,
            name: resolveOverride(anchor.key) ?? anchor.name,
            source: "custom",
        });
    }

    return result;
}

/**
 * Finds the subdivision that contains `rootIndex`. Returns -1 if none match.
 */
export function findSubdivisionIndexForRoot(
    subdivisions: SubdivisionInfo[],
    rootIndex: number
): number {
    for (let i = 0; i < subdivisions.length; i++) {
        const s = subdivisions[i];
        if (rootIndex >= s.startRootIndex && rootIndex < s.endRootIndex) {
            return i;
        }
    }
    return -1;
}
