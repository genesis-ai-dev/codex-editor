import { SQLiteIndexManager } from "./sqliteIndex";

// Global instance to maintain state across the extension
let globalIndexManager: SQLiteIndexManager | null = null;

/**
 * Flag set during clearSQLiteIndexManager so in-flight DB operations
 * (codexDocument sync, fileSyncManager) can bail early instead of
 * hitting a closed/deleted database mid-operation.
 */
let shuttingDown = false;

/**
 * Returns true while the database is being torn down (project swap, deactivation).
 * Long-running DB operations should check this and bail early.
 */
export function isDBShuttingDown(): boolean {
    return shuttingDown;
}

/**
 * Get the global SQLite index manager instance
 * This allows other parts of the extension to access the same index manager
 */
export function getSQLiteIndexManager(): SQLiteIndexManager | null {
    return globalIndexManager;
}

/**
 * Set the global SQLite index manager instance
 * This should be called during extension initialization
 */
export function setSQLiteIndexManager(manager: SQLiteIndexManager): void {
    globalIndexManager = manager;
    shuttingDown = false;
}

/**
 * Clear the global SQLite index manager instance.
 * Closes the underlying database connection before releasing the reference.
 * This should be called during extension deactivation or project swap.
 *
 * The reference is cleared FIRST so new callers immediately get null,
 * then close() is awaited. If close() throws, the stale reference is
 * still gone — preventing a zombie manager from being returned.
 */
export async function clearSQLiteIndexManager(): Promise<void> {
    shuttingDown = true;
    const manager = globalIndexManager;
    globalIndexManager = null; // Clear first to prevent new callers from getting it
    if (manager) {
        try {
            await manager.close();
        } catch (e) {
            console.error("[SQLiteIndexManager] Error closing index manager during cleanup:", e);
        }
    }
    shuttingDown = false;
}

/**
 * Force refresh the FTS index for immediate search visibility.
 * Call this when you need to ensure the latest data is searchable.
 *
 * @returns `true` if the refresh was performed, `false` if the
 *          index manager is not available (e.g. during shutdown).
 */
export async function refreshSearchIndex(): Promise<boolean> {
    if (globalIndexManager) {
        await globalIndexManager.refreshFTSIndex();
        return true;
    }
    return false;
}

/**
 * Debug function to check FTS synchronization
 * Returns info about cell count vs FTS count
 */
export async function getFTSDebugInfo(): Promise<{ cellsCount: number; ftsCount: number; } | null> {
    if (globalIndexManager) {
        return await globalIndexManager.getFTSDebugInfo();
    }
    return null;
}

/**
 * Debug function to check if a specific cell is in the FTS index
 */
export async function isCellInFTSIndex(cellId: string): Promise<boolean> {
    if (globalIndexManager) {
        return await globalIndexManager.isCellInFTSIndex(cellId);
    }
    return false;
} 