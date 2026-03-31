/**
 * Shared database abstraction types.
 *
 * Both the native SQLite backend (nativeSqlite.ts / AsyncDatabase) and the
 * WASM fallback (fts5Sqlite.ts / Fts5AsyncDatabase) implement IAsyncDatabase,
 * so SQLiteIndexManager and every other consumer can use either backend
 * interchangeably without knowing which engine is active.
 */

/** Result of an INSERT / UPDATE / DELETE operation. */
export interface RunResult {
    /** Row ID of the last inserted row. */
    lastID: number;
    /** Number of rows affected by the statement. */
    changes: number;
}

/**
 * Promise-based database interface implemented by both the native SQLite
 * backend and the fts5-sql-bundle (sql.js WASM) fallback.
 *
 * Every method mirrors the AsyncDatabase API from nativeSqlite.ts so that
 * switching backends requires zero changes in consuming code.
 */
export interface IAsyncDatabase {
    /** Execute an INSERT, UPDATE, DELETE, or DDL statement. */
    run(sql: string, params?: any[]): Promise<RunResult>;

    /** Fetch a single row. Returns undefined if no rows match. */
    get<T = Record<string, any>>(sql: string, params?: any[]): Promise<T | undefined>;

    /** Fetch all matching rows as an array. */
    all<T = Record<string, any>>(sql: string, params?: any[]): Promise<T[]>;

    /**
     * Execute one or more SQL statements (no parameters, no return values).
     * Useful for DDL, PRAGMA, or multi-statement scripts.
     */
    exec(sql: string): Promise<void>;

    /** Close the database connection. Double-close is a safe no-op. */
    close(): Promise<void>;

    /**
     * Configure database options (synchronous).
     * Native: supports "busyTimeout", "trace", "profile".
     * Fallback: safe no-op.
     */
    configure(option: string, value: any): void;

    /**
     * Execute a callback inside a BEGIN / COMMIT transaction.
     * If the callback throws, the transaction is rolled back.
     */
    transaction<T>(fn: (db: IAsyncDatabase) => Promise<T>): Promise<T>;

    /**
     * Iterate over rows one at a time (memory-efficient for large result sets).
     * The callback is called for each row; the promise resolves with the count.
     */
    each<T = Record<string, any>>(
        sql: string,
        params: any[],
        rowCallback: (row: T) => void,
    ): Promise<number>;

    /** Load a SQLite extension from a shared library file. */
    loadExtension(filepath: string): Promise<void>;

    /**
     * Flush any pending writes to disk.
     *
     * - **Native backend**: no-op (writes go through the OS page cache and WAL).
     * - **Fallback backend**: serializes the in-memory database via `db.export()`
     *   and writes the result to the database file.
     *
     * SQLiteIndexManager calls this wherever it would otherwise run a WAL
     * checkpoint, so both backends persist data through the same call sites.
     */
    flush(): Promise<void>;
}
