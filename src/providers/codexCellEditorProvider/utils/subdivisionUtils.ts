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
     * Document-local name overrides, keyed by subdivision key (typically
     * `startCellId`, or `FIRST_SUBDIVISION_KEY` for the implicit first subdivision).
     * Takes precedence over every other name source.
     */
    nameOverrides?: { [key: string]: string; };
    /**
     * Mirrored-from-source name overrides used as a fallback when the document
     * has no local override for a key. Lets target documents inherit source-side
     * names without surrendering the ability to set their own. Same key shape as
     * `nameOverrides`.
     */
    fallbackNameOverrides?: { [key: string]: string; };
    /**
     * Arithmetic chunk size used both for the no-placements fallback AND for
     * sub-chunking long stretches between user-defined breaks.
     */
    cellsPerPage: number;
    /**
     * Maximum stretch length (in root cells) the resolver will leave unsplit
     * between two user-defined breaks. Stretches longer than this are split
     * into chunks of `cellsPerPage`. Pass `0` / `undefined` to use
     * `cellsPerPage` itself as the threshold (the legacy "always chunk past
     * a page" behaviour). When custom placements are absent the threshold is
     * applied to the whole milestone the same way.
     */
    maxSubdivisionLength?: number;
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
        fallbackNameOverrides,
        cellsPerPage,
        maxSubdivisionLength,
        firstSubdivisionDefaultName,
    } = opts;

    const totalRoots = rootContentCellIds.length;
    if (totalRoots === 0) {
        return [];
    }

    // Two-tier name resolution: a document's local override always wins, with the
    // mirrored-source fallback acting as the default when the local map is silent.
    // Empty strings are treated as "not set" so a stray "" never masks a real name.
    const pickName = (
        map: { [k: string]: string; } | undefined,
        key: string
    ): string | undefined => {
        if (!map) return undefined;
        const value = map[key];
        return typeof value === "string" && value.length > 0 ? value : undefined;
    };
    const resolveOverride = (key: string): string | undefined =>
        pickName(nameOverrides, key) ?? pickName(fallbackNameOverrides, key);

    // Threshold rules (shared across the no-placements and with-placements branches):
    //   - `pageSize` is the chunk granularity used when we *do* split.
    //   - `threshold` is the maximum stretch length we leave unsplit.
    //   - When `maxSubdivisionLength` is positive we honour it directly so users
    //     can preserve uneven logical pages; otherwise threshold === pageSize,
    //     matching the legacy "split anything larger than a page" behaviour.
    const pageSize = Math.max(1, cellsPerPage);
    const threshold =
        typeof maxSubdivisionLength === "number" && maxSubdivisionLength > 0
            ? maxSubdivisionLength
            : pageSize;

    /**
     * Expands a single stretch [startRootIndex, endRootIndex) into one or more
     * `SubdivisionInfo` entries, sub-chunking by `pageSize` when the stretch is
     * longer than `threshold`. The first chunk inherits the parent identity
     * (key/name/source/startCellId); subsequent chunks are auto-derived.
     */
    const expandStretch = (parent: SubdivisionInfo): SubdivisionInfo[] => {
        const length = parent.endRootIndex - parent.startRootIndex;
        if (length <= threshold) return [parent];
        const out: SubdivisionInfo[] = [];
        let cursor = parent.startRootIndex;
        let isFirst = true;
        while (cursor < parent.endRootIndex) {
            const endRoot = Math.min(cursor + pageSize, parent.endRootIndex);
            if (isFirst) {
                out.push({ ...parent, endRootIndex: endRoot });
                isFirst = false;
            } else {
                const startCellId = rootContentCellIds[cursor];
                const key = startCellId ?? `auto-${cursor}`;
                out.push({
                    index: 0, // re-indexed by the caller after all stretches expand
                    startRootIndex: cursor,
                    endRootIndex: endRoot,
                    key,
                    startCellId,
                    name: resolveOverride(key),
                    source: "auto",
                });
            }
            cursor = endRoot;
        }
        return out;
    };

    /** Re-numbers `index` on the final expanded subdivision list. */
    const reindex = (entries: SubdivisionInfo[]): SubdivisionInfo[] =>
        entries.map((entry, idx) => ({ ...entry, index: idx }));

    // Branch 1: no user-defined breaks → treat the whole milestone as one stretch
    // and expand it. This keeps the implicit-first identity stable when the
    // milestone fits in a single page (pure auto, no chunking) while still
    // chunking large unbroken milestones to match legacy pagination.
    if (!placements || placements.length === 0) {
        const wholeMilestone: SubdivisionInfo = {
            index: 0,
            startRootIndex: 0,
            endRootIndex: totalRoots,
            key: FIRST_SUBDIVISION_KEY,
            startCellId: rootContentCellIds[0],
            name:
                resolveOverride(FIRST_SUBDIVISION_KEY) ??
                firstSubdivisionDefaultName,
            source: "auto",
        };
        return reindex(expandStretch(wholeMilestone));
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

    // Compose the user-break stretches: implicit first + each resolved break.
    // Each entry is then expanded if its length exceeds the threshold.
    const stretches: SubdivisionInfo[] = [];
    const firstEnd = resolved.length > 0 ? resolved[0].rootIndex : totalRoots;
    stretches.push({
        index: 0, // placeholder, reindexed at the end
        startRootIndex: 0,
        endRootIndex: firstEnd,
        key: FIRST_SUBDIVISION_KEY,
        startCellId: rootContentCellIds[0],
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
        stretches.push({
            index: 0, // placeholder
            startRootIndex: anchor.rootIndex,
            endRootIndex,
            key: anchor.key,
            startCellId: anchor.startCellId,
            name: resolveOverride(anchor.key) ?? anchor.name,
            source: "custom",
        });
    }

    const expanded: SubdivisionInfo[] = [];
    for (const stretch of stretches) {
        for (const piece of expandStretch(stretch)) {
            expanded.push(piece);
        }
    }
    return reindex(expanded);
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

/**
 * Result of `splitPlacementsAtAnchor`. Used by the milestone-placement edit
 * pipeline (add / promote) to atomically re-partition an existing milestone's
 * subdivisions when a new milestone boundary is introduced inside it.
 */
export interface SplitPlacementsResult {
    /**
     * Placements that fall strictly before the new boundary. These remain on
     * the original (now-shorter) milestone.
     */
    before: MilestoneSubdivisionPlacement[];
    /**
     * Placements that fall strictly after the new boundary, re-anchored as
     * subdivisions of the freshly-created milestone. The placement at the
     * boundary itself (if any) is NOT included here — it becomes the new
     * milestone's implicit first subdivision and its name (if any) is
     * surfaced via `boundaryName`.
     */
    after: MilestoneSubdivisionPlacement[];
    /**
     * If a placement existed exactly at the new boundary cell, its `name` is
     * returned here. Callers persist this as the new milestone's
     * `subdivisionNames["__start__"]` so the implicit first subdivision keeps
     * the user's label even though it no longer corresponds to a placement.
     */
    boundaryName?: string;
}

/**
 * Partitions a milestone's existing placements at an anchor cell when a new
 * milestone is being inserted there (whether by direct add or by promotion of
 * an existing subdivision break).
 *
 * `rootIds` is the ordered list of root content cell IDs in the original
 * (un-split) milestone. `boundaryCellId` must appear in `rootIds`; otherwise
 * the function returns the input unchanged in `before` (defensive).
 *
 * Placements whose `startCellId` is not a root cell are silently dropped — the
 * resolver would prune them anyway.
 */
export function splitPlacementsAtAnchor(
    placements: MilestoneSubdivisionPlacement[] | undefined,
    rootIds: string[],
    boundaryCellId: string
): SplitPlacementsResult {
    const empty: SplitPlacementsResult = { before: [], after: [] };
    if (!boundaryCellId) return empty;
    const boundaryIndex = rootIds.indexOf(boundaryCellId);
    // Boundary outside the milestone or at the very start — caller should have
    // rejected this earlier; we degrade gracefully to "no split" so we never
    // silently lose data.
    if (boundaryIndex <= 0) {
        return {
            before: Array.isArray(placements) ? [...placements] : [],
            after: [],
        };
    }

    const before: MilestoneSubdivisionPlacement[] = [];
    const after: MilestoneSubdivisionPlacement[] = [];
    let boundaryName: string | undefined;
    const seen = new Set<string>();

    for (const placement of placements ?? []) {
        if (!placement || typeof placement.startCellId !== "string") continue;
        if (seen.has(placement.startCellId)) continue;
        seen.add(placement.startCellId);
        const idx = rootIds.indexOf(placement.startCellId);
        if (idx === -1) continue; // stale anchor — drop
        if (idx < boundaryIndex) {
            const entry: MilestoneSubdivisionPlacement = {
                startCellId: placement.startCellId,
            };
            if (typeof placement.name === "string" && placement.name.length > 0) {
                entry.name = placement.name;
            }
            before.push(entry);
        } else if (idx === boundaryIndex) {
            // Placement coincides with the new milestone boundary. We don't
            // carry it into `after` because the new milestone's first
            // subdivision is implicit; instead we surface its name so callers
            // can stash it in `subdivisionNames[FIRST_SUBDIVISION_KEY]`.
            if (typeof placement.name === "string" && placement.name.length > 0) {
                boundaryName = placement.name;
            }
        } else {
            const entry: MilestoneSubdivisionPlacement = {
                startCellId: placement.startCellId,
            };
            if (typeof placement.name === "string" && placement.name.length > 0) {
                entry.name = placement.name;
            }
            after.push(entry);
        }
    }

    return { before, after, boundaryName };
}

/**
 * Result of `mergePlacementsForRemovedMilestone`. Captures both the new
 * placement list to write onto the surviving (previous) milestone, and the
 * recommended source-side first-subdivision name carried over from the
 * removed milestone (relevant only when `boundaryAnchorCellId` matches the
 * surviving milestone's first root cell — see merge logic below).
 */
export interface MergePlacementsResult {
    placements: MilestoneSubdivisionPlacement[];
}

/**
 * Builds the merged placement list for the surviving (previous) milestone
 * when a milestone is removed or demoted. Both operations expand the
 * previous milestone's range to absorb the removed milestone's content
 * cells; the difference is whether the boundary itself is preserved as a
 * custom subdivision break.
 *
 *  - `prevPlacements`: existing placements on the surviving milestone.
 *  - `removedPlacements`: placements on the milestone being removed (these
 *    are lifted up because their anchors still point at valid root cells in
 *    the merged milestone).
 *  - `boundaryAnchorCellId`: the first root content cell of the removed
 *    milestone. After the merge it sits at the seam between the two
 *    milestones' original cell ranges.
 *  - `boundaryName`: optional label for the boundary placement. When
 *    `preserveBoundary` is `true` and `boundaryName` is set, the boundary
 *    becomes a new placement on the surviving milestone (carrying that
 *    name) so the section heading isn't silently lost.
 *  - `preserveBoundary`: `true` for **demote** semantics (boundary kept as
 *    a subdivision break), `false` for **remove** semantics (boundary gone
 *    entirely).
 *
 * Placements are deduplicated by `startCellId` (last write wins on name).
 */
export function mergePlacementsForRemovedMilestone({
    prevPlacements,
    removedPlacements,
    boundaryAnchorCellId,
    boundaryName,
    preserveBoundary,
}: {
    prevPlacements: MilestoneSubdivisionPlacement[] | undefined;
    removedPlacements: MilestoneSubdivisionPlacement[] | undefined;
    boundaryAnchorCellId?: string;
    boundaryName?: string;
    preserveBoundary: boolean;
}): MergePlacementsResult {
    const merged = new Map<string, MilestoneSubdivisionPlacement>();
    const push = (p: MilestoneSubdivisionPlacement | undefined) => {
        if (!p || typeof p.startCellId !== "string") return;
        const entry: MilestoneSubdivisionPlacement = { startCellId: p.startCellId };
        if (typeof p.name === "string" && p.name.length > 0) {
            entry.name = p.name;
        }
        merged.set(p.startCellId, entry);
    };

    for (const p of prevPlacements ?? []) push(p);

    if (
        preserveBoundary &&
        typeof boundaryAnchorCellId === "string" &&
        boundaryAnchorCellId.length > 0
    ) {
        // For demote: stamp the boundary as a fresh placement carrying the
        // removed milestone's label as its name (when provided). Setting it
        // before the removed milestone's other placements means the explicit
        // boundary entry will be replaced if the removed milestone happened
        // to also have a placement at that exact cell ID — that's fine; the
        // removed-side name takes precedence as the more specific override.
        const entry: MilestoneSubdivisionPlacement = { startCellId: boundaryAnchorCellId };
        if (typeof boundaryName === "string" && boundaryName.length > 0) {
            entry.name = boundaryName;
        }
        merged.set(boundaryAnchorCellId, entry);
    }

    for (const p of removedPlacements ?? []) push(p);

    return { placements: Array.from(merged.values()) };
}
