import * as vscode from "vscode";
import initSqlJs, { Database, SqlJsStatic } from "fts5-sql-bundle";
import { createHash } from "crypto";
import { TranslationPair, MinimalCellResult } from "../../../../../types";
import { updateSplashScreenTimings } from "../../../../providers/SplashScreen/register";
import { ActivationTiming } from "../../../../extension";
import { debounce } from "lodash";

const INDEX_DB_PATH = [".project", "indexes.sqlite"];

// Schema version for migrations
const CURRENT_SCHEMA_VERSION = 4;

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
        console.log(`[SQLiteIndex] ${step}: ${duration.toFixed(2)}ms`);

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
                console.log(`[SQLiteIndex] ${this.currentProgressName}: ${finalDuration.toFixed(2)}ms`);
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
                console.warn(`[SQLiteIndex] Database corruption detected: ${errorMessage}`);
                console.warn("[SQLiteIndex] Deleting corrupt database and creating new one");

                // Delete the corrupted database file
                try {
                    await vscode.workspace.fs.delete(dbPath);
                    stepStart = this.trackProgress("Delete corrupted database", stepStart);
                } catch (deleteError) {
                    console.warn("[SQLiteIndex] Could not delete corrupted database file:", deleteError);
                }
            } else {
                console.log("[SQLiteIndex] Database file not found or other error, creating new database");
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
        let stepStart = schemaStart;

        // Enable foreign keys
        stepStart = this.trackProgress("Enable foreign key constraints", stepStart);
        this.db.run("PRAGMA foreign_keys = ON");

        // Files table - tracks file metadata
        stepStart = this.trackProgress("Create files table", stepStart);
        this.db.run(`
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

        // Cells table - stores individual cells with content hashing
        stepStart = this.trackProgress("Create cells table", stepStart);
        this.db.run(`
            CREATE TABLE IF NOT EXISTS cells (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cell_id TEXT NOT NULL,
                file_id INTEGER NOT NULL,
                cell_type TEXT NOT NULL CHECK(cell_type IN ('source', 'target')),
                content TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                line_number INTEGER,
                word_count INTEGER DEFAULT 0,
                metadata TEXT, -- JSON field for flexible metadata
                raw_content TEXT, -- Raw content with HTML tags
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
                UNIQUE(cell_id, file_id, cell_type)
            )
        `);

        // Translation pairs table - links source and target cells
        stepStart = this.trackProgress("Create translation pairs table", stepStart);
        this.db.run(`
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

        // Words table - tracks word occurrences
        stepStart = this.trackProgress("Create words table", stepStart);
        this.db.run(`
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

        // FTS5 virtual table for cell content search
        stepStart = this.trackProgress("Create full-text search index", stepStart);
        this.db.run(`
            CREATE VIRTUAL TABLE IF NOT EXISTS cells_fts USING fts5(
                cell_id,
                content,
                raw_content,
                content_type,
                tokenize='porter unicode61'
            )
        `); // NOTE: we might not be able to use the porter

        // Create indexes for performance
        stepStart = this.trackProgress("Create database indexes", stepStart);
        this.db.run("CREATE INDEX IF NOT EXISTS idx_cells_cell_id ON cells(cell_id)");
        this.db.run("CREATE INDEX IF NOT EXISTS idx_cells_content_hash ON cells(content_hash)");
        this.db.run("CREATE INDEX IF NOT EXISTS idx_cells_file_id ON cells(file_id)");
        this.db.run("CREATE INDEX IF NOT EXISTS idx_words_word ON words(word)");
        this.db.run("CREATE INDEX IF NOT EXISTS idx_words_cell_id ON words(cell_id)");
        this.db.run(
            "CREATE INDEX IF NOT EXISTS idx_translation_pairs_source ON translation_pairs(source_cell_id)"
        );
        this.db.run(
            "CREATE INDEX IF NOT EXISTS idx_translation_pairs_target ON translation_pairs(target_cell_id)"
        );
        this.db.run("CREATE INDEX IF NOT EXISTS idx_files_path ON files(file_path)");

        // Triggers to maintain updated_at timestamps
        stepStart = this.trackProgress("Create database triggers", stepStart);
        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS update_files_timestamp 
            AFTER UPDATE ON files
            BEGIN
                UPDATE files SET updated_at = strftime('%s', 'now') * 1000 
                WHERE id = NEW.id;
            END
        `);

        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS update_cells_timestamp 
            AFTER UPDATE ON cells
            BEGIN
                UPDATE cells SET updated_at = strftime('%s', 'now') * 1000 
                WHERE id = NEW.id;
            END
        `);

        // Trigger to sync FTS table
        stepStart = this.trackProgress("Setup FTS synchronization", stepStart);
        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS cells_fts_insert 
            AFTER INSERT ON cells
            BEGIN
                INSERT INTO cells_fts(cell_id, content, raw_content, content_type) 
                VALUES (NEW.cell_id, NEW.content, COALESCE(NEW.raw_content, NEW.content), NEW.cell_type);
            END
        `);

        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS cells_fts_update 
            AFTER UPDATE OF content, raw_content ON cells
            BEGIN
                UPDATE cells_fts 
                SET content = NEW.content, raw_content = COALESCE(NEW.raw_content, NEW.content)
                WHERE cell_id = NEW.cell_id;
            END
        `);

        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS cells_fts_delete 
            AFTER DELETE ON cells
            BEGIN
                DELETE FROM cells_fts WHERE cell_id = OLD.cell_id;
            END
        `);

        this.trackProgress("Schema Creation Complete", schemaStart);
    }

    private async ensureSchema(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        const ensureStart = globalThis.performance.now();
        let stepStart = ensureStart;

        try {
            // Check current schema version
            stepStart = this.trackProgress("Check database schema version", stepStart);
            const currentVersion = this.getSchemaVersion();
            console.log(`[SQLiteIndex] Current schema version: ${currentVersion}`);

            if (currentVersion === 0) {
                // New database - create with latest schema
                stepStart = this.trackProgress("Initialize new database schema", stepStart);
                console.log("[SQLiteIndex] Setting up new database with latest schema");
                await this.createSchema();
                this.setSchemaVersion(CURRENT_SCHEMA_VERSION);
                this.trackProgress("New database schema initialized", stepStart);
                console.log(`[SQLiteIndex] New database created with schema version ${CURRENT_SCHEMA_VERSION}`);
            } else if (currentVersion > CURRENT_SCHEMA_VERSION) {
                // Database schema is ahead of code - recreate to avoid compatibility issues
                stepStart = this.trackProgress("Handle future schema version", stepStart);
                console.warn(`[SQLiteIndex] Database schema version ${currentVersion} is ahead of code version ${CURRENT_SCHEMA_VERSION}`);
                console.warn("[SQLiteIndex] Recreating database to ensure compatibility");

                await this.recreateDatabase();
                this.setSchemaVersion(CURRENT_SCHEMA_VERSION);

                this.trackProgress("Future schema compatibility resolved", stepStart);
                console.log(`[SQLiteIndex] Database recreated with compatible schema version ${CURRENT_SCHEMA_VERSION}`);
            } else if (currentVersion < CURRENT_SCHEMA_VERSION) {
                // Handle migrations based on version
                stepStart = this.trackProgress("Migrate database schema", stepStart);
                console.log(`[SQLiteIndex] Migrating database from version ${currentVersion} to ${CURRENT_SCHEMA_VERSION}`);

                if (currentVersion < 3) {
                    // Migration for content sanitization (version 2 -> 3)
                    // Note: We now delete the database and reindex instead of migrating
                    console.log("[SQLiteIndex] Schema version 3 requires clean reindex - database will be recreated");
                    await this.recreateDatabase();
                } else if (currentVersion < 4) {
                    // Migration for improved content sanitization (version 3 -> 4)
                    // This version ensures HTML tags are properly sanitized from content column
                    console.log("[SQLiteIndex] Schema version 4 requires clean reindex for content sanitization - database will be recreated");

                    // Show user notification about the one-time migration
                    const vscode = await import('vscode');
                    vscode.window.showInformationMessage("Codex: Upgrading search index to new clean format. This is a one-time operation...");

                    await this.recreateDatabase();
                }

                // Update schema version after successful migration
                this.setSchemaVersion(CURRENT_SCHEMA_VERSION);
                this.trackProgress("Database migration complete", stepStart);
                console.log(`[SQLiteIndex] Database migrated to schema version ${CURRENT_SCHEMA_VERSION}`);
            } else {
                stepStart = this.trackProgress("Verify database schema", stepStart);
                console.log(`[SQLiteIndex] Schema is up to date (version ${currentVersion})`);

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
                console.warn("[SQLiteIndex] Recreating corrupted database");
                stepStart = this.trackProgress("Recreate corrupted database", stepStart);

                // Force recreate the database
                this.db = new this.sql!.Database();
                await this.createSchema();
                this.setSchemaVersion(CURRENT_SCHEMA_VERSION);

                this.trackProgress("Database corruption recovery complete", stepStart);
                console.log("[SQLiteIndex] Successfully recreated database after corruption");
            } else {
                // Re-throw non-corruption errors
                throw error;
            }
        }
    }

    private async recreateDatabase(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        console.log("[SQLiteIndex] Dropping all existing tables...");

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

        console.log("[SQLiteIndex] Creating fresh schema...");
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

    async upsertFile(
        filePath: string,
        fileType: "source" | "codex",
        lastModifiedMs: number
    ): Promise<number> {
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

        const contentHash = this.computeContentHash(sanitizedContent + (rawContent || ""));
        const wordCount = sanitizedContent.split(/\s+/).filter((w) => w.length > 0).length;

        // Check if cell exists and if content changed
        const checkStmt = this.db.prepare(`
            SELECT id, content_hash FROM cells 
            WHERE cell_id = ? AND file_id = ? AND cell_type = ?
        `);

        let existingCell: { id: number; content_hash: string; } | null = null;
        try {
            checkStmt.bind([cellId, fileId, cellType]);
            if (checkStmt.step()) {
                existingCell = checkStmt.getAsObject() as any;
            }
        } finally {
            checkStmt.free();
        }

        const contentChanged = !existingCell || existingCell.content_hash !== contentHash;
        const isNew = !existingCell;

        if (!contentChanged && existingCell) {
            return { id: existingCell.id, isNew: false, contentChanged: false };
        }

        // Upsert the cell - store sanitized content in content column, original in raw_content
        const upsertStmt = this.db.prepare(`
            INSERT INTO cells (cell_id, file_id, cell_type, content, content_hash, line_number, word_count, metadata, raw_content)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cell_id, file_id, cell_type) DO UPDATE SET
                content = excluded.content,
                content_hash = excluded.content_hash,
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
                fileId,
                cellType,
                sanitizedContent, // Store sanitized content in content column
                contentHash,
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

        const contentHash = this.computeContentHash(sanitizedContent + (rawContent || ""));
        const wordCount = sanitizedContent.split(/\s+/).filter((w) => w.length > 0).length;

        // Check if cell exists and if content changed
        const checkStmt = this.db.prepare(`
            SELECT id, content_hash FROM cells 
            WHERE cell_id = ? AND file_id = ? AND cell_type = ?
        `);

        let existingCell: { id: number; content_hash: string; } | null = null;
        try {
            checkStmt.bind([cellId, fileId, cellType]);
            if (checkStmt.step()) {
                existingCell = checkStmt.getAsObject() as any;
            }
        } finally {
            checkStmt.free();
        }

        const contentChanged = !existingCell || existingCell.content_hash !== contentHash;
        const isNew = !existingCell;

        if (!contentChanged && existingCell) {
            return { id: existingCell.id, isNew: false, contentChanged: false };
        }

        // Upsert the cell - store sanitized content in content column, original in raw_content
        const upsertStmt = this.db.prepare(`
            INSERT INTO cells (cell_id, file_id, cell_type, content, content_hash, line_number, word_count, metadata, raw_content)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cell_id, file_id, cell_type) DO UPDATE SET
                content = excluded.content,
                content_hash = excluded.content_hash,
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
                fileId,
                cellType,
                sanitizedContent, // Store sanitized content in content column
                contentHash,
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

    // Add a single document
    add(doc: any): void {
        if (!this.db) throw new Error("Database not initialized");

        // Determine file info from document
        const filePath = doc.uri || doc.document || "unknown";
        const fileType = doc.cellType || (doc.targetContent ? "codex" : "source");

        // Upsert file synchronously
        const fileId = this.upsertFileSync(filePath, fileType as any, Date.now());

        // Add cell based on document type
        if (doc.cellId && doc.content) {
            // Source text document
            this.upsertCellSync(
                doc.cellId,
                fileId,
                "source",
                doc.content,
                doc.line,
                {
                    versions: doc.versions,
                },
                doc.rawContent // Pass raw content if available
            );
        } else if (doc.cellId && (doc.sourceContent || doc.targetContent)) {
            // Translation pair document
            if (doc.sourceContent) {
                this.upsertCellSync(
                    doc.cellId,
                    fileId,
                    "source",
                    doc.sourceContent,
                    doc.line,
                    {
                        document: doc.document,
                        section: doc.section,
                    },
                    doc.rawSourceContent // Pass raw source content if available
                );
            }
            if (doc.targetContent) {
                this.upsertCellSync(
                    doc.cellId,
                    fileId,
                    "target",
                    doc.targetContent,
                    doc.line,
                    {
                        document: doc.document,
                        section: doc.section,
                    },
                    doc.rawTargetContent // Pass raw target content if available
                );
            }
        }
    }

    // Add multiple documents
    async addAll(documents: any[]): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        if (documents.length === 0) return;

        // Start real-time progress for large operations
        if (documents.length > 50) {
            this.startRealtimeProgress(`Indexing ${documents.length} documents`);
        } else {
            const addAllStart = globalThis.performance.now();
            this.trackProgress(`Processing ${documents.length} documents`, addAllStart);
        }

        try {
            await this.runInTransaction(() => {
                let processed = 0;
                const batchSize = 100; // Process in smaller batches

                for (let i = 0; i < documents.length; i += batchSize) {
                    const batch = documents.slice(i, i + batchSize);
                    for (const doc of batch) {
                        this.add(doc);
                        processed++;
                    }

                    // Update progress description for large operations
                    if (documents.length > 50 && processed % (batchSize * 2) === 0) {
                        // Update the current step name to show progress
                        if (this.currentProgressName) {
                            const progressPercent = Math.round((processed / documents.length) * 100);
                            const newStepName = `Indexing ${documents.length} documents (${progressPercent}%)`;

                            // Update the step name in the current timing entry
                            const lastIndex = this.progressTimings.length - 1;
                            if (lastIndex >= 0) {
                                this.progressTimings[lastIndex].step = newStepName;
                                this.currentProgressName = newStepName;
                            }
                        }
                    }
                }
            });
        } finally {
            // Finish real-time progress for large operations
            if (documents.length > 50) {
                this.finishRealtimeProgress();
            }
        }
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
                    console.warn(`[SQLiteIndex] Cell ${row.cell_id} missing content data:`, {
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
                    console.warn(`[SQLiteIndex] Cell ${row.cell_id} missing content data`);
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
                    console.warn(`[SQLiteIndex] Cell ${row.cell_id} missing content data`);
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
                console.log("[SQLiteIndex] Database connection closed and resources cleaned up");
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
                console.log("[SQLiteIndex] Database file deleted successfully");
            } catch (deleteError) {
                console.warn("[SQLiteIndex] Could not delete database file:", deleteError);
                // Don't throw here - we want to continue with reindex even if file deletion fails
            }
        } catch (error) {
            console.error("[SQLiteIndex] Error deleting database file:", error);
        }
    }

    // Manual command to delete database and trigger reindex
    async deleteDatabaseAndTriggerReindex(): Promise<void> {
        console.log("[SQLiteIndex] Manual database deletion requested...");

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
}
