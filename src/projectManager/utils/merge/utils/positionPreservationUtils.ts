import type { CustomNotebookCellData } from "../../../../../types";

export interface CellPositionContext {
    /** The ID of the cell that came before this cell (null if first cell) */
    previousCellId: string | null;
    /** The ID of the cell that came after this cell (null if last cell) */
    nextCellId: string | null;
}

/**
 * Builds a map of cell position context for each cell in the array.
 * This tracks what cell came before and after each cell, enabling
 * position-preserving merges.
 */
export function buildCellPositionContextMap(
    cells: CustomNotebookCellData[]
): Map<string, CellPositionContext> {
    const positionMap = new Map<string, CellPositionContext>();

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const cellId = cell.metadata?.id;
        if (!cellId) continue;

        const previousCellId = i > 0 ? (cells[i - 1].metadata?.id || null) : null;
        const nextCellId = i < cells.length - 1 ? (cells[i + 1].metadata?.id || null) : null;

        positionMap.set(cellId, { previousCellId, nextCellId });
    }

    return positionMap;
}

type Logger = (...args: unknown[]) => void;

type InsertionTarget =
    | { kind: "after"; anchorCellId: string }
    | { kind: "before"; anchorCellId: string }
    | { kind: "append" };

function pushToBucket<T>(map: Map<string, T[]>, key: string, value: T): void {
    const existing = map.get(key);
    if (existing) {
        existing.push(value);
    } else {
        map.set(key, [value]);
    }
}

/**
 * Inserts "their-only" cells into an existing ordered list of cells, preserving the
 * relative order from "their" side while placing each cell near its closest neighbor
 * that exists in the base list.
 *
 * This is designed to preserve paratextual cell ordering without repeated `splice` and
 * repeated index-map rebuilds (which can become O(n^2) in large merges).
 */
export function insertUniqueCellsPreservingRelativePositions(options: {
    baseCells: CustomNotebookCellData[];
    theirUniqueCellIdsInOrder: string[];
    theirUniqueCellsById: Map<string, CustomNotebookCellData>;
    theirPositionContextMap: Map<string, CellPositionContext>;
    debugLog?: Logger;
}): CustomNotebookCellData[] {
    const { baseCells, theirUniqueCellIdsInOrder, theirUniqueCellsById, theirPositionContextMap, debugLog } =
        options;

    const baseCellIdSet = new Set<string>(
        baseCells.map((c) => c.metadata?.id).filter((id): id is string => typeof id === "string" && id.length > 0)
    );

    // Memoized nearest-neighbor lookups (path-compressed). This makes neighbor discovery ~O(n).
    const nearestPrevBaseMemo = new Map<string, string | null>();
    const nearestNextBaseMemo = new Map<string, string | null>();

    const resolveNearestBaseNeighbor = (
        startCellId: string,
        dir: "previousCellId" | "nextCellId",
        memo: Map<string, string | null>
    ): string | null => {
        const visited: string[] = [];
        let currentId: string | null = startCellId;

        while (currentId) {
            if (memo.has(currentId)) {
                const cached = memo.get(currentId) ?? null;
                for (const v of visited) memo.set(v, cached);
                return cached;
            }

            const ctx = theirPositionContextMap.get(currentId);
            const neighborId: string | null = ctx ? ctx[dir] : null;
            if (!neighborId) {
                memo.set(currentId, null);
                for (const v of visited) memo.set(v, null);
                return null;
            }

            if (baseCellIdSet.has(neighborId)) {
                memo.set(currentId, neighborId);
                for (const v of visited) memo.set(v, neighborId);
                return neighborId;
            }

            visited.push(currentId);
            currentId = neighborId;
        }

        for (const v of visited) memo.set(v, null);
        return null;
    };

    const getInsertionTarget = (cellId: string): InsertionTarget => {
        const prevAnchor = resolveNearestBaseNeighbor(cellId, "previousCellId", nearestPrevBaseMemo);
        if (prevAnchor) return { kind: "after", anchorCellId: prevAnchor };

        const nextAnchor = resolveNearestBaseNeighbor(cellId, "nextCellId", nearestNextBaseMemo);
        if (nextAnchor) return { kind: "before", anchorCellId: nextAnchor };

        return { kind: "append" };
    };

    // Bucket cells to insert before/after specific anchors (single-pass assembly later).
    const insertBefore = new Map<string, CustomNotebookCellData[]>();
    const insertAfter = new Map<string, CustomNotebookCellData[]>();
    const appendAtEnd: CustomNotebookCellData[] = [];

    for (const cellId of theirUniqueCellIdsInOrder) {
        const cell = theirUniqueCellsById.get(cellId);
        if (!cell) continue;

        const target = getInsertionTarget(cellId);
        if (target.kind === "after") {
            debugLog?.(`Cell ${cellId}: inserting after nearest base neighbor ${target.anchorCellId}`);
            pushToBucket(insertAfter, target.anchorCellId, cell);
            continue;
        }
        if (target.kind === "before") {
            debugLog?.(`Cell ${cellId}: inserting before nearest base neighbor ${target.anchorCellId}`);
            pushToBucket(insertBefore, target.anchorCellId, cell);
            continue;
        }

        debugLog?.(`Cell ${cellId}: no neighbors found in base, appending at end`);
        appendAtEnd.push(cell);
    }

    // Assemble final result in one pass over the base order.
    const result: CustomNotebookCellData[] = [];
    for (const baseCell of baseCells) {
        const baseId = baseCell.metadata?.id;
        if (baseId && insertBefore.has(baseId)) {
            result.push(...(insertBefore.get(baseId) || []));
        }

        result.push(baseCell);

        if (baseId && insertAfter.has(baseId)) {
            result.push(...(insertAfter.get(baseId) || []));
        }
    }

    if (appendAtEnd.length > 0) {
        result.push(...appendAtEnd);
    }

    return result;
}

