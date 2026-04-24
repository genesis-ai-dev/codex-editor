/**
 * Database factory — single entry point for opening SQLite databases.
 *
 * Depending on tool preferences and runtime availability, returns either
 * a native AsyncDatabase (node_sqlite3) or a Fts5AsyncDatabase (sql.js WASM).
 * Callers always receive an IAsyncDatabase and never need to know which
 * engine is active.
 */

import type { IAsyncDatabase } from "./sqliteTypes";
import { isNativeSqliteReady, AsyncDatabase } from "./nativeSqlite";
import { isFts5SqliteReady, Fts5AsyncDatabase } from "./fts5Sqlite";
import { shouldUseNativeSqlite, getSqliteToolMode } from "./toolPreferences";
import { captureEvent } from "./telemetry";

/**
 * Open a database file using the preferred backend.
 *
 * Resolution order:
 *  1. Preferred backend (based on user preference + availability).
 *  2. If the preferred backend isn't ready, fall back to whatever IS ready.
 *     This handles the case where the preference is "builtin" but fts5 was
 *     never initialized (e.g. native loaded fine on startup), or vice-versa.
 *  3. If neither backend is ready → throw.
 */
export const openDatabase = async (filepath: string): Promise<IAsyncDatabase> => {
    // Try preferred backend first
    if (shouldUseNativeSqlite()) {
        return AsyncDatabase.open(filepath);
    }

    if (isFts5SqliteReady()) {
        return Fts5AsyncDatabase.open(filepath);
    }

    // Preferred backend not available — gracefully fall back to whatever IS ready.
    // This mirrors how audio/git tools work: the preference is advisory, not a hard gate.
    if (isNativeSqliteReady()) {
        captureEvent("tool_fallback_used", {
            tool: "sqlite",
            reason: "preferred_backend_unavailable",
            mode: getSqliteToolMode(),
        });
        return AsyncDatabase.open(filepath);
    }

    throw new Error(
        "No SQLite backend available. Neither the native binary nor the fts5-sql-bundle fallback is initialized.",
    );
};

/**
 * Check whether at least one SQLite backend is operational.
 * Used by toolsManager.checkTools() to determine overall sqlite availability.
 */
export const isDatabaseReady = (): boolean => {
    return isNativeSqliteReady() || isFts5SqliteReady();
};

/**
 * Check whether the currently active backend is the native one.
 * Reflects which backend `openDatabase()` would actually use right now,
 * accounting for the graceful fallback (preference is "builtin" but fts5
 * isn't loaded → native is used anyway).
 *
 * Used by SQLiteIndexManager to decide whether WAL-specific PRAGMAs
 * should be emitted or skipped.
 */
export const isUsingNativeBackend = (): boolean => {
    if (shouldUseNativeSqlite()) {
        return true;
    }
    // Preference says fts5, but is it actually available?
    if (isFts5SqliteReady()) {
        return false;
    }
    // Fts5 not ready — native will be used as graceful fallback
    return isNativeSqliteReady();
};
