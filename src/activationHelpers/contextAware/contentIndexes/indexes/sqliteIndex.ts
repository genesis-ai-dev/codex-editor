import * as vscode from "vscode";
import initSqlJs, { Database, SqlJsStatic } from "fts5-sql-bundle";
import { createHash } from "crypto";
import { TranslationPair, MinimalCellResult } from "../../../../../types";
import { updateSplashScreenTimings } from "../../../../providers/SplashScreen/register";
import { ActivationTiming } from "../../../../extension";
import { debounce } from "lodash";

const INDEX_DB_PATH = [".project", "indexes.sqlite"];

const DEBUG_MODE = false;
const debug = (message: string, ...args: any[]) => {
    DEBUG_MODE && console.log(`[SQLiteIndex] ${message}`, ...args);
};

// Schema version for migrations
export const CURRENT_SCHEMA_VERSION = 9; // Optimized schema: no redundant columns, proper timestamps, t_is_fully_validated with threshold logic and more

export class SQLiteIndexManager {
    private sql: SqlJsStatic | null = null;
    private db: Database | null = null;
    private saveDebounceTimer: NodeJS.Timeout | null = null;
    private readonly SAVE_DEBOUNCE_MS = 0;
    private progressTimings: ActivationTiming[] = [];
    private currentProgressTimer: NodeJS.Timeout | null = null;
    private currentProgressStartTime: number | null = null;
    private currentProgressName: string | null = null;
    private enableRealtimeProgress: boolean = true;

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
        console.log(`[Index] ${step}: ${duration.toFixed(2)}ms`);
    }

    async initialize(context: vscode.ExtensionContext): Promise<void> {
        const initStart = globalThis.performance.now();
        let stepStart = initStart;

        // Initialize SQL.js
        stepStart = this.trackProgress("Initialize SQL.js WASM", stepStart);
        const sqlWasmPath = vscode.Uri.joinPath(
            context.extensionUri,
            "out/node_modules/fts5-sql-bundle/dist/sql-wasm.wasm"
        );

        this.sql = await initSqlJs({
            locateFile: (file: string) => sqlWasmPath.fsPath,
        });

        if (!this.sql) {
            throw new Error("Failed to initialize SQL.js");
        }

        stepStart = this.trackProgress("SQL.js Ready", stepStart);

        // Load or create database
        await this.loadOrCreateDatabase();

        this.trackProgress("Database Setup Complete", initStart);
    }

    private async loadOrCreateDatabase(): Promise<void> {
        const loadStart = globalThis.performance.now();
        let stepStart = loadStart;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        const dbPath = vscode.Uri.joinPath(workspaceFolder.uri, ...INDEX_DB_PATH);

        stepStart = this.trackProgress("Check for existing database", stepStart);

        try {
            const fileContent = await vscode.workspace.fs.readFile(dbPath);
            stepStart = this.trackProgress("Load existing database file", stepStart);

            this.db = new this.sql!.Database(fileContent);
            stepStart = this.trackProgress("Parse database structure", stepStart);

            console.log("Loaded existing index database");

            // Ensure schema is up to date
            await this.ensureSchema();
        } catch (error) {
            stepStart = this.trackProgress("Handle database error", stepStart);

            // Check if this is a corruption error
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isCorruption = errorMessage.includes("database disk image is malformed") ||
                errorMessage.includes("file is not a database") ||
                errorMessage.includes("database is locked") ||
                errorMessage.includes("database corruption");

            if (isCorruption) {
                debug(`[SQLiteIndex] Database corruption detected: ${errorMessage}`);
                debug("[SQLiteIndex] Deleting corrupt database and creating new one");

                // Delete the corrupted database file
                try {
                    await vscode.workspace.fs.delete(dbPath);
                    stepStart = this.trackProgress("Delete corrupted database", stepStart);
                } catch (deleteError) {
                    debug("[SQLiteIndex] Could not delete corrupted database file:", deleteError);
                }
            } else {
                debug("Database file not found or other error, creating new database");
            }

            stepStart = this.trackProgress("Create new database", stepStart);
            console.log("Creating new index database");
            this.db = new this.sql!.Database();

            await this.createSchema();

            // Validate schema before setting version to ensure reliability
            if (!this.validateSchemaIntegrity()) {
                throw new Error(`Schema validation failed after creation for version ${CURRENT_SCHEMA_VERSION} - database may be corrupted`);
            }

            this.setSchemaVersion(CURRENT_SCHEMA_VERSION);
            await this.saveDatabase();
        }

        this.trackProgress("Database Load/Create Complete", loadStart);
    }

    private async createSchema(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        const schemaStart = globalThis.performance.now();

        // Optimize database for faster creation (OUTSIDE of transaction)
        debug("Optimizing database settings for fast creation...");
        this.db.run("PRAGMA synchronous = OFF");        // Disable fsync for speed
        this.db.run("PRAGMA journal_mode = MEMORY");     // Use memory journal
        this.db.run("PRAGMA temp_store = MEMORY");       // Store temp data in memory
        this.db.run("PRAGMA cache_size = -64000");       // 64MB cache
        this.db.run("PRAGMA foreign_keys = OFF");        // Disable FK checks during creation

        // Batch all schema creation in a single transaction for massive speedup
        await this.runInTransaction(() => {
            // Create all tables in batch
            debug("Creating database tables...");

            // Sync metadata table
            this.db!.run(`
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
                )
            `);

            // Files table
            this.db!.run(`
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
                )
            `);

            // Cells table - restructured to combine source and target in same row
            this.db!.run(`
                CREATE TABLE IF NOT EXISTS cells (
                    cell_id TEXT PRIMARY KEY,
                    
                    -- Source columns
                    s_file_id INTEGER,
                    s_content TEXT,
                    s_raw_content_hash TEXT,
                    s_line_number INTEGER,
                    s_word_count INTEGER DEFAULT 0,
                    s_raw_content TEXT,
                    s_created_at INTEGER,
                    s_updated_at INTEGER,
                    
                    -- Target columns  
                    t_file_id INTEGER,
                    t_content TEXT,
                    t_raw_content_hash TEXT,
                    t_line_number INTEGER,
                    t_word_count INTEGER DEFAULT 0,
                    t_raw_content TEXT,
                    t_created_at INTEGER,
                    
                    -- Target metadata (optimized fields only)
                    t_current_edit_timestamp INTEGER,
                    t_validation_count INTEGER DEFAULT 0,
                    t_validated_by TEXT,
                    t_is_fully_validated BOOLEAN DEFAULT FALSE,
                    
                    FOREIGN KEY (s_file_id) REFERENCES files(id) ON DELETE SET NULL,
                    FOREIGN KEY (t_file_id) REFERENCES files(id) ON DELETE SET NULL
                )
            `);

            // Translation pairs table removed in schema v8 - source/target are now in same row

            // Words table
            this.db!.run(`
                CREATE TABLE IF NOT EXISTS words (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    word TEXT NOT NULL,
                    cell_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    frequency INTEGER DEFAULT 1,
                    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                    FOREIGN KEY (cell_id) REFERENCES cells(cell_id) ON DELETE CASCADE
                )
            `);

            debug("Creating full-text search index...");
            // FTS5 virtual table - separate entries for source and target content
            this.db!.run(`
                CREATE VIRTUAL TABLE IF NOT EXISTS cells_fts USING fts5(
                    cell_id,
                    content,
                    raw_content,
                    content_type,
                    tokenize='porter unicode61'
                )
            `);
        });

        debug("Creating database indexes (deferred)...");
        // Create indexes in a separate optimized transaction
        await this.runInTransaction(() => {
            // Create essential indexes only - defer others until after data insertion
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_sync_metadata_path ON sync_metadata(file_path)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_files_path ON files(file_path)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_cells_s_file_id ON cells(s_file_id)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_cells_t_file_id ON cells(t_file_id)");
        });

        debug("Creating database triggers...");
        // Create triggers in batch
        await this.runInTransaction(() => {
            // Timestamp triggers
            this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS update_sync_metadata_timestamp 
                AFTER UPDATE ON sync_metadata
                BEGIN
                    UPDATE sync_metadata SET updated_at = strftime('%s', 'now') * 1000 
                    WHERE id = NEW.id;
                END
            `);

            this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS update_files_timestamp 
                AFTER UPDATE ON files
                BEGIN
                    UPDATE files SET updated_at = strftime('%s', 'now') * 1000 
                    WHERE id = NEW.id;
                END
            `);

            this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS update_cells_s_timestamp 
                AFTER UPDATE OF s_content, s_raw_content ON cells
                BEGIN
                    UPDATE cells SET s_updated_at = strftime('%s', 'now') * 1000 
                    WHERE cell_id = NEW.cell_id;
                END
            `);

            // Target timestamp trigger removed - timestamps now handled in application logic
            // to preserve actual edit timestamps from JSON metadata instead of database operation time

            // FTS synchronization triggers - handle source and target separately
            this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_source_insert 
                AFTER INSERT ON cells
                WHEN NEW.s_content IS NOT NULL
                BEGIN
                    INSERT INTO cells_fts(cell_id, content, raw_content, content_type) 
                    VALUES (NEW.cell_id, NEW.s_content, COALESCE(NEW.s_raw_content, NEW.s_content), 'source');
                END
            `);

            this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_target_insert 
                AFTER INSERT ON cells
                WHEN NEW.t_content IS NOT NULL
                BEGIN
                    INSERT INTO cells_fts(cell_id, content, raw_content, content_type) 
                    VALUES (NEW.cell_id, NEW.t_content, COALESCE(NEW.t_raw_content, NEW.t_content), 'target');
                END
            `);

            this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_source_update 
                AFTER UPDATE OF s_content, s_raw_content ON cells
                WHEN NEW.s_content IS NOT NULL
                BEGIN
                    INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type) 
                    VALUES (NEW.cell_id, NEW.s_content, COALESCE(NEW.s_raw_content, NEW.s_content), 'source');
                END
            `);

            this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_target_update 
                AFTER UPDATE OF t_content, t_raw_content ON cells
                WHEN NEW.t_content IS NOT NULL
                BEGIN
                    INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type) 
                    VALUES (NEW.cell_id, NEW.t_content, COALESCE(NEW.t_raw_content, NEW.t_content), 'target');
                END
            `);

            this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_delete 
                AFTER DELETE ON cells
                BEGIN
                    DELETE FROM cells_fts WHERE cell_id = OLD.cell_id;
                END
            `);
        });

        // Restore normal database settings for production use (OUTSIDE of transaction)
        debug("Restoring production database settings...");
        this.db.run("PRAGMA synchronous = NORMAL");      // Restore safe sync mode
        this.db.run("PRAGMA journal_mode = WAL");        // Use WAL mode for better concurrency
        this.db.run("PRAGMA foreign_keys = ON");         // Re-enable foreign key constraints
        this.db.run("PRAGMA cache_size = -8000");        // Reasonable cache size (8MB)

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

        await this.runInTransaction(() => {
            // Create remaining indexes that benefit from having data first
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_sync_metadata_hash ON sync_metadata(content_hash)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_sync_metadata_modified ON sync_metadata(last_modified_ms)");

            // Additional indexes for the new cell structure (main ones already created)
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_cells_s_content_hash ON cells(s_raw_content_hash)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_cells_t_content_hash ON cells(t_raw_content_hash)");

            // Performance indexes for extracted metadata
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_cells_t_is_fully_validated ON cells(t_is_fully_validated)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_cells_t_current_edit_timestamp ON cells(t_current_edit_timestamp)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_cells_t_validation_count ON cells(t_validation_count)");

            // Keep word index (will need updating for new structure)
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_words_word ON words(word)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_words_cell_id ON words(cell_id)");

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
            const currentVersion = this.getSchemaVersion();
            debug(`Current schema version: ${currentVersion}`);



            if (currentVersion === 0) {
                // Scenario 1: No schema exists - create fresh schema
                stepStart = this.trackProgress("Initialize new database schema", stepStart);
                debug("Setting up new database with latest schema");
                await this.createSchema();

                // Validate schema before setting version to ensure reliability
                if (!this.validateSchemaIntegrity()) {
                    throw new Error(`Schema validation failed after creation for version ${CURRENT_SCHEMA_VERSION} - database may be corrupted`);
                }

                this.setSchemaVersion(CURRENT_SCHEMA_VERSION);
                this.trackProgress("New database schema initialized", stepStart);
                debug(`New database created with schema version ${CURRENT_SCHEMA_VERSION}`);
            } else if (currentVersion !== CURRENT_SCHEMA_VERSION) {
                // Scenario 2: ANY version mismatch (ahead, behind, or different) - ALWAYS recreate everything
                // No partial migrations - we're senior database engineers who don't mess with bad/partial databases!
                stepStart = this.trackProgress("Handle schema version mismatch", stepStart);
                debug(`Database schema version ${currentVersion} does not match code version ${CURRENT_SCHEMA_VERSION}`);
                debug("FULL RECREATION: No partial migrations - deleting and recreating database from scratch for maximum reliability");

                // Log schema recreation to console instead of showing to user
                console.log(`[SQLiteIndex] 🔄 AI updating database schema (v${currentVersion} → v${CURRENT_SCHEMA_VERSION}). Recreating for reliability...`);

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
                this.db = new this.sql!.Database();
                await this.createSchema();

                // Validate schema before setting version to ensure reliability
                if (!this.validateSchemaIntegrity()) {
                    throw new Error(`Schema validation failed after corruption recovery for version ${CURRENT_SCHEMA_VERSION} - database may be corrupted`);
                }

                this.setSchemaVersion(CURRENT_SCHEMA_VERSION);

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
        const tablesStmt = this.db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
        `);

        const tableNames: string[] = [];
        try {
            while (tablesStmt.step()) {
                tableNames.push(tablesStmt.getAsObject().name as string);
            }
        } finally {
            tablesStmt.free();
        }

        // Drop all tables in a transaction
        await this.runInTransaction(() => {
            // Drop FTS table first if it exists
            if (tableNames.includes('cells_fts')) {
                this.db!.run("DROP TABLE IF EXISTS cells_fts");
            }

            // Drop other tables
            for (const tableName of tableNames) {
                if (tableName !== 'cells_fts') {
                    this.db!.run(`DROP TABLE IF EXISTS ${tableName}`);
                }
            }
        });

        debug("Creating fresh schema...");
        await this.createSchema();

        // Yield control after schema creation
        await new Promise(resolve => setImmediate(resolve));

        // Validate schema before setting version to ensure reliability
        if (!this.validateSchemaIntegrity()) {
            throw new Error(`Schema validation failed after recreation for version ${CURRENT_SCHEMA_VERSION} - database may be corrupted`);
        }

        this.setSchemaVersion(CURRENT_SCHEMA_VERSION);
    }

    private getSchemaVersion(): number {
        if (!this.db) return 0;

        try {
            // Check if any tables exist at all (new database check)
            const checkAnyTable = this.db.prepare(`
                SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'
            `);

            let tableCount = 0;
            try {
                checkAnyTable.step();
                tableCount = checkAnyTable.getAsObject().count as number;
            } finally {
                checkAnyTable.free();
            }

            if (tableCount === 0) return 0; // Completely new database

            // Check if schema_info table exists
            const checkTable = this.db.prepare(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='schema_info'
            `);

            let hasTable = false;
            try {
                if (checkTable.step()) {
                    hasTable = checkTable.getAsObject().name === 'schema_info';
                }
            } finally {
                checkTable.free();
            }

            if (!hasTable) return -1; // Unknown version if no schema_info table but other tables exist

            const stmt = this.db.prepare("SELECT version FROM schema_info WHERE id = 1 LIMIT 1");
            try {
                if (stmt.step()) {
                    const result = stmt.getAsObject();
                    return (result.version as number) || -1;
                }
                return -1; // No version found
            } finally {
                stmt.free();
            }
        } catch {
            return -1; // Fallback to unknown version
        }
    }


    setSchemaVersion(version: number): void {
        if (!this.db) return;

        // Create schema_info table if it doesn't exist
        this.db.run(`
            CREATE TABLE IF NOT EXISTS schema_info (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                version INTEGER NOT NULL
            )
        `);

        // Clean up any duplicate rows and insert the new version
        // Use a transaction to ensure atomicity
        this.db.run("BEGIN TRANSACTION");
        try {
            // Clean up any existing duplicate rows from old schema
            this.db.run("DELETE FROM schema_info");
            this.db.run("INSERT INTO schema_info (id, version) VALUES (1, ?)", [version]);
            this.db.run("COMMIT");
            debug(`Schema version updated to ${version}`);
        } catch (error) {
            this.db.run("ROLLBACK");
            console.error("Failed to set schema version:", error);
            throw error;
        }
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

        const stmt = this.db.prepare(`
            INSERT INTO files (file_path, file_type, last_modified_ms, content_hash)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(file_path) DO UPDATE SET
                last_modified_ms = excluded.last_modified_ms,
                content_hash = excluded.content_hash,
                updated_at = strftime('%s', 'now') * 1000
            RETURNING id
        `);

        try {
            stmt.bind([filePath, fileType, lastModifiedMs, contentHash]);
            stmt.step();
            const result = stmt.getAsObject();
            return result.id as number;
        } finally {
            stmt.free();
        }
    }

    // Synchronous version for use within transactions
    upsertFileSync(
        filePath: string,
        fileType: "source" | "codex",
        lastModifiedMs: number
    ): number {
        if (!this.db) throw new Error("Database not initialized");

        const contentHash = this.computeContentHash(filePath + lastModifiedMs);

        const stmt = this.db.prepare(`
            INSERT INTO files (file_path, file_type, last_modified_ms, content_hash)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(file_path) DO UPDATE SET
                last_modified_ms = excluded.last_modified_ms,
                content_hash = excluded.content_hash,
                updated_at = strftime('%s', 'now') * 1000
            RETURNING id
        `);

        try {
            stmt.bind([filePath, fileType, lastModifiedMs, contentHash]);
            stmt.step();
            const result = stmt.getAsObject();
            return result.id as number;
        } finally {
            stmt.free();
        }
    }

    async upsertCell(
        cellId: string,
        fileId: number,
        cellType: "source" | "target",
        content: string,
        lineNumber?: number,
        metadata?: any,
        rawContent?: string
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
        const checkStmt = this.db.prepare(`
            SELECT cell_id, ${cellType === 'source' ? 's_raw_content_hash' : 't_raw_content_hash'} as hash 
            FROM cells 
            WHERE cell_id = ?
        `);

        let existingCell: { cell_id: string; hash: string | null; } | null = null;
        try {
            checkStmt.bind([cellId]);
            if (checkStmt.step()) {
                existingCell = checkStmt.getAsObject() as any;
            }
        } finally {
            checkStmt.free();
        }

        const contentChanged = !existingCell || existingCell.hash !== rawContentHash;
        const isNew = !existingCell;

        // Extract metadata for dedicated columns (always extract for target cells to handle validation changes)
        const extractedMetadata = this.extractMetadataFields(metadata, cellType);

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
            `${prefix}file_id`,
            `${prefix}content`,
            `${prefix}raw_content_hash`,
            `${prefix}line_number`,
            `${prefix}word_count`,
            `${prefix}raw_content`
        ];

        const values = [
            fileId,
            sanitizedContent,
            rawContentHash,
            lineNumber || null,
            wordCount,
            actualRawContent
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
            columns.push('t_current_edit_timestamp', 't_validation_count', 't_validated_by', 't_is_fully_validated');
            values.push(
                actualEditTimestamp, // Only t_current_edit_timestamp for target cells (no redundant t_updated_at)
                extractedMetadata.validationCount || 0,
                extractedMetadata.validatedBy || null,
                extractedMetadata.isFullyValidated ? 1 : 0
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
                const checkCreatedStmt = this.db.prepare(`
                    SELECT t_created_at FROM cells WHERE cell_id = ? LIMIT 1
                `);

                let currentCreatedAt: number | null = null;
                try {
                    checkCreatedStmt.bind([cellId]);
                    if (checkCreatedStmt.step()) {
                        currentCreatedAt = checkCreatedStmt.getAsObject().t_created_at as number | null;
                    }
                } finally {
                    checkCreatedStmt.free();
                }

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
        const upsertStmt = this.db.prepare(`
            INSERT INTO cells (cell_id, ${columns.join(', ')})
            VALUES (?, ${values.map(() => '?').join(', ')})
            ON CONFLICT(cell_id) DO UPDATE SET
                ${columns.map(col => `${col} = excluded.${col}`).join(', ')}
        `);

        try {
            upsertStmt.bind([cellId, ...values]);
            upsertStmt.step();

            this.debouncedSave();
            return { id: cellId, isNew, contentChanged };
        } finally {
            upsertStmt.free();
        }
    }

    // Synchronous version for use within transactions
    upsertCellSync(
        cellId: string,
        fileId: number,
        cellType: "source" | "target",
        content: string,
        lineNumber?: number,
        metadata?: any,
        rawContent?: string
    ): { id: string; isNew: boolean; contentChanged: boolean; } {
        if (!this.db) throw new Error("Database not initialized");

        // Use rawContent if provided, otherwise fall back to content
        const actualRawContent = rawContent || content;

        // Sanitize content for storage - remove HTML tags for clean searching/indexing
        const sanitizedContent = this.sanitizeContent(content);

        const rawContentHash = this.computeRawContentHash(actualRawContent);
        const wordCount = sanitizedContent.split(/\s+/).filter((w) => w.length > 0).length;
        const currentTimestamp = Date.now();

        // Check if cell exists and if content changed
        const checkStmt = this.db.prepare(`
            SELECT cell_id, ${cellType === 'source' ? 's_raw_content_hash' : 't_raw_content_hash'} as hash 
            FROM cells 
            WHERE cell_id = ?
        `);

        let existingCell: { cell_id: string; hash: string | null; } | null = null;
        try {
            checkStmt.bind([cellId]);
            if (checkStmt.step()) {
                existingCell = checkStmt.getAsObject() as any;
            }
        } finally {
            checkStmt.free();
        }

        const contentChanged = !existingCell || existingCell.hash !== rawContentHash;
        const isNew = !existingCell;

        // Extract metadata for dedicated columns (always extract for target cells to handle validation changes)
        const extractedMetadata = this.extractMetadataFields(metadata, cellType);

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
            `${prefix}file_id`,
            `${prefix}content`,
            `${prefix}raw_content_hash`,
            `${prefix}line_number`,
            `${prefix}word_count`,
            `${prefix}raw_content`
        ];

        const values = [
            fileId,
            sanitizedContent,
            rawContentHash,
            lineNumber || null,
            wordCount,
            actualRawContent
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
            columns.push('t_current_edit_timestamp', 't_validation_count', 't_validated_by', 't_is_fully_validated');
            values.push(
                actualEditTimestamp, // Only t_current_edit_timestamp for target cells (no redundant t_updated_at)
                extractedMetadata.validationCount || 0,
                extractedMetadata.validatedBy || null,
                extractedMetadata.isFullyValidated ? 1 : 0
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
                const checkCreatedStmt = this.db.prepare(`
                    SELECT t_created_at FROM cells WHERE cell_id = ? LIMIT 1
                `);

                let currentCreatedAt: number | null = null;
                try {
                    checkCreatedStmt.bind([cellId]);
                    if (checkCreatedStmt.step()) {
                        currentCreatedAt = checkCreatedStmt.getAsObject().t_created_at as number | null;
                    }
                } finally {
                    checkCreatedStmt.free();
                }

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
        const upsertStmt = this.db.prepare(`
            INSERT INTO cells (cell_id, ${columns.join(', ')})
            VALUES (?, ${values.map(() => '?').join(', ')})
            ON CONFLICT(cell_id) DO UPDATE SET
                ${columns.map(col => `${col} = excluded.${col}`).join(', ')}
        `);

        try {
            upsertStmt.bind([cellId, ...values]);
            upsertStmt.step();

            // Note: Don't call debouncedSave() in sync version as it's async
            return { id: cellId, isNew, contentChanged };
        } finally {
            upsertStmt.free();
        }
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
        await this.runInTransaction(() => {
            // Delete in reverse dependency order to avoid foreign key issues
            this.db!.run("DELETE FROM cells_fts");
            // translation_pairs table no longer exists in schema v8
            this.db!.run("DELETE FROM words");
            this.db!.run("DELETE FROM cells");
            this.db!.run("DELETE FROM files");
        });

        // Use setImmediate to make the save operation non-blocking
        setImmediate(() => {
            this.debouncedSave();
        });
    }

    // Get document count
    get documentCount(): number {
        if (!this.db) return 0;

        const stmt = this.db.prepare("SELECT COUNT(DISTINCT cell_id) as count FROM cells");
        try {
            stmt.step();
            const result = stmt.getAsObject();
            return (result.count as number) || 0;
        } finally {
            stmt.free();
        }
    }

    /**
     * Get database instance for advanced operations (use with caution)
     */
    get database(): Database | null {
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
    search(query: string, options?: any): any[] {
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

        const stmt = this.db.prepare(`
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
            ORDER BY score DESC
            LIMIT ?
        `);

        const results = [];
        try {
            // Always search using the sanitized content column for better matching
            const ftsSearchQuery = `content: ${ftsQuery}`;
            stmt.bind([ftsSearchQuery, limit]);
            while (stmt.step()) {
                const row = stmt.getAsObject();

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
        } finally {
            stmt.free();
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
    searchSanitized(query: string, options?: any): any[] {
        return this.search(query, { ...options, returnRawContent: false });
    }

    // Get document by ID (for source text index compatibility)
    async getById(cellId: string): Promise<any | null> {
        if (!this.db) return null;

        const stmt = this.db.prepare(`
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
                t_file.file_path as t_file_path
            FROM cells c
            LEFT JOIN files s_file ON c.s_file_id = s_file.id
            LEFT JOIN files t_file ON c.t_file_id = t_file.id
            WHERE c.cell_id = ?
        `);

        try {
            stmt.bind([cellId]);
            if (stmt.step()) {
                const row = stmt.getAsObject();

                // Construct metadata from dedicated columns
                const sourceMetadata = {};
                const targetMetadata = {
                    currentEditTimestamp: row.t_current_edit_timestamp || null,
                    validationCount: row.t_validation_count || 0,
                    validatedBy: row.t_validated_by ? row.t_validated_by.split(',') : [],
                    isFullyValidated: Boolean(row.t_is_fully_validated)
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
        } finally {
            stmt.free();
        }

        return null;
    }

    // Get cell by exact ID match (for translation pairs)
    async getCellById(cellId: string, cellType?: "source" | "target"): Promise<any | null> {
        if (!this.db) return null;

        const stmt = this.db.prepare(`
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
                t_file.file_path as t_file_path,
                t_file.file_type as t_file_type
            FROM cells c
            LEFT JOIN files s_file ON c.s_file_id = s_file.id
            LEFT JOIN files t_file ON c.t_file_id = t_file.id
            WHERE c.cell_id = ?
        `);

        try {
            stmt.bind([cellId]);
            if (stmt.step()) {
                const row = stmt.getAsObject();

                // Construct metadata from dedicated columns
                const sourceMetadata = {};
                const targetMetadata = {
                    currentEditTimestamp: row.t_current_edit_timestamp || null,
                    validationCount: row.t_validation_count || 0,
                    validatedBy: row.t_validated_by ? row.t_validated_by.split(',') : [],
                    isFullyValidated: Boolean(row.t_is_fully_validated)
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
        } finally {
            stmt.free();
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

    // Update word index for a cell
    async updateWordIndex(cellId: string, content: string): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        // Clear existing words for this cell (cell_id is now TEXT)
        this.db.run("DELETE FROM words WHERE cell_id = ?", [cellId]);

        // Add new words
        const words = content
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 0);
        const wordCounts = new Map<string, number>();

        words.forEach((word, position) => {
            wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
        });

        const stmt = this.db.prepare(
            "INSERT INTO words (word, cell_id, position, frequency) VALUES (?, ?, ?, ?)"
        );

        try {
            let position = 0;
            for (const [word, frequency] of wordCounts) {
                stmt.bind([word, cellId, position++, frequency]);
                stmt.step();
                stmt.reset();
            }
        } finally {
            stmt.free();
        }
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

        sql += ` ORDER BY score DESC LIMIT ?`;
        params.push(limit);

        const stmt = this.db.prepare(sql);
        const results = [];

        try {
            stmt.bind(params);
            while (stmt.step()) {
                const row = stmt.getAsObject();

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
        } finally {
            stmt.free();
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

            console.log(`[searchGreekText] Words extracted: ${words.length} - ${words.slice(0, 5).join(', ')}...`);
            console.log(`[searchGreekText] FTS query: content: ${ftsQuery}`);

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

            sql += ` ORDER BY score DESC LIMIT ?`;
            params.push(limit);
        }

        const stmt = this.db.prepare(sql);
        const results = [];

        try {
            stmt.bind(params);
            while (stmt.step()) {
                const row = stmt.getAsObject();

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
        } finally {
            stmt.free();
        }

        return results;
    }

    async getFileStats(): Promise<Map<string, any>> {
        if (!this.db) throw new Error("Database not initialized");

        const stmt = this.db.prepare(`
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
        try {
            while (stmt.step()) {
                const row = stmt.getAsObject();
                stats.set(row.file_path as string, row);
            }
        } finally {
            stmt.free();
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

        const stmt = this.db.prepare(`
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

        try {
            stmt.step();
            const result = stmt.getAsObject();
            return {
                totalCells: (result.total_cells as number) || 0,
                cellsWithRawContent: (result.cells_with_raw_content as number) || 0,
                cellsWithDifferentContent: (result.cells_with_different_content as number) || 0,
                avgContentLength: (result.avg_content_length as number) || 0,
                avgRawContentLength: (result.avg_raw_content_length as number) || 0,
                cellsWithMissingContent: (result.cells_with_missing_content as number) || 0,
                cellsWithMissingRawContent: (result.cells_with_missing_raw_content as number) || 0,
            };
        } finally {
            stmt.free();
        }
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
        const pairsStmt = this.db.prepare(`
            SELECT 
                COUNT(*) as total_pairs,
                SUM(CASE WHEN s_content IS NOT NULL AND s_content != '' AND t_content IS NOT NULL AND t_content != '' THEN 1 ELSE 0 END) as complete_pairs,
                SUM(CASE WHEN (s_content IS NOT NULL AND s_content != '') AND (t_content IS NULL OR t_content = '') THEN 1 ELSE 0 END) as incomplete_pairs
            FROM cells
            WHERE s_content IS NOT NULL OR t_content IS NOT NULL
        `);

        let totalPairs = 0;
        let completePairs = 0;
        let incompletePairs = 0;

        try {
            pairsStmt.step();
            const result = pairsStmt.getAsObject();
            totalPairs = (result.total_pairs as number) || 0;
            completePairs = (result.complete_pairs as number) || 0;
            incompletePairs = (result.incomplete_pairs as number) || 0;
        } finally {
            pairsStmt.free();
        }

        // Count orphaned source cells (source cells with no corresponding target)
        const orphanedSourceStmt = this.db.prepare(`
            SELECT COUNT(*) as count
            FROM cells c
            WHERE c.s_content IS NOT NULL 
            AND c.s_content != ''
            AND (c.t_content IS NULL OR c.t_content = '')
        `);

        let orphanedSourceCells = 0;
        try {
            orphanedSourceStmt.step();
            orphanedSourceCells = (orphanedSourceStmt.getAsObject().count as number) || 0;
        } finally {
            orphanedSourceStmt.free();
        }

        // Count orphaned target cells (target cells with no corresponding source)
        const orphanedTargetStmt = this.db.prepare(`
            SELECT COUNT(*) as count
            FROM cells c
            WHERE c.t_content IS NOT NULL 
            AND c.t_content != ''
            AND (c.s_content IS NULL OR c.s_content = '')
        `);

        let orphanedTargetCells = 0;
        try {
            orphanedTargetStmt.step();
            orphanedTargetCells = (orphanedTargetStmt.getAsObject().count as number) || 0;
        } finally {
            orphanedTargetStmt.free();
        }

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
        const checkStmt = this.db.prepare(`
            SELECT cell_id, s_content, s_raw_content, t_content, t_raw_content
            FROM cells 
            WHERE (s_content IS NOT NULL AND s_content != '' AND (s_raw_content IS NULL OR s_raw_content = ''))
            OR (t_content IS NOT NULL AND t_content != '' AND (t_raw_content IS NULL OR t_raw_content = ''))
            OR (s_content IS NULL OR s_content = '')
        `);

        try {
            while (checkStmt.step()) {
                const row = checkStmt.getAsObject();
                const cellId = row.cell_id as string;

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
        } finally {
            checkStmt.free();
        }

        // Get total cell count
        const countStmt = this.db.prepare("SELECT COUNT(*) as total FROM cells");
        let totalCells = 0;
        try {
            countStmt.step();
            totalCells = countStmt.getAsObject().total as number;
        } finally {
            countStmt.free();
        }

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

        const version = this.getSchemaVersion();

        // Get all tables
        const tablesStmt = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'");
        const tables: string[] = [];
        try {
            while (tablesStmt.step()) {
                tables.push(tablesStmt.getAsObject().name as string);
            }
        } finally {
            tablesStmt.free();
        }

        // Get cells table columns
        const cellsColumnsStmt = this.db.prepare("PRAGMA table_info(cells)");
        const cellsColumns: string[] = [];
        try {
            while (cellsColumnsStmt.step()) {
                cellsColumns.push(cellsColumnsStmt.getAsObject().name as string);
            }
        } finally {
            cellsColumnsStmt.free();
        }

        // Get FTS table columns
        const ftsColumnsStmt = this.db.prepare("PRAGMA table_info(cells_fts)");
        const ftsColumns: string[] = [];
        try {
            while (ftsColumnsStmt.step()) {
                ftsColumns.push(ftsColumnsStmt.getAsObject().name as string);
            }
        } finally {
            ftsColumnsStmt.free();
        }

        return { version, tables, cellsColumns, ftsColumns };
    }

    /**
 * Validate that the database schema was created correctly with all expected components
 * This validation is version-agnostic and works with whatever the current schema version is
 */
    private validateSchemaIntegrity(): boolean {
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
                's_file_id', 's_content', 's_raw_content_hash', 's_line_number', 's_word_count', 's_raw_content', 's_created_at', 's_updated_at',
                't_file_id', 't_content', 't_raw_content_hash', 't_line_number', 't_word_count', 't_raw_content', 't_created_at',
                't_current_edit_timestamp', 't_validation_count', 't_validated_by', 't_is_fully_validated'
            ];

            const expectedIndexes = [
                'idx_sync_metadata_path',
                'idx_files_path',
                'idx_cells_s_file_id',
                'idx_cells_t_file_id'
            ];

            // Check tables exist
            const tablesStmt = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'");
            const actualTables: string[] = [];
            try {
                while (tablesStmt.step()) {
                    actualTables.push(tablesStmt.getAsObject().name as string);
                }
            } finally {
                tablesStmt.free();
            }

            for (const expectedTable of requiredCoreTables) {
                if (!actualTables.includes(expectedTable)) {
                    debug(`Schema validation failed: Missing table '${expectedTable}'`);
                    return false;
                }
            }

            // Check cells table has correct v8 structure
            const cellsColumnsStmt = this.db.prepare("PRAGMA table_info(cells)");
            const actualCellsColumns: string[] = [];
            try {
                while (cellsColumnsStmt.step()) {
                    actualCellsColumns.push(cellsColumnsStmt.getAsObject().name as string);
                }
            } finally {
                cellsColumnsStmt.free();
            }

            for (const expectedColumn of expectedCellsColumns) {
                if (!actualCellsColumns.includes(expectedColumn)) {
                    debug(`Schema validation failed: Missing column '${expectedColumn}' in cells table`);
                    return false;
                }
            }

            // Check essential indexes exist
            const indexesStmt = this.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'");
            const actualIndexes: string[] = [];
            try {
                while (indexesStmt.step()) {
                    actualIndexes.push(indexesStmt.getAsObject().name as string);
                }
            } finally {
                indexesStmt.free();
            }

            for (const expectedIndex of expectedIndexes) {
                if (!actualIndexes.includes(expectedIndex)) {
                    debug(`Schema validation failed: Missing index '${expectedIndex}'`);
                    return false;
                }
            }

            // Verify FTS table is properly set up
            try {
                const ftsTestStmt = this.db.prepare("SELECT * FROM cells_fts LIMIT 0");
                ftsTestStmt.step(); // This will fail if FTS table is malformed
                ftsTestStmt.free();
            } catch (error) {
                debug(`Schema validation failed: FTS table malformed - ${error}`);
                return false;
            }

            // Test that basic database operations work
            try {
                this.db.run("BEGIN");
                // Test basic table functionality
                const testStmt = this.db.prepare("SELECT COUNT(*) FROM files");
                testStmt.step();
                testStmt.free();
                this.db.run("ROLLBACK");
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

    private debouncedSave = debounce(async () => {
        try {
            await this.saveDatabase();
        } catch (error) {
            console.error("Error in debounced save:", error);
        }
    }, this.SAVE_DEBOUNCE_MS);

    // Force immediate save for critical updates (like during queued translations)
    async forceSave(): Promise<void> {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }

        try {
            await this.saveDatabase();
        } catch (error) {
            console.error("Error in force save:", error);
            throw error;
        }
    }

    // Force FTS index to rebuild/refresh for immediate search visibility
    async refreshFTSIndex(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        try {
            // Force FTS5 to rebuild its index
            this.db.run("INSERT INTO cells_fts(cells_fts) VALUES('rebuild')");
        } catch (error) {
            // If rebuild fails, try optimize instead
            try {
                this.db.run("INSERT INTO cells_fts(cells_fts) VALUES('optimize')");
            } catch (optimizeError) {
                // If both fail, silently continue - the triggers should handle synchronization
            }
        }
    }

    // Ensure all pending writes are committed and visible for search
    async flushPendingWrites(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        // Execute a dummy query to ensure any autocommit transactions are flushed
        try {
            this.db.run("BEGIN IMMEDIATE; COMMIT;");
        } catch (error) {
            // Database might already be in a transaction, that's fine
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
                // Manually sync this specific cell to FTS if triggers didn't work
                const actualRawContent = rawContent || content;
                this.db!.run(`
                    INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type) 
                    VALUES (?, ?, ?, ?)
                `, [cellId, content, actualRawContent, cellType]);
            } catch (error) {
                // Trigger should have handled it, continue silently
            }
        }

        return result;
    }

    // Debug method to check if a cell is in the FTS index
    async isCellInFTSIndex(cellId: string): Promise<boolean> {
        if (!this.db) return false;

        const stmt = this.db.prepare("SELECT cell_id FROM cells_fts WHERE cell_id = ? LIMIT 1");
        try {
            stmt.bind([cellId]);
            return stmt.step();
        } finally {
            stmt.free();
        }
    }

    // Debug method to get FTS index count vs regular table count
    async getFTSDebugInfo(): Promise<{ cellsCount: number; ftsCount: number; }> {
        if (!this.db) return { cellsCount: 0, ftsCount: 0 };

        const cellsStmt = this.db.prepare("SELECT COUNT(*) as count FROM cells");
        const ftsStmt = this.db.prepare("SELECT COUNT(*) as count FROM cells_fts");

        let cellsCount = 0;
        let ftsCount = 0;

        try {
            cellsStmt.step();
            cellsCount = cellsStmt.getAsObject().count as number;

            ftsStmt.step();
            ftsCount = ftsStmt.getAsObject().count as number;
        } finally {
            cellsStmt.free();
            ftsStmt.free();
        }

        return { cellsCount, ftsCount };
    }

    async saveDatabase(): Promise<void> {
        if (!this.db) return;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const dbPath = vscode.Uri.joinPath(workspaceFolder.uri, ...INDEX_DB_PATH);
        const data = this.db.export();

        // Ensure .project directory exists
        const projectDir = vscode.Uri.joinPath(workspaceFolder.uri, ".project");
        try {
            await vscode.workspace.fs.createDirectory(projectDir);
        } catch {
            // Directory might already exist
        }

        await vscode.workspace.fs.writeFile(dbPath, data);
    }

    async close(): Promise<void> {
        // Clean up all timers to prevent memory leaks
        if (this.currentProgressTimer) {
            clearInterval(this.currentProgressTimer);
            this.currentProgressTimer = null;
        }

        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }

        // Reset progress tracking state to prevent memory leaks
        this.currentProgressName = null;
        this.currentProgressStartTime = null;
        this.progressTimings = [];

        // Save and close database
        if (this.db) {
            try {
                await this.saveDatabase();
                this.db.close();
                this.db = null;
                debug("Database connection closed and resources cleaned up");
            } catch (error) {
                console.error("[SQLiteIndex] Error during database close:", error);
                // Still close the database even if save fails
                if (this.db) {
                    this.db.close();
                    this.db = null;
                }
            }
        }
    }

    // Transaction helper for batch operations
    async runInTransaction<T>(callback: () => T): Promise<T> {
        if (!this.db) throw new Error("Database not initialized");

        this.db.run("BEGIN TRANSACTION");
        try {
            const result = callback();
            this.db.run("COMMIT");
            return result;
        } catch (error) {
            this.db.run("ROLLBACK");
            throw error;
        }
    }

    // Helper function to sanitize HTML content (same as in codexDocument.ts)
    private sanitizeContent(htmlContent: string): string {
        if (!htmlContent) return '';

        // Remove HTML tags but preserve the text content
        return htmlContent
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
            .replace(/&amp;/g, '&')  // Replace HTML entities
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim(); // Remove leading/trailing whitespace
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
            console.log("[SQLiteIndex] 🤖 AI preparing to learn from scratch...");

            // Close current database connection
            await this.close();

            // Delete the database file
            await this.deleteDatabaseFile();

            console.log("[SQLiteIndex] ✅ AI reset complete.");
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
                const syncStmt = this.db.prepare(`
                    SELECT content_hash, last_modified_ms, file_size 
                    FROM sync_metadata 
                    WHERE file_path = ?
                `);

                let existingRecord: { content_hash: string; last_modified_ms: number; file_size: number; } | null = null;
                try {
                    syncStmt.bind([filePath]);
                    if (syncStmt.step()) {
                        existingRecord = syncStmt.getAsObject() as any;
                    }
                } finally {
                    syncStmt.free();
                }

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

        const stmt = this.db.prepare(`
            INSERT INTO sync_metadata (file_path, file_type, content_hash, file_size, last_modified_ms, last_synced_ms)
            VALUES (?, ?, ?, ?, ?, strftime('%s', 'now') * 1000)
            ON CONFLICT(file_path) DO UPDATE SET
                content_hash = excluded.content_hash,
                file_size = excluded.file_size,
                last_modified_ms = excluded.last_modified_ms,
                last_synced_ms = strftime('%s', 'now') * 1000,
                updated_at = strftime('%s', 'now') * 1000
        `);

        try {
            stmt.bind([filePath, fileType, contentHash, fileSize, lastModifiedMs]);
            stmt.step();
        } finally {
            stmt.free();
        }
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

        const stmt = this.db.prepare(`
            SELECT 
                COUNT(*) as total_files,
                COUNT(CASE WHEN file_type = 'source' THEN 1 END) as source_files,
                COUNT(CASE WHEN file_type = 'codex' THEN 1 END) as codex_files,
                AVG(file_size) as avg_file_size,
                MIN(last_synced_ms) as oldest_sync_ms,
                MAX(last_synced_ms) as newest_sync_ms
            FROM sync_metadata
        `);

        try {
            stmt.step();
            const result = stmt.getAsObject();
            return {
                totalFiles: (result.total_files as number) || 0,
                sourceFiles: (result.source_files as number) || 0,
                codexFiles: (result.codex_files as number) || 0,
                avgFileSize: (result.avg_file_size as number) || 0,
                oldestSync: result.oldest_sync_ms ? new Date(result.oldest_sync_ms as number) : null,
                newestSync: result.newest_sync_ms ? new Date(result.newest_sync_ms as number) : null,
            };
        } finally {
            stmt.free();
        }
    }

    /**
     * Remove sync metadata for files that no longer exist
     */
    async cleanupSyncMetadata(existingFilePaths: string[]): Promise<number> {
        if (!this.db) throw new Error("Database not initialized");

        if (existingFilePaths.length === 0) {
            // If no files exist, clear all sync metadata
            const stmt = this.db.prepare("DELETE FROM sync_metadata");
            try {
                stmt.step();
                return this.db.getRowsModified();
            } finally {
                stmt.free();
            }
        }

        // Create placeholders for IN clause
        const placeholders = existingFilePaths.map(() => '?').join(',');
        const stmt = this.db.prepare(`
            DELETE FROM sync_metadata 
            WHERE file_path NOT IN (${placeholders})
        `);

        try {
            stmt.bind(existingFilePaths);
            stmt.step();
            return this.db.getRowsModified();
        } finally {
            stmt.free();
        }
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
        const unknownFileStmt = this.db.prepare(`
            SELECT id FROM files WHERE file_path = 'unknown' AND file_type = 'source'
        `);

        let unknownFileId: number | null = null;
        try {
            unknownFileStmt.bind([]);
            if (unknownFileStmt.step()) {
                unknownFileId = (unknownFileStmt.getAsObject() as any).id;
            }
        } finally {
            unknownFileStmt.free();
        }

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

        const duplicateStmt = this.db.prepare(duplicateQuery);
        const duplicatesToRemove: Array<{ cellId: string; }> = [];

        try {
            duplicateStmt.bind([unknownFileId, unknownFileId]);
            while (duplicateStmt.step()) {
                const row = duplicateStmt.getAsObject() as any;
                duplicatesToRemove.push({
                    cellId: row.cell_id
                });
            }
        } finally {
            duplicateStmt.free();
        }

        debug(`Found ${duplicatesToRemove.length} duplicate cells to remove from 'unknown' file`);

        if (duplicatesToRemove.length === 0) {
            return { duplicatesRemoved: 0, cellsAffected: 0, unknownFileRemoved: false };
        }

        // Remove duplicates from 'unknown' file in batches
        let duplicatesRemoved = 0;
        await this.runInTransaction(() => {
            // Remove cells from FTS first (both source and target entries)
            for (const duplicate of duplicatesToRemove) {
                try {
                    this.db!.run("DELETE FROM cells_fts WHERE cell_id = ? AND content_type = 'source'", [duplicate.cellId]);
                } catch (error) {
                    // Continue even if FTS delete fails
                }
            }

            // Update cells to remove source data from 'unknown' file
            const updateStmt = this.db!.prepare(`
                UPDATE cells 
                SET s_file_id = NULL,
                    s_content = NULL,
                    s_raw_content = NULL,
                    s_line_number = NULL,

                    s_word_count = NULL,
                    s_raw_content_hash = NULL,
                    s_content_hash = NULL,

                    s_updated_at = datetime('now')
                WHERE cell_id = ? AND s_file_id = ?
            `);
            try {
                for (const duplicate of duplicatesToRemove) {
                    updateStmt.bind([duplicate.cellId, unknownFileId]);
                    updateStmt.step();
                    duplicatesRemoved++;
                    updateStmt.reset();
                }
            } finally {
                updateStmt.free();
            }
        });

        // Check if 'unknown' file now has any remaining cells
        const remainingCellsStmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM cells WHERE s_file_id = ? OR t_file_id = ?
        `);

        let remainingCells = 0;
        try {
            remainingCellsStmt.bind([unknownFileId, unknownFileId]);
            if (remainingCellsStmt.step()) {
                remainingCells = (remainingCellsStmt.getAsObject() as any).count;
            }
        } finally {
            remainingCellsStmt.free();
        }

        // If no cells remain, remove the 'unknown' file entry
        let unknownFileRemoved = false;
        if (remainingCells === 0) {
            this.db.run("DELETE FROM files WHERE id = ?", [unknownFileId]);
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
        returnRawContent: boolean = false
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

            const stmt = this.db.prepare(sql);
            const results = [];

            try {
                stmt.bind([limit]);
                while (stmt.step()) {
                    const row = stmt.getAsObject();

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
            } finally {
                stmt.free();
            }

            return results;
        }

        // Debug: Check if we have any complete pairs in the database at all
        const debugStmt = this.db.prepare(`
            SELECT COUNT(*) as complete_pairs_count
            FROM cells c
            WHERE c.s_content IS NOT NULL 
                AND c.s_content != ''
                AND c.t_content IS NOT NULL 
                AND c.t_content != ''
        `);

        let totalCompletePairs = 0;
        try {
            debugStmt.step();
            totalCompletePairs = (debugStmt.getAsObject().complete_pairs_count as number) || 0;
        } finally {
            debugStmt.free();
        }

        console.log(`[searchCompleteTranslationPairs] Database contains ${totalCompletePairs} complete translation pairs total`);

        // Use FTS5's natural fuzzy search - keep it simple and let FTS5 do the work
        // Clean the query but don't over-process it
        const cleanQuery = query
            .trim()
            .replace(/[^\w\s\u0370-\u03FF\u1F00-\u1FFF]/g, ' ') // Keep Greek characters and basic word chars
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        if (!cleanQuery) {
            return this.searchCompleteTranslationPairs('', limit, returnRawContent);
        }

        console.log(`[searchCompleteTranslationPairs] Using natural FTS5 search with query: "${cleanQuery}"`);

        // Enhanced FTS5 query - search BOTH source AND target content for complete pairs
        const sql = `
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
                AND c.s_content IS NOT NULL 
                AND c.s_content != ''
                AND c.t_content IS NOT NULL 
                AND c.t_content != ''
            ORDER BY score DESC
            LIMIT ?
        `;

        const stmt = this.db.prepare(sql);
        const results = [];

        try {
            // Use the clean query directly - let FTS5 do its magic
            stmt.bind([cleanQuery, limit]);

            while (stmt.step()) {
                const row = stmt.getAsObject();

                // Target content is now directly available from the main query
                const targetContent = row.target_content as string;
                const rawTargetContent = row.raw_target_content as string;

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

            // If FTS5 query fails, try a simple LIKE fallback that searches both source and target
            console.log(`[searchCompleteTranslationPairs] Falling back to LIKE search`);
            const fallbackStmt = this.db.prepare(`
                SELECT 
                    c.cell_id,
                    c.s_content as source_content,
                    c.s_raw_content as raw_source_content,
                    c.t_content as target_content,
                    c.t_raw_content as raw_target_content,
                    c.s_line_number as line,
                    COALESCE(s_file.file_path, t_file.file_path) as uri,
                    1.0 as score
                FROM cells c
                LEFT JOIN files s_file ON c.s_file_id = s_file.id
                LEFT JOIN files t_file ON c.t_file_id = t_file.id
                WHERE c.s_content IS NOT NULL 
                    AND c.s_content != ''
                    AND c.t_content IS NOT NULL 
                    AND c.t_content != ''
                    AND (c.s_content LIKE ? OR c.t_content LIKE ?)
                ORDER BY c.cell_id DESC
                LIMIT ?
            `);

            try {
                // Use first word for LIKE search in both source and target
                const firstWord = cleanQuery.split(' ')[0];
                const searchPattern = `%${firstWord}%`;
                fallbackStmt.bind([searchPattern, searchPattern, limit]);

                while (fallbackStmt.step()) {
                    const row = fallbackStmt.getAsObject();

                    // Target content is now directly available from the main query
                    const targetContent = row.target_content as string;
                    const rawTargetContent = row.raw_target_content as string;

                    results.push({
                        cellId: row.cell_id,
                        cell_id: row.cell_id,
                        sourceContent: returnRawContent && row.raw_source_content ? row.raw_source_content : row.source_content,
                        targetContent: returnRawContent && rawTargetContent ? rawTargetContent : targetContent,
                        content: returnRawContent && row.raw_source_content ? row.raw_source_content : row.source_content,
                        uri: row.uri,
                        line: row.line,
                        score: row.score,
                        cell_type: 'source'
                    });
                }
            } finally {
                fallbackStmt.free();
            }
        } finally {
            stmt.free();
        }

        console.log(`[searchCompleteTranslationPairs] Found ${results.length} complete translation pairs`);

        // If we still have no results and there are complete pairs in the database, 
        // let's debug by showing some sample data
        if (results.length === 0 && totalCompletePairs > 0) {
            console.log(`[searchCompleteTranslationPairs] No results found despite ${totalCompletePairs} complete pairs existing. Debugging...`);

            // Show a few sample source cells to see what the content looks like
            const sampleStmt = this.db.prepare(`
                SELECT c.cell_id, c.s_content as content, 'source' as cell_type 
                FROM cells c 
                WHERE c.s_content IS NOT NULL AND c.s_content != '' 
                LIMIT 3
            `);

            try {
                console.log(`[searchCompleteTranslationPairs] Sample source cells in database:`);
                while (sampleStmt.step()) {
                    const sample = sampleStmt.getAsObject();
                    console.log(`  ${sample.cell_id}: ${(sample.content as string).substring(0, 50)}...`);
                }
            } finally {
                sampleStmt.free();
            }

            // Try a very simple FTS search to see if FTS is working at all
            const simpleStmt = this.db.prepare(`
                SELECT cell_id, content 
                FROM cells_fts 
                WHERE cells_fts MATCH ? 
                LIMIT 3
            `);

            try {
                console.log(`[searchCompleteTranslationPairs] Simple FTS test with first word of query:`);
                const firstWord = cleanQuery.split(' ')[0];
                simpleStmt.bind([firstWord]);
                while (simpleStmt.step()) {
                    const sample = simpleStmt.getAsObject();
                    console.log(`  ${sample.cell_id}: ${(sample.content as string).substring(0, 50)}...`);
                }
            } finally {
                simpleStmt.free();
            }
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
        onlyValidated: boolean = false
    ): Promise<any[]> {
        console.log(`[searchCompleteTranslationPairsWithValidation] Searching for ${onlyValidated ? 'validated-only' : 'all'} translation pairs`);
        // If validation filtering is not required, use the existing method
        if (!onlyValidated) {
            return this.searchCompleteTranslationPairs(query, limit, returnRawContent);
        }

        if (!this.db) throw new Error("Database not initialized");

        console.log(`[searchCompleteTranslationPairsWithValidation] Searching for ${onlyValidated ? 'validated-only' : 'all'} translation pairs`);

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

            const stmt = this.db.prepare(sql);
            const results = [];

            try {
                stmt.bind([limit]);
                while (stmt.step()) {
                    const row = stmt.getAsObject();

                    // Additional validation check if needed
                    let isFullyValidated = true;
                    if (onlyValidated) {
                        isFullyValidated = await this.isTargetCellFullyValidated(row.cell_id as string);
                        console.log(`[searchCompleteTranslationPairsWithValidation] Target cell ${row.cell_id} is ${isFullyValidated ? 'validated' : 'not validated'}`);
                    }

                    if (isFullyValidated) {
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
                }
            } finally {
                stmt.free();
            }

            return results;
        }

        // Clean query for FTS5 search
        const cleanQuery = query
            .trim()
            .replace(/[^\w\s\u0370-\u03FF\u1F00-\u1FFF]/g, ' ') // Keep Greek characters and basic word chars
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        if (!cleanQuery) {
            return this.searchCompleteTranslationPairsWithValidation('', limit, returnRawContent, onlyValidated);
        }

        console.log(`[searchCompleteTranslationPairsWithValidation] Using FTS5 search with validation filter: "${cleanQuery}"`);

        // FTS5 query with validation filtering
        const sql = `
            SELECT 
                c.cell_id,
                c.s_content as source_content,
                c.s_raw_content as raw_source_content,
                c.s_line_number as line,
                COALESCE(s_file.file_path, t_file.file_path) as uri,
                bm25(cells_fts) as score
            FROM cells_fts
            JOIN cells c ON cells_fts.cell_id = c.cell_id
            LEFT JOIN files s_file ON c.s_file_id = s_file.id
            LEFT JOIN files t_file ON c.t_file_id = t_file.id
            WHERE cells_fts MATCH ?
                AND cells_fts.content_type = 'source'
                AND c.s_content IS NOT NULL 
                AND c.s_content != ''
                AND c.t_content IS NOT NULL 
                AND c.t_content != ''
            ORDER BY score DESC
            LIMIT ?
        `;

        const stmt = this.db.prepare(sql);
        const results = [];

        try {
            stmt.bind([cleanQuery, limit * 3]); // Get more results to account for validation filtering

            while (stmt.step()) {
                const row = stmt.getAsObject();

                // Check if target content is validated (only if onlyValidated is true)
                let isFullyValidated = true;
                if (onlyValidated) {
                    isFullyValidated = await this.isTargetCellFullyValidated(row.cell_id as string);
                    console.log(`[searchCompleteTranslationPairsWithValidation] Target cell ${row.cell_id} is ${isFullyValidated ? 'validated' : 'not validated'}`);
                }

                if (isFullyValidated) {
                    // Get the target content for this cell
                    const targetStmt = this.db.prepare(`
                        SELECT t_content as content, t_raw_content as raw_content 
                        FROM cells 
                        WHERE cell_id = ? AND t_content IS NOT NULL AND t_content != ''
                        LIMIT 1
                    `);

                    let targetContent = '';
                    let rawTargetContent = '';
                    try {
                        targetStmt.bind([row.cell_id]);
                        if (targetStmt.step()) {
                            const targetRow = targetStmt.getAsObject();
                            targetContent = targetRow.content as string;
                            rawTargetContent = targetRow.raw_content as string;
                        }
                    } finally {
                        targetStmt.free();
                    }

                    if (targetContent) { // Only include if we found target content
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

                    // Stop when we have enough results
                    if (results.length >= limit) break;
                }
            }
        } catch (error) {
            console.error(`[searchCompleteTranslationPairsWithValidation] FTS5 query failed: ${error}`);
            // Fallback to non-validated search if validation filtering fails
            return this.searchCompleteTranslationPairs(query, limit, returnRawContent);
        } finally {
            stmt.free();
        }

        console.log(`[searchCompleteTranslationPairsWithValidation] Found ${results.length} ${onlyValidated ? 'validated' : 'all'} translation pairs`);
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
        const stmt = this.db.prepare(`
            SELECT t_is_fully_validated FROM cells 
            WHERE cell_id = ? AND t_content IS NOT NULL
            LIMIT 1
        `);

        try {
            stmt.bind([cellId]);
            if (stmt.step()) {
                const row = stmt.getAsObject();
                return Boolean(row.t_is_fully_validated);
            }
        } catch (error) {
            console.error(`[isTargetCellFullyValidated] Error checking validation for ${cellId}:`, error);
        } finally {
            stmt.free();
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
 * Recalculate t_is_fully_validated for all cells based on current validation threshold
 * This should be called whenever the validation threshold setting changes
 */
    async recalculateAllValidationStatus(): Promise<{ updatedCells: number; }> {
        if (!this.db) throw new Error("Database not initialized");

        const currentThreshold = this.getValidationThreshold();

        // Update all target cells based on current validation count vs threshold
        const updateStmt = this.db.prepare(`
            UPDATE cells 
            SET t_is_fully_validated = CASE 
                WHEN t_validation_count >= ? THEN 1 
                ELSE 0 
            END
            WHERE t_content IS NOT NULL AND t_content != ''
        `);

        try {
            updateStmt.bind([currentThreshold]);
            updateStmt.step();
            const updatedCells = this.db.getRowsModified();

            // Save changes to disk
            await this.saveDatabase();

            return { updatedCells };
        } finally {
            updateStmt.free();
        }
    }

    /**
     * Extract frequently accessed metadata fields for dedicated columns
     */
    private extractMetadataFields(metadata: any, cellType: "source" | "target"): {
        currentEditTimestamp?: number | null;
        validationCount?: number;
        validatedBy?: string;
        isFullyValidated?: boolean;
    } {
        const result: {
            currentEditTimestamp?: number | null;
            validationCount?: number;
            validatedBy?: string;
            isFullyValidated?: boolean;
        } = {};

        if (!metadata || typeof metadata !== 'object' || cellType !== 'target') {
            return result;
        }

        // Extract edit information for target cells only
        const edits = metadata.edits || [];



        if (edits.length > 0) {
            const lastEdit = edits[edits.length - 1];
            result.currentEditTimestamp = lastEdit.timestamp || null;

            // Extract validation information
            if (lastEdit.validatedBy) {


                const activeValidations = lastEdit.validatedBy.filter((v: any) =>
                    v && typeof v === 'object' && !v.isDeleted
                );
                result.validationCount = activeValidations.length;

                // NEW: Check against validation threshold instead of just > 0
                const requiredValidators = this.getValidationThreshold();
                result.isFullyValidated = activeValidations.length >= requiredValidators;

                // Store comma-separated list of usernames
                const usernames = activeValidations.map((v: any) => v.username).filter(Boolean);
                result.validatedBy = usernames.length > 0 ? usernames.join(',') : undefined;


            } else {
                result.validationCount = 0;
                result.isFullyValidated = false;
                result.validatedBy = undefined;

            }
        } else {

        }

        return result;
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

        const currentVersion = this.getSchemaVersion();

        // Get all schema_info rows
        const schemaInfoStmt = this.db.prepare("SELECT * FROM schema_info");
        const schemaInfoRows: any[] = [];
        try {
            while (schemaInfoStmt.step()) {
                schemaInfoRows.push(schemaInfoStmt.getAsObject());
            }
        } catch {
            // Table might not exist
        } finally {
            schemaInfoStmt.free();
        }

        // Check if cells table exists and its structure
        let cellsTableExists = false;
        const cellsColumns: string[] = [];
        try {
            const cellsColumnsStmt = this.db.prepare("PRAGMA table_info(cells)");
            try {
                while (cellsColumnsStmt.step()) {
                    cellsTableExists = true;
                    cellsColumns.push(cellsColumnsStmt.getAsObject().name as string);
                }
            } finally {
                cellsColumnsStmt.free();
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
        const statsStmt = this.db.prepare(`
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

        let stats = {
            totalCells: 0,
            cellsWithSourceLineNumbers: 0,
            cellsWithTargetLineNumbers: 0,
            cellsWithNullSourceLineNumbers: 0,
            cellsWithNullTargetLineNumbers: 0,
            targetCellsWithContent: 0,
            targetCellsWithoutContent: 0
        };

        try {
            statsStmt.step();
            const result = statsStmt.getAsObject();
            stats = {
                totalCells: (result.total_cells as number) || 0,
                cellsWithSourceLineNumbers: (result.cells_with_source_line_numbers as number) || 0,
                cellsWithTargetLineNumbers: (result.cells_with_target_line_numbers as number) || 0,
                cellsWithNullSourceLineNumbers: (result.cells_with_null_source_line_numbers as number) || 0,
                cellsWithNullTargetLineNumbers: (result.cells_with_null_target_line_numbers as number) || 0,
                targetCellsWithContent: (result.target_cells_with_content as number) || 0,
                targetCellsWithoutContent: (result.target_cells_without_content as number) || 0
            };
        } finally {
            statsStmt.free();
        }

        // Get sample cells with line numbers
        const sampleStmt = this.db.prepare(`
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

        try {
            while (sampleStmt.step()) {
                const row = sampleStmt.getAsObject();
                sampleCells.push({
                    cellId: row.cell_id as string,
                    sourceLineNumber: row.source_line_number as number | null,
                    targetLineNumber: row.target_line_number as number | null,
                    sourceFilePath: row.source_file_path as string | null,
                    targetFilePath: row.target_file_path as string | null,
                    hasSourceContent: Boolean(row.has_source_content),
                    hasTargetContent: Boolean(row.has_target_content)
                });
            }
        } finally {
            sampleStmt.free();
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
        const statsStmt = this.db.prepare(`
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

        let stats = {
            totalTargetCells: 0,
            targetCellsWithContent: 0,
            targetCellsWithCreatedAt: 0,
            targetCellsWithEditTimestamp: 0,
            targetCellsWithContentButNoCreatedAt: 0,
            targetCellsWithoutContentButWithCreatedAt: 0
        };

        try {
            statsStmt.step();
            const result = statsStmt.getAsObject();
            stats = {
                totalTargetCells: (result.total_target_cells as number) || 0,
                targetCellsWithContent: (result.target_cells_with_content as number) || 0,
                targetCellsWithCreatedAt: (result.target_cells_with_created_at as number) || 0,
                targetCellsWithEditTimestamp: (result.target_cells_with_edit_timestamp as number) || 0,
                targetCellsWithContentButNoCreatedAt: (result.target_cells_with_content_but_no_created_at as number) || 0,
                targetCellsWithoutContentButWithCreatedAt: (result.target_cells_without_content_but_with_created_at as number) || 0
            };
        } finally {
            statsStmt.free();
        }

        // Get sample target cells to inspect timestamps
        const sampleStmt = this.db.prepare(`
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

        try {
            while (sampleStmt.step()) {
                const row = sampleStmt.getAsObject();
                sampleCells.push({
                    cellId: row.cell_id as string,
                    hasContent: Boolean(row.has_content),
                    createdAt: row.created_at as number | null,
                    editTimestamp: row.edit_timestamp as number | null,
                    createdAtDate: row.created_at ? new Date(row.created_at as number).toISOString() : null,
                    editTimestampDate: row.edit_timestamp ? new Date(row.edit_timestamp as number).toISOString() : null
                });
            }
        } finally {
            sampleStmt.free();
        }

        // Find timestamp consistency issues
        const issuesStmt = this.db.prepare(`
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

        try {
            while (issuesStmt.step()) {
                const row = issuesStmt.getAsObject();
                const hasContent = Boolean(row.has_content);
                const createdAt = row.created_at as number | null;
                const editTimestamp = row.edit_timestamp as number | null;

                let issue = '';
                if (hasContent && !createdAt) {
                    issue = 'Has content but missing t_created_at';
                } else if (!hasContent && createdAt) {
                    issue = 'No content but has t_created_at (should be NULL)';
                } else if (hasContent && !editTimestamp) {
                    issue = 'Has content but missing t_current_edit_timestamp';
                }

                timestampConsistencyIssues.push({
                    cellId: row.cell_id as string,
                    issue,
                    hasContent,
                    createdAt,
                    editTimestamp
                });
            }
        } finally {
            issuesStmt.free();
        }

        return {
            ...stats,
            sampleTargetCells: sampleCells,
            timestampConsistencyIssues
        };
    }
}
