import * as vscode from "vscode";
import { AsyncDatabase } from "../../../../utils/nativeSqlite";
import { createHash } from "crypto";
import { TranslationPair, MinimalCellResult } from "../../../../../types";
import { updateSplashScreenTimings } from "../../../../providers/SplashScreen/register";
import { ActivationTiming } from "../../../../extension";
import { debounce } from "lodash";
import { EditMapUtils } from "../../../../utils/editMapUtils";

const INDEX_DB_PATH = [".project", "indexes.sqlite"];

const DEBUG_MODE = false;
const debug = (message: string, ...args: any[]) => {
    DEBUG_MODE && console.log(`[SQLiteIndex] ${message}`, ...args);
};

// Schema version for migrations
export const CURRENT_SCHEMA_VERSION = 12; // Added milestone_index column for O(1) milestone lookup

export class SQLiteIndexManager {
    private db: AsyncDatabase | null = null;
    private dbPath: string | null = null;
    private progressTimings: ActivationTiming[] = [];
    private currentProgressTimer: NodeJS.Timeout | null = null;
    private currentProgressStartTime: number | null = null;
    private currentProgressName: string | null = null;
    private enableRealtimeProgress: boolean = true;
    /** Mutex that serializes access to SQLite transactions (SQLite only allows one at a time). */
    private transactionLock: Promise<void> = Promise.resolve();

    private trackProgress(step: string, stepStartTime: number): number {
        const stepEndTime = globalThis.performance.now();
        const duration = stepEndTime - stepStartTime; // Duration of THIS step only

        this.progressTimings.push({ step, duration, startTime: stepStartTime });
        debug(`${step}: ${duration.toFixed(2)}ms`);

        // Stop any previous real-time timer
        if (this.currentProgressTimer) {
            clearInterval(this.currentProgressTimer);
            this.currentProgressTimer = null;
        }

        // Update splash screen with database creation progress
        updateSplashScreenTimings(this.progressTimings);

        return stepEndTime; // Return the END time for the next step to use as its start time
    }

    private startRealtimeProgress(stepName: string): number {
        const startTime = globalThis.performance.now();

        // Stop any previous timer
        if (this.currentProgressTimer) {
            clearInterval(this.currentProgressTimer);
        }

        this.currentProgressName = stepName;
        this.currentProgressStartTime = startTime;

        // Add initial timing entry
        this.progressTimings.push({ step: stepName, duration: 0, startTime });
        updateSplashScreenTimings(this.progressTimings);

        // Start real-time updates only if enabled (to avoid performance issues)
        if (this.enableRealtimeProgress) {
            this.currentProgressTimer = setInterval(() => {
                if (this.currentProgressStartTime && this.currentProgressName) {
                    const currentDuration = globalThis.performance.now() - this.currentProgressStartTime;

                    // Update the last timing entry with current duration
                    const lastIndex = this.progressTimings.length - 1;
                    if (lastIndex >= 0 && this.progressTimings[lastIndex].step === this.currentProgressName) {
                        this.progressTimings[lastIndex].duration = currentDuration;
                        // Only update splash screen every 500ms to avoid performance issues
                        updateSplashScreenTimings(this.progressTimings);
                    }
                }
            }, 500) as unknown as NodeJS.Timeout;
        }

        return startTime;
    }

    private finishRealtimeProgress(): number {
        if (this.currentProgressTimer) {
            clearInterval(this.currentProgressTimer);
            this.currentProgressTimer = null;
        }

        if (this.currentProgressStartTime && this.currentProgressName) {
            const finalDuration = globalThis.performance.now() - this.currentProgressStartTime;

            // Update the last timing entry with final duration
            const lastIndex = this.progressTimings.length - 1;
            if (lastIndex >= 0 && this.progressTimings[lastIndex].step === this.currentProgressName) {
                this.progressTimings[lastIndex].duration = finalDuration;
                updateSplashScreenTimings(this.progressTimings);
                debug(`${this.currentProgressName}: ${finalDuration.toFixed(2)}ms`);
            }
        }

        this.currentProgressName = null;
        this.currentProgressStartTime = null;

        return globalThis.performance.now();
    }

    // Method to disable real-time progress updates for better performance
    public disableRealtimeProgress(): void {
        this.enableRealtimeProgress = false;
        if (this.currentProgressTimer) {
            clearInterval(this.currentProgressTimer);
            this.currentProgressTimer = null;
        }
    }

    // Public method to add progress entries from external functions
    public addProgressEntry(step: string, duration: number, startTime: number): void {
        this.progressTimings.push({ step, duration, startTime });
        updateSplashScreenTimings(this.progressTimings);
        debug(`[Index] ${step}: ${duration.toFixed(2)}ms`);
    }

    async initialize(context: vscode.ExtensionContext): Promise<void> {
        const initStart = globalThis.performance.now();
        let stepStart = initStart;

        // No WASM initialization needed - native SQLite binary is downloaded on first run
        stepStart = this.trackProgress("AI initializing learning engine", stepStart);
        stepStart = this.trackProgress("AI learning engine ready", stepStart);

        // Load or create database
        await this.loadOrCreateDatabase();

        this.trackProgress("AI learning capabilities ready", initStart);
    }

    private async loadOrCreateDatabase(): Promise<void> {
        const loadStart = globalThis.performance.now();
        let stepStart = loadStart;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        const dbUri = vscode.Uri.joinPath(workspaceFolder.uri, ...INDEX_DB_PATH);
        this.dbPath = dbUri.fsPath;

        // Ensure the .project directory exists
        const projectDir = vscode.Uri.joinPath(workspaceFolder.uri, ".project");
        try {
            await vscode.workspace.fs.createDirectory(projectDir);
        } catch {
            // Directory might already exist
        }

        stepStart = this.trackProgress("Check for existing database", stepStart);

        // Check if the database file exists and is valid
        let dbExists = false;
        try {
            await vscode.workspace.fs.stat(dbUri);
            dbExists = true;
        } catch {
            dbExists = false;
        }

        if (dbExists) {
            try {
                stepStart = this.trackProgress("AI accessing previous learning", stepStart);

                // Open the existing file directly - no buffer loading needed
                this.db = await AsyncDatabase.open(this.dbPath);

                // Apply production PRAGMAs on every open (not just schema creation).
                // WAL is persisted in the file, but all other PRAGMAs are per-connection.
                await this.applyProductionPragmas();

                stepStart = this.trackProgress("Parse database structure", stepStart);

                debug("Loaded existing index database");

                // Run a quick integrity check to catch corruption early
                await this.quickIntegrityCheck();

                // Ensure schema is up to date
                await this.ensureSchema();
            } catch (error) {
                stepStart = this.trackProgress("Handle database error", stepStart);

                const errorMessage = error instanceof Error ? error.message : String(error);
                const isCorruption = errorMessage.includes("database disk image is malformed") ||
                    errorMessage.includes("file is not a database") ||
                    errorMessage.includes("database is locked") ||
                    errorMessage.includes("database corruption");

                if (isCorruption) {
                    debug(`[SQLiteIndex] Database corruption detected: ${errorMessage}`);
                    debug("[SQLiteIndex] Deleting corrupt database and creating new one");

                    // Close the potentially corrupted connection
                    if (this.db) {
                        try { await this.db.close(); } catch { /* ignore */ }
                        this.db = null;
                    }

                    try {
                        await vscode.workspace.fs.delete(dbUri);
                        stepStart = this.trackProgress("Delete corrupted database", stepStart);
                    } catch (deleteError) {
                        debug("[SQLiteIndex] Could not delete corrupted database file:", deleteError);
                    }
                }

                // Create a fresh database
                stepStart = this.trackProgress("AI preparing fresh learning space", stepStart);
                debug("Creating new index database");
                this.db = await AsyncDatabase.open(this.dbPath);
                await this.applyProductionPragmas();

                await this.createSchema();

                if (!(await this.validateSchemaIntegrity())) {
                    throw new Error(`Schema validation failed after creation for version ${CURRENT_SCHEMA_VERSION} - database may be corrupted`);
                }

                await this.setSchemaVersion(CURRENT_SCHEMA_VERSION);
            }
        } else {
            // No existing database - create a new one
            stepStart = this.trackProgress("AI preparing fresh learning space", stepStart);
            debug("Creating new index database");
            this.db = await AsyncDatabase.open(this.dbPath);
            await this.applyProductionPragmas();

            await this.createSchema();

            if (!(await this.validateSchemaIntegrity())) {
                throw new Error(`Schema validation failed after creation for version ${CURRENT_SCHEMA_VERSION} - database may be corrupted`);
            }

            await this.setSchemaVersion(CURRENT_SCHEMA_VERSION);
        }

        this.trackProgress("AI learning space ready", loadStart);
    }

    /**
     * Apply production-grade PRAGMAs to every database connection.
     * WAL mode is persisted in the file, but all other PRAGMAs are per-connection
     * and must be re-applied every time the database is opened.
     */
    private async applyProductionPragmas(): Promise<void> {
        if (!this.db) return;

        // WAL mode — best for read-heavy workloads with occasional writes.
        // Persisted in the file, but safe to re-issue (no-op if already WAL).
        await this.db.exec("PRAGMA journal_mode = WAL");

        // synchronous=NORMAL is safe with WAL (data survives process crashes;
        // only an OS crash can lose the most recent transaction).
        // Default is FULL which doubles fsync overhead for negligible safety gain with WAL.
        await this.db.exec("PRAGMA synchronous = NORMAL");

        // 8 MB page cache — covers typical hot working set for 1500+ cell documents
        await this.db.exec("PRAGMA cache_size = -8000");

        // Store temp tables and indexes in memory (faster sorts / GROUP BY)
        await this.db.exec("PRAGMA temp_store = MEMORY");

        // Enable foreign key enforcement
        await this.db.exec("PRAGMA foreign_keys = ON");

        // Busy timeout: wait up to 5 seconds for locks instead of failing immediately.
        // Prevents SQLITE_BUSY when another connection/process touches the file.
        this.db.configure("busyTimeout", 5000);

        debug("[SQLiteIndex] Production PRAGMAs applied (WAL, sync=NORMAL, cache=8MB, busyTimeout=5s)");
    }

    /**
     * Run a lightweight integrity check on startup.
     * PRAGMA quick_check is much faster than full integrity_check (~100ms vs seconds)
     * and catches the most common corruption patterns (page-level checksums, freelist).
     * If corruption is detected, the database file is deleted so the caller can recreate it.
     */
    private async quickIntegrityCheck(): Promise<void> {
        if (!this.db) return;

        try {
            const result = await this.db.get<{ integrity_check: string }>(
                "PRAGMA quick_check(1)"
            );
            if (result && result.integrity_check !== "ok") {
                console.error(`[SQLiteIndex] Integrity check failed: ${result.integrity_check}`);
                throw new Error(`database corruption detected by quick_check: ${result.integrity_check}`);
            }
            debug("[SQLiteIndex] Quick integrity check passed");
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            // If this is our own corruption error or any DB error, let the caller's
            // corruption handler take over (it will delete + recreate)
            throw new Error(`database corruption: ${msg}`);
        }
    }

    private async createSchema(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        const schemaStart = globalThis.performance.now();

        // Temporarily override PRAGMAs for fast bulk creation (OUTSIDE of transaction)
        debug("Optimizing database settings for fast creation...");
        await this.db.exec("PRAGMA synchronous = OFF");        // Disable fsync for speed
        await this.db.exec("PRAGMA journal_mode = MEMORY");     // Use memory journal
        await this.db.exec("PRAGMA temp_store = MEMORY");       // Store temp data in memory
        await this.db.exec("PRAGMA cache_size = -64000");       // 64MB cache
        await this.db.exec("PRAGMA foreign_keys = OFF");        // Disable FK checks during creation

        // Batch all schema creation in a single transaction for massive speedup
        await this.runInTransaction(async () => {
            // Create all tables in batch
            debug("Creating database tables...");

            await this.db!.exec(`
                CREATE TABLE IF NOT EXISTS sync_metadata (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_path TEXT NOT NULL UNIQUE,
                    file_type TEXT NOT NULL CHECK(file_type IN ('source', 'codex')),
                    content_hash TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    last_modified_ms INTEGER NOT NULL,
                    last_synced_ms INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
                    git_commit_hash TEXT,
                    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
                );

                CREATE TABLE IF NOT EXISTS files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_path TEXT NOT NULL UNIQUE,
                    file_type TEXT NOT NULL CHECK(file_type IN ('source', 'codex')),
                    last_modified_ms INTEGER NOT NULL,
                    content_hash TEXT NOT NULL,
                    total_cells INTEGER DEFAULT 0,
                    total_words INTEGER DEFAULT 0,
                    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
                );

                CREATE TABLE IF NOT EXISTS cells (
                    cell_id TEXT PRIMARY KEY,
                    cell_type TEXT,
                    s_file_id INTEGER,
                    s_content TEXT,
                    s_raw_content_hash TEXT,
                    s_line_number INTEGER,
                    s_word_count INTEGER DEFAULT 0,
                    s_raw_content TEXT,
                    s_created_at INTEGER,
                    s_updated_at INTEGER,
                    t_file_id INTEGER,
                    t_content TEXT,
                    t_raw_content_hash TEXT,
                    t_line_number INTEGER,
                    t_word_count INTEGER DEFAULT 0,
                    t_raw_content TEXT,
                    t_created_at INTEGER,
                    t_current_edit_timestamp INTEGER,
                    t_validation_count INTEGER DEFAULT 0,
                    t_validated_by TEXT,
                    t_is_fully_validated BOOLEAN DEFAULT FALSE,
                    t_audio_validation_count INTEGER DEFAULT 0,
                    t_audio_validated_by TEXT,
                    t_audio_is_fully_validated BOOLEAN DEFAULT FALSE,
                    milestone_index INTEGER,
                    FOREIGN KEY (s_file_id) REFERENCES files(id) ON DELETE SET NULL,
                    FOREIGN KEY (t_file_id) REFERENCES files(id) ON DELETE SET NULL
                );

                CREATE TABLE IF NOT EXISTS words (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    word TEXT NOT NULL,
                    cell_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    frequency INTEGER DEFAULT 1,
                    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                    FOREIGN KEY (cell_id) REFERENCES cells(cell_id) ON DELETE CASCADE
                );

                CREATE VIRTUAL TABLE IF NOT EXISTS cells_fts USING fts5(
                    cell_id,
                    content,
                    raw_content,
                    content_type,
                    tokenize='porter unicode61'
                );
            `);
        });

        debug("Creating database indexes (deferred)...");
        await this.runInTransaction(async () => {
            await this.db!.exec(`
                CREATE INDEX IF NOT EXISTS idx_sync_metadata_path ON sync_metadata(file_path);
                CREATE INDEX IF NOT EXISTS idx_files_path ON files(file_path);
                CREATE INDEX IF NOT EXISTS idx_cells_s_file_id ON cells(s_file_id);
                CREATE INDEX IF NOT EXISTS idx_cells_t_file_id ON cells(t_file_id);
                CREATE INDEX IF NOT EXISTS idx_cells_milestone_index ON cells(milestone_index);
            `);
        });

        debug("Creating database triggers...");
        // Create triggers in batch - note: each trigger must be a separate exec() since
        // SQLite's exec() processes one statement at a time for triggers with BEGIN/END
        await this.runInTransaction(async () => {
            await this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS update_sync_metadata_timestamp 
                AFTER UPDATE ON sync_metadata
                BEGIN
                    UPDATE sync_metadata SET updated_at = strftime('%s', 'now') * 1000 
                    WHERE id = NEW.id;
                END
            `);
            await this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS update_files_timestamp 
                AFTER UPDATE ON files
                BEGIN
                    UPDATE files SET updated_at = strftime('%s', 'now') * 1000 
                    WHERE id = NEW.id;
                END
            `);
            await this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS update_cells_s_timestamp 
                AFTER UPDATE OF s_content, s_raw_content ON cells
                BEGIN
                    UPDATE cells SET s_updated_at = strftime('%s', 'now') * 1000 
                    WHERE cell_id = NEW.cell_id;
                END
            `);
            // Target timestamp trigger removed - timestamps now handled in application logic
            await this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_source_insert 
                AFTER INSERT ON cells
                WHEN NEW.s_content IS NOT NULL
                BEGIN
                    INSERT INTO cells_fts(cell_id, content, raw_content, content_type) 
                    VALUES (NEW.cell_id, NEW.s_content, COALESCE(NEW.s_raw_content, NEW.s_content), 'source');
                END
            `);
            await this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_target_insert 
                AFTER INSERT ON cells
                WHEN NEW.t_content IS NOT NULL
                BEGIN
                    INSERT INTO cells_fts(cell_id, content, raw_content, content_type) 
                    VALUES (NEW.cell_id, NEW.t_content, COALESCE(NEW.t_raw_content, NEW.t_content), 'target');
                END
            `);
            await this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_source_update 
                AFTER UPDATE OF s_content, s_raw_content ON cells
                WHEN NEW.s_content IS NOT NULL
                BEGIN
                    INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type) 
                    VALUES (NEW.cell_id, NEW.s_content, COALESCE(NEW.s_raw_content, NEW.s_content), 'source');
                END
            `);
            await this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_target_update 
                AFTER UPDATE OF t_content, t_raw_content ON cells
                WHEN NEW.t_content IS NOT NULL
                BEGIN
                    INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type) 
                    VALUES (NEW.cell_id, NEW.t_content, COALESCE(NEW.t_raw_content, NEW.t_content), 'target');
                END
            `);
            await this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_delete 
                AFTER DELETE ON cells
                BEGIN
                    DELETE FROM cells_fts WHERE cell_id = OLD.cell_id;
                END
            `);
        });

        // Restore normal database settings for production use (OUTSIDE of transaction)
        debug("Restoring production database settings...");
        await this.db.exec("PRAGMA synchronous = NORMAL");      // Restore safe sync mode
        await this.db.exec("PRAGMA journal_mode = WAL");        // Use WAL mode for better concurrency
        await this.db.exec("PRAGMA foreign_keys = ON");         // Re-enable foreign key constraints
        await this.db.exec("PRAGMA cache_size = -8000");        // Reasonable cache size (8MB)

        const schemaEndTime = globalThis.performance.now();
        const totalTime = schemaEndTime - schemaStart;
        debug(`Fast schema creation completed in ${totalTime.toFixed(2)}ms`);

        // Single progress update at the end
        this.trackProgress("Optimized Schema Creation Complete", schemaStart);
    }

    /**
     * Create remaining indexes after data insertion for better performance
     */
    async createDeferredIndexes(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        debug("Creating deferred indexes for optimal performance...");
        const indexStart = globalThis.performance.now();

        await this.runInTransaction(async () => {
            await this.db!.exec(`
                CREATE INDEX IF NOT EXISTS idx_sync_metadata_hash ON sync_metadata(content_hash);
                CREATE INDEX IF NOT EXISTS idx_sync_metadata_modified ON sync_metadata(last_modified_ms);
                CREATE INDEX IF NOT EXISTS idx_cells_s_content_hash ON cells(s_raw_content_hash);
                CREATE INDEX IF NOT EXISTS idx_cells_t_content_hash ON cells(t_raw_content_hash);
                CREATE INDEX IF NOT EXISTS idx_cells_t_is_fully_validated ON cells(t_is_fully_validated);
                CREATE INDEX IF NOT EXISTS idx_cells_t_current_edit_timestamp ON cells(t_current_edit_timestamp);
                CREATE INDEX IF NOT EXISTS idx_cells_t_validation_count ON cells(t_validation_count);
                CREATE INDEX IF NOT EXISTS idx_cells_t_audio_is_fully_validated ON cells(t_audio_is_fully_validated);
                CREATE INDEX IF NOT EXISTS idx_cells_t_audio_validation_count ON cells(t_audio_validation_count);
                CREATE INDEX IF NOT EXISTS idx_words_word ON words(word);
                CREATE INDEX IF NOT EXISTS idx_words_cell_id ON words(cell_id);
            `);

            // Translation pairs indexes removed in schema v8 - table no longer exists
        });

        const indexEndTime = globalThis.performance.now();
        debug(`Deferred indexes created in ${(indexEndTime - indexStart).toFixed(2)}ms`);
    }

    private async ensureSchema(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        const ensureStart = globalThis.performance.now();
        let stepStart = ensureStart;

        try {
            // Check current schema version
            stepStart = this.trackProgress("Check database schema version", stepStart);
            const currentVersion = await this.getSchemaVersion();
            debug(`Current schema version: ${currentVersion}`);



            if (currentVersion === 0) {
                // Scenario 1: No schema exists - create fresh schema
                stepStart = this.trackProgress("AI organizing learning structure", stepStart);
                debug("Setting up new database with latest schema");
                await this.createSchema();

                // Validate schema before setting version to ensure reliability
                if (!(await this.validateSchemaIntegrity())) {
                    throw new Error(`Schema validation failed after creation for version ${CURRENT_SCHEMA_VERSION} - database may be corrupted`);
                }

                await this.setSchemaVersion(CURRENT_SCHEMA_VERSION);
                this.trackProgress("✨ AI learning structure organized", stepStart);
                debug(`New database created with schema version ${CURRENT_SCHEMA_VERSION}`);
            } else if (currentVersion !== CURRENT_SCHEMA_VERSION) {
                // Scenario 2: ANY version mismatch (ahead, behind, or different) - ALWAYS recreate everything
                // No partial migrations - we're senior database engineers who don't mess with bad/partial databases!
                stepStart = this.trackProgress("Handle schema version mismatch", stepStart);
                debug(`Database schema version ${currentVersion} does not match code version ${CURRENT_SCHEMA_VERSION}`);
                debug("FULL RECREATION: No partial migrations - deleting and recreating database from scratch for maximum reliability");

                // Log schema recreation to console instead of showing to user
                debug(`[SQLiteIndex] 🔄 AI updating database schema (v${currentVersion} → v${CURRENT_SCHEMA_VERSION}). Recreating for reliability...`);

                // CRITICAL: Delete the database file completely and recreate from scratch
                // This handles ALL cases: old schemas, corrupted databases, future schema versions, etc.
                await this.deleteDatabaseFile();

                // Recreate the database with the current schema (version 8)
                await this.recreateDatabase();

                this.trackProgress("Database complete recreation finished", stepStart);
                debug(`Database completely recreated with schema version ${CURRENT_SCHEMA_VERSION} - no partial migrations used`);
            } else {
                // Scenario 3: Correct version - load normally
                stepStart = this.trackProgress("Verify database schema", stepStart);
                debug(`Schema is up to date (version ${currentVersion})`);

                // Schema is current - no additional checks needed
            }

            this.trackProgress("Database Schema Setup Complete", ensureStart);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isCorruption = errorMessage.includes("database disk image is malformed") ||
                errorMessage.includes("file is not a database") ||
                errorMessage.includes("database is locked") ||
                errorMessage.includes("database corruption");

            if (isCorruption) {
                console.error(`[SQLiteIndex] Database corruption detected during schema operations: ${errorMessage}`);
                debug("[SQLiteIndex] Recreating corrupted database");
                stepStart = this.trackProgress("Recreate corrupted database", stepStart);

                // Force recreate the database
                if (this.db) {
                    try { await this.db.close(); } catch { /* ignore */ }
                }
                if (this.dbPath) {
                    try { await vscode.workspace.fs.delete(vscode.Uri.file(this.dbPath)); } catch { /* ignore */ }
                    this.db = await AsyncDatabase.open(this.dbPath);
                    await this.applyProductionPragmas();
                } else {
                    throw new Error("Database path not set");
                }
                await this.createSchema();

                if (!(await this.validateSchemaIntegrity())) {
                    throw new Error(`Schema validation failed after corruption recovery for version ${CURRENT_SCHEMA_VERSION} - database may be corrupted`);
                }

                await this.setSchemaVersion(CURRENT_SCHEMA_VERSION);

                this.trackProgress("Database corruption recovery complete", stepStart);
                debug("Successfully recreated database after corruption");
            } else {
                // Re-throw non-corruption errors
                throw error;
            }
        }
    }

    private async recreateDatabase(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        debug("Dropping all existing tables...");

        // Get all table names first
        const tableRows = await this.db.all<{ name: string }>(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `);
        const tableNames = tableRows.map(r => r.name);

        // Drop all tables in a transaction
        await this.runInTransaction(async () => {
            if (tableNames.includes('cells_fts')) {
                await this.db!.run("DROP TABLE IF EXISTS cells_fts");
            }
            for (const tableName of tableNames) {
                if (tableName !== 'cells_fts') {
                    await this.db!.run(`DROP TABLE IF EXISTS ${tableName}`);
                }
            }
        });

        debug("Creating fresh schema...");
        await this.createSchema();

        await new Promise(resolve => setImmediate(resolve));

        if (!(await this.validateSchemaIntegrity())) {
            throw new Error(`Schema validation failed after recreation for version ${CURRENT_SCHEMA_VERSION} - database may be corrupted`);
        }

        await this.setSchemaVersion(CURRENT_SCHEMA_VERSION);

        // Reclaim space left by dropped tables
        await this.vacuum();
    }

    private async getSchemaVersion(): Promise<number> {
        if (!this.db) return 0;

        try {
            const countRow = await this.db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'"
            );
            if (!countRow || countRow.count === 0) return 0;

            const tableRow = await this.db.get<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_info'"
            );
            if (!tableRow) return -1;

            const versionRow = await this.db.get<{ version: number }>(
                "SELECT version FROM schema_info WHERE id = 1 LIMIT 1"
            );
            return versionRow?.version ?? -1;
        } catch {
            return -1;
        }
    }


    async setSchemaVersion(version: number): Promise<void> {
        if (!this.db) return;

        await this.db.run(`
            CREATE TABLE IF NOT EXISTS schema_info (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                version INTEGER NOT NULL
            )
        `);

        await this.runInTransaction(async () => {
            await this.db!.run("DELETE FROM schema_info");
            await this.db!.run("INSERT INTO schema_info (id, version) VALUES (1, ?)", [version]);
            debug(`Schema version updated to ${version}`);
        });
    }

    private computeContentHash(content: string): string {
        return createHash("sha256").update(content).digest("hex");
    }

    private computeRawContentHash(rawContent: string): string {
        return createHash("sha256").update(rawContent).digest("hex");
    }

    async upsertFile(
        filePath: string,
        fileType: "source" | "codex",
        lastModifiedMs: number
    ): Promise<number> {
        if (!this.db) throw new Error("Database not initialized");

        // Handle both URI strings and file paths
        const fileUri = filePath.startsWith('file:') ? vscode.Uri.parse(filePath) : vscode.Uri.file(filePath);
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const contentHash = this.computeContentHash(fileContent.toString());

        const result = await this.db!.get<{id: number}>(`
            INSERT INTO files (file_path, file_type, last_modified_ms, content_hash)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(file_path) DO UPDATE SET
                last_modified_ms = excluded.last_modified_ms,
                content_hash = excluded.content_hash,
                updated_at = strftime('%s', 'now') * 1000
            RETURNING id
        `, [filePath, fileType, lastModifiedMs, contentHash]);
        return result?.id ?? 0;
    }

    // Synchronous version for use within transactions
    async upsertFileSync(
        filePath: string,
        fileType: "source" | "codex",
        lastModifiedMs: number
    ): Promise<number> {
        if (!this.db) throw new Error("Database not initialized");

        const contentHash = this.computeContentHash(filePath + lastModifiedMs);

        const result = await this.db!.get<{id: number}>(`
            INSERT INTO files (file_path, file_type, last_modified_ms, content_hash)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(file_path) DO UPDATE SET
                last_modified_ms = excluded.last_modified_ms,
                content_hash = excluded.content_hash,
                updated_at = strftime('%s', 'now') * 1000
            RETURNING id
        `, [filePath, fileType, lastModifiedMs, contentHash]);
        return result?.id ?? 0;
    }

    async upsertCell(
        cellId: string,
        fileId: number,
        cellType: "source" | "target",
        content: string,
        lineNumber?: number,
        metadata?: any,
        rawContent?: string,
        milestoneIndex?: number | null
    ): Promise<{ id: string; isNew: boolean; contentChanged: boolean; }> {
        if (!this.db) throw new Error("Database not initialized");

        // Use rawContent if provided, otherwise fall back to content
        const actualRawContent = rawContent || content;

        // Sanitize content for storage - remove HTML tags for clean searching/indexing
        const sanitizedContent = this.sanitizeContent(content);

        const rawContentHash = this.computeRawContentHash(actualRawContent);
        const wordCount = sanitizedContent.split(/\s+/).filter((w) => w.length > 0).length;
        const currentTimestamp = Date.now();

        // Check if cell exists and if content changed
        const existingCell = await this.db!.get<{ cell_id: string; hash: string | null; }>(`
            SELECT cell_id, ${cellType === 'source' ? 's_raw_content_hash' : 't_raw_content_hash'} as hash 
            FROM cells 
            WHERE cell_id = ?
        `, [cellId]);

        const contentChanged = !existingCell || existingCell.hash !== rawContentHash;
        const isNew = !existingCell;

        // Extract metadata for dedicated columns (always extract for target cells to handle validation changes)
        const extractedMetadata = this.extractMetadataFields(metadata, cellType);

        // Extract cell_type from metadata
        const cellTypeValue = metadata?.type || null;

        // For target cells, always update metadata even if content hasn't changed (validation may have changed)
        const shouldUpdate = contentChanged || (cellType === 'target' && metadata && Object.keys(metadata).length > 0);

        if (!shouldUpdate && existingCell) {
            return { id: cellId, isNew: false, contentChanged: false };
        }

        // Use actual edit timestamp from JSON metadata when available
        const actualEditTimestamp = extractedMetadata.currentEditTimestamp || currentTimestamp;

        // Prepare column names and values based on cell type
        const prefix = cellType === 'source' ? 's_' : 't_';
        const columns = [
            'cell_type',
            `${prefix}file_id`,
            `${prefix}content`,
            `${prefix}raw_content_hash`,
            `${prefix}line_number`,
            `${prefix}word_count`,
            `${prefix}raw_content`,
            'milestone_index'
        ];

        const values = [
            cellTypeValue,
            fileId,
            sanitizedContent,
            rawContentHash,
            lineNumber || null,
            wordCount,
            actualRawContent,
            milestoneIndex !== undefined ? milestoneIndex : null
        ];

        // Add timestamps based on cell type
        if (cellType === 'source') {
            // Source cells keep s_updated_at for tracking source content changes
            columns.push('s_updated_at');
            values.push(actualEditTimestamp);
        }
        // Target cells only use t_current_edit_timestamp (added below with metadata)

        // Add target-specific metadata columns
        if (cellType === 'target') {
            columns.push('t_current_edit_timestamp', 't_validation_count', 't_validated_by', 't_is_fully_validated',
                't_audio_validation_count', 't_audio_validated_by', 't_audio_is_fully_validated');
            values.push(
                actualEditTimestamp, // Only t_current_edit_timestamp for target cells (no redundant t_updated_at)
                extractedMetadata.validationCount || 0,
                extractedMetadata.validatedBy || null,
                extractedMetadata.isFullyValidated ? 1 : 0,
                extractedMetadata.audioValidationCount || 0,
                extractedMetadata.audioValidatedBy || null,
                extractedMetadata.audioIsFullyValidated ? 1 : 0
            );
        }

        // Handle t_created_at logic for target cells (more complex than source cells)
        if (cellType === 'target') {
            // For target cells, t_created_at should only be set when first content is added
            if (isNew) {
                // New target cell: only set t_created_at if we actually have content
                if (content && content.trim() !== '') {
                    columns.push('t_created_at');
                    values.push(actualEditTimestamp);
                }
                // If no content, t_created_at remains NULL (will be set when first content is added)
            } else {
                // Existing target cell: check if t_created_at is NULL and we're adding first content
                const createdAtRow = await this.db!.get<{t_created_at: number | null}>(`
                    SELECT t_created_at FROM cells WHERE cell_id = ? LIMIT 1
                `, [cellId]);
                const currentCreatedAt = createdAtRow?.t_created_at ?? null;

                // If t_created_at is NULL and we're adding content, set it to current edit timestamp
                if (currentCreatedAt === null && content && content.trim() !== '') {
                    columns.push('t_created_at');
                    values.push(actualEditTimestamp);
                }
                // Otherwise, don't modify t_created_at (preserve existing value)
            }
        } else if (cellType === 'source') {
            // Source cells: simpler logic, always set created_at for new cells
            if (isNew) {
                columns.push('s_created_at');
                values.push(actualEditTimestamp);
            }
        }

        // Created_at logic is handled above based on cell type and content presence

        // Upsert the cell
        await this.db!.run(`
            INSERT INTO cells (cell_id, ${columns.join(', ')})
            VALUES (?, ${values.map(() => '?').join(', ')})
            ON CONFLICT(cell_id) DO UPDATE SET
                ${columns.map(col => `${col} = excluded.${col}`).join(', ')}
        `, [cellId, ...values]);

        this.debouncedSave();
        return { id: cellId, isNew, contentChanged };
    }

    // Synchronous version for use within transactions
    async upsertCellSync(
        cellId: string,
        fileId: number,
        cellType: "source" | "target",
        content: string,
        lineNumber?: number,
        metadata?: any,
        rawContent?: string,
        milestoneIndex?: number | null
    ): Promise<{ id: string; isNew: boolean; contentChanged: boolean; }> {
        if (!this.db) throw new Error("Database not initialized");

        // Use rawContent if provided, otherwise fall back to content
        const actualRawContent = rawContent || content;

        // Sanitize content for storage - remove HTML tags for clean searching/indexing
        const sanitizedContent = this.sanitizeContent(content);

        const rawContentHash = this.computeRawContentHash(actualRawContent);
        const wordCount = sanitizedContent.split(/\s+/).filter((w) => w.length > 0).length;
        const currentTimestamp = Date.now();

        // Check if cell exists and if content changed
        const existingCell = await this.db!.get<{ cell_id: string; hash: string | null; }>(`
            SELECT cell_id, ${cellType === 'source' ? 's_raw_content_hash' : 't_raw_content_hash'} as hash 
            FROM cells 
            WHERE cell_id = ?
        `, [cellId]);

        const contentChanged = !existingCell || existingCell.hash !== rawContentHash;
        const isNew = !existingCell;

        // Extract metadata for dedicated columns (always extract for target cells to handle validation changes)
        const extractedMetadata = this.extractMetadataFields(metadata, cellType);

        // Extract cell_type from metadata
        const cellTypeValue = metadata?.type || null;

        // For target cells, always update metadata even if content hasn't changed (validation may have changed)
        const shouldUpdate = contentChanged || (cellType === 'target' && metadata && Object.keys(metadata).length > 0);

        if (!shouldUpdate && existingCell) {
            return { id: cellId, isNew: false, contentChanged: false };
        }

        // Use actual edit timestamp from JSON metadata when available
        const actualEditTimestamp = extractedMetadata.currentEditTimestamp || currentTimestamp;

        // Prepare column names and values based on cell type
        const prefix = cellType === 'source' ? 's_' : 't_';
        const columns = [
            'cell_type',
            `${prefix}file_id`,
            `${prefix}content`,
            `${prefix}raw_content_hash`,
            `${prefix}line_number`,
            `${prefix}word_count`,
            `${prefix}raw_content`,
            'milestone_index'
        ];

        const values = [
            cellTypeValue,
            fileId,
            sanitizedContent,
            rawContentHash,
            lineNumber || null,
            wordCount,
            actualRawContent,
            milestoneIndex !== undefined ? milestoneIndex : null
        ];

        // Add timestamps based on cell type
        if (cellType === 'source') {
            // Source cells keep s_updated_at for tracking source content changes
            columns.push('s_updated_at');
            values.push(actualEditTimestamp);
        }
        // Target cells only use t_current_edit_timestamp (added below with metadata)

        // Add target-specific metadata columns
        if (cellType === 'target') {
            columns.push('t_current_edit_timestamp', 't_validation_count', 't_validated_by', 't_is_fully_validated',
                't_audio_validation_count', 't_audio_validated_by', 't_audio_is_fully_validated');
            values.push(
                actualEditTimestamp, // Only t_current_edit_timestamp for target cells (no redundant t_updated_at)
                extractedMetadata.validationCount || 0,
                extractedMetadata.validatedBy || null,
                extractedMetadata.isFullyValidated ? 1 : 0,
                extractedMetadata.audioValidationCount || 0,
                extractedMetadata.audioValidatedBy || null,
                extractedMetadata.audioIsFullyValidated ? 1 : 0
            );
        }

        // Handle t_created_at logic for target cells (more complex than source cells)
        if (cellType === 'target') {
            // For target cells, t_created_at should only be set when first content is added
            if (isNew) {
                // New target cell: only set t_created_at if we actually have content
                if (content && content.trim() !== '') {
                    columns.push('t_created_at');
                    values.push(actualEditTimestamp);
                }
                // If no content, t_created_at remains NULL (will be set when first content is added)
            } else {
                // Existing target cell: check if t_created_at is NULL and we're adding first content
                const createdAtRow = await this.db!.get<{t_created_at: number | null}>(`
                    SELECT t_created_at FROM cells WHERE cell_id = ? LIMIT 1
                `, [cellId]);
                const currentCreatedAt = createdAtRow?.t_created_at ?? null;

                // If t_created_at is NULL and we're adding content, set it to current edit timestamp
                if (currentCreatedAt === null && content && content.trim() !== '') {
                    columns.push('t_created_at');
                    values.push(actualEditTimestamp);
                }
                // Otherwise, don't modify t_created_at (preserve existing value)
            }
        } else if (cellType === 'source') {
            // Source cells: simpler logic, always set created_at for new cells
            if (isNew) {
                columns.push('s_created_at');
                values.push(actualEditTimestamp);
            }
        }

        // Created_at logic is handled above based on cell type and content presence

        // Upsert the cell
        await this.db!.run(`
            INSERT INTO cells (cell_id, ${columns.join(', ')})
            VALUES (?, ${values.map(() => '?').join(', ')})
            ON CONFLICT(cell_id) DO UPDATE SET
                ${columns.map(col => `${col} = excluded.${col}`).join(', ')}
        `, [cellId, ...values]);

        // Note: Don't call debouncedSave() in sync version as it's async
        return { id: cellId, isNew, contentChanged };
    }

    // Add a single document (DEPRECATED - use FileSyncManager instead)
    add(doc: any): void {
        debug("[SQLiteIndex] DEPRECATED: add() method called - use FileSyncManager instead", {
            cellId: doc.cellId,
            caller: new Error().stack?.split('\n')[2]?.trim()
        });

        // Legacy add method disabled in favor of FileSyncManager
        // All indexing should now go through the file synchronization system
        return;
    }

    // Add multiple documents (DEPRECATED - use FileSyncManager instead)
    async addAll(documents: any[]): Promise<void> {
        debug("[SQLiteIndex] DEPRECATED: addAll() method called - use FileSyncManager instead", {
            documentCount: documents.length,
            caller: new Error().stack?.split('\n')[2]?.trim()
        });

        // Legacy addAll method disabled in favor of FileSyncManager
        // All indexing should now go through the file synchronization system
        return;
    }

    // Remove all documents
    async removeAll(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        // Use a transaction for better performance and make it non-blocking
        await this.runInTransaction(async () => {
            // Delete in reverse dependency order to avoid foreign key issues
            await this.db!.run("DELETE FROM cells_fts");
            await this.db!.run("DELETE FROM words");
            await this.db!.run("DELETE FROM cells");
            await this.db!.run("DELETE FROM files");
        });

        // Use setImmediate to make the save operation non-blocking
        setImmediate(() => {
            this.debouncedSave();
        });
    }

    // Get document count
    get documentCount(): number {
        // Deprecated: Use getDocumentCount() instead for async access
        // This getter is kept for backward compatibility but will be removed
        throw new Error("documentCount getter is deprecated. Use async getDocumentCount() instead.");
    }

    async getDocumentCount(): Promise<number> {
        if (!this.db) return 0;

        const row = await this.db.get<{ count: number }>("SELECT COUNT(DISTINCT cell_id) as count FROM cells");
        return (row?.count as number) || 0;
    }

    /**
     * Get database instance for advanced operations (use with caution)
     */
    get database(): AsyncDatabase | null {
        return this.db;
    }

    // Search with MiniSearch-compatible interface (minisearch was deprecated–thankfully. We're now using SQLite3 and FTS5.)
    /**
     * Search database cells using sanitized content for matching, but return raw content for webview display or sanitized for AI processing.
     * This provides the best of both worlds: accurate text matching and appropriate content format for the use case.
     * 
     * @param query - Search query string
     * @param options - Search options
     * @param options.limit - Maximum results to return (default: 50)
     * @param options.fuzzy - Fuzzy matching threshold (default: 0.2)
     * @param options.returnRawContent - If true, return raw content with HTML; if false, return sanitized content (default: false)
     * @param options.isParallelPassagesWebview - If true, this search is for the search passages webview display (default: false)
     * @returns Array of search results with raw or sanitized content based on options
     */
    async search(query: string, options?: any): Promise<any[]> {
        if (!this.db) return [];

        const limit = options?.limit || 50;
        const fuzzy = options?.fuzzy || 0.2;
        const boost = options?.boost || {};

        // Determine content type based on caller
        // Pearch passages webview needs raw content for proper HTML display
        // Everything else (LLM, etc.) should get sanitized content
        const returnRawContent = options?.returnRawContent || options?.isParallelPassagesWebview || false;

        // Escape special characters for FTS5
        // FTS5 treats these as special: " ( ) * : .
        const escapeForFTS5 = (text: string): string => {
            // Clean and tokenize text robustly
            const tokens = text
                .split(/\s+/)
                .map(token => {
                    // Remove problematic leading/trailing punctuation
                    return token
                        .replace(/^[.,;:!?()[\]{}"""'''‹›«»\-_]+/, '')
                        .replace(/[.,;:!?()[\]{}"""'''‹›«»\-_]+$/, '')
                        .trim();
                })
                .filter(token => token.length > 1 && !/^\d+$/.test(token));

            if (tokens.length === 0) return '';

            // Escape each token properly for FTS5
            const escapedTokens = tokens
                .map((token) => {
                    // Handle FTS5 special characters
                    const escaped = token.replace(/"/g, '""'); // Double quotes for FTS5

                    // For fuzzy matching, we can't use quotes with wildcards
                    if (fuzzy > 0 && !token.includes("*")) {
                        // Clean token for fuzzy matching - remove remaining problematic chars
                        const cleanToken = escaped.replace(/[":().,;·]/g, " ").trim();
                        if (cleanToken) {
                            return cleanToken
                                .split(/\s+/)
                                .map((t) => `"${t}"*`)  // Wrap in quotes BEFORE adding wildcard
                                .join(" ");
                        }
                        return null;
                    } else {
                        // For exact matching, use phrase queries
                        return `"${escaped}"`;
                    }
                })
                .filter(Boolean);

            return escapedTokens.join(" ");
        };

        const ftsQuery = escapeForFTS5(query);

        // If the query is empty after escaping, return empty results
        if (!ftsQuery.trim()) {
            return [];
        }

        // Always search using the sanitized content column for better matching
        const ftsSearchQuery = `content: ${ftsQuery}`;
        const rows = await this.db!.all<{
            cell_id: string;
            content: string;
            content_type: string;
            s_content: string;
            s_raw_content: string;
            s_line_number: number;
            t_content: string;
            t_raw_content: string;
            t_line_number: number;
            s_file_path: string;
            t_file_path: string;
            score: number;
        }>(`
            SELECT 
                cells_fts.cell_id,
                cells_fts.content,
                cells_fts.content_type,
                c.s_content,
                c.s_raw_content,
                c.s_line_number,
                c.t_content,
                c.t_raw_content,
                c.t_line_number,
                s_file.file_path as s_file_path,
                t_file.file_path as t_file_path,
                bm25(cells_fts) as score
            FROM cells_fts
            JOIN cells c ON cells_fts.cell_id = c.cell_id
            LEFT JOIN files s_file ON c.s_file_id = s_file.id
            LEFT JOIN files t_file ON c.t_file_id = t_file.id
            WHERE cells_fts MATCH ?
            ORDER BY score ASC
            LIMIT ?
        `, [ftsSearchQuery, limit]);

        const results = [];
        for (const row of rows) {
            // Determine the content type from FTS entry
            const contentType = row.content_type as string; // 'source' or 'target'

            // Get the appropriate content and metadata based on content type
            let content, rawContent, line, uri, metadata;

            if (contentType === 'source') {
                content = row.s_content;
                rawContent = row.s_raw_content;
                line = row.s_line_number;
                uri = row.s_file_path;
                metadata = {}; // Metadata now in dedicated columns
            } else {
                content = row.t_content;
                rawContent = row.t_raw_content;
                line = row.t_line_number;
                uri = row.t_file_path;
                metadata = {}; // Metadata now in dedicated columns
            }

            // Verify both columns contain data - no fallbacks
            if (!content || !rawContent) {
                debug(`[SQLiteIndex] Cell ${row.cell_id} missing content data:`, {
                    content: !!content,
                    raw_content: !!rawContent,
                    content_type: contentType
                });
                continue; // Skip this result
            }

            // Choose which content to return based on use case
            const contentToReturn = returnRawContent ? rawContent : content;

            // Format result to match MiniSearch output (minisearch was deprecated–thankfully. We're now using SQLite3 and FTS5.)
            const result: any = {
                id: row.cell_id,
                cellId: row.cell_id,
                score: row.score,
                match: {}, // MiniSearch compatibility (minisearch was deprecated–thankfully. We're now using SQLite3 and FTS5.)
                uri: uri,
                line: line,
            };

            // Add content based on cell type - always provide both versions for transparency
            if (contentType === "source") {
                result.sourceContent = contentToReturn;
                result.content = contentToReturn;
                // Always provide both versions for debugging/transparency
                result.sanitizedContent = content;
                result.rawContent = rawContent;
            } else {
                result.targetContent = contentToReturn;
                // Always provide both versions for debugging/transparency
                result.sanitizedTargetContent = content;
                result.rawTargetContent = rawContent;
            }

            // Add metadata fields
            Object.assign(result, metadata);

            results.push(result);
        }

        return results;
    }

    // Search and return sanitized content (for cases where HTML tags are not needed)
    /**
     * Search database cells and return sanitized content (HTML tags removed).
     * Use this when you need clean text without formatting.
     * 
     * @param query - Search query string
     * @param options - Search options (same as search method)
     * @returns Array of search results with sanitized content (no HTML tags)
     */
    async searchSanitized(query: string, options?: any): Promise<any[]> {
        return await this.search(query, { ...options, returnRawContent: false });
    }

    // Get document by ID (for source text index compatibility)
    async getById(cellId: string): Promise<any | null> {
        if (!this.db) return null;

        const row = await this.db.get<{
            cell_id: string;
            s_content: string;
            s_raw_content: string;
            s_file_path: string;
            t_content: string;
            t_raw_content: string;
            t_current_edit_timestamp: number | null;
            t_validation_count: number;
            t_validated_by: string | null;
            t_is_fully_validated: boolean;
            t_audio_validation_count: number;
            t_audio_validated_by: string | null;
            t_audio_is_fully_validated: boolean;
            t_file_path: string;
        }>(`
            SELECT 
                c.cell_id,
                -- Source columns
                c.s_content,
                c.s_raw_content,
                s_file.file_path as s_file_path,
                -- Target columns
                c.t_content,
                c.t_raw_content,
                c.t_current_edit_timestamp,
                c.t_validation_count,
                c.t_validated_by,
                c.t_is_fully_validated,
                c.t_audio_validation_count,
                c.t_audio_validated_by,
                c.t_audio_is_fully_validated,
                t_file.file_path as t_file_path
            FROM cells c
            LEFT JOIN files s_file ON c.s_file_id = s_file.id
            LEFT JOIN files t_file ON c.t_file_id = t_file.id
            WHERE c.cell_id = ?
        `, [cellId]);

        if (row) {
            // Construct metadata from dedicated columns
            const sourceMetadata = {};
            const targetMetadata = {
                currentEditTimestamp: row.t_current_edit_timestamp || null,
                validationCount: row.t_validation_count || 0,
                validatedBy: row.t_validated_by ? row.t_validated_by.split(',') : [],
                isFullyValidated: Boolean(row.t_is_fully_validated),
                audioValidationCount: row.t_audio_validation_count || 0,
                audioValidatedBy: row.t_audio_validated_by ? row.t_audio_validated_by.split(',') : [],
                audioIsFullyValidated: Boolean(row.t_audio_is_fully_validated)
            };

            return {
                cellId: cellId,
                content: row.s_raw_content || row.s_content || "", // Prefer source raw content
                versions: [], // Versions now tracked in dedicated columns
                sourceContent: row.s_content,
                targetContent: row.t_content,
                sourceRawContent: row.s_raw_content,
                targetRawContent: row.t_raw_content,
                source_file_path: row.s_file_path,
                target_file_path: row.t_file_path,
                source_metadata: sourceMetadata,
                target_metadata: targetMetadata,
            };
        }

        return null;
    }

    /**
     * Build a map of source cells keyed by cell_id with minimal payload for webviews
     * Optionally filtered by a specific source file path to reduce payload size
     */
    public async getSourceCellsMapForFile(
        sourceFilePath?: string
    ): Promise<{ [k: string]: { content: string; versions: string[]; }; }> {
        if (!this.db) return {};

        const build = async (pathA?: string, pathB?: string): Promise<{ [k: string]: { content: string; versions: string[]; }; }> => {
            const result: { [k: string]: { content: string; versions: string[]; }; } = {};
            let sql = `
                SELECT c.cell_id AS cell_id,
                       COALESCE(c.s_raw_content, c.s_content) AS content
                FROM cells c
                LEFT JOIN files s_file ON c.s_file_id = s_file.id
                WHERE c.s_content IS NOT NULL AND c.s_content != ''
            `;
            const params: any[] = [];

            if (pathA || pathB) {
                if (pathA && pathB && pathA !== pathB) {
                    sql += ` AND (s_file.file_path = ? OR s_file.file_path = ?)`;
                    params.push(pathA, pathB);
                } else {
                    const only = pathA || pathB;
                    sql += ` AND s_file.file_path = ?`;
                    params.push(only);
                }
            }

            const rows = await this.db!.all<{ cell_id: string; content: string }>(sql, params);
            for (const row of rows) {
                const cellId = String(row.cell_id);
                const content = String(row.content || "");
                result[cellId] = { content, versions: [] };
            }
            return result;
        };

        let result: { [k: string]: { content: string; versions: string[]; }; } = {};
        if (sourceFilePath) {
            const isUri = sourceFilePath.startsWith("file:");
            const fsPathVariant = isUri ? vscode.Uri.parse(sourceFilePath).fsPath : undefined;
            result = await build(sourceFilePath, fsPathVariant);
            if (Object.keys(result).length === 0) {
                // Retry with swapped order just in case
                result = await build(fsPathVariant, sourceFilePath);
            }
            if (Object.keys(result).length === 0) {
                // Fallback to unfiltered
                result = await build();
            }
        } else {
            result = await build();
        }

        return result;
    }

    // Get cell by exact ID match (for translation pairs)
    async getCellById(cellId: string, cellType?: "source" | "target"): Promise<any | null> {
        if (!this.db) return null;

        const row = await this.db.get<{
            cell_id: string;
            s_content: string;
            s_raw_content: string;
            s_line_number: number;
            s_file_path: string;
            s_file_type: string;
            t_content: string;
            t_raw_content: string;
            t_line_number: number;
            t_current_edit_timestamp: number | null;
            t_validation_count: number;
            t_validated_by: string | null;
            t_is_fully_validated: boolean;
            t_audio_validation_count: number;
            t_audio_validated_by: string | null;
            t_audio_is_fully_validated: boolean;
            t_file_path: string;
            t_file_type: string;
        }>(`
            SELECT 
                c.cell_id,
                -- Source columns
                c.s_content,
                c.s_raw_content,
                c.s_line_number,
                s_file.file_path as s_file_path,
                s_file.file_type as s_file_type,
                -- Target columns
                c.t_content,
                c.t_raw_content,
                c.t_line_number,
                c.t_current_edit_timestamp,
                c.t_validation_count,
                c.t_validated_by,
                c.t_is_fully_validated,
                c.t_audio_validation_count,
                c.t_audio_validated_by,
                c.t_audio_is_fully_validated,
                t_file.file_path as t_file_path,
                t_file.file_type as t_file_type
            FROM cells c
            LEFT JOIN files s_file ON c.s_file_id = s_file.id
            LEFT JOIN files t_file ON c.t_file_id = t_file.id
            WHERE c.cell_id = ?
        `, [cellId]);

        if (row) {
            // Construct metadata from dedicated columns
            const sourceMetadata = {};
            const targetMetadata = {
                currentEditTimestamp: row.t_current_edit_timestamp || null,
                validationCount: row.t_validation_count || 0,
                validatedBy: row.t_validated_by ? row.t_validated_by.split(',') : [],
                isFullyValidated: Boolean(row.t_is_fully_validated),
                audioValidationCount: row.t_audio_validation_count || 0,
                audioValidatedBy: row.t_audio_validated_by ? row.t_audio_validated_by.split(',') : [],
                audioIsFullyValidated: Boolean(row.t_audio_is_fully_validated)
            };

            // Return data based on requested cell type
            if (cellType === "source" && row.s_content) {
                return {
                    cellId: row.cell_id,
                    content: row.s_content,
                    rawContent: row.s_raw_content,
                    cell_type: "source",
                    uri: row.s_file_path,
                    line: row.s_line_number,
                    ...sourceMetadata,
                };
            } else if (cellType === "target" && row.t_content) {
                return {
                    cellId: row.cell_id,
                    content: row.t_content,
                    rawContent: row.t_raw_content,
                    cell_type: "target",
                    uri: row.t_file_path,
                    line: row.t_line_number,
                    ...targetMetadata,
                };
            } else if (!cellType) {
                // Return source if available, otherwise target
                if (row.s_content) {
                    return {
                        cellId: row.cell_id,
                        content: row.s_content,
                        rawContent: row.s_raw_content,
                        cell_type: "source",
                        uri: row.s_file_path,
                        line: row.s_line_number,
                        ...sourceMetadata,
                    };
                } else if (row.t_content) {
                    return {
                        cellId: row.cell_id,
                        content: row.t_content,
                        rawContent: row.t_raw_content,
                        cell_type: "target",
                        uri: row.t_file_path,
                        line: row.t_line_number,
                        ...targetMetadata,
                    };
                }
            }
        }

        return null;
    }

    // Get translation pair by cell ID
    async getTranslationPair(cellId: string): Promise<any | null> {
        if (!this.db) return null;

        const sourceCell = await this.getCellById(cellId, "source");
        const targetCell = await this.getCellById(cellId, "target");

        if (!sourceCell && !targetCell) return null;

        return {
            cellId,
            sourceContent: sourceCell?.content || "",
            targetContent: targetCell?.content || "",
            rawSourceContent: sourceCell?.rawContent || "",
            rawTargetContent: targetCell?.rawContent || "",
            document: sourceCell?.document || targetCell?.document,
            section: sourceCell?.section || targetCell?.section,
            uri: sourceCell?.uri || targetCell?.uri,
            line: sourceCell?.line || targetCell?.line,
        };
    }

    // Update word index for a cell — batched in a single transaction for performance.
    // Previously each word was a separate auto-committed INSERT (N+1 problem);
    // wrapping in a transaction reduces disk I/O from N fsync calls to 1.
    async updateWordIndex(cellId: string, content: string): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        // Tokenize and count
        const words = content
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 0);
        const wordCounts = new Map<string, number>();
        for (const word of words) {
            wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
        }

        await this.runInTransaction(async () => {
            // Clear existing words for this cell
            await this.db!.run("DELETE FROM words WHERE cell_id = ?", [cellId]);

            // Batch insert all words inside the same transaction
            let position = 0;
            for (const [word, frequency] of wordCounts) {
                await this.db!.run(
                    "INSERT INTO words (word, cell_id, position, frequency) VALUES (?, ?, ?, ?)",
                    [word, cellId, position++, frequency]
                );
            }
        });
    }

    /**
     * Search cells with more granular control over cell types and content format.
     * Always searches using sanitized content for better matching accuracy.
     * 
     * @param query - Search query string
     * @param cellType - Filter by cell type ('source' or 'target'), optional
     * @param limit - Maximum results to return (default: 50)
     * @param returnRawContent - If true, return raw content with HTML; if false, return sanitized content (default: false)
     * @returns Array of detailed cell results
     */
    async searchCells(
        query: string,
        cellType?: "source" | "target",
        limit: number = 50,
        returnRawContent: boolean = false
    ): Promise<any[]> {
        if (!this.db) throw new Error("Database not initialized");

        // Reuse the same escaping logic from the search method
        const escapeForFTS5 = (text: string): string => {
            // First, handle quotes by doubling them
            const escaped = text.replace(/"/g, '""');

            // Split by whitespace but preserve the original tokens
            const tokens = escaped.split(/\s+/).filter((token) => token.length > 0);

            // Wrap each token in quotes to make it a phrase query
            const escapedTokens = tokens.map((token) => `"${token}"`);

            return escapedTokens.join(" ");
        };

        const ftsQuery = escapeForFTS5(query);

        // If the query is empty after escaping, return empty results
        if (!ftsQuery.trim()) {
            return [];
        }

        // Build query for new schema with combined source/target rows
        let sql = `
            SELECT 
                c.cell_id,
                CASE 
                    WHEN cells_fts.content_type = 'source' THEN c.s_content
                    WHEN cells_fts.content_type = 'target' THEN c.t_content
                END as content,
                CASE 
                    WHEN cells_fts.content_type = 'source' THEN c.s_raw_content
                    WHEN cells_fts.content_type = 'target' THEN c.t_raw_content
                END as raw_content,
                CASE 
                    WHEN cells_fts.content_type = 'source' THEN c.s_word_count
                    WHEN cells_fts.content_type = 'target' THEN c.t_word_count
                END as word_count,
                CASE 
                    WHEN cells_fts.content_type = 'source' THEN c.s_line_number
                    WHEN cells_fts.content_type = 'target' THEN c.t_line_number
                END as line,
                CASE 
                    WHEN cells_fts.content_type = 'source' THEN s_file.file_path
                    WHEN cells_fts.content_type = 'target' THEN t_file.file_path
                END as file_path,
                CASE 
                    WHEN cells_fts.content_type = 'source' THEN s_file.file_type
                    WHEN cells_fts.content_type = 'target' THEN t_file.file_type
                END as file_type,
                cells_fts.content_type as cell_type,
                bm25(cells_fts) as score
            FROM cells_fts
            JOIN cells c ON cells_fts.cell_id = c.cell_id
            LEFT JOIN files s_file ON c.s_file_id = s_file.id
            LEFT JOIN files t_file ON c.t_file_id = t_file.id
            WHERE cells_fts MATCH ?
        `;

        const params: any[] = [`content: ${ftsQuery}`];

        if (cellType) {
            sql += ` AND cells_fts.content_type = ?`;
            params.push(cellType);
        }

        sql += ` ORDER BY score ASC LIMIT ?`;
        params.push(limit);

        const rows = await this.db.all<{
            cell_id: string;
            content: string;
            raw_content: string;
            word_count: number;
            line: number;
            file_path: string;
            file_type: string;
            cell_type: string;
            score: number;
        }>(sql, params);

        const results = [];
        for (const row of rows) {
            // Verify content exists
            if (!row.content) {
                debug(`[SQLiteIndex] Cell ${row.cell_id} missing content data`);
                continue;
            }

            results.push({
                cellId: row.cell_id,
                cell_id: row.cell_id,
                content: returnRawContent ? (row.raw_content || row.content) : row.content,
                rawContent: row.raw_content,
                sourceContent: row.cell_type === 'source' ? row.content : undefined,
                targetContent: row.cell_type === 'target' ? row.content : undefined,
                cell_type: row.cell_type,
                uri: row.file_path,
                line: row.line,
                score: row.score,
                word_count: row.word_count,
                file_type: row.file_type
            });
        }

        return results;
    }

    // Special search method for Greek text that preserves diacritics and uses OR queries
    async searchGreekText(
        query: string,
        cellType?: "source" | "target",
        limit: number = 50
    ): Promise<any[]> {
        if (!this.db) throw new Error("Database not initialized");

        let sql: string;
        let params: any[];

        // Handle empty query by returning recent cells
        if (!query || query.trim() === '') {
            sql = `
                SELECT 
                    c.cell_id,
                    COALESCE(c.s_content, c.t_content) as content,
                    COALESCE(c.s_raw_content, c.t_raw_content) as raw_content,
                    CASE 
                        WHEN c.s_content IS NOT NULL THEN 'source'
                        WHEN c.t_content IS NOT NULL THEN 'target'
                    END as cell_type,
                    COALESCE(c.s_word_count, c.t_word_count) as word_count,
                    COALESCE(s_file.file_path, t_file.file_path) as uri,
                    COALESCE(s_file.file_type, t_file.file_type) as file_type,
                    COALESCE(c.s_line_number, c.t_line_number) as line,
                    0 as score
                FROM cells c
                LEFT JOIN files s_file ON c.s_file_id = s_file.id
                LEFT JOIN files t_file ON c.t_file_id = t_file.id
                WHERE (c.s_content IS NOT NULL OR c.t_content IS NOT NULL)
            `;
            params = [];

            if (cellType) {
                if (cellType === 'source') {
                    sql += ` AND c.s_content IS NOT NULL`;
                } else {
                    sql += ` AND c.t_content IS NOT NULL`;
                }
            }

            sql += ` ORDER BY c.cell_id DESC LIMIT ?`;
            params.push(limit);
        } else {
            // Clean and tokenize text robustly for all scripts and content types
            const cleanAndTokenize = (text: string): string[] => {
                return text
                    .split(/\s+/) // Split on whitespace
                    .map(token => {
                        // Remove only the most problematic punctuation for FTS5 while preserving content integrity
                        // Focus on trailing/leading punctuation that causes syntax errors
                        return token
                            .replace(/^[.,;:!?()[\]{}"""'''‹›«»\-_]+/, '') // Remove leading punctuation
                            .replace(/[.,;:!?()[\]{}"""'''‹›«»\-_]+$/, '') // Remove trailing punctuation
                            .trim();
                    })
                    .filter(token => {
                        // Filter out tokens that are:
                        // 1. Empty after cleaning
                        // 2. Single characters (usually punctuation remnants)
                        // 3. Only digits (usually page numbers, etc.)
                        return token.length > 1 && !/^\d+$/.test(token);
                    });
            };

            const words = cleanAndTokenize(query);

            if (words.length === 0) {
                return [];
            }

            // Create an OR query for all words - properly escape each word for FTS5
            const escapedWords = words.map(word => {
                // Handle FTS5 special characters more carefully
                let escaped = word;

                // Double internal quotes for FTS5
                escaped = escaped.replace(/"/g, '""');

                // If the word contains FTS5 operators or special chars, wrap in quotes
                // FTS5 special characters: " * : ( ) 
                if (/["*:()]/.test(escaped) || escaped.includes(' ')) {
                    return `"${escaped}"`;
                } else {
                    // For simple words without special chars, use phrase query for exact matching
                    return `"${escaped}"`;
                }
            });

            const ftsQuery = escapedWords.join(" OR ");

            debug(`[searchGreekText] Words extracted: ${words.length} - ${words.slice(0, 5).join(', ')}...`);


            sql = `
                SELECT 
                    c.cell_id,
                    CASE 
                        WHEN cells_fts.content_type = 'source' THEN c.s_content
                        WHEN cells_fts.content_type = 'target' THEN c.t_content
                    END as content,
                    CASE 
                        WHEN cells_fts.content_type = 'source' THEN c.s_raw_content
                        WHEN cells_fts.content_type = 'target' THEN c.t_raw_content
                    END as raw_content,
                    cells_fts.content_type as cell_type,
                    CASE 
                        WHEN cells_fts.content_type = 'source' THEN c.s_word_count
                        WHEN cells_fts.content_type = 'target' THEN c.t_word_count
                    END as word_count,
                    CASE 
                        WHEN cells_fts.content_type = 'source' THEN s_file.file_path
                        WHEN cells_fts.content_type = 'target' THEN t_file.file_path
                    END as uri,
                    CASE 
                        WHEN cells_fts.content_type = 'source' THEN s_file.file_type
                        WHEN cells_fts.content_type = 'target' THEN t_file.file_type
                    END as file_type,
                    CASE 
                        WHEN cells_fts.content_type = 'source' THEN c.s_line_number
                        WHEN cells_fts.content_type = 'target' THEN c.t_line_number
                    END as line,
                    bm25(cells_fts) as score
                FROM cells_fts
                JOIN cells c ON cells_fts.cell_id = c.cell_id
                LEFT JOIN files s_file ON c.s_file_id = s_file.id
                LEFT JOIN files t_file ON c.t_file_id = t_file.id
                WHERE cells_fts MATCH ?
            `;

            params = [`content: ${ftsQuery}`];

            if (cellType) {
                sql += ` AND cells_fts.content_type = ?`;
                params.push(cellType);
            }

            sql += ` ORDER BY score ASC LIMIT ?`;
            params.push(limit);
        }

        const rows = await this.db!.all<{
            cell_id: string;
            content: string;
            raw_content: string;
            cell_type: string;
            uri: string;
            line: number;
            score: number;
            word_count: number;
            file_type: string;
        }>(sql, params);

        const results = [];
        for (const row of rows) {
            // Verify content exists
            if (!row.content) {
                debug(`[SQLiteIndex] Cell ${row.cell_id} missing content data`);
                continue;
            }

            results.push({
                cellId: row.cell_id,
                cell_id: row.cell_id,
                content: row.content,
                rawContent: row.raw_content,
                sourceContent: row.cell_type === 'source' ? row.content : undefined,
                targetContent: row.cell_type === 'target' ? row.content : undefined,
                cell_type: row.cell_type,
                uri: row.uri,
                line: row.line,
                score: row.score,
                word_count: row.word_count,
                file_type: row.file_type
            });
        }

        return results;
    }

    async getFileStats(): Promise<Map<string, any>> {
        if (!this.db) throw new Error("Database not initialized");

        const rows = await this.db!.all<{
            id: number;
            file_path: string;
            file_type: string;
            cell_count: number;
            total_words: number;
        }>(`
            SELECT 
                f.id, f.file_path, f.file_type,
                COUNT(CASE WHEN c.s_file_id = f.id THEN 1 END) + 
                COUNT(CASE WHEN c.t_file_id = f.id THEN 1 END) as cell_count,
                COALESCE(SUM(CASE WHEN c.s_file_id = f.id THEN c.s_word_count END), 0) + 
                COALESCE(SUM(CASE WHEN c.t_file_id = f.id THEN c.t_word_count END), 0) as total_words
            FROM files f
            LEFT JOIN cells c ON (f.id = c.s_file_id OR f.id = c.t_file_id)
            GROUP BY f.id
        `);

        const stats = new Map();
        for (const row of rows) {
            stats.set(row.file_path, row);
        }

        return stats;
    }

    async getContentStats(): Promise<{
        totalCells: number;
        cellsWithRawContent: number;
        cellsWithDifferentContent: number;
        avgContentLength: number;
        avgRawContentLength: number;
        cellsWithMissingContent: number;
        cellsWithMissingRawContent: number;
    }> {
        if (!this.db) throw new Error("Database not initialized");

        const result = await this.db!.get<{
            total_cells: number;
            cells_with_raw_content: number;
            cells_with_different_content: number;
            avg_content_length: number;
            avg_raw_content_length: number;
            cells_with_missing_content: number;
            cells_with_missing_raw_content: number;
        }>(`
            SELECT 
                COUNT(*) as total_cells,
                (COUNT(s_raw_content) + COUNT(t_raw_content)) as cells_with_raw_content,
                (SUM(CASE WHEN s_content != s_raw_content THEN 1 ELSE 0 END) + 
                 SUM(CASE WHEN t_content != t_raw_content THEN 1 ELSE 0 END)) as cells_with_different_content,
                (AVG(LENGTH(COALESCE(s_content, ''))) + AVG(LENGTH(COALESCE(t_content, '')))) / 2 as avg_content_length,
                (AVG(LENGTH(COALESCE(s_raw_content, ''))) + AVG(LENGTH(COALESCE(t_raw_content, '')))) / 2 as avg_raw_content_length,
                -- Only count missing SOURCE content as problematic (target cells can be legitimately blank)
                SUM(CASE WHEN s_content IS NULL OR s_content = '' THEN 1 ELSE 0 END) as cells_with_missing_content,
                -- Only count missing SOURCE raw content as problematic (target cells can be legitimately blank)
                SUM(CASE WHEN s_raw_content IS NULL OR s_raw_content = '' THEN 1 ELSE 0 END) as cells_with_missing_raw_content
            FROM cells
        `);

        if (!result) {
            return {
                totalCells: 0,
                cellsWithRawContent: 0,
                cellsWithDifferentContent: 0,
                avgContentLength: 0,
                avgRawContentLength: 0,
                cellsWithMissingContent: 0,
                cellsWithMissingRawContent: 0,
            };
        }

        return {
            totalCells: result.total_cells || 0,
            cellsWithRawContent: result.cells_with_raw_content || 0,
            cellsWithDifferentContent: result.cells_with_different_content || 0,
            avgContentLength: result.avg_content_length || 0,
            avgRawContentLength: result.avg_raw_content_length || 0,
            cellsWithMissingContent: result.cells_with_missing_content || 0,
            cellsWithMissingRawContent: result.cells_with_missing_raw_content || 0,
        };
    }

    // Get translation pair statistics for validation
    async getTranslationPairStats(): Promise<{
        totalPairs: number;
        completePairs: number;
        incompletePairs: number;
        orphanedSourceCells: number;
        orphanedTargetCells: number;
    }> {
        if (!this.db) throw new Error("Database not initialized");

        // Count translation pairs from combined source/target rows (schema v8+)
        const pairsResult = await this.db!.get<{
            total_pairs: number;
            complete_pairs: number;
            incomplete_pairs: number;
        }>(`
            SELECT 
                COUNT(*) as total_pairs,
                SUM(CASE WHEN s_content IS NOT NULL AND s_content != '' AND t_content IS NOT NULL AND t_content != '' THEN 1 ELSE 0 END) as complete_pairs,
                SUM(CASE WHEN (s_content IS NOT NULL AND s_content != '') AND (t_content IS NULL OR t_content = '') THEN 1 ELSE 0 END) as incomplete_pairs
            FROM cells
            WHERE s_content IS NOT NULL OR t_content IS NOT NULL
        `);

        const totalPairs = pairsResult?.total_pairs || 0;
        const completePairs = pairsResult?.complete_pairs || 0;
        const incompletePairs = pairsResult?.incomplete_pairs || 0;

        // Count orphaned source cells (source cells with no corresponding target)
        const orphanedSourceResult = await this.db!.get<{ count: number }>(`
            SELECT COUNT(*) as count
            FROM cells c
            WHERE c.s_content IS NOT NULL 
            AND c.s_content != ''
            AND (c.t_content IS NULL OR c.t_content = '')
        `);

        const orphanedSourceCells = orphanedSourceResult?.count || 0;

        // Count orphaned target cells (target cells with no corresponding source)
        const orphanedTargetResult = await this.db!.get<{ count: number }>(`
            SELECT COUNT(*) as count
            FROM cells c
            WHERE c.t_content IS NOT NULL 
            AND c.t_content != ''
            AND (c.s_content IS NULL OR c.s_content = '')
        `);

        const orphanedTargetCells = orphanedTargetResult?.count || 0;

        return {
            totalPairs,
            completePairs,
            incompletePairs,
            orphanedSourceCells,
            orphanedTargetCells
        };
    }

    // Verify data integrity - ensure both content columns are populated
    async verifyDataIntegrity(): Promise<{
        isValid: boolean;
        issues: string[];
        totalCells: number;
        problematicCells: Array<{ cellId: string, issue: string; }>;
    }> {
        if (!this.db) throw new Error("Database not initialized");

        const issues: string[] = [];
        const problematicCells: Array<{ cellId: string, issue: string; }> = [];

        // Check for cells with missing source content (target content can be legitimately blank)
        const checkRows = await this.db!.all<{
            cell_id: string;
            s_content: string | null;
            s_raw_content: string | null;
            t_content: string | null;
            t_raw_content: string | null;
        }>(`
            SELECT cell_id, s_content, s_raw_content, t_content, t_raw_content
            FROM cells 
            WHERE (s_content IS NOT NULL AND s_content != '' AND (s_raw_content IS NULL OR s_raw_content = ''))
            OR (t_content IS NOT NULL AND t_content != '' AND (t_raw_content IS NULL OR t_raw_content = ''))
            OR (s_content IS NULL OR s_content = '')
        `);

        for (const row of checkRows) {
            const cellId = row.cell_id;

            // Check source content consistency
            if (row.s_content && row.s_content !== '' && (!row.s_raw_content || row.s_raw_content === '')) {
                issues.push(`Cell ${cellId} has source content but missing source raw_content`);
                problematicCells.push({ cellId, issue: 'missing source raw_content' });
            }

            // Check target content consistency (only if target has content)
            if (row.t_content && row.t_content !== '' && (!row.t_raw_content || row.t_raw_content === '')) {
                issues.push(`Cell ${cellId} has target content but missing target raw_content`);
                problematicCells.push({ cellId, issue: 'missing target raw_content' });
            }

            // Check for missing source content (this is always problematic - source cells should have content)
            if (!row.s_content || row.s_content === '') {
                issues.push(`Cell ${cellId} has no source content (source cells must have content)`);
                problematicCells.push({ cellId, issue: 'missing source content' });
            }
        }

        // Get total cell count
        const countResult = await this.db!.get<{ total: number }>("SELECT COUNT(*) as total FROM cells");
        const totalCells = countResult?.total || 0;

        return {
            isValid: issues.length === 0,
            issues,
            totalCells,
            problematicCells
        };
    }

    // Debug method to inspect database schema
    async debugSchema(): Promise<{
        version: number;
        tables: string[];
        cellsColumns: string[];
        ftsColumns: string[];
    }> {
        if (!this.db) throw new Error("Database not initialized");

        const version = await this.getSchemaVersion();

        // Get all tables
        const tablesRows = await this.db!.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
        const tables: string[] = [];
        for (const row of tablesRows) {
            tables.push(row.name);
        }

        // Get cells table columns
        const cellsColumnsRows = await this.db!.all<{ name: string }>("PRAGMA table_info(cells)");
        const cellsColumns: string[] = [];
        for (const row of cellsColumnsRows) {
            cellsColumns.push(row.name);
        }

        // Get FTS table columns
        const ftsColumnsRows = await this.db!.all<{ name: string }>("PRAGMA table_info(cells_fts)");
        const ftsColumns: string[] = [];
        for (const row of ftsColumnsRows) {
            ftsColumns.push(row.name);
        }

        return { version, tables, cellsColumns, ftsColumns };
    }

    /**
 * Validate that the database schema was created correctly with all expected components
 * This validation is version-agnostic and works with whatever the current schema version is
 */
    private async validateSchemaIntegrity(): Promise<boolean> {
        if (!this.db) {
            debug("Schema validation failed: No database connection");
            return false;
        }

        try {
            const currentSchemaVersion = CURRENT_SCHEMA_VERSION;
            debug(`Validating schema integrity for version ${currentSchemaVersion}`);

            // Core tables that should exist after createSchema() (schema_info is created later by setSchemaVersion)
            const requiredCoreTables = [
                'sync_metadata',
                'files',
                'cells',
                'words',
                'cells_fts'
            ];

            // Expected structure for current schema version (no migration paths)
            // Since we recreate for any version mismatch, we only validate current schema
            const expectedCellsColumns = [
                'cell_id',
                'cell_type',
                's_file_id', 's_content', 's_raw_content_hash', 's_line_number', 's_word_count', 's_raw_content', 's_created_at', 's_updated_at',
                't_file_id', 't_content', 't_raw_content_hash', 't_line_number', 't_word_count', 't_raw_content', 't_created_at',
                't_current_edit_timestamp', 't_validation_count', 't_validated_by', 't_is_fully_validated',
                't_audio_validation_count', 't_audio_validated_by', 't_audio_is_fully_validated'
            ];

            const expectedIndexes = [
                'idx_sync_metadata_path',
                'idx_files_path',
                'idx_cells_s_file_id',
                'idx_cells_t_file_id'
            ];

            // Check tables exist
            const tablesRows = await this.db!.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
            const actualTables: string[] = [];
            for (const row of tablesRows) {
                actualTables.push(row.name);
            }

            for (const expectedTable of requiredCoreTables) {
                if (!actualTables.includes(expectedTable)) {
                    debug(`Schema validation failed: Missing table '${expectedTable}'`);
                    return false;
                }
            }

            // Check cells table has correct v8 structure
            const cellsColumnsRows = await this.db!.all<{ name: string }>("PRAGMA table_info(cells)");
            const actualCellsColumns: string[] = [];
            for (const row of cellsColumnsRows) {
                actualCellsColumns.push(row.name);
            }

            for (const expectedColumn of expectedCellsColumns) {
                if (!actualCellsColumns.includes(expectedColumn)) {
                    debug(`Schema validation failed: Missing column '${expectedColumn}' in cells table`);
                    return false;
                }
            }

            // Check essential indexes exist
            const indexesRows = await this.db!.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'");
            const actualIndexes: string[] = [];
            for (const row of indexesRows) {
                actualIndexes.push(row.name);
            }

            for (const expectedIndex of expectedIndexes) {
                if (!actualIndexes.includes(expectedIndex)) {
                    debug(`Schema validation failed: Missing index '${expectedIndex}'`);
                    return false;
                }
            }

            // Verify FTS table is properly set up
            try {
                await this.db!.all("SELECT * FROM cells_fts LIMIT 0");
            } catch (error) {
                debug(`Schema validation failed: FTS table malformed - ${error}`);
                return false;
            }

            // Test that basic database operations work
            try {
                await this.db!.get("SELECT COUNT(*) FROM files");
                await this.db!.get("SELECT COUNT(*) FROM cells");
            } catch (error) {
                debug(`Schema validation failed: Basic table operations failed - ${error}`);
                return false;
            }

            debug(`Schema validation passed: All expected components for version ${currentSchemaVersion} are present and functional`);
            return true;

        } catch (error) {
            debug(`Schema validation failed with exception: ${error}`);
            return false;
        }
    }

    /**
     * No-op: Native SQLite writes to disk automatically via WAL mode.
     * Kept as a debounced no-op for backward compatibility with callers.
     */
    private debouncedSave = debounce(async () => {
        // No-op: native SQLite writes to disk automatically
    }, 0);

    /**
     * No-op: Native SQLite writes to disk automatically.
     * Kept for backward compatibility with callers like FileSyncManager.
     */
    async forceSave(): Promise<void> {
        // No-op: native SQLite writes to disk automatically via WAL mode
    }

    // Force FTS index to rebuild/refresh for immediate search visibility
    async refreshFTSIndex(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        try {
            // Force FTS5 to rebuild its index
            await this.db.run("INSERT INTO cells_fts(cells_fts) VALUES('rebuild')");
        } catch (error) {
            // If rebuild fails, try optimize instead
            try {
                await this.db.run("INSERT INTO cells_fts(cells_fts) VALUES('optimize')");
            } catch (optimizeError) {
                // If both fail, silently continue - the triggers should handle synchronization
            }
        }
    }

    // Ensure all pending writes are committed and visible for search
    async flushPendingWrites(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        // Run an empty transaction through the mutex to ensure any
        // preceding queued transactions have been committed first.
        try {
            await this.runInTransaction(async () => {
                // no-op – just forces serialization with other transactions
            });
        } catch {
            // Non-critical: WAL mode auto-commits anyway
        }
    }

    // Immediate cell update with FTS synchronization
    async upsertCellWithFTSSync(
        cellId: string,
        fileId: number,
        cellType: "source" | "target",
        content: string,
        lineNumber?: number,
        metadata?: any,
        rawContent?: string
    ): Promise<{ id: string; isNew: boolean; contentChanged: boolean; }> {
        const result = await this.upsertCell(cellId, fileId, cellType, content, lineNumber, metadata, rawContent);

        // Force FTS synchronization for immediate search visibility
        if (result.contentChanged) {
            try {
                // Sanitize content for FTS search (same as upsertCell does)
                const sanitizedContent = this.sanitizeContent(content);
                const actualRawContent = rawContent || content;

                // Manually sync this specific cell to FTS if triggers didn't work
                // Use sanitized content for the content field (for searching) and raw content for raw_content field
                await this.db!.run(`
                    INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type) 
                    VALUES (?, ?, ?, ?)
                `, [cellId, sanitizedContent, actualRawContent, cellType]);
            } catch (error) {
                console.error("Error syncing cell to FTS index:", error);
                // Trigger should have handled it, but log the error for debugging
            }
        }

        return result;
    }

    // Debug method to check if a cell is in the FTS index
    async isCellInFTSIndex(cellId: string): Promise<boolean> {
        if (!this.db) return false;

        const row = await this.db!.get<{ cell_id: string }>("SELECT cell_id FROM cells_fts WHERE cell_id = ? LIMIT 1", [cellId]);
        return !!row;
    }

    // Debug method to get FTS index count vs regular table count
    async getFTSDebugInfo(): Promise<{ cellsCount: number; ftsCount: number; }> {
        if (!this.db) return { cellsCount: 0, ftsCount: 0 };

        const cellsResult = await this.db!.get<{ count: number }>("SELECT COUNT(*) as count FROM cells");
        const ftsResult = await this.db!.get<{ count: number }>("SELECT COUNT(*) as count FROM cells_fts");

        const cellsCount = cellsResult?.count || 0;
        const ftsCount = ftsResult?.count || 0;

        return { cellsCount, ftsCount };
    }

    /**
     * No-op: Native native SQLite writes to disk automatically via WAL mode.
     * Previously, this serialized the entire in-memory database (103MB+) to a Uint8Array
     * and rewrote the entire file to disk. With native SQLite, only modified 4KB pages
     * are flushed to disk automatically.
     * @deprecated Native SQLite handles persistence automatically
     */
    async saveDatabase(): Promise<void> {
        // No-op: native SQLite writes incrementally to disk via WAL mode
    }

    async close(): Promise<void> {
        // Clean up all timers to prevent memory leaks
        if (this.currentProgressTimer) {
            clearInterval(this.currentProgressTimer);
            this.currentProgressTimer = null;
        }

        // Reset progress tracking state to prevent memory leaks
        this.currentProgressName = null;
        this.currentProgressStartTime = null;
        this.progressTimings = [];

        // Checkpoint WAL to merge it back into the main database file before closing.
        // TRUNCATE mode resets the WAL file to zero bytes, keeping the directory tidy.
        if (this.db) {
            try {
                await this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
            } catch {
                // Non-critical — WAL will be checkpointed on next open
            }
        }

        // Close database connection
        if (this.db) {
            try {
                await this.db.close();
                this.db = null;
                debug("Database connection closed and resources cleaned up");
            } catch (error) {
                console.error("[SQLiteIndex] Error during database close:", error);
                this.db = null;
            }
        }
    }

    /**
     * Checkpoint the WAL file to keep it from growing unboundedly.
     * Call after large batch operations (sync, rebuild, etc.).
     */
    async walCheckpoint(): Promise<void> {
        if (!this.db) return;
        try {
            await this.db.exec("PRAGMA wal_checkpoint(PASSIVE)");
            debug("[SQLiteIndex] WAL checkpoint completed");
        } catch (error) {
            // Non-critical — SQLite's autocheckpoint will handle it eventually
            debug("[SQLiteIndex] WAL checkpoint failed (non-critical):", error);
        }
    }

    /**
     * Reclaim disk space by rebuilding the database file.
     * VACUUM rewrites the entire DB into a compact form, eliminating free pages
     * left by deleted rows. This is an expensive operation (~seconds for large DBs)
     * and should only be called infrequently (e.g., after schema recreation, large
     * deletions, or on explicit user request).
     *
     * NOTE: VACUUM cannot run inside a transaction and temporarily doubles disk usage.
     */
    async vacuum(): Promise<void> {
        if (!this.db) return;
        try {
            const start = globalThis.performance.now();
            await this.db.exec("VACUUM");
            const elapsed = globalThis.performance.now() - start;
            debug(`[SQLiteIndex] VACUUM completed in ${elapsed.toFixed(0)}ms`);
        } catch (error) {
            console.warn("[SQLiteIndex] VACUUM failed (non-critical):", error);
        }
    }

    /**
     * Transaction helper for batch operations.
     * Uses a promise-based mutex so that concurrent callers are serialized
     * instead of hitting "cannot start a transaction within a transaction".
     */
    async runInTransaction<T>(callback: () => T | Promise<T>): Promise<T> {
        if (!this.db) throw new Error("Database not initialized");

        // Queue behind any already-running transaction
        let releaseLock!: () => void;
        const previousLock = this.transactionLock;
        this.transactionLock = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });

        // Wait for the previous transaction to finish
        await previousLock;

        try {
            await this.db.run("BEGIN TRANSACTION");
            try {
                const result = await callback();
                await this.db.run("COMMIT");
                return result;
            } catch (error) {
                try {
                    await this.db.run("ROLLBACK");
                } catch (rollbackError) {
                    debug(`[SQLiteIndex] ROLLBACK failed: ${rollbackError}`);
                }
                throw error;
            }
        } finally {
            releaseLock();
        }
    }

    // Helper function to sanitize HTML content using enhanced regex parsing
    private sanitizeContent(htmlContent: string): string {
        if (!htmlContent) return '';

        // Use enhanced regex approach since we want to avoid heavy dependencies
        return this.parseAndSanitizeHtml(htmlContent);
    }

    // Enhanced HTML sanitization method using improved regex patterns
    private parseAndSanitizeHtml(htmlContent: string): string {
        if (!htmlContent) return '';

        let cleanContent = htmlContent;

        // Step 1: Remove footnote sup tags completely (including all nested content)
        // Handle both class-based and data-attribute-based footnotes
        cleanContent = cleanContent
            .replace(/<sup[^>]*class=["']footnote-marker["'][^>]*>[\s\S]*?<\/sup>/gi, '')
            .replace(/<sup[^>]*data-footnote[^>]*>[\s\S]*?<\/sup>/gi, '')
            .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, ''); // Remove any remaining sup tags

        // Step 2: Remove suggestion markup and other unwanted elements
        // (The spell-check regex strips legacy elements with "spell-check" CSS classes)
        cleanContent = cleanContent
            .replace(/<[^>]*class=["'][^"']*spell-check[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');

        // Step 3: Replace paragraph end tags with spaces to preserve word boundaries
        cleanContent = cleanContent.replace(/<\/p>/gi, ' ');

        // Step 4: Remove all remaining HTML tags
        cleanContent = cleanContent.replace(/<[^>]*>/g, '');

        // Step 5: Clean up HTML entities and normalize whitespace
        cleanContent = cleanContent
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#\d+;/g, ' ') // Remove numeric HTML entities
            .replace(/&[a-zA-Z]+;/g, ' ') // Remove named HTML entities
            .replace(/\s+/g, ' ') // Normalize all whitespace to single spaces
            .trim();

        return cleanContent;
    }

    // Delete the database file from disk
    private async deleteDatabaseFile(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error("No workspace folder found");
            }

            const dbPath = vscode.Uri.joinPath(workspaceFolder.uri, ...INDEX_DB_PATH);

            try {
                await vscode.workspace.fs.delete(dbPath);
                debug("Database file deleted successfully");
            } catch (deleteError) {
                debug("[SQLiteIndex] Could not delete database file:", deleteError);
                // Don't throw here - we want to continue with reindex even if file deletion fails
            }
        } catch (error) {
            console.error("[SQLiteIndex] Error deleting database file:", error);
        }
    }

    // Manual command to delete database and trigger reindex
    async deleteDatabaseAndTriggerReindex(): Promise<void> {
        debug("Manual database deletion requested...");

        // Show user confirmation
        const vscode = await import('vscode');
        const confirm = await vscode.window.showWarningMessage(
            "This will reset the AI's knowledge and start fresh. This may take a few moments. Continue?",
            { modal: true },
            "Yes, Reset AI"
        );

        if (confirm === "Yes, Reset AI") {
            // Log AI reset to console instead of showing to user
            debug("[SQLiteIndex] AI preparing to learn from scratch...");

            // Close current database connection
            await this.close();

            // Delete the database file
            await this.deleteDatabaseFile();

            debug("[SQLiteIndex] ✅ AI reset complete.");
            vscode.window.showInformationMessage("AI reset complete. Please reload the extension to continue.");
        }
    }

    /**
     * Check which files need synchronization based on content hash and modification time
     */
    async checkFilesForSync(filePaths: string[]): Promise<{
        needsSync: string[];
        unchanged: string[];
        details: Map<string, { reason: string; oldHash?: string; newHash?: string; }>;
    }> {
        if (!this.db) throw new Error("Database not initialized");

        const needsSync: string[] = [];
        const unchanged: string[] = [];
        const details = new Map<string, { reason: string; oldHash?: string; newHash?: string; }>();

        for (const filePath of filePaths) {
            try {
                // Get file stats
                const fileUri = vscode.Uri.file(filePath);
                const fileStat = await vscode.workspace.fs.stat(fileUri);
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                const newContentHash = createHash("sha256").update(fileContent).digest("hex");

                // Check sync metadata
                const existingRecord = await this.db!.get<{
                    content_hash: string;
                    last_modified_ms: number;
                    file_size: number;
                }>(`
                    SELECT content_hash, last_modified_ms, file_size 
                    FROM sync_metadata 
                    WHERE file_path = ?
                `, [filePath]);

                if (!existingRecord) {
                    needsSync.push(filePath);
                    details.set(filePath, {
                        reason: "new file - not in sync metadata",
                        newHash: newContentHash
                    });
                } else if (existingRecord.content_hash !== newContentHash) {
                    needsSync.push(filePath);
                    details.set(filePath, {
                        reason: "content changed - hash mismatch",
                        oldHash: existingRecord.content_hash,
                        newHash: newContentHash
                    });
                } else if (existingRecord.last_modified_ms !== fileStat.mtime) {
                    needsSync.push(filePath);
                    details.set(filePath, {
                        reason: "modification time changed - possible external edit",
                        oldHash: existingRecord.content_hash,
                        newHash: newContentHash
                    });
                } else if (existingRecord.file_size !== fileStat.size) {
                    needsSync.push(filePath);
                    details.set(filePath, {
                        reason: "file size changed",
                        oldHash: existingRecord.content_hash,
                        newHash: newContentHash
                    });
                } else {
                    unchanged.push(filePath);
                    details.set(filePath, {
                        reason: "no changes detected",
                        oldHash: existingRecord.content_hash,
                        newHash: newContentHash
                    });
                }
            } catch (error) {
                console.error(`[SQLiteIndex] Error checking file ${filePath}:`, error);
                needsSync.push(filePath);
                details.set(filePath, {
                    reason: `error checking file: ${error instanceof Error ? error.message : 'unknown error'}`
                });
            }
        }

        return { needsSync, unchanged, details };
    }

    /**
     * Update sync metadata for a file after successful indexing
     */
    async updateSyncMetadata(
        filePath: string,
        fileType: "source" | "codex",
        contentHash: string,
        fileSize: number,
        lastModifiedMs: number
    ): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        await this.db!.run(`
            INSERT INTO sync_metadata (file_path, file_type, content_hash, file_size, last_modified_ms, last_synced_ms)
            VALUES (?, ?, ?, ?, ?, strftime('%s', 'now') * 1000)
            ON CONFLICT(file_path) DO UPDATE SET
                content_hash = excluded.content_hash,
                file_size = excluded.file_size,
                last_modified_ms = excluded.last_modified_ms,
                last_synced_ms = strftime('%s', 'now') * 1000,
                updated_at = strftime('%s', 'now') * 1000
        `, [filePath, fileType, contentHash, fileSize, lastModifiedMs]);
    }

    /**
     * Get sync statistics for debugging/monitoring
     */
    async getSyncStats(): Promise<{
        totalFiles: number;
        sourceFiles: number;
        codexFiles: number;
        avgFileSize: number;
        oldestSync: Date | null;
        newestSync: Date | null;
    }> {
        if (!this.db) throw new Error("Database not initialized");

        const result = await this.db!.get<{
            total_files: number;
            source_files: number;
            codex_files: number;
            avg_file_size: number;
            oldest_sync_ms: number | null;
            newest_sync_ms: number | null;
        }>(`
            SELECT 
                COUNT(*) as total_files,
                COUNT(CASE WHEN file_type = 'source' THEN 1 END) as source_files,
                COUNT(CASE WHEN file_type = 'codex' THEN 1 END) as codex_files,
                AVG(file_size) as avg_file_size,
                MIN(last_synced_ms) as oldest_sync_ms,
                MAX(last_synced_ms) as newest_sync_ms
            FROM sync_metadata
        `);

        if (!result) {
            return {
                totalFiles: 0,
                sourceFiles: 0,
                codexFiles: 0,
                avgFileSize: 0,
                oldestSync: null,
                newestSync: null,
            };
        }

        return {
            totalFiles: result.total_files || 0,
            sourceFiles: result.source_files || 0,
            codexFiles: result.codex_files || 0,
            avgFileSize: result.avg_file_size || 0,
            oldestSync: result.oldest_sync_ms ? new Date(result.oldest_sync_ms) : null,
            newestSync: result.newest_sync_ms ? new Date(result.newest_sync_ms) : null,
        };
    }

    /**
     * Remove sync metadata for files that no longer exist
     */
    async cleanupSyncMetadata(existingFilePaths: string[]): Promise<number> {
        if (!this.db) throw new Error("Database not initialized");

        if (existingFilePaths.length === 0) {
            // If no files exist, clear all sync metadata
            const result = await this.db!.run("DELETE FROM sync_metadata");
            return result.changes;
        }

        // Create placeholders for IN clause
        const placeholders = existingFilePaths.map(() => '?').join(',');
        const result = await this.db!.run(`
            DELETE FROM sync_metadata 
            WHERE file_path NOT IN (${placeholders})
        `, existingFilePaths);
        return result.changes;
    }

    /**
     * Clean up duplicate source cells by removing entries from "unknown" file
     * when the same cell exists in a proper source file
     */
    async deduplicateSourceCells(): Promise<{
        duplicatesRemoved: number;
        cellsAffected: number;
        unknownFileRemoved: boolean;
    }> {
        if (!this.db) throw new Error("Database not initialized");

        debug("Starting source cell deduplication...");

        // First, identify the "unknown" file ID
        const unknownFileRow = await this.db!.get<{ id: number }>(`
            SELECT id FROM files WHERE file_path = 'unknown' AND file_type = 'source'
        `);
        const unknownFileId: number | null = unknownFileRow?.id ?? null;

        if (!unknownFileId) {
            debug("No 'unknown' source file found - no deduplication needed");
            return { duplicatesRemoved: 0, cellsAffected: 0, unknownFileRemoved: false };
        }

        debug(`Found 'unknown' file with ID: ${unknownFileId}`);

        // Find all cell_ids that exist both in 'unknown' file and in proper source files
        const duplicateQuery = `
            SELECT DISTINCT c.cell_id
            FROM cells c
            WHERE c.s_file_id = ?
            AND c.s_content IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM cells c2 
                JOIN files f ON c2.s_file_id = f.id
                WHERE c2.cell_id = c.cell_id 
                AND c2.s_file_id != ?
                AND c2.s_content IS NOT NULL
                AND f.file_path != 'unknown'
            )
        `;

        const duplicateRows = await this.db!.all<{ cell_id: string }>(duplicateQuery, [unknownFileId, unknownFileId]);
        const duplicatesToRemove: Array<{ cellId: string; }> = [];
        for (const row of duplicateRows) {
            duplicatesToRemove.push({
                cellId: row.cell_id
            });
        }

        debug(`Found ${duplicatesToRemove.length} duplicate cells to remove from 'unknown' file`);

        if (duplicatesToRemove.length === 0) {
            return { duplicatesRemoved: 0, cellsAffected: 0, unknownFileRemoved: false };
        }

        // Remove duplicates from 'unknown' file in batches
        let duplicatesRemoved = 0;
        await this.runInTransaction(async () => {
            for (const duplicate of duplicatesToRemove) {
                try {
                    await this.db!.run("DELETE FROM cells_fts WHERE cell_id = ? AND content_type = 'source'", [duplicate.cellId]);
                } catch (error) {
                    // Continue even if FTS delete fails
                }
            }

            for (const duplicate of duplicatesToRemove) {
                await this.db!.run(`
                    UPDATE cells 
                    SET s_file_id = NULL,
                        s_content = NULL,
                        s_raw_content = NULL,
                        s_line_number = NULL,
                        s_word_count = NULL,
                        s_raw_content_hash = NULL,
                        s_updated_at = datetime('now')
                    WHERE cell_id = ? AND s_file_id = ?
                `, [duplicate.cellId, unknownFileId]);
                duplicatesRemoved++;
            }
        });

        // Check if 'unknown' file now has any remaining cells
        const remainingRow = await this.db.get<{ count: number }>(
            "SELECT COUNT(*) as count FROM cells WHERE s_file_id = ? OR t_file_id = ?",
            [unknownFileId, unknownFileId]
        );
        const remainingCells = remainingRow?.count ?? 0;

        // If no cells remain, remove the 'unknown' file entry
        let unknownFileRemoved = false;
        if (remainingCells === 0) {
            await this.db!.run("DELETE FROM files WHERE id = ?", [unknownFileId]);
            unknownFileRemoved = true;
            debug("Removed empty 'unknown' file entry");
        }

        // Refresh FTS index to ensure consistency
        await this.refreshFTSIndex();

        debug(`Deduplication complete: removed ${duplicatesRemoved} duplicate cells`);
        debug(`Cells affected: ${duplicatesToRemove.length}`);
        debug(`Unknown file removed: ${unknownFileRemoved}`);

        return {
            duplicatesRemoved,
            cellsAffected: duplicatesToRemove.length,
            unknownFileRemoved
        };
    }

    // Search for complete translation pairs only (cells with both source AND target content)
    async searchCompleteTranslationPairs(
        query: string,
        limit: number = 30,
        returnRawContent: boolean = false,
        searchSourceOnly: boolean = true  // true for few-shot examples, false for UI search
    ): Promise<any[]> {
        if (!this.db) throw new Error("Database not initialized");

        // Handle empty query by returning recent complete pairs
        if (!query || query.trim() === '') {
            const sql = `
                SELECT 
                    c.cell_id,
                    c.s_content as source_content,
                    c.s_raw_content as raw_source_content,
                    c.t_content as target_content,
                    c.t_raw_content as raw_target_content,
                    COALESCE(s_file.file_path, t_file.file_path) as uri,
                    COALESCE(c.s_line_number, c.t_line_number) as line,
                    0 as score
                FROM cells c
                LEFT JOIN files s_file ON c.s_file_id = s_file.id
                LEFT JOIN files t_file ON c.t_file_id = t_file.id
                WHERE c.s_content IS NOT NULL 
                    AND c.s_content != ''
                    AND c.t_content IS NOT NULL 
                    AND c.t_content != ''
                ORDER BY c.cell_id DESC
                LIMIT ?
            `;

            const rows = await this.db!.all<{
                cell_id: string;
                source_content: string;
                raw_source_content: string | null;
                target_content: string;
                raw_target_content: string | null;
                uri: string | null;
                line: number | null;
                score: number;
            }>(sql, [limit]);
            const results = [];

            for (const row of rows) {
                results.push({
                    cellId: row.cell_id,
                    cell_id: row.cell_id,
                    sourceContent: returnRawContent && row.raw_source_content ? row.raw_source_content : row.source_content,
                    targetContent: returnRawContent && row.raw_target_content ? row.raw_target_content : row.target_content,
                    content: returnRawContent && row.raw_source_content ? row.raw_source_content : row.source_content,
                    uri: row.uri,
                    line: row.line,
                    score: row.score,
                    cell_type: 'source' // For compatibility
                });
            }

            return results;
        }

        // Tokenize query - keep single characters for short queries
        const trimmedQuery = query.trim();
        const words = trimmedQuery
            .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(token => token.length > 0);

        // If no valid words after tokenization, return empty (don't fall back to random results)
        if (words.length === 0) {
            return [];
        }

        // Generate search terms for FTS5
        const searchTerms: string[] = [];
        for (const word of words) {
            // Always add the full word
            searchTerms.push(word);

            // For words 2+ chars, add prefix wildcard for partial matching
            if (word.length >= 2) {
                searchTerms.push(word + '*');
            }
        }

        // Build FTS5 query - use OR matching, limit terms for performance
        const maxTerms = 30;
        const finalTerms = searchTerms.slice(0, maxTerms);
        const cleanQuery = finalTerms.length > 0 ? finalTerms.join(' OR ') : words[0];

        // Simple substring match for the original query - ensures "ccc" matches "cccb"
        // Escape % and _ for LIKE (SQL wildcards)
        const escapedQuery = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
        const likePattern = `%${escapedQuery}%`;

        // Enhanced FTS5 query - search source (and optionally target) content for complete pairs
        // Use UNION to combine FTS5 MATCH results with LIKE substring matching
        // (FTS5 MATCH can't be combined with OR in WHERE clause)
        const ftsContentTypeFilter = searchSourceOnly ? "cells_fts.content_type = 'source'" : "(cells_fts.content_type = 'source' OR cells_fts.content_type = 'target')";

        // Build LIKE conditions - search source always, target only if searchSourceOnly is false
        const likeConditions = searchSourceOnly
            ? "(c.s_content LIKE ? OR c.s_raw_content LIKE ?)"
            : "(c.s_content LIKE ? OR c.t_content LIKE ? OR c.s_raw_content LIKE ? OR c.t_raw_content LIKE ?)";

        const sql = `
            SELECT DISTINCT 
                cell_id,
                source_content,
                raw_source_content,
                target_content,
                raw_target_content,
                line,
                uri,
                score
            FROM (
                -- FTS5 search results
                SELECT DISTINCT 
                    c.cell_id,
                    c.s_content as source_content,
                    c.s_raw_content as raw_source_content,
                    c.t_content as target_content,
                    c.t_raw_content as raw_target_content,
                    c.s_line_number as line,
                    COALESCE(s_file.file_path, t_file.file_path) as uri,
                    bm25(cells_fts) as score
                FROM cells_fts
                JOIN cells c ON cells_fts.cell_id = c.cell_id
                LEFT JOIN files s_file ON c.s_file_id = s_file.id
                LEFT JOIN files t_file ON c.t_file_id = t_file.id
                WHERE cells_fts MATCH ?
                    AND ${ftsContentTypeFilter}
                    AND c.s_content IS NOT NULL 
                    AND c.s_content != ''
                    AND c.t_content IS NOT NULL 
                    AND c.t_content != ''
                
                UNION
                
                -- LIKE substring search results (for cases FTS5 might miss)
                SELECT DISTINCT 
                    c.cell_id,
                    c.s_content as source_content,
                    c.s_raw_content as raw_source_content,
                    c.t_content as target_content,
                    c.t_raw_content as raw_target_content,
                    c.s_line_number as line,
                    COALESCE(s_file.file_path, t_file.file_path) as uri,
                    0.0 as score
                FROM cells c
                LEFT JOIN files s_file ON c.s_file_id = s_file.id
                LEFT JOIN files t_file ON c.t_file_id = t_file.id
                WHERE ${likeConditions}
                    AND c.s_content IS NOT NULL 
                    AND c.s_content != ''
                    AND c.t_content IS NOT NULL 
                    AND c.t_content != ''
            )
            ORDER BY score ASC
            LIMIT ?
        `;

        const results = [];

        try {
            // Use both FTS5 query and LIKE pattern for substring matching
            // Bind parameters depend on searchSourceOnly
            let rows: Array<{
                cell_id: string;
                source_content: string;
                raw_source_content: string | null;
                target_content: string;
                raw_target_content: string | null;
                uri: string | null;
                line: number | null;
                score: number;
            }>;
            if (searchSourceOnly) {
                rows = await this.db!.all<{
                    cell_id: string;
                    source_content: string;
                    raw_source_content: string | null;
                    target_content: string;
                    raw_target_content: string | null;
                    uri: string | null;
                    line: number | null;
                    score: number;
                }>(sql, [cleanQuery, likePattern, likePattern, limit]);
            } else {
                rows = await this.db!.all<{
                    cell_id: string;
                    source_content: string;
                    raw_source_content: string | null;
                    target_content: string;
                    raw_target_content: string | null;
                    uri: string | null;
                    line: number | null;
                    score: number;
                }>(sql, [cleanQuery, likePattern, likePattern, likePattern, likePattern, limit]);
            }

            for (const row of rows) {
                // Target content is now directly available from the main query
                const targetContent = row.target_content;
                const rawTargetContent = row.raw_target_content;

                // Both source and target content are guaranteed to exist due to the WHERE clause
                results.push({
                    cellId: row.cell_id,
                    cell_id: row.cell_id,
                    sourceContent: returnRawContent && row.raw_source_content ? row.raw_source_content : row.source_content,
                    targetContent: returnRawContent && rawTargetContent ? rawTargetContent : targetContent,
                    content: returnRawContent && row.raw_source_content ? row.raw_source_content : row.source_content,
                    uri: row.uri,
                    line: row.line,
                    score: row.score,
                    cell_type: 'source' // For compatibility
                });
            }
        } catch (error) {
            console.error(`[searchCompleteTranslationPairs] FTS5 query failed: ${error}`);
            return [];
        }



        return results;
    }

    /**
     * Search for complete translation pairs filtered by validation status
     * @param query - Search query string
     * @param limit - Maximum results to return (default: 30)
     * @param returnRawContent - If true, return raw content with HTML; if false, return sanitized content (default: false)
     * @param onlyValidated - If true, only return pairs where target content has been validated by at least one user (default: false)
     * @returns Array of search results with validation filtering applied
     */
    async searchCompleteTranslationPairsWithValidation(
        query: string,
        limit: number = 30,
        returnRawContent: boolean = false,
        onlyValidated: boolean = false,
        searchSourceOnly: boolean = true  // true for few-shot examples, false for UI search when searchScope === "both"
    ): Promise<any[]> {
        // If validation filtering is not required, use the existing method
        if (!onlyValidated) {
            return this.searchCompleteTranslationPairs(query, limit, returnRawContent, searchSourceOnly);
        }

        if (!this.db) throw new Error("Database not initialized");

        // Handle empty query by returning recent complete validated pairs
        if (!query || query.trim() === '') {
            const sql = `
                SELECT 
                    c.cell_id,
                    c.s_content as source_content,
                    c.s_raw_content as raw_source_content,
                    c.t_content as target_content,
                    c.t_raw_content as raw_target_content,
                    COALESCE(s_file.file_path, t_file.file_path) as uri,
                    COALESCE(c.s_line_number, c.t_line_number) as line,
                    0 as score
                FROM cells c
                LEFT JOIN files s_file ON c.s_file_id = s_file.id
                LEFT JOIN files t_file ON c.t_file_id = t_file.id
                WHERE c.s_content IS NOT NULL 
                    AND c.s_content != ''
                    AND c.t_content IS NOT NULL 
                    AND c.t_content != ''
                    ${onlyValidated ? "AND c.t_is_fully_validated = 1" : ""}
                ORDER BY c.cell_id DESC
                LIMIT ?
            `;

            const rows = await this.db!.all<{
                cell_id: string;
                source_content: string;
                raw_source_content: string | null;
                target_content: string;
                raw_target_content: string | null;
                uri: string | null;
                line: number | null;
                score: number;
            }>(sql, [limit]);
            const results = [];

            // The SQL already filters with "AND c.t_is_fully_validated = 1" when
            // onlyValidated is true, so no per-row isTargetCellFullyValidated check is needed.
            for (const row of rows) {
                results.push({
                    cellId: row.cell_id,
                    cell_id: row.cell_id,
                    sourceContent: returnRawContent && row.raw_source_content ? row.raw_source_content : row.source_content,
                    targetContent: returnRawContent && row.raw_target_content ? row.raw_target_content : row.target_content,
                    content: returnRawContent && row.raw_source_content ? row.raw_source_content : row.source_content,
                    uri: row.uri,
                    line: row.line,
                    score: row.score,
                    cell_type: 'source' // For compatibility
                });
            }

            return results;
        }

        // Tokenize query - keep single characters for short queries
        const trimmedQuery = query.trim();
        const words = trimmedQuery
            .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(token => token.length > 0);

        // If no valid words after tokenization, return empty (don't fall back to random results)
        if (words.length === 0) {
            return [];
        }

        // Generate search terms for FTS5
        const searchTerms: string[] = [];
        for (const word of words) {
            // Always add the full word
            searchTerms.push(word);

            // For words 2+ chars, add prefix wildcard for partial matching
            if (word.length >= 2) {
                searchTerms.push(word + '*');
            }
        }

        // Build FTS5 query - use OR matching, limit terms for performance
        const maxTerms = 30;
        const finalTerms = searchTerms.slice(0, maxTerms);
        const cleanQuery = finalTerms.length > 0 ? finalTerms.join(' OR ') : words[0];

        // Simple substring match for the original query - ensures "ccc" matches "cccb"
        // Escape % and _ for LIKE (SQL wildcards)
        const escapedQuery = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
        const likePattern = `%${escapedQuery}%`;

        // Enhanced FTS5 query - search source (and optionally target) content for complete pairs
        // Use UNION to combine FTS5 MATCH results with LIKE substring matching
        // (FTS5 MATCH can't be combined with OR in WHERE clause)
        const ftsContentTypeFilter = searchSourceOnly ? "cells_fts.content_type = 'source'" : "(cells_fts.content_type = 'source' OR cells_fts.content_type = 'target')";

        // Build LIKE conditions - search source always, target only if searchSourceOnly is false
        const likeConditions = searchSourceOnly
            ? "(c.s_content LIKE ? OR c.s_raw_content LIKE ?)"
            : "(c.s_content LIKE ? OR c.t_content LIKE ? OR c.s_raw_content LIKE ? OR c.t_raw_content LIKE ?)";

        // FTS5 query with validation filtering
        // Use UNION to combine FTS5 MATCH results with LIKE substring matching
        // (FTS5 MATCH can't be combined with OR in WHERE clause)
        // Include t_content/t_raw_content in SELECT to avoid per-row target lookups (N+1).
        // Add validation filter directly in SQL instead of per-row isTargetCellFullyValidated.
        const validationFilter = onlyValidated ? "AND c.t_is_fully_validated = 1" : "";
        const sql = `
            SELECT DISTINCT
                cell_id,
                source_content,
                raw_source_content,
                target_content,
                raw_target_content,
                line,
                uri,
                score
            FROM (
                -- FTS5 search results
                SELECT 
                    c.cell_id,
                    c.s_content as source_content,
                    c.s_raw_content as raw_source_content,
                    c.t_content as target_content,
                    c.t_raw_content as raw_target_content,
                    c.s_line_number as line,
                    COALESCE(s_file.file_path, t_file.file_path) as uri,
                    bm25(cells_fts) as score
                FROM cells_fts
                JOIN cells c ON cells_fts.cell_id = c.cell_id
                LEFT JOIN files s_file ON c.s_file_id = s_file.id
                LEFT JOIN files t_file ON c.t_file_id = t_file.id
                WHERE cells_fts MATCH ?
                    AND ${ftsContentTypeFilter}
                    AND c.s_content IS NOT NULL 
                    AND c.s_content != ''
                    AND c.t_content IS NOT NULL 
                    AND c.t_content != ''
                    ${validationFilter}
                
                UNION
                
                -- LIKE substring search results (for cases FTS5 might miss)
                SELECT 
                    c.cell_id,
                    c.s_content as source_content,
                    c.s_raw_content as raw_source_content,
                    c.t_content as target_content,
                    c.t_raw_content as raw_target_content,
                    c.s_line_number as line,
                    COALESCE(s_file.file_path, t_file.file_path) as uri,
                    0.0 as score
                FROM cells c
                LEFT JOIN files s_file ON c.s_file_id = s_file.id
                LEFT JOIN files t_file ON c.t_file_id = t_file.id
                WHERE ${likeConditions}
                    AND c.s_content IS NOT NULL 
                    AND c.s_content != ''
                    AND c.t_content IS NOT NULL 
                    AND c.t_content != ''
                    ${validationFilter}
            )
            ORDER BY score ASC
            LIMIT ?
        `;

        const results = [];

        try {
            // Use both FTS5 query and LIKE pattern for substring matching
            // Bind parameters depend on searchSourceOnly
            // Row type now includes target_content/raw_target_content from the SQL
            type SearchRow = {
                cell_id: string;
                source_content: string;
                raw_source_content: string | null;
                target_content: string | null;
                raw_target_content: string | null;
                uri: string | null;
                line: number | null;
                score: number;
            };
            let rows: SearchRow[];
            if (searchSourceOnly) {
                rows = await this.db!.all<SearchRow>(sql, [cleanQuery, likePattern, likePattern, limit]);
            } else {
                rows = await this.db!.all<SearchRow>(sql, [cleanQuery, likePattern, likePattern, likePattern, likePattern, limit]);
            }

            // Validation and target content are now filtered/included at the SQL level —
            // no per-row isTargetCellFullyValidated or target content lookup needed.
            for (const row of rows) {
                const targetContent = row.target_content ?? '';
                const rawTargetContent = row.raw_target_content ?? '';

                if (targetContent) {
                    results.push({
                        cellId: row.cell_id,
                        cell_id: row.cell_id,
                        sourceContent: returnRawContent && row.raw_source_content ? row.raw_source_content : row.source_content,
                        targetContent: returnRawContent && rawTargetContent ? rawTargetContent : targetContent,
                        content: returnRawContent && row.raw_source_content ? row.raw_source_content : row.source_content,
                        uri: row.uri,
                        line: row.line,
                        score: row.score,
                        cell_type: 'source' // For compatibility
                    });
                }
            }
        } catch (error) {
            console.error(`[searchCompleteTranslationPairsWithValidation] FTS5 query failed: ${error}`);
            return [];
        }

        return results;
    }

    /**
     * Check if a target cell has been validated by at least one user
     * @param cellId - The cell ID to check
     * @returns True if the target cell has been validated, false otherwise
     */
    private async isTargetCellFullyValidated(cellId: string): Promise<boolean> {
        if (!this.db) return false;

        // Get the target cell's validation status from dedicated columns
        try {
            const row = await this.db!.get<{ t_is_fully_validated: number | null }>(`
                SELECT t_is_fully_validated FROM cells 
                WHERE cell_id = ? AND t_content IS NOT NULL
                LIMIT 1
            `, [cellId]);
            if (row) {
                return Boolean(row.t_is_fully_validated);
            }
        } catch (error) {
            console.error(`[isTargetCellFullyValidated] Error checking validation for ${cellId}:`, error);
        }

        return false;
    }

    /**
     * Check if a target cell's audio is fully validated (for performance optimization)
     */
    private async isTargetCellAudioFullyValidated(cellId: string): Promise<boolean> {
        if (!this.db) return false;

        // Get the target cell's audio validation status from dedicated columns
        try {
            const row = await this.db!.get<{ t_audio_is_fully_validated: number | null }>(`
                SELECT t_audio_is_fully_validated FROM cells 
                WHERE cell_id = ? AND t_content IS NOT NULL
                LIMIT 1
            `, [cellId]);
            if (row) {
                return Boolean(row.t_audio_is_fully_validated);
            }
        } catch (error) {
            console.error(`[isTargetCellAudioFullyValidated] Error checking audio validation for ${cellId}:`, error);
        }

        return false;
    }

    /**
     * Get the validation threshold for determining if a cell is "fully validated"
     * This reads from the same configuration as the Project Manager
     */
    private getValidationThreshold(): number {
        // Use the same configuration source as Project Manager
        return vscode.workspace.getConfiguration('codex-project-manager')
            .get('validationCount', 1); // Default to 1 validator required
    }

    /**
     * Get the validation threshold for determining if a cell is "fully validated"
     * This reads from the same configuration as the Project Manager
     */
    private getAudioValidationThreshold(): number {
        // Use the same configuration source as Project Manager
        return vscode.workspace.getConfiguration('codex-project-manager')
            .get('validationCountAudio', 1); // Default to 1 validator required
    }

    /**
     * Recalculate t_is_fully_validated for all cells based on current validation threshold
     * This should be called whenever the validation threshold setting changes
     */
    async recalculateAllValidationStatus(): Promise<{ updatedCells: number; }> {
        if (!this.db) throw new Error("Database not initialized");

        const currentThreshold = this.getValidationThreshold();

        // Update all target cells based on current validation count vs threshold
        const result = await this.db!.run(`
            UPDATE cells 
            SET t_is_fully_validated = CASE 
                WHEN t_validation_count >= ? THEN 1 
                ELSE 0 
            END
            WHERE t_content IS NOT NULL AND t_content != ''
        `, [currentThreshold]);
        const updatedCells = result.changes;

        return { updatedCells };
    }

    /**
     * Recalculate t_audio_is_fully_validated for all cells based on current audio validation threshold
     * This should be called whenever the audio validation threshold setting changes
     */
    async recalculateAllAudioValidationStatus(): Promise<{ updatedCells: number; }> {
        if (!this.db) throw new Error("Database not initialized");

        const currentThreshold = this.getAudioValidationThreshold();

        // Update all target cells based on current audio validation count vs threshold
        const result = await this.db!.run(`
            UPDATE cells 
            SET t_audio_is_fully_validated = CASE 
                WHEN t_audio_validation_count >= ? THEN 1 
                ELSE 0 
            END
        `, [currentThreshold]);
        const updatedCells = result.changes;

        return { updatedCells };
    }

    /**
     * Extract frequently accessed metadata fields for dedicated columns
     */
    private extractMetadataFields(metadata: any, cellType: "source" | "target"): {
        currentEditTimestamp?: number | null;
        validationCount?: number;
        validatedBy?: string;
        isFullyValidated?: boolean;
        audioValidationCount?: number;
        audioValidatedBy?: string;
        audioIsFullyValidated?: boolean;
    } {
        const result: {
            currentEditTimestamp?: number | null;
            validationCount?: number;
            validatedBy?: string;
            isFullyValidated?: boolean;
            audioValidationCount?: number;
            audioValidatedBy?: string;
            audioIsFullyValidated?: boolean;
        } = {};

        if (!metadata || typeof metadata !== "object" || cellType !== "target") {
            return result;
        }

        const edits = metadata.edits || [];

        if (edits.length > 0) {
            const valueEdits = edits.filter((edit: any) => edit.editMap && EditMapUtils.isValue(edit.editMap));

            if (valueEdits.length > 0) {
                const lastEdit = valueEdits[valueEdits.length - 1];
                result.currentEditTimestamp = lastEdit.timestamp || null;

                // Note: validatedBy is only present for cell-level edits (EditHistory).
                // File-level metadata edits (FileEditHistory) do not have validatedBy field.
                // For file-level metadata edits, validation tracking is not supported.
                if (lastEdit.validatedBy) {
                    // Cell-level edit with validation tracking
                    const activeValidations = (lastEdit as any).validatedBy.filter((v: any) => v && typeof v === "object" && !v.isDeleted);
                    result.validationCount = activeValidations.length;

                    // NEW: Check against validation threshold instead of just > 0
                    const requiredValidators = this.getValidationThreshold();
                    result.isFullyValidated = activeValidations.length >= requiredValidators;

                    // Store comma-separated list of usernames
                    const usernames = activeValidations.map((v: any) => v.username).filter((name: any) => typeof name === "string" && name.trim().length > 0);
                    result.validatedBy = usernames.length > 0 ? usernames.join(",") : undefined;
                }
            }
        }

        if (result.validationCount === undefined) {
            result.validationCount = 0;
            result.isFullyValidated = false;
            result.validatedBy = undefined;
        }

        // Extract audio validation information from attachments
        const audioDetails = this.collectAudioValidationDetails(
            metadata.attachments || {},
            metadata.selectedAudioId,
            metadata.selectionTimestamp
        );
        result.audioValidationCount = audioDetails.count;
        result.audioValidatedBy = audioDetails.usernames;
        result.audioIsFullyValidated = audioDetails.isFullyValidated;

        if (!result.currentEditTimestamp && audioDetails.latestTimestamp !== null) {
            result.currentEditTimestamp = audioDetails.latestTimestamp;
        }

        return result;
    }

    private collectAudioValidationDetails(attachments: Record<string, any>, selectedAudioId?: string, selectionTimestamp?: number): {
        count: number;
        usernames?: string;
        isFullyValidated: boolean;
        latestTimestamp: number | null;
    } {
        if (!attachments || typeof attachments !== "object") {
            return { count: 0, isFullyValidated: false, latestTimestamp: null };
        }

        const entries = Object.entries(attachments)
            .filter(([_, attachment]: [string, any]) => attachment && attachment.type === "audio");

        let currentAudioAttachment: any | null = null;
        if (selectedAudioId) {
            const selected = attachments[selectedAudioId];
            if (selected && selected.type === "audio" && !selected.isDeleted) {
                currentAudioAttachment = selected;
            }
        }

        if (!currentAudioAttachment) {
            const audioAttachments = entries.map(([_, att]) => att);
            if (audioAttachments.length === 0) {
                return { count: 0, isFullyValidated: false, latestTimestamp: null };
            }
            currentAudioAttachment = audioAttachments.sort((a: any, b: any) =>
                (b.updatedAt || 0) - (a.updatedAt || 0)
            )[0];
        }

        const validatedBy = Array.isArray((currentAudioAttachment as any).validatedBy)
            ? (currentAudioAttachment as any).validatedBy
            : [];

        const activeAudioValidations = validatedBy.filter((entry: any) =>
            entry && typeof entry === "object" && !entry.isDeleted
        );

        const count = activeAudioValidations.length;
        // Check against audio validation threshold
        const requiredAudioValidators = this.getAudioValidationThreshold();
        let threshold = requiredAudioValidators;
        if (currentAudioAttachment && currentAudioAttachment.type === "audio") {
            const attachmentMetadata = (currentAudioAttachment as any).metadata;
            if (
                attachmentMetadata &&
                typeof attachmentMetadata === "object" &&
                typeof attachmentMetadata.requiredAudioValidations === "number"
            ) {
                threshold = attachmentMetadata.requiredAudioValidations;
            }
        }

        const isFullyValidated = count >= threshold;

        const usernames = activeAudioValidations
            .map((entry: any) => entry.username)
            .filter((name: any) => typeof name === "string" && name.trim().length > 0);

        const latestTimestamp = activeAudioValidations
            .map((entry: any) =>
                typeof entry.updatedTimestamp === "number"
                    ? entry.updatedTimestamp
                    : typeof entry.creationTimestamp === "number"
                        ? entry.creationTimestamp
                        : null
            )
            .filter((ts: number | null) => typeof ts === "number")
            .reduce((latest: number | null, ts: number | null) => {
                if (typeof ts !== "number") {
                    return latest;
                }
                if (latest === null || ts > latest) {
                    return ts;
                }
                return latest;
            }, null as number | null);

        const effectiveTimestamp = selectionTimestamp && selectionTimestamp > (latestTimestamp || 0)
            ? selectionTimestamp
            : latestTimestamp;

        return {
            count,
            usernames: usernames.length > 0 ? usernames.join(",") : undefined,
            isFullyValidated,
            latestTimestamp: effectiveTimestamp,
        };
    }

    /**
     * Force database recreation for testing/debugging purposes
     */
    async forceRecreateDatabase(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        debug("[SQLiteIndex] Force recreating database...");
        await this.recreateDatabase();
        debug("[SQLiteIndex] Database recreation completed");
    }

    /**
     * Get detailed schema information for debugging
     */
    async getDetailedSchemaInfo(): Promise<{
        currentVersion: number;
        schemaInfoRows: any[];
        cellsTableExists: boolean;
        cellsColumns: string[];
        hasNewStructure: boolean;
    }> {
        if (!this.db) throw new Error("Database not initialized");

        const currentVersion = await this.getSchemaVersion();

        // Get all schema_info rows
        let schemaInfoRows: any[] = [];
        try {
            schemaInfoRows = await this.db!.all<any>("SELECT * FROM schema_info");
        } catch {
            // Table might not exist
        }

        // Check if cells table exists and its structure
        let cellsTableExists = false;
        const cellsColumns: string[] = [];
        try {
            const cellsColumnRows = await this.db!.all<{ name: string }>("PRAGMA table_info(cells)");
            for (const row of cellsColumnRows) {
                cellsTableExists = true;
                cellsColumns.push(row.name);
            }
        } catch {
            // Table might not exist
        }

        const hasNewStructure = cellsColumns.includes('s_content') && cellsColumns.includes('t_content');

        return {
            currentVersion,
            schemaInfoRows,
            cellsTableExists,
            cellsColumns,
            hasNewStructure
        };
    }

    /**
     * Debug method to check line number population in the database
     * This reflects our logic: source cells always get line numbers, target cells only when they have content
     */
    async getLineNumberStats(): Promise<{
        totalCells: number;
        cellsWithSourceLineNumbers: number;
        cellsWithTargetLineNumbers: number;
        cellsWithNullSourceLineNumbers: number;
        cellsWithNullTargetLineNumbers: number;
        targetCellsWithContent: number;
        targetCellsWithoutContent: number;
        sampleCellsWithLineNumbers: Array<{
            cellId: string;
            sourceLineNumber: number | null;
            targetLineNumber: number | null;
            sourceFilePath: string | null;
            targetFilePath: string | null;
            hasSourceContent: boolean;
            hasTargetContent: boolean;
        }>;
    }> {
        if (!this.db) throw new Error("Database not initialized");

        // Get general stats
        const result = await this.db!.get<{
            total_cells: number;
            cells_with_source_line_numbers: number;
            cells_with_target_line_numbers: number;
            cells_with_null_source_line_numbers: number;
            cells_with_null_target_line_numbers: number;
            target_cells_with_content: number;
            target_cells_without_content: number;
        }>(`
            SELECT 
                COUNT(*) as total_cells,
                COUNT(c.s_line_number) as cells_with_source_line_numbers,
                COUNT(c.t_line_number) as cells_with_target_line_numbers,
                SUM(CASE WHEN c.s_line_number IS NULL THEN 1 ELSE 0 END) as cells_with_null_source_line_numbers,
                SUM(CASE WHEN c.t_line_number IS NULL THEN 1 ELSE 0 END) as cells_with_null_target_line_numbers,
                SUM(CASE WHEN c.t_content IS NOT NULL AND c.t_content != '' THEN 1 ELSE 0 END) as target_cells_with_content,
                SUM(CASE WHEN c.t_content IS NULL OR c.t_content = '' THEN 1 ELSE 0 END) as target_cells_without_content
            FROM cells c
        `);

        const stats = {
            totalCells: result?.total_cells ?? 0,
            cellsWithSourceLineNumbers: result?.cells_with_source_line_numbers ?? 0,
            cellsWithTargetLineNumbers: result?.cells_with_target_line_numbers ?? 0,
            cellsWithNullSourceLineNumbers: result?.cells_with_null_source_line_numbers ?? 0,
            cellsWithNullTargetLineNumbers: result?.cells_with_null_target_line_numbers ?? 0,
            targetCellsWithContent: result?.target_cells_with_content ?? 0,
            targetCellsWithoutContent: result?.target_cells_without_content ?? 0
        };

        // Get sample cells with line numbers
        const sampleRows = await this.db!.all<{
            cell_id: string;
            source_line_number: number | null;
            target_line_number: number | null;
            source_file_path: string | null;
            target_file_path: string | null;
            has_source_content: number;
            has_target_content: number;
        }>(`
            SELECT 
                c.cell_id,
                c.s_line_number as source_line_number,
                c.t_line_number as target_line_number,
                s_file.file_path as source_file_path,
                t_file.file_path as target_file_path,
                CASE WHEN c.s_content IS NOT NULL AND c.s_content != '' THEN 1 ELSE 0 END as has_source_content,
                CASE WHEN c.t_content IS NOT NULL AND c.t_content != '' THEN 1 ELSE 0 END as has_target_content
            FROM cells c
            LEFT JOIN files s_file ON c.s_file_id = s_file.id
            LEFT JOIN files t_file ON c.t_file_id = t_file.id
            WHERE c.s_line_number IS NOT NULL OR c.t_line_number IS NOT NULL
            ORDER BY c.s_line_number, c.t_line_number
            LIMIT 10
        `);

        const sampleCells: Array<{
            cellId: string;
            sourceLineNumber: number | null;
            targetLineNumber: number | null;
            sourceFilePath: string | null;
            targetFilePath: string | null;
            hasSourceContent: boolean;
            hasTargetContent: boolean;
        }> = [];

        for (const row of sampleRows) {
            sampleCells.push({
                cellId: row.cell_id,
                sourceLineNumber: row.source_line_number,
                targetLineNumber: row.target_line_number,
                sourceFilePath: row.source_file_path,
                targetFilePath: row.target_file_path,
                hasSourceContent: Boolean(row.has_source_content),
                hasTargetContent: Boolean(row.has_target_content)
            });
        }

        return {
            ...stats,
            sampleCellsWithLineNumbers: sampleCells
        };
    }

    /**
     * Debug method to check target cell timestamp consistency after our fixes
     * This verifies that t_created_at is only populated for cells with content
     * and that t_current_edit_timestamp is properly populated from JSON metadata
     */
    async getTargetTimestampStats(): Promise<{
        totalTargetCells: number;
        targetCellsWithContent: number;
        targetCellsWithCreatedAt: number;
        targetCellsWithEditTimestamp: number;
        targetCellsWithContentButNoCreatedAt: number;
        targetCellsWithoutContentButWithCreatedAt: number;
        sampleTargetCells: Array<{
            cellId: string;
            hasContent: boolean;
            createdAt: number | null;
            editTimestamp: number | null;
            createdAtDate: string | null;
            editTimestampDate: string | null;
        }>;
        timestampConsistencyIssues: Array<{
            cellId: string;
            issue: string;
            hasContent: boolean;
            createdAt: number | null;
            editTimestamp: number | null;
        }>;
    }> {
        if (!this.db) throw new Error("Database not initialized");

        // Get general stats about target cell timestamps
        const result = await this.db!.get<{
            total_target_cells: number;
            target_cells_with_content: number;
            target_cells_with_created_at: number;
            target_cells_with_edit_timestamp: number;
            target_cells_with_content_but_no_created_at: number;
            target_cells_without_content_but_with_created_at: number;
        }>(`
            SELECT 
                COUNT(*) as total_target_cells,
                SUM(CASE WHEN c.t_content IS NOT NULL AND c.t_content != '' THEN 1 ELSE 0 END) as target_cells_with_content,
                COUNT(c.t_created_at) as target_cells_with_created_at,
                COUNT(c.t_current_edit_timestamp) as target_cells_with_edit_timestamp,
                SUM(CASE WHEN (c.t_content IS NOT NULL AND c.t_content != '') AND c.t_created_at IS NULL THEN 1 ELSE 0 END) as target_cells_with_content_but_no_created_at,
                SUM(CASE WHEN (c.t_content IS NULL OR c.t_content = '') AND c.t_created_at IS NOT NULL THEN 1 ELSE 0 END) as target_cells_without_content_but_with_created_at
            FROM cells c
            WHERE c.t_file_id IS NOT NULL OR c.t_content IS NOT NULL
        `);

        const stats = {
            totalTargetCells: result?.total_target_cells ?? 0,
            targetCellsWithContent: result?.target_cells_with_content ?? 0,
            targetCellsWithCreatedAt: result?.target_cells_with_created_at ?? 0,
            targetCellsWithEditTimestamp: result?.target_cells_with_edit_timestamp ?? 0,
            targetCellsWithContentButNoCreatedAt: result?.target_cells_with_content_but_no_created_at ?? 0,
            targetCellsWithoutContentButWithCreatedAt: result?.target_cells_without_content_but_with_created_at ?? 0
        };

        // Get sample target cells to inspect timestamps
        const sampleRows = await this.db!.all<{
            cell_id: string;
            has_content: number;
            created_at: number | null;
            edit_timestamp: number | null;
        }>(`
            SELECT 
                c.cell_id,
                CASE WHEN c.t_content IS NOT NULL AND c.t_content != '' THEN 1 ELSE 0 END as has_content,
                c.t_created_at as created_at,
                c.t_current_edit_timestamp as edit_timestamp
            FROM cells c
            WHERE c.t_file_id IS NOT NULL OR c.t_content IS NOT NULL
            ORDER BY c.t_created_at DESC, c.t_current_edit_timestamp DESC
            LIMIT 10
        `);

        const sampleCells: Array<{
            cellId: string;
            hasContent: boolean;
            createdAt: number | null;
            editTimestamp: number | null;
            createdAtDate: string | null;
            editTimestampDate: string | null;
        }> = [];

        for (const row of sampleRows) {
            sampleCells.push({
                cellId: row.cell_id,
                hasContent: Boolean(row.has_content),
                createdAt: row.created_at,
                editTimestamp: row.edit_timestamp,
                createdAtDate: row.created_at ? new Date(row.created_at).toISOString() : null,
                editTimestampDate: row.edit_timestamp ? new Date(row.edit_timestamp).toISOString() : null
            });
        }

        // Find timestamp consistency issues
        const issuesRows = await this.db!.all<{
            cell_id: string;
            has_content: number;
            created_at: number | null;
            edit_timestamp: number | null;
        }>(`
            SELECT 
                c.cell_id,
                CASE WHEN c.t_content IS NOT NULL AND c.t_content != '' THEN 1 ELSE 0 END as has_content,
                c.t_created_at as created_at,
                c.t_current_edit_timestamp as edit_timestamp
            FROM cells c
            WHERE (c.t_file_id IS NOT NULL OR c.t_content IS NOT NULL)
            AND (
                -- Issue 1: Has content but no created_at timestamp
                ((c.t_content IS NOT NULL AND c.t_content != '') AND c.t_created_at IS NULL)
                OR
                -- Issue 2: No content but has created_at timestamp
                ((c.t_content IS NULL OR c.t_content = '') AND c.t_created_at IS NOT NULL)
                OR
                -- Issue 3: Has content but no edit timestamp
                ((c.t_content IS NOT NULL AND c.t_content != '') AND c.t_current_edit_timestamp IS NULL)
            )
            LIMIT 20
        `);

        const timestampConsistencyIssues: Array<{
            cellId: string;
            issue: string;
            hasContent: boolean;
            createdAt: number | null;
            editTimestamp: number | null;
        }> = [];

        for (const row of issuesRows) {
            const hasContent = Boolean(row.has_content);
            const createdAt = row.created_at;
            const editTimestamp = row.edit_timestamp;

            let issue = '';
            if (hasContent && !createdAt) {
                issue = 'Has content but missing t_created_at';
            } else if (!hasContent && createdAt) {
                issue = 'No content but has t_created_at (should be NULL)';
            } else if (hasContent && !editTimestamp) {
                issue = 'Has content but missing t_current_edit_timestamp';
            }

            timestampConsistencyIssues.push({
                cellId: row.cell_id,
                issue,
                hasContent,
                createdAt,
                editTimestamp
            });
        }

        return {
            ...stats,
            sampleTargetCells: sampleCells,
            timestampConsistencyIssues
        };
    }
}
