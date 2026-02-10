/**
 * Native SQLite wrapper — dynamically loads the prebuilt node_sqlite3.node binary
 * and applies the essential JS wrapper logic inline.
 *
 * Provides a Promise-based API that replaces the synchronous sql.js (fts5-sql-bundle) API.
 * Key benefit: file-based SQLite with incremental page writes instead of
 * serializing and rewriting the entire database on every save.
 *
 * Migration from sql.js patterns:
 *   - initSqlJs() + new SQL.Database()       → AsyncDatabase.open(filepath)
 *   - db.run(sql)                             → await db.run(sql)
 *   - stmt = db.prepare(sql); stmt.bind(p);
 *     while(stmt.step()) stmt.getAsObject();
 *     stmt.free();                            → await db.all(sql, params)
 *   - stmt.bind(p); stmt.step();
 *     stmt.getAsObject(); stmt.free();        → await db.get(sql, params)
 *   - db.export() + writeFile()               → Not needed (writes to disk automatically)
 *   - db.getRowsModified()                    → result.changes from run()
 *   - db.create_function()                    → Not supported; compute in JS instead
 */

import { EventEmitter } from "events";

// ── Types ────────────────────────────────────────────────────────────────────

/** Result of an INSERT/UPDATE/DELETE operation */
export interface RunResult {
    /** Row ID of the last inserted row */
    lastID: number;
    /** Number of rows affected by the statement */
    changes: number;
}

/**
 * The raw native binding exported by node_sqlite3.node.
 * This is what `require('node_sqlite3.node')` returns.
 */
interface NativeBinding {
    Database: new (filename: string, mode: number, callback: (err: Error | null) => void) => NativeDatabase;
    Statement: new (db: NativeDatabase, sql: string, errBack?: (err: Error) => void) => NativeStatement;
    OPEN_READONLY: number;
    OPEN_READWRITE: number;
    OPEN_CREATE: number;
    BUSY: number;
    LOCKED: number;
}

/** Raw native Database — only has C++-level methods */
interface NativeDatabase {
    close(callback: (err: Error | null) => void): void;
    exec(sql: string, callback: (err: Error | null) => void): void;
    configure(option: string, value: any): void;
    loadExtension(filepath: string, callback: (err: Error | null) => void): void;
    // The following methods are ADDED by our wrapper below:
    run?(sql: string, ...args: any[]): NativeDatabase;
    get?(sql: string, ...args: any[]): NativeDatabase;
    all?(sql: string, ...args: any[]): NativeDatabase;
    each?(sql: string, ...args: any[]): NativeDatabase;
    prepare?(sql: string, ...args: any[]): NativeStatement;
}

/** Raw native Statement */
interface NativeStatement {
    bind(...args: any[]): NativeStatement;
    run(...args: any[]): NativeStatement;
    get(...args: any[]): NativeStatement;
    all(...args: any[]): NativeStatement;
    each(...args: any[]): NativeStatement;
    reset(callback?: (err: Error | null) => void): NativeStatement;
    finalize(callback?: (err: Error | null) => void): void;
}

/** The wrapped Database type (with convenience methods added) */
interface WrappedDatabase extends NativeDatabase {
    run(sql: string, ...args: any[]): WrappedDatabase;
    get(sql: string, ...args: any[]): WrappedDatabase;
    all(sql: string, ...args: any[]): WrappedDatabase;
    each(sql: string, ...args: any[]): WrappedDatabase;
    prepare(sql: string, ...args: any[]): NativeStatement;
}

// ── Module-level state ───────────────────────────────────────────────────────

/** The loaded native binding (set by initNativeSqlite) */
let binding: NativeBinding | null = null;

/** Whether the wrapper methods have been applied to Database/Statement prototypes */
let wrapperApplied = false;

// ── Wrapper logic (equivalent to sqlite3.js from node-sqlite3) ──────────────

/**
 * Create a convenience method on Database.prototype that:
 *  1. Creates a Statement from the SQL
 *  2. Calls the Statement method with params
 *  3. Finalizes the Statement
 *
 * This replicates the `normalizeMethod` pattern from node-sqlite3's sqlite3.js.
 */
function normalizeMethod(
    fn: (statement: NativeStatement, params: any[]) => any
): (this: any, sql: string, ...args: any[]) => any {
    return function (this: any, sql: string, ...rest: any[]) {
        let errBack: ((err: Error) => void) | undefined;
        const args = rest.slice();

        if (typeof args[args.length - 1] === "function") {
            const callback = args[args.length - 1];
            errBack = function (err: Error) {
                if (err) {
                    callback(err);
                }
            };
        }

        const statement = new binding!.Statement(this, sql, errBack);
        return fn.call(this, statement, args);
    };
}

/**
 * Copy prototype properties from source to target (simple inheritance).
 */
function inherits(target: any, source: any): void {
    for (const k in source.prototype) {
        target.prototype[k] = source.prototype[k];
    }
}

/**
 * Apply the JS wrapper methods to the native Database and Statement prototypes.
 * This must be called once after loading the binding.
 */
function applyWrapper(): void {
    if (wrapperApplied || !binding) {
        return;
    }

    const Database = binding.Database;
    const Statement = binding.Statement;

    // Add EventEmitter capabilities
    inherits(Database, EventEmitter);
    inherits(Statement, EventEmitter);

    // Database#prepare(sql, [bind1, bind2, ...], [callback])
    Database.prototype.prepare = normalizeMethod(function (statement: NativeStatement, params: any[]) {
        return params.length
            ? statement.bind(...params)
            : statement;
    });

    // Database#run(sql, [bind1, bind2, ...], [callback])
    Database.prototype.run = normalizeMethod(function (this: any, statement: NativeStatement, params: any[]) {
        statement.run(...params).finalize();
        return this;
    });

    // Database#get(sql, [bind1, bind2, ...], [callback])
    Database.prototype.get = normalizeMethod(function (this: any, statement: NativeStatement, params: any[]) {
        statement.get(...params).finalize();
        return this;
    });

    // Database#all(sql, [bind1, bind2, ...], [callback])
    Database.prototype.all = normalizeMethod(function (this: any, statement: NativeStatement, params: any[]) {
        statement.all(...params).finalize();
        return this;
    });

    // Database#each(sql, [bind1, bind2, ...], [callback], [complete])
    Database.prototype.each = normalizeMethod(function (this: any, statement: NativeStatement, params: any[]) {
        statement.each(...params).finalize();
        return this;
    });

    // Support event-based configure for trace/profile/change
    const supportedEvents = ["trace", "profile", "change"];

    Database.prototype.addListener = Database.prototype.on = function (type: string, ...args: any[]) {
        const val = EventEmitter.prototype.addListener.apply(this, [type, ...args] as any);
        if (supportedEvents.indexOf(type) >= 0) {
            this.configure(type, true);
        }
        return val;
    };

    Database.prototype.removeListener = function (type: string, ...args: any[]) {
        const val = EventEmitter.prototype.removeListener.apply(this, [type, ...args] as any);
        if (!(this as any)._events[type]) {
            if (supportedEvents.indexOf(type) >= 0) {
                this.configure(type, false);
            }
        }
        return val;
    };

    Database.prototype.removeAllListeners = function (type: string) {
        const val = EventEmitter.prototype.removeAllListeners.apply(this, [type] as any);
        if (supportedEvents.indexOf(type) >= 0) {
            this.configure(type, false);
        }
        return val;
    };

    wrapperApplied = true;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the native SQLite module by loading the .node binary.
 * Must be called once on startup BEFORE any AsyncDatabase operations.
 *
 * @param binaryPath - Absolute path to the node_sqlite3.node file
 */
export function initNativeSqlite(binaryPath: string): void {
    if (binding) {
        console.log("[SQLite] Native binding already loaded, skipping re-init");
        return;
    }

    console.log(`[SQLite] Loading native binding from: ${binaryPath}`);

    // Use the real Node.js require (not webpack's __webpack_require__)
    // to dynamically load the .node native addon at runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, no-eval
    const nodeRequire = eval("require") as NodeRequire;
    const loadedBinding = nodeRequire(binaryPath) as NativeBinding;

    if (!loadedBinding || !loadedBinding.Database) {
        throw new Error(
            `Failed to load SQLite native binding from ${binaryPath}: ` +
            `binding.Database is ${typeof loadedBinding?.Database}`
        );
    }

    binding = loadedBinding;
    applyWrapper();

    console.log("[SQLite] Native binding loaded and wrapper applied successfully");
}

/**
 * Check whether the native SQLite module has been initialized.
 */
export function isNativeSqliteReady(): boolean {
    return binding !== null && wrapperApplied;
}

/**
 * Promise-based wrapper around the native SQLite Database.
 * All methods return Promises instead of using callbacks.
 */
export class AsyncDatabase {
    private db: WrappedDatabase;

    private constructor(db: WrappedDatabase) {
        this.db = db;
    }

    /**
     * Open a database file. Creates the file if it doesn't exist.
     * Use ":memory:" for an in-memory database (testing only).
     *
     * @throws Error if initNativeSqlite() hasn't been called yet
     */
    static open(
        filepath: string,
        mode?: number
    ): Promise<AsyncDatabase> {
        if (!binding) {
            throw new Error(
                "SQLite native module not initialized. Call initNativeSqlite(binaryPath) first."
            );
        }

        return new Promise((resolve, reject) => {
            const effectiveMode =
                mode ?? (binding!.OPEN_READWRITE | binding!.OPEN_CREATE);
            const db = new binding!.Database(
                filepath,
                effectiveMode,
                (err: Error | null) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(new AsyncDatabase(db as unknown as WrappedDatabase));
                    }
                }
            );
        });
    }

    /**
     * Execute an INSERT, UPDATE, DELETE, or DDL statement.
     * Returns { lastID, changes }.
     */
    run(sql: string, params?: any[]): Promise<RunResult> {
        return new Promise((resolve, reject) => {
            this.db.run(
                sql,
                params ?? [],
                function (this: any, err: Error | null) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ lastID: this.lastID, changes: this.changes });
                    }
                }
            );
        });
    }

    /**
     * Fetch a single row. Returns undefined if no rows match.
     */
    get<T = Record<string, any>>(
        sql: string,
        params?: any[]
    ): Promise<T | undefined> {
        return new Promise((resolve, reject) => {
            this.db.get(
                sql,
                params ?? [],
                (err: Error | null, row: any) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row as T | undefined);
                    }
                }
            );
        });
    }

    /**
     * Fetch all matching rows as an array.
     */
    all<T = Record<string, any>>(
        sql: string,
        params?: any[]
    ): Promise<T[]> {
        return new Promise((resolve, reject) => {
            this.db.all(
                sql,
                params ?? [],
                (err: Error | null, rows: any[]) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve((rows || []) as T[]);
                    }
                }
            );
        });
    }

    /**
     * Execute one or more SQL statements (no parameters, no return values).
     * Useful for DDL, PRAGMA, or multi-statement scripts.
     */
    exec(sql: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.exec(sql, (err: Error | null) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Close the database connection.
     */
    close(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.close((err: Error | null) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Configure database options.
     * Commonly used: configure("busyTimeout", 5000)
     */
    configure(option: string, value: any): void {
        this.db.configure(option, value);
    }

    /**
     * Iterate over rows one at a time (memory-efficient for large result sets).
     * The callback is called for each row, and the promise resolves with the total count.
     */
    each<T = Record<string, any>>(
        sql: string,
        params: any[],
        rowCallback: (row: T) => void
    ): Promise<number> {
        return new Promise((resolve, reject) => {
            this.db.each(
                sql,
                params,
                (err: Error | null, row: any) => {
                    if (err) {
                        reject(err);
                    } else {
                        rowCallback(row as T);
                    }
                },
                (err: Error | null, count: number) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(count);
                    }
                }
            );
        });
    }

    /**
     * Load a SQLite extension from a shared library file.
     */
    loadExtension(filepath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.loadExtension(filepath, (err: Error | null) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Access the underlying raw Database instance.
     * Use only when the wrapper API is insufficient.
     */
    get raw(): WrappedDatabase {
        return this.db;
    }
}
