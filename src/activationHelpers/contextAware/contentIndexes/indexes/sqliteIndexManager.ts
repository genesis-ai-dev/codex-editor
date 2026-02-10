import { SQLiteIndexManager } from "./sqliteIndex";

// Global instance to maintain state across the extension
let globalIndexManager: SQLiteIndexManager | null = null;

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
}

/**
 * Clear the global SQLite index manager instance.
 * Closes the underlying database connection before releasing the reference.
 * This should be called during extension deactivation.
 */
export async function clearSQLiteIndexManager(): Promise<void> {
    if (globalIndexManager) {
        try {
            await globalIndexManager.close();
        } catch (e) {
            console.error("[SQLiteIndexManager] Error closing index manager during cleanup:", e);
        }
    }
    globalIndexManager = null;
}

/**
 * Force refresh the FTS index for immediate search visibility
 * Call this when you need to ensure the latest data is searchable
 */
export async function refreshSearchIndex(): Promise<void> {
    if (globalIndexManager) {
        await globalIndexManager.refreshFTSIndex();
    }
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