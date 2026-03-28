/**
 * Health Propagation Service
 *
 * When a cell's health changes (validation, edit, etc.), this service finds
 * similar cells via the branching search algorithm and recalculates their
 * health as a weighted average of their own example cells' health scores.
 *
 * Depth-1 only: propagation does NOT cascade to neighbors of neighbors.
 * Anchored cells (directly validated) are never overwritten.
 */

import { getSQLiteIndexManager, isDBShuttingDown } from "../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager";
import { SearchManager } from "../activationHelpers/contextAware/contentIndexes/searchAlgorithms/searchManager";

const DEBUG_MODE = false;
const debug = (message: string, ...args: unknown[]) => {
    if (DEBUG_MODE) console.log(`[HealthPropagation] ${message}`, ...args);
};

/** Number of similar cells we expect to find for each cell. */
const EXPECTED_NEIGHBOR_COUNT = 15;
/** Debounce window — batches rapid validations into a single propagation pass. */
const PROPAGATION_DEBOUNCE_MS = 2000;

// ── State ──────────────────────────────────────────────────────────────

/** Cell IDs whose health changed and whose neighbors need recalculation. */
const pendingCellIds = new Set<string>();
/** Timer handle for the debounced queue processor. */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Callback registered by the provider to receive propagated health updates. */
let onHealthUpdated: ((updates: Array<{ cellId: string; health: number }>) => void) | null = null;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Register a callback that will be invoked with batched health updates
 * after propagation completes. The provider uses this to update in-memory
 * documents and push changes to visible webviews.
 */
export function setHealthUpdateCallback(
    cb: (updates: Array<{ cellId: string; health: number }>) => void
): void {
    onHealthUpdated = cb;
}

/**
 * Queue a cell for health propagation. The actual propagation is debounced
 * so rapid validations (e.g. validating 10 cells quickly) are batched.
 */
export function queueHealthPropagation(cellId: string): void {
    pendingCellIds.add(cellId);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processQueue, PROPAGATION_DEBOUNCE_MS);
}

// ── Core Logic ─────────────────────────────────────────────────────────

/**
 * Compute a position-weighted health score.
 *
 * @param healthValues - Health scores of found examples, in rank order (best match first).
 * @param expectedN    - Expected number of examples. Missing slots contribute 0.
 * @returns Weighted average where weight_i = 1/(i+1) for rank i.
 */
export function computeWeightedHealth(healthValues: number[], expectedN: number): number {
    // Denominator: sum of all expected weights  Σ(1/i, i=1..N)
    let totalWeight = 0;
    for (let i = 1; i <= expectedN; i++) {
        totalWeight += 1 / i;
    }

    // Numerator: sum of weight × health for found results
    let weightedSum = 0;
    for (let i = 0; i < healthValues.length; i++) {
        const weight = 1 / (i + 1);
        weightedSum += weight * healthValues[i];
    }

    // Missing results contribute 0 to numerator but their weight is in the denominator
    const health = totalWeight > 0 ? weightedSum / totalWeight : 0.3;
    return Math.max(0.3, health);
}

async function processQueue(): Promise<void> {
    const triggerCellIds = Array.from(pendingCellIds);
    pendingCellIds.clear();
    debounceTimer = null;

    if (triggerCellIds.length === 0) return;
    if (isDBShuttingDown()) return;

    const indexManager = getSQLiteIndexManager();
    if (!indexManager) return;

    try {
        const searchManager = new SearchManager(indexManager);
        const allNeighborIds = new Set<string>();

        // ── Phase 1: Find neighbors of all trigger cells ───────────
        for (const cellId of triggerCellIds) {
            const sourceCell = await indexManager.getCellById(cellId, "source");
            const sourceContent = sourceCell?.content;
            if (!sourceContent?.trim()) continue;

            const similarPairs = await searchManager.searchTranslationPairs(
                sourceContent,
                { limit: EXPECTED_NEIGHBOR_COUNT }
            );

            for (const pair of similarPairs) {
                if (pair.cellId !== cellId) {
                    allNeighborIds.add(pair.cellId);
                }
            }
        }

        if (allNeighborIds.size === 0) return;

        // ── Phase 2: Filter out anchored cells ─────────────────────
        const neighborIds = Array.from(allNeighborIds);
        const validationStatus = await indexManager.getCellsValidationStatus(neighborIds);
        const recalcCellIds = neighborIds.filter((id) => {
            const status = validationStatus.get(id);
            if (!status) return true; // No status → not anchored
            return status.textCount === 0 && status.audioCount === 0;
        });

        if (recalcCellIds.length === 0) return;
        debug(`Recalculating health for ${recalcCellIds.length} non-anchored neighbors`);

        // ── Phase 3: Recalculate each neighbor's health ────────────
        const healthUpdates: Array<{ cellId: string; health: number }> = [];

        // Get current health for all recalc cells (for threshold comparison)
        const currentHealthMap = await indexManager.getCellsHealth(recalcCellIds);

        for (const cellId of recalcCellIds) {
            const sourceCell = await indexManager.getCellById(cellId, "source");
            const sourceContent = sourceCell?.content;
            if (!sourceContent?.trim()) continue;

            // Find THIS cell's own examples
            const examplePairs = await searchManager.searchTranslationPairs(
                sourceContent,
                { limit: EXPECTED_NEIGHBOR_COUNT }
            );

            // Exclude self from examples
            const exampleIds = examplePairs
                .filter((p) => p.cellId !== cellId)
                .map((p) => p.cellId);

            if (exampleIds.length === 0) continue;

            // Get health of examples (in rank order)
            const exampleHealthMap = await indexManager.getCellsHealth(exampleIds);
            const healthValues = exampleIds.map((id) => exampleHealthMap.get(id) ?? 0.3);

            const newHealth = computeWeightedHealth(healthValues, EXPECTED_NEIGHBOR_COUNT);

            // Only update if health changed meaningfully
            const currentHealth = currentHealthMap.get(cellId) ?? 0.3;
            if (Math.abs(newHealth - currentHealth) > 0.01) {
                healthUpdates.push({ cellId, health: Math.round(newHealth * 100) / 100 });
            }
        }

        if (healthUpdates.length === 0) return;

        // ── Phase 4: Batch update SQLite ───────────────────────────
        await indexManager.updateCellsHealth(healthUpdates);

        // ── Phase 5: Notify provider ───────────────────────────────
        if (onHealthUpdated) {
            onHealthUpdated(healthUpdates);
        }

        debug(`Propagated health to ${healthUpdates.length} cells from ${triggerCellIds.length} trigger(s)`);
    } catch (error) {
        console.error("[HealthPropagation] Error during propagation:", error);
    }
}
