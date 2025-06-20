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
    DEBUG_MODE && debug(`${message}`, ...args);
};

// Schema version for migrations
const CURRENT_SCHEMA_VERSION = 7; // Incremented to add unique constraint for target cells

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

            // Cells table
            this.db!.run(`
                CREATE TABLE IF NOT EXISTS cells (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cell_id TEXT NOT NULL,
                    file_id INTEGER NOT NULL,
                    cell_type TEXT NOT NULL CHECK(cell_type IN ('source', 'target')),
                    content TEXT NOT NULL,
                    raw_content_hash TEXT NOT NULL,
                    line_number INTEGER,
                    word_count INTEGER DEFAULT 0,
                    metadata TEXT,
                    raw_content TEXT,
                    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
                    UNIQUE(cell_id, file_id, cell_type)
                )
            `);

            // Create a unique constraint for target cells to prevent duplicates
            this.db!.run(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_target_cells 
                ON cells (cell_id) 
                WHERE cell_type = 'target'
            `);

            // Translation pairs table
            this.db!.run(`
                CREATE TABLE IF NOT EXISTS translation_pairs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_cell_id INTEGER NOT NULL,
                    target_cell_id INTEGER,
                    is_complete BOOLEAN DEFAULT 0,
                    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                    FOREIGN KEY (source_cell_id) REFERENCES cells(id) ON DELETE CASCADE,
                    FOREIGN KEY (target_cell_id) REFERENCES cells(id) ON DELETE SET NULL,
                    UNIQUE(source_cell_id, target_cell_id)
                )
            `);

            // Words table
            this.db!.run(`
                CREATE TABLE IF NOT EXISTS words (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    word TEXT NOT NULL,
                    cell_id INTEGER NOT NULL,
                    position INTEGER NOT NULL,
                    frequency INTEGER DEFAULT 1,
                    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                    FOREIGN KEY (cell_id) REFERENCES cells(id) ON DELETE CASCADE
                )
            `);

            debug("Creating full-text search index...");
            // FTS5 virtual table - defer this as it's expensive
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
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_cells_file_id ON cells(file_id)");
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
                CREATE TRIGGER IF NOT EXISTS update_cells_timestamp 
                AFTER UPDATE ON cells
                BEGIN
                    UPDATE cells SET updated_at = strftime('%s', 'now') * 1000 
                    WHERE id = NEW.id;
                END
            `);

            // FTS synchronization triggers
            this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_insert 
                AFTER INSERT ON cells
                BEGIN
                    INSERT INTO cells_fts(cell_id, content, raw_content, content_type) 
                    VALUES (NEW.cell_id, NEW.content, COALESCE(NEW.raw_content, NEW.content), NEW.cell_type);
                END
            `);

            this.db!.run(`
                CREATE TRIGGER IF NOT EXISTS cells_fts_update 
                AFTER UPDATE OF content, raw_content ON cells
                BEGIN
                    UPDATE cells_fts 
                    SET content = NEW.content, raw_content = COALESCE(NEW.raw_content, NEW.content)
                    WHERE cell_id = NEW.cell_id;
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
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_cells_cell_id ON cells(cell_id)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_cells_raw_content_hash ON cells(raw_content_hash)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_words_word ON words(word)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_words_cell_id ON words(cell_id)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_translation_pairs_source ON translation_pairs(source_cell_id)");
            this.db!.run("CREATE INDEX IF NOT EXISTS idx_translation_pairs_target ON translation_pairs(target_cell_id)");
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
                // New database - create with latest schema
                stepStart = this.trackProgress("Initialize new database schema", stepStart);
                debug("Setting up new database with latest schema");
                await this.createSchema();
                this.setSchemaVersion(CURRENT_SCHEMA_VERSION);
                this.trackProgress("New database schema initialized", stepStart);
                debug(`New database created with schema version ${CURRENT_SCHEMA_VERSION}`);
            } else if (currentVersion > CURRENT_SCHEMA_VERSION) {
                // Database schema is ahead of code - recreate to avoid compatibility issues
                stepStart = this.trackProgress("Handle future schema version", stepStart);
                debug(`[SQLiteIndex] Database schema version ${currentVersion} is ahead of code version ${CURRENT_SCHEMA_VERSION}`);
                debug("[SQLiteIndex] Recreating database to ensure compatibility");

                await this.recreateDatabase();
                this.setSchemaVersion(CURRENT_SCHEMA_VERSION);

                this.trackProgress("Future schema compatibility resolved", stepStart);
                debug(`Database recreated with compatible schema version ${CURRENT_SCHEMA_VERSION}`);
            } else if (currentVersion < CURRENT_SCHEMA_VERSION) {
                // Handle migrations based on version
                stepStart = this.trackProgress("Migrate database schema", stepStart);
                debug(`Migrating database from version ${currentVersion} to ${CURRENT_SCHEMA_VERSION}`);

                if (currentVersion < 6) {
                    // Schema version 6: content_hash -> raw_content_hash and hash calculation change
                    // This is a breaking change that requires full database recreation
                    debug("Schema version 6 requires full database recreation due to hash column changes");

                    // Show user notification about the one-time migration
                    const vscode = await import('vscode');
                    vscode.window.showInformationMessage("Codex: Upgrading database schema to version 6. This is a one-time operation that will improve sync performance...");

                    await this.recreateDatabase();
                } else if (currentVersion < 7) {
                    // Schema version 7: Add unique constraint for target cells
                    debug("Schema version 7: Adding unique constraint for target cells");

                    // Show user notification about the migration
                    const vscode = await import('vscode');
                    vscode.window.showInformationMessage("Codex: Upgrading database to prevent duplicate target cells. This may take a moment...");

                    // First, clean up any existing duplicates
                    const duplicationResult = await this.deduplicateTargetCells();
                    debug(`[SQLiteIndex] Deduplication complete: ${duplicationResult.duplicatesRemoved} duplicates removed from ${duplicationResult.cellsAffected} cells`);

                    // Then add the new unique constraint
                    await this.runInTransaction(() => {
                        this.db!.run(`
                            CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_target_cells 
                            ON cells (cell_id) 
                            WHERE cell_type = 'target'
                        `);
                    });

                    debug("Schema version 7: Unique constraint for target cells added successfully");
                }

                // Update schema version after successful migration
                this.setSchemaVersion(CURRENT_SCHEMA_VERSION);
                this.trackProgress("Database migration complete", stepStart);
                debug(`Database migrated to schema version ${CURRENT_SCHEMA_VERSION}`);
            } else {
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

            if (!hasTable) return 1; // Assume version 1 if no schema_info table but other tables exist

            const stmt = this.db.prepare("SELECT version FROM schema_info LIMIT 1");
            try {
                if (stmt.step()) {
                    const result = stmt.getAsObject();
                    return (result.version as number) || 1;
                }
                return 1;
            } finally {
                stmt.free();
            }
        } catch {
            return 1; // Fallback to version 1
        }
    }

    setSchemaVersion(version: number): void {
        if (!this.db) return;

        // Create schema_info table if it doesn't exist
        this.db.run(`
            CREATE TABLE IF NOT EXISTS schema_info (
                version INTEGER PRIMARY KEY
            )
        `);

        // Insert or update version
        this.db.run(`
            INSERT OR REPLACE INTO schema_info (version) VALUES (?)
        `, [version]);
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
    ): Promise<{ id: number; isNew: boolean; contentChanged: boolean; }> {
        if (!this.db) throw new Error("Database not initialized");

        // Use rawContent if provided, otherwise fall back to content
        const actualRawContent = rawContent || content;

        // Sanitize content for storage - remove HTML tags for clean searching/indexing
        const sanitizedContent = this.sanitizeContent(content);

        const rawContentHash = this.computeRawContentHash(actualRawContent);
        const wordCount = sanitizedContent.split(/\s+/).filter((w) => w.length > 0).length;

        // Check if cell exists and if content changed
        // For target cells, check globally (ignore file_id due to unique constraint)
        // For source cells, maintain per-file uniqueness
        const checkStmt = this.db.prepare(cellType === 'target' ? `
            SELECT id, raw_content_hash, file_id FROM cells 
            WHERE cell_id = ? AND cell_type = ?
        ` : `
            SELECT id, raw_content_hash, file_id FROM cells 
            WHERE cell_id = ? AND file_id = ? AND cell_type = ?
        `);

        let existingCell: { id: number; raw_content_hash: string; file_id?: number; } | null = null;
        try {
            if (cellType === 'target') {
                checkStmt.bind([cellId, cellType]);
            } else {
                checkStmt.bind([cellId, fileId, cellType]);
            }
            if (checkStmt.step()) {
                existingCell = checkStmt.getAsObject() as any;
            }
        } finally {
            checkStmt.free();
        }

        const contentChanged = !existingCell || existingCell.raw_content_hash !== rawContentHash;
        const isNew = !existingCell;

        if (!contentChanged && existingCell) {
            return { id: existingCell.id, isNew: false, contentChanged: false };
        }

        // For target cells, update the file_id to the current file when updating
        const actualFileId = (cellType === 'target' && existingCell) ? fileId : fileId;

        // Upsert the cell - store sanitized content in content column, original in raw_content
        // Use different conflict resolution for target vs source cells
        const upsertStmt = this.db.prepare(cellType === 'target' ? `
            INSERT INTO cells (cell_id, file_id, cell_type, content, raw_content_hash, line_number, word_count, metadata, raw_content)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cell_id) WHERE cell_type = 'target' DO UPDATE SET
                file_id = excluded.file_id,
                content = excluded.content,
                raw_content_hash = excluded.raw_content_hash,
                line_number = excluded.line_number,
                word_count = excluded.word_count,
                metadata = excluded.metadata,
                raw_content = excluded.raw_content,
                updated_at = strftime('%s', 'now') * 1000
            RETURNING id
        ` : `
            INSERT INTO cells (cell_id, file_id, cell_type, content, raw_content_hash, line_number, word_count, metadata, raw_content)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cell_id, file_id, cell_type) DO UPDATE SET
                content = excluded.content,
                raw_content_hash = excluded.raw_content_hash,
                line_number = excluded.line_number,
                word_count = excluded.word_count,
                metadata = excluded.metadata,
                raw_content = excluded.raw_content,
                updated_at = strftime('%s', 'now') * 1000
            RETURNING id
        `);

        try {
            upsertStmt.bind([
                cellId,
                actualFileId,
                cellType,
                sanitizedContent, // Store sanitized content in content column
                rawContentHash,
                lineNumber || null,
                wordCount,
                metadata ? JSON.stringify(metadata) : null,
                actualRawContent, // Store original/raw content in raw_content column
            ]);
            upsertStmt.step();
            const result = upsertStmt.getAsObject();

            this.debouncedSave();
            return { id: result.id as number, isNew, contentChanged };
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
    ): { id: number; isNew: boolean; contentChanged: boolean; } {
        if (!this.db) throw new Error("Database not initialized");

        // Use rawContent if provided, otherwise fall back to content
        const actualRawContent = rawContent || content;

        // Sanitize content for storage - remove HTML tags for clean searching/indexing
        const sanitizedContent = this.sanitizeContent(content);

        const rawContentHash = this.computeRawContentHash(actualRawContent);
        const wordCount = sanitizedContent.split(/\s+/).filter((w) => w.length > 0).length;

        // Check if cell exists and if content changed
        // For target cells, check globally (ignore file_id due to unique constraint)
        // For source cells, maintain per-file uniqueness
        const checkStmt = this.db.prepare(cellType === 'target' ? `
            SELECT id, raw_content_hash, file_id FROM cells 
            WHERE cell_id = ? AND cell_type = ?
        ` : `
            SELECT id, raw_content_hash, file_id FROM cells 
            WHERE cell_id = ? AND file_id = ? AND cell_type = ?
        `);

        let existingCell: { id: number; raw_content_hash: string; file_id?: number; } | null = null;
        try {
            if (cellType === 'target') {
                checkStmt.bind([cellId, cellType]);
            } else {
                checkStmt.bind([cellId, fileId, cellType]);
            }
            if (checkStmt.step()) {
                existingCell = checkStmt.getAsObject() as any;
            }
        } finally {
            checkStmt.free();
        }

        const contentChanged = !existingCell || existingCell.raw_content_hash !== rawContentHash;
        const isNew = !existingCell;

        if (!contentChanged && existingCell) {
            return { id: existingCell.id, isNew: false, contentChanged: false };
        }

        // For target cells, update the file_id to the current file when updating
        const actualFileId = (cellType === 'target' && existingCell) ? fileId : fileId;

        // Upsert the cell - store sanitized content in content column, original in raw_content
        // Use different conflict resolution for target vs source cells
        const upsertStmt = this.db.prepare(cellType === 'target' ? `
            INSERT INTO cells (cell_id, file_id, cell_type, content, raw_content_hash, line_number, word_count, metadata, raw_content)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cell_id) WHERE cell_type = 'target' DO UPDATE SET
                file_id = excluded.file_id,
                content = excluded.content,
                raw_content_hash = excluded.raw_content_hash,
                line_number = excluded.line_number,
                word_count = excluded.word_count,
                metadata = excluded.metadata,
                raw_content = excluded.raw_content,
                updated_at = strftime('%s', 'now') * 1000
            RETURNING id
        ` : `
            INSERT INTO cells (cell_id, file_id, cell_type, content, raw_content_hash, line_number, word_count, metadata, raw_content)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cell_id, file_id, cell_type) DO UPDATE SET
                content = excluded.content,
                raw_content_hash = excluded.raw_content_hash,
                line_number = excluded.line_number,
                word_count = excluded.word_count,
                metadata = excluded.metadata,
                raw_content = excluded.raw_content,
                updated_at = strftime('%s', 'now') * 1000
            RETURNING id
        `);

        try {
            upsertStmt.bind([
                cellId,
                actualFileId,
                cellType,
                sanitizedContent, // Store sanitized content in content column
                rawContentHash,
                lineNumber || null,
                wordCount,
                metadata ? JSON.stringify(metadata) : null,
                actualRawContent, // Store original/raw content in raw_content column
            ]);
            upsertStmt.step();
            const result = upsertStmt.getAsObject();

            // Note: Don't call debouncedSave() in sync version as it's async
            return { id: result.id as number, isNew, contentChanged };
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
            this.db!.run("DELETE FROM translation_pairs");
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
                c.cell_id,
                c.content,
                c.raw_content,
                c.cell_type,
                c.line_number as line,
                c.metadata,
                f.file_path as uri,
                bm25(cells_fts) as score
            FROM cells_fts
            JOIN cells c ON cells_fts.cell_id = c.cell_id
            JOIN files f ON c.file_id = f.id
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
                const metadata = row.metadata ? JSON.parse(row.metadata as string) : {};

                // Verify both columns contain data - no fallbacks
                if (!row.content || !row.raw_content) {
                    debug(`[SQLiteIndex] Cell ${row.cell_id} missing content data:`, {
                        content: !!row.content,
                        raw_content: !!row.raw_content
                    });
                    continue; // Skip this result
                }

                // Choose which content to return based on use case
                const contentToReturn = returnRawContent ? row.raw_content : row.content;

                // Format result to match MiniSearch output (minisearch was deprecated–thankfully. We're now using SQLite3 and FTS5.)
                const result: any = {
                    id: row.cell_id,
                    cellId: row.cell_id,
                    score: row.score,
                    match: {}, // MiniSearch compatibility (minisearch was deprecated–thankfully. We're now using SQLite3 and FTS5.)
                    uri: row.uri,
                    line: row.line,
                };

                // Add content based on cell type - always provide both versions for transparency
                if (row.cell_type === "source") {
                    result.sourceContent = contentToReturn;
                    result.content = contentToReturn;
                    // Always provide both versions for debugging/transparency
                    result.sanitizedContent = row.content;
                    result.rawContent = row.raw_content;
                } else {
                    result.targetContent = contentToReturn;
                    // Always provide both versions for debugging/transparency
                    result.sanitizedTargetContent = row.content;
                    result.rawTargetContent = row.raw_content;
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
                c.content,
                c.raw_content,
                c.cell_type,
                c.metadata,
                f.file_path
            FROM cells c
            JOIN files f ON c.file_id = f.id
            WHERE c.cell_id = ?
            ORDER BY c.cell_type ASC
        `);

        const results = [];
        try {
            stmt.bind([cellId]);
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
        } finally {
            stmt.free();
        }

        if (results.length === 0) return null;

        // Combine results for the same cell ID
        const combined: any = {
            cellId: cellId,
            content: "",
            versions: [],
        };

        for (const row of results) {
            const metadata = row.metadata ? JSON.parse(row.metadata as string) : {};

            if (row.cell_type === "source") {
                // Use raw_content if available, otherwise fall back to sanitized content
                combined.content = row.raw_content || row.content;
                if (metadata.versions) {
                    combined.versions = metadata.versions;
                }
            }
        }

        return combined;
    }

    // Get cell by exact ID match (for translation pairs)
    async getCellById(cellId: string, cellType?: "source" | "target"): Promise<any | null> {
        if (!this.db) return null;

        let sql = `
            SELECT 
                c.*,
                f.file_path,
                f.file_type
            FROM cells c
            JOIN files f ON c.file_id = f.id
            WHERE c.cell_id = ?
        `;

        if (cellType) {
            sql += ` AND c.cell_type = ?`;
        }

        sql += ` LIMIT 1`;

        const stmt = this.db.prepare(sql);
        try {
            if (cellType) {
                stmt.bind([cellId, cellType]);
            } else {
                stmt.bind([cellId]);
            }

            if (stmt.step()) {
                const row = stmt.getAsObject();
                const metadata = row.metadata ? JSON.parse(row.metadata as string) : {};

                return {
                    cellId: row.cell_id,
                    content: row.content,
                    rawContent: row.raw_content,
                    cell_type: row.cell_type,
                    uri: row.file_path,
                    line: row.line_number,
                    ...metadata,
                };
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

        // First, get the cell's internal ID
        const cellStmt = this.db.prepare("SELECT id FROM cells WHERE cell_id = ? LIMIT 1");
        let cellInternalId: number | null = null;

        try {
            cellStmt.bind([cellId]);
            if (cellStmt.step()) {
                cellInternalId = cellStmt.getAsObject().id as number;
            }
        } finally {
            cellStmt.free();
        }

        if (!cellInternalId) return;

        // Clear existing words for this cell
        this.db.run("DELETE FROM words WHERE cell_id = ?", [cellInternalId]);

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
                stmt.bind([word, cellInternalId, position++, frequency]);
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

        let sql = `
            SELECT 
                c.id, c.cell_id, c.content, c.raw_content, c.cell_type, c.word_count,
                f.file_path, f.file_type,
                c.line_number as line,
                bm25(cells_fts) as score
            FROM cells_fts
            JOIN cells c ON cells_fts.cell_id = c.cell_id
            JOIN files f ON c.file_id = f.id
            WHERE cells_fts MATCH ?
        `;

        const params: any[] = [`content: ${ftsQuery}`];

        if (cellType) {
            sql += ` AND c.cell_type = ?`;
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

                // Verify both columns contain data
                if (!row.content || !row.raw_content) {
                    debug(`[SQLiteIndex] Cell ${row.cell_id} missing content data`);
                    continue;
                }

                const metadata = row.metadata ? JSON.parse(row.metadata as string) : {};

                results.push({
                    cellId: row.cell_id,
                    cell_id: row.cell_id,
                    content: row.content,
                    rawContent: row.raw_content,
                    sourceContent: row.cell_type === 'source' ? row.content : undefined,
                    targetContent: row.cell_type === 'target' ? row.content : undefined,
                    cell_type: row.cell_type,
                    uri: row.file_path,
                    line: row.line,
                    score: row.score,
                    ...metadata
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
                    c.id, c.cell_id, c.content, c.raw_content, c.cell_type, c.word_count,
                    f.file_path as uri, f.file_type,
                    c.line_number as line,
                    0 as score
                FROM cells c
                JOIN files f ON c.file_id = f.id
                WHERE 1=1
            `;
            params = [];

            if (cellType) {
                sql += ` AND c.cell_type = ?`;
                params.push(cellType);
            }

            sql += ` ORDER BY c.id DESC LIMIT ?`;
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
                    c.id, c.cell_id, c.content, c.raw_content, c.cell_type, c.word_count,
                    f.file_path as uri, f.file_type,
                    c.line_number as line,
                    bm25(cells_fts) as score
                FROM cells_fts
                JOIN cells c ON cells_fts.cell_id = c.cell_id
                JOIN files f ON c.file_id = f.id
                WHERE cells_fts MATCH ?
            `;

            params = [`content: ${ftsQuery}`];

            if (cellType) {
                sql += ` AND c.cell_type = ?`;
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

                // Verify both columns contain data
                if (!row.content || !row.raw_content) {
                    debug(`[SQLiteIndex] Cell ${row.cell_id} missing content data`);
                    continue;
                }

                const metadata = row.metadata ? JSON.parse(row.metadata as string) : {};

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
                    ...metadata
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
                COUNT(c.id) as cell_count,
                SUM(c.word_count) as total_words
            FROM files f
            LEFT JOIN cells c ON f.id = c.file_id
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
                COUNT(raw_content) as cells_with_raw_content,
                SUM(CASE WHEN content != raw_content THEN 1 ELSE 0 END) as cells_with_different_content,
                AVG(LENGTH(content)) as avg_content_length,
                AVG(LENGTH(COALESCE(raw_content, ''))) as avg_raw_content_length,
                SUM(CASE WHEN content IS NULL OR content = '' THEN 1 ELSE 0 END) as cells_with_missing_content,
                SUM(CASE WHEN raw_content IS NULL OR raw_content = '' THEN 1 ELSE 0 END) as cells_with_missing_raw_content
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

        // Count translation pairs
        const pairsStmt = this.db.prepare(`
            SELECT 
                COUNT(*) as total_pairs,
                SUM(CASE WHEN is_complete = 1 THEN 1 ELSE 0 END) as complete_pairs,
                SUM(CASE WHEN is_complete = 0 THEN 1 ELSE 0 END) as incomplete_pairs
            FROM translation_pairs
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

        // Count orphaned source cells (source cells not in any translation pair)
        const orphanedSourceStmt = this.db.prepare(`
            SELECT COUNT(*) as count
            FROM cells c
            WHERE c.cell_type = 'source'
            AND NOT EXISTS (
                SELECT 1 FROM translation_pairs tp 
                WHERE tp.source_cell_id = c.id
            )
        `);

        let orphanedSourceCells = 0;
        try {
            orphanedSourceStmt.step();
            orphanedSourceCells = (orphanedSourceStmt.getAsObject().count as number) || 0;
        } finally {
            orphanedSourceStmt.free();
        }

        // Count orphaned target cells
        const orphanedTargetStmt = this.db.prepare(`
            SELECT COUNT(*) as count
            FROM cells c
            WHERE c.cell_type = 'target'
            AND NOT EXISTS (
                SELECT 1 FROM translation_pairs tp 
                WHERE tp.target_cell_id = c.id
            )
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

        // Check for cells with missing content
        const checkStmt = this.db.prepare(`
            SELECT cell_id, content, raw_content 
            FROM cells 
            WHERE content IS NULL OR content = '' OR raw_content IS NULL OR raw_content = ''
        `);

        try {
            while (checkStmt.step()) {
                const row = checkStmt.getAsObject();
                const cellId = row.cell_id as string;

                if (!row.content || row.content === '') {
                    issues.push(`Cell ${cellId} has missing or empty content`);
                    problematicCells.push({ cellId, issue: 'missing content' });
                }

                if (!row.raw_content || row.raw_content === '') {
                    issues.push(`Cell ${cellId} has missing or empty raw_content`);
                    problematicCells.push({ cellId, issue: 'missing raw_content' });
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
    ): Promise<{ id: number; isNew: boolean; contentChanged: boolean; }> {
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
            "This will delete the search index database and trigger a complete reindex. This may take several minutes. Continue?",
            { modal: true },
            "Yes, Delete and Reindex"
        );

        if (confirm === "Yes, Delete and Reindex") {
            vscode.window.showInformationMessage("Codex: Deleting database and starting reindex...");

            // Close current database connection
            await this.close();

            // Delete the database file
            await this.deleteDatabaseFile();

            vscode.window.showInformationMessage("Codex: Database deleted. Please reload the extension to trigger reindex.");
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
            SELECT DISTINCT u.cell_id, u.id as unknown_cell_id
            FROM cells u
            JOIN cells p ON u.cell_id = p.cell_id
            JOIN files f ON p.file_id = f.id
            WHERE u.file_id = ? 
            AND u.cell_type = 'source'
            AND p.file_id != ?
            AND p.cell_type = 'source'
            AND f.file_path != 'unknown'
        `;

        const duplicateStmt = this.db.prepare(duplicateQuery);
        const duplicatesToRemove: Array<{ cellId: string; unknownCellId: number; }> = [];

        try {
            duplicateStmt.bind([unknownFileId, unknownFileId]);
            while (duplicateStmt.step()) {
                const row = duplicateStmt.getAsObject() as any;
                duplicatesToRemove.push({
                    cellId: row.cell_id,
                    unknownCellId: row.unknown_cell_id
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
            // Remove cells from FTS first
            for (const duplicate of duplicatesToRemove) {
                try {
                    this.db!.run("DELETE FROM cells_fts WHERE cell_id = ?", [duplicate.cellId]);
                } catch (error) {
                    // Continue even if FTS delete fails
                }
            }

            // Remove cells from main table
            const deleteStmt = this.db!.prepare("DELETE FROM cells WHERE id = ?");
            try {
                for (const duplicate of duplicatesToRemove) {
                    deleteStmt.bind([duplicate.unknownCellId]);
                    deleteStmt.step();
                    duplicatesRemoved++;
                    deleteStmt.reset();
                }
            } finally {
                deleteStmt.free();
            }
        });

        // Check if 'unknown' file now has any remaining cells
        const remainingCellsStmt = this.db.prepare(`
            SELECT COUNT(*) as count FROM cells WHERE file_id = ?
        `);

        let remainingCells = 0;
        try {
            remainingCellsStmt.bind([unknownFileId]);
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
                SELECT DISTINCT
                    source_cell.cell_id,
                    source_cell.content as source_content,
                    source_cell.raw_content as raw_source_content,
                    target_cell.content as target_content,
                    target_cell.raw_content as raw_target_content,
                    source_file.file_path as uri,
                    source_cell.line_number as line,
                    0 as score
                FROM cells source_cell
                JOIN cells target_cell ON source_cell.cell_id = target_cell.cell_id 
                JOIN files source_file ON source_cell.file_id = source_file.id
                WHERE source_cell.cell_type = 'source' 
                    AND target_cell.cell_type = 'target'
                    AND source_cell.content IS NOT NULL 
                    AND source_cell.content != ''
                    AND target_cell.content IS NOT NULL 
                    AND target_cell.content != ''
                ORDER BY source_cell.id DESC
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
            SELECT COUNT(DISTINCT source_cells.cell_id) as complete_pairs_count
            FROM cells source_cells
            JOIN cells target_cells ON source_cells.cell_id = target_cells.cell_id 
            WHERE source_cells.cell_type = 'source' 
                AND target_cells.cell_type = 'target'
                AND source_cells.content IS NOT NULL 
                AND source_cells.content != ''
                AND target_cells.content IS NOT NULL 
                AND target_cells.content != ''
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

        // Simple FTS5 query - let FTS5 handle the fuzzy matching and ranking
        const sql = `
            SELECT 
                c.cell_id,
                c.content as source_content,
                c.raw_content as raw_source_content,
                c.line_number as line,
                f.file_path as uri,
                bm25(cells_fts) as score
            FROM cells_fts
            JOIN cells c ON cells_fts.cell_id = c.cell_id
            JOIN files f ON c.file_id = f.id
            WHERE cells_fts MATCH ?
                AND c.cell_type = 'source'
                AND c.content IS NOT NULL 
                AND c.content != ''
                AND EXISTS (
                    SELECT 1 FROM cells target_cells 
                    WHERE target_cells.cell_id = c.cell_id 
                        AND target_cells.cell_type = 'target'
                        AND target_cells.content IS NOT NULL 
                        AND target_cells.content != ''
                )
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

                // Get the target content for this cell
                const targetStmt = this.db.prepare(`
                    SELECT content, raw_content 
                    FROM cells 
                    WHERE cell_id = ? AND cell_type = 'target' AND content IS NOT NULL AND content != ''
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
            }
        } catch (error) {
            console.error(`[searchCompleteTranslationPairs] FTS5 query failed: ${error}`);

            // If FTS5 query fails, try a simple LIKE fallback
            console.log(`[searchCompleteTranslationPairs] Falling back to LIKE search`);
            const fallbackStmt = this.db.prepare(`
                SELECT 
                    c.cell_id,
                    c.content as source_content,
                    c.raw_content as raw_source_content,
                    c.line_number as line,
                    f.file_path as uri,
                    1.0 as score
                FROM cells c
                JOIN files f ON c.file_id = f.id
                WHERE c.cell_type = 'source'
                    AND c.content IS NOT NULL 
                    AND c.content != ''
                    AND c.content LIKE ?
                    AND EXISTS (
                        SELECT 1 FROM cells target_cells 
                        WHERE target_cells.cell_id = c.cell_id 
                            AND target_cells.cell_type = 'target'
                            AND target_cells.content IS NOT NULL 
                            AND target_cells.content != ''
                    )
                ORDER BY c.id DESC
                LIMIT ?
            `);

            try {
                // Use first word for LIKE search
                const firstWord = cleanQuery.split(' ')[0];
                fallbackStmt.bind([`%${firstWord}%`, limit]);

                while (fallbackStmt.step()) {
                    const row = fallbackStmt.getAsObject();

                    // Get the target content for this cell
                    const targetStmt = this.db.prepare(`
                        SELECT content, raw_content 
                        FROM cells 
                        WHERE cell_id = ? AND cell_type = 'target' AND content IS NOT NULL AND content != ''
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
                            cell_type: 'source'
                        });
                    }
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
                SELECT c.cell_id, c.content, c.cell_type 
                FROM cells c 
                WHERE c.cell_type = 'source' AND c.content IS NOT NULL AND c.content != '' 
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
                SELECT DISTINCT
                    source_cell.cell_id,
                    source_cell.content as source_content,
                    source_cell.raw_content as raw_source_content,
                    target_cell.content as target_content,
                    target_cell.raw_content as raw_target_content,
                    source_file.file_path as uri,
                    source_cell.line_number as line,
                    0 as score
                FROM cells source_cell
                JOIN cells target_cell ON source_cell.cell_id = target_cell.cell_id 
                JOIN files source_file ON source_cell.file_id = source_file.id
                WHERE source_cell.cell_type = 'source' 
                    AND target_cell.cell_type = 'target'
                    AND source_cell.content IS NOT NULL 
                    AND source_cell.content != ''
                    AND target_cell.content IS NOT NULL 
                    AND target_cell.content != ''
                    ${onlyValidated ? "AND target_cell.metadata IS NOT NULL AND JSON_EXTRACT(target_cell.metadata, '$.edits') IS NOT NULL" : ""}
                ORDER BY source_cell.id DESC
                LIMIT ?
            `;

            const stmt = this.db.prepare(sql);
            const results = [];

            try {
                stmt.bind([limit]);
                while (stmt.step()) {
                    const row = stmt.getAsObject();

                    // Additional validation check if needed
                    let isValidated = true;
                    if (onlyValidated) {
                        isValidated = await this.isTargetCellValidated(row.cell_id as string);
                        console.log(`[searchCompleteTranslationPairsWithValidation] Target cell ${row.cell_id} is ${isValidated ? 'validated' : 'not validated'}`);
                    }

                    if (isValidated) {
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
                c.content as source_content,
                c.raw_content as raw_source_content,
                c.line_number as line,
                f.file_path as uri,
                bm25(cells_fts) as score
            FROM cells_fts
            JOIN cells c ON cells_fts.cell_id = c.cell_id
            JOIN files f ON c.file_id = f.id
            WHERE cells_fts MATCH ?
                AND c.cell_type = 'source'
                AND c.content IS NOT NULL 
                AND c.content != ''
                AND EXISTS (
                    SELECT 1 FROM cells target_cells 
                    WHERE target_cells.cell_id = c.cell_id 
                        AND target_cells.cell_type = 'target'
                        AND target_cells.content IS NOT NULL 
                        AND target_cells.content != ''
                )
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
                let isValidated = true;
                if (onlyValidated) {
                    isValidated = await this.isTargetCellValidated(row.cell_id as string);
                    console.log(`[searchCompleteTranslationPairsWithValidation] Target cell ${row.cell_id} is ${isValidated ? 'validated' : 'not validated'}`);
                }

                if (isValidated) {
                    // Get the target content for this cell
                    const targetStmt = this.db.prepare(`
                        SELECT content, raw_content 
                        FROM cells 
                        WHERE cell_id = ? AND cell_type = 'target' AND content IS NOT NULL AND content != ''
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
    private async isTargetCellValidated(cellId: string): Promise<boolean> {
        if (!this.db) return false;

        // Get the target cell's metadata
        const stmt = this.db.prepare(`
            SELECT metadata FROM cells 
            WHERE cell_id = ? AND cell_type = 'target' 
            LIMIT 1
        `);

        try {
            stmt.bind([cellId]);
            if (stmt.step()) {
                const row = stmt.getAsObject();
                const metadata = row.metadata ? JSON.parse(row.metadata as string) : null;

                if (metadata?.edits && Array.isArray(metadata.edits) && metadata.edits.length > 0) {
                    // Get the latest edit
                    const latestEdit = metadata.edits[metadata.edits.length - 1];

                    if (latestEdit.validatedBy && Array.isArray(latestEdit.validatedBy)) {
                        // Check if there are any active validations (isDeleted: false)
                        return latestEdit.validatedBy.some((entry: any) =>
                            entry &&
                            typeof entry === 'object' &&
                            entry.username &&
                            entry.isDeleted === false
                        );
                    }
                }
            }
        } catch (error) {
            console.error(`[isTargetCellValidated] Error checking validation for ${cellId}:`, error);
        } finally {
            stmt.free();
        }

        return false;
    }

    /**
     * Cleanup duplicate target cells that might exist before the unique constraint was enforced
     * This method should be called after upgrading the schema
     */
    async deduplicateTargetCells(): Promise<{
        duplicatesRemoved: number;
        cellsAffected: number;
    }> {
        if (!this.db) throw new Error("Database not initialized");

        debug("[SQLiteIndex] Starting target cell deduplication...");

        let duplicatesRemoved = 0;
        let cellIds = new Set<string>();

        await this.runInTransaction(() => {
            // Find all target cells with duplicates (same cell_id, different internal ids)
            const findDuplicatesStmt = this.db!.prepare(`
                SELECT cell_id, COUNT(*) as count, GROUP_CONCAT(id) as ids
                FROM cells 
                WHERE cell_type = 'target'
                GROUP BY cell_id
                HAVING COUNT(*) > 1
            `);

            const duplicateGroups: Array<{ cell_id: string; ids: string; }> = [];
            try {
                while (findDuplicatesStmt.step()) {
                    const row = findDuplicatesStmt.getAsObject();
                    duplicateGroups.push({
                        cell_id: row.cell_id as string,
                        ids: row.ids as string
                    });
                }
            } finally {
                findDuplicatesStmt.free();
            }

            debug(`[SQLiteIndex] Found ${duplicateGroups.length} target cells with duplicates`);

            // For each group of duplicates, keep the most recent one and delete the others
            for (const group of duplicateGroups) {
                const ids = group.ids.split(',').map(id => parseInt(id));
                cellIds.add(group.cell_id);

                // Get details of all duplicates, ordered by updated_at DESC
                const getDetailsStmt = this.db!.prepare(`
                    SELECT id, updated_at, created_at, metadata
                    FROM cells 
                    WHERE id IN (${ids.map(() => '?').join(',')})
                    ORDER BY updated_at DESC, created_at DESC
                `);

                const duplicates: Array<{ id: number; }> = [];
                try {
                    getDetailsStmt.bind(ids);
                    while (getDetailsStmt.step()) {
                        duplicates.push(getDetailsStmt.getAsObject() as any);
                    }
                } finally {
                    getDetailsStmt.free();
                }

                // Keep the first (most recent) and delete the rest
                const toDelete = duplicates.slice(1);
                for (const duplicate of toDelete) {
                    // Delete from FTS first
                    this.db!.run(`DELETE FROM cells_fts WHERE cell_id = ?`, [group.cell_id]);

                    // Delete the duplicate cell
                    this.db!.run(`DELETE FROM cells WHERE id = ?`, [duplicate.id]);
                    duplicatesRemoved++;

                    debug(`[SQLiteIndex] Removed duplicate target cell: ${group.cell_id} (internal id: ${duplicate.id})`);
                }

                // Re-add the kept cell to FTS (in case it was deleted above)
                if (duplicates.length > 0) {
                    const keptCell = duplicates[0];
                    const cellDataStmt = this.db!.prepare(`
                        SELECT cell_id, content, raw_content, cell_type 
                        FROM cells WHERE id = ?
                    `);
                    try {
                        cellDataStmt.bind([keptCell.id]);
                        if (cellDataStmt.step()) {
                            const cellData = cellDataStmt.getAsObject();
                            this.db!.run(`
                                INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type) 
                                VALUES (?, ?, ?, ?)
                            `, [
                                cellData.cell_id,
                                cellData.content,
                                cellData.raw_content || cellData.content,
                                cellData.cell_type
                            ]);
                        }
                    } finally {
                        cellDataStmt.free();
                    }
                }
            }
        });

        debug(`[SQLiteIndex] Target cell deduplication completed: ${duplicatesRemoved} duplicates removed from ${cellIds.size} cells`);

        return {
            duplicatesRemoved,
            cellsAffected: cellIds.size
        };
    }
}
