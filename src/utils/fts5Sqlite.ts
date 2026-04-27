/**
 * fts5-sql-bundle (sql.js + FTS5) wrapper — provides the same IAsyncDatabase
 * interface as the native SQLite backend so that SQLiteIndexManager can run
 * on either engine interchangeably.
 *
 * Key differences from native:
 *  - The database lives entirely in WASM memory.  Writes are only persisted
 *    when `flush()` (or `close()`) is called, which serializes the in-memory
 *    DB via `db.export()` and writes the buffer to disk.
 *  - WAL mode is not supported.  PRAGMAs like `journal_mode = WAL` are
 *    silently accepted by SQLite inside WASM but have no real effect.
 *  - `configure()` is a no-op (no busyTimeout, trace, or profile support).
 *  - On `open()`, any orphaned WAL/SHM files are detected and deleted so
 *    SQLite inside WASM can open the main file cleanly.
 */

import * as fs from "fs";
import * as vscode from "vscode";
import type { IAsyncDatabase, RunResult } from "./sqliteTypes";

// ── fts5-sql-bundle types (mirrors the published index.d.ts) ────────────────

interface Fts5SqlJsStatic {
    Database: {
        new (): Fts5SqlJsDatabase;
        new (data: ArrayLike<number>): Fts5SqlJsDatabase;
    };
}

interface Fts5SqlJsDatabase {
    run(sql: string, params?: any[]): void;
    exec(sql: string, params?: any[]): Array<{ columns: string[]; values: any[][] }>;
    prepare(sql: string): Fts5SqlJsStatement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
    create_function(name: string, func: (...args: any[]) => any): void;
}

interface Fts5SqlJsStatement {
    bind(params?: any[]): boolean;
    step(): boolean;
    get(params?: any[]): any[];
    getColumnNames(): string[];
    getAsObject(params?: any[]): Record<string, any>;
    run(params?: any[]): void;
    reset(): void;
    freemem(): void;
    free(): void;
}

// ── Module state ─────────────────────────────────────────────────────────────

let sqlJsStatic: Fts5SqlJsStatic | null = null;

// ── Public init / readiness ──────────────────────────────────────────────────

/**
 * Initialize the fts5-sql-bundle WASM engine.
 * Must be called once before any Fts5AsyncDatabase operations.
 *
 * @param context  Extension context — used to resolve the WASM file path.
 */
export async function initFts5Sqlite(context: vscode.ExtensionContext): Promise<void> {
    if (sqlJsStatic) {
        console.log("[fts5Sqlite] Already initialized, skipping re-init");
        return;
    }

    console.log("[fts5Sqlite] Initializing fts5-sql-bundle WASM engine…");

    // fts5-sql-bundle exports { default, initSqlJs } — grab the default export
    // eslint-disable-next-line no-eval, @typescript-eslint/no-var-requires
    const fts5Module = eval("require")("fts5-sql-bundle");
    const initSqlJs: (opts?: { locateFile?: (file: string) => string }) => Promise<Fts5SqlJsStatic> =
        fts5Module.default ?? fts5Module.initSqlJs ?? fts5Module;

    const wasmPath = vscode.Uri.joinPath(
        context.extensionUri,
        "out",
        "node_modules",
        "fts5-sql-bundle",
        "dist",
        "sql-wasm.wasm",
    );

    sqlJsStatic = await initSqlJs({
        locateFile: (_file: string) => wasmPath.fsPath,
    });

    console.log("[fts5Sqlite] WASM engine initialized successfully");
}

/** Check whether the fts5-sql-bundle WASM engine has been initialized. */
export function isFts5SqliteReady(): boolean {
    return sqlJsStatic !== null;
}

// ── Fts5AsyncDatabase ────────────────────────────────────────────────────────

/**
 * IAsyncDatabase implementation backed by fts5-sql-bundle (sql.js + FTS5 WASM).
 *
 * All methods return Promises for API compatibility with the native backend
 * even though the underlying sql.js operations are synchronous.
 */
export class Fts5AsyncDatabase implements IAsyncDatabase {
    private db: Fts5SqlJsDatabase | null;
    private readonly filePath: string | null;
    private closed = false;

    /** Debounce timer for auto-persist after writes. */
    private persistTimer: NodeJS.Timeout | null = null;
    private static readonly PERSIST_DEBOUNCE_MS = 2_000;
    /** True when in-memory state has changed since the last persistToDisk(). */
    private dirty = false;

    private constructor(db: Fts5SqlJsDatabase, filePath: string | null) {
        this.db = db;
        this.filePath = filePath === ":memory:" ? null : filePath;
    }

    /**
     * Open (or create) a database file.
     * Use ":memory:" for an in-memory database (testing only).
     *
     * If orphaned WAL/SHM sidecar files exist from a previous native-sqlite
     * session, they are deleted so the WASM engine can open the main file
     * cleanly.  A warning is logged because uncommitted WAL data will be lost
     * (the caller — SQLiteIndexManager — handles this by detecting a stale
     * schema and triggering a rebuild from source files).
     */
    static async open(filepath: string): Promise<Fts5AsyncDatabase> {
        if (!sqlJsStatic) {
            throw new Error(
                "fts5-sql-bundle not initialized. Call initFts5Sqlite(context) first.",
            );
        }

        let db: Fts5SqlJsDatabase;

        if (filepath === ":memory:") {
            db = new sqlJsStatic.Database();
        } else {
            Fts5AsyncDatabase.cleanOrphanedWalFiles(filepath);

            if (fs.existsSync(filepath)) {
                const buffer = fs.readFileSync(filepath);
                if (buffer.length > 0) {
                    db = new sqlJsStatic.Database(new Uint8Array(buffer));
                } else {
                    // 0-byte file (e.g. leftover from a crash) — treat as fresh DB
                    console.warn(`[fts5Sqlite] Database file is 0 bytes, creating fresh database: ${filepath}`);
                    db = new sqlJsStatic.Database();
                }
            } else {
                db = new sqlJsStatic.Database();
            }
        }

        return new Fts5AsyncDatabase(db, filepath);
    }

    /**
     * Detect and remove orphaned WAL/SHM files left by the native backend.
     * sql.js cannot read WAL data — if the WAL is non-empty the main file
     * may be incomplete.  Callers will detect schema mismatches and rebuild.
     */
    private static cleanOrphanedWalFiles(filepath: string): void {
        const walPath = `${filepath}-wal`;
        const shmPath = `${filepath}-shm`;

        try {
            if (fs.existsSync(walPath)) {
                const stats = fs.statSync(walPath);
                if (stats.size > 0) {
                    console.warn(
                        `[fts5Sqlite] WAL file exists at ${walPath} (${stats.size} bytes). ` +
                        "sql.js cannot read WAL data — database may be stale and will be rebuilt.",
                    );
                }
                fs.unlinkSync(walPath);
            }
        } catch (err) {
            console.warn(`[fts5Sqlite] Could not remove WAL file: ${err}`);
        }

        try {
            if (fs.existsSync(shmPath)) {
                fs.unlinkSync(shmPath);
            }
        } catch (err) {
            console.warn(`[fts5Sqlite] Could not remove SHM file: ${err}`);
        }
    }

    // ── IAsyncDatabase implementation ────────────────────────────────────────

    async run(sql: string, params?: any[]): Promise<RunResult> {
        this.guardClosed();

        this.db!.run(sql, params ?? []);
        const changes = this.db!.getRowsModified();

        if (Fts5AsyncDatabase.isWriteStatement(sql)) {
            this.schedulePersist();
        }

        return { lastID: 0, changes };
    }

    async get<T = Record<string, any>>(
        sql: string,
        params?: any[],
    ): Promise<T | undefined> {
        this.guardClosed();

        const stmt = this.db!.prepare(sql);
        try {
            stmt.bind(params ?? []);
            const hasRow = stmt.step();
            if (!hasRow) return undefined;
            const row = stmt.getAsObject() as T;

            if (Fts5AsyncDatabase.isWriteStatement(sql)) {
                this.schedulePersist();
            }

            return row;
        } finally {
            stmt.free();
        }
    }

    async all<T = Record<string, any>>(
        sql: string,
        params?: any[],
    ): Promise<T[]> {
        this.guardClosed();

        const stmt = this.db!.prepare(sql);
        try {
            stmt.bind(params ?? []);
            const rows: T[] = [];
            while (stmt.step()) {
                rows.push(stmt.getAsObject() as T);
            }

            if (Fts5AsyncDatabase.isWriteStatement(sql)) {
                this.schedulePersist();
            }

            return rows;
        } finally {
            stmt.free();
        }
    }

    async exec(sql: string): Promise<void> {
        this.guardClosed();

        this.db!.exec(sql);

        if (Fts5AsyncDatabase.isWriteStatement(sql)) {
            this.schedulePersist();
        }
    }

    async close(): Promise<void> {
        if (this.closed) return;

        // Cancel any pending debounced persist — we'll do a final one below.
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }

        // Final persist while the db is still open (persistToDisk skips if closed).
        await this.persistToDisk();

        this.closed = true;
        this.db!.close();
        this.db = null;
    }

    configure(_option: string, _value: any): void {
        // No-op: sql.js has no busyTimeout, trace, or profile configuration.
    }

    async transaction<T>(fn: (db: IAsyncDatabase) => Promise<T>): Promise<T> {
        this.guardClosed();

        await this.run("BEGIN TRANSACTION");
        try {
            const result = await fn(this);
            await this.run("COMMIT");
            return result;
        } catch (err) {
            try {
                await this.run("ROLLBACK");
            } catch {
                // Swallow ROLLBACK errors — the original error is more important
            }
            throw err;
        }
    }

    async each<T = Record<string, any>>(
        sql: string,
        params: any[],
        rowCallback: (row: T) => void,
    ): Promise<number> {
        this.guardClosed();

        const stmt = this.db!.prepare(sql);
        try {
            stmt.bind(params);
            let count = 0;
            while (stmt.step()) {
                rowCallback(stmt.getAsObject() as T);
                count++;
            }
            return count;
        } finally {
            stmt.free();
        }
    }

    async loadExtension(_filepath: string): Promise<void> {
        throw new Error(
            "loadExtension() is not supported by the fts5-sql-bundle fallback. " +
            "FTS5 is compiled into the WASM binary.",
        );
    }

    /**
     * Serialize the in-memory database and write it to the file on disk.
     * This is the fts5-sql-bundle equivalent of a WAL checkpoint.
     */
    async flush(): Promise<void> {
        await this.persistToDisk();
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private guardClosed(): void {
        if (this.closed) {
            throw new Error("Database connection is closed");
        }
    }

    private schedulePersist(): void {
        if (!this.filePath) return;
        this.dirty = true;
        if (this.persistTimer) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(
            () => this.persistToDisk(),
            Fts5AsyncDatabase.PERSIST_DEBOUNCE_MS,
        );
    }

    private async persistToDisk(): Promise<void> {
        if (!this.filePath) return;
        // After close() has called db.close(), export() would throw.
        // close() does its own final persist before closing, so we can safely skip.
        if (this.closed) return;
        if (!this.dirty) return;

        try {
            const data = this.db!.export();
            await fs.promises.writeFile(this.filePath, Buffer.from(data));
            this.dirty = false;
        } catch (err) {
            console.error(`[fts5Sqlite] Failed to persist database to ${this.filePath}:`, err);
        }
    }

    private static isWriteStatement(sql: string): boolean {
        const trimmed = sql.trimStart().toUpperCase();
        return (
            trimmed.startsWith("INSERT") ||
            trimmed.startsWith("UPDATE") ||
            trimmed.startsWith("DELETE") ||
            trimmed.startsWith("CREATE") ||
            trimmed.startsWith("DROP") ||
            trimmed.startsWith("ALTER") ||
            trimmed.startsWith("BEGIN") ||
            trimmed.startsWith("COMMIT") ||
            trimmed.startsWith("PRAGMA")
        );
    }
}
