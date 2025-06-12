import * as vscode from "vscode";
import initSqlJs, { Database, SqlJsStatic } from "fts5-sql-bundle";
import { createHash } from "crypto";
import { TranslationPair, MinimalCellResult } from "../../../../../types";
import { updateSplashScreenTimings } from "../../../../providers/SplashScreen/register";
import { ActivationTiming } from "../../../../extension";

const INDEX_DB_PATH = [".project", "indexes.sqlite"];

// Schema version for migrations
const CURRENT_SCHEMA_VERSION = 2;

export class SQLiteIndexManager {
    private sql: SqlJsStatic | null = null;
    private db: Database | null = null;
    private saveDebounceTimer: NodeJS.Timeout | null = null;
    private readonly SAVE_DEBOUNCE_MS = 0;
    private progressTimings: ActivationTiming[] = [];
    private currentProgressTimer: NodeJS.Timeout | null = null;
    private currentProgressStartTime: number | null = null;
    private currentProgressName: string | null = null;

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

        // Start real-time updates every 50ms for more responsive updates
        this.currentProgressTimer = setInterval(() => {
            if (this.currentProgressStartTime && this.currentProgressName) {
                const currentDuration = globalThis.performance.now() - this.currentProgressStartTime;

                // Update the last timing entry with current duration
                const lastIndex = this.progressTimings.length - 1;
                if (lastIndex >= 0 && this.progressTimings[lastIndex].step === this.currentProgressName) {
                    this.progressTimings[lastIndex].duration = currentDuration;
                    updateSplashScreenTimings(this.progressTimings);
                }
            }
        }, 50) as unknown as NodeJS.Timeout;

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
            } else if (currentVersion < CURRENT_SCHEMA_VERSION) {
                // Old database - recreate instead of migrating to ensure clean schema
                stepStart = this.trackProgress("Recreate outdated database", stepStart);
                console.log(`[SQLiteIndex] Old schema detected (version ${currentVersion}). Recreating database for clean slate.`);
                await this.recreateDatabase();
                this.trackProgress("Database recreation complete", stepStart);
                console.log(`[SQLiteIndex] Database recreated with schema version ${CURRENT_SCHEMA_VERSION}`);
            } else {
                stepStart = this.trackProgress("Verify database schema", stepStart);
                console.log(`[SQLiteIndex] Schema is up to date (version ${currentVersion})`);
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

    private setSchemaVersion(version: number): void {
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
        const contentHash = this.computeContentHash(content + (rawContent || ""));
        const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;

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

        // Upsert the cell
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
                content,
                contentHash,
                lineNumber || null,
                wordCount,
                metadata ? JSON.stringify(metadata) : null,
                actualRawContent,
            ]);
            upsertStmt.step();
            const result = upsertStmt.getAsObject();

            this.debouncedSave();
            return { id: result.id as number, isNew, contentChanged };
        } finally {
            upsertStmt.free();
        }
    }

    // Add a single document
    async add(doc: any): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        // Determine file info from document
        const filePath = doc.uri || doc.document || "unknown";
        const fileType = doc.cellType || (doc.targetContent ? "codex" : "source");

        // Upsert file
        const fileId = await this.upsertFile(filePath, fileType as any, Date.now());

        // Add cell based on document type
        if (doc.cellId && doc.content) {
            // Source text document
            await this.upsertCell(
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
                await this.upsertCell(
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
                await this.upsertCell(
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

        this.db.run("DELETE FROM translation_pairs");
        this.db.run("DELETE FROM words");
        this.db.run("DELETE FROM cells");
        this.db.run("DELETE FROM files");
        this.db.run("DELETE FROM cells_fts");

        this.debouncedSave();
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
            // First, handle quotes by doubling them
            const escaped = text.replace(/"/g, '""');

            // For other special characters, we'll use phrase queries to treat them literally
            // Split by whitespace but preserve the original tokens
            const tokens = escaped.split(/\s+/).filter((token) => token.length > 0);

            // Wrap each token in quotes to make it a phrase query (treats special chars literally)
            const escapedTokens = tokens
                .map((token) => {
                    // If fuzzy search is enabled and token doesn't already have wildcards
                    if (fuzzy > 0 && !token.includes("*")) {
                        // For fuzzy matching, we can't use quotes, so we need to escape differently
                        // Remove problematic characters for fuzzy matching
                        const cleanToken = token.replace(/[":().,;·]/g, " ").trim();
                        if (cleanToken) {
                            return cleanToken
                                .split(/\s+/)
                                .map((t) => `"${t}"*`)  // Wrap in quotes BEFORE adding wildcard
                                .join(" ");
                        }
                        return null;
                    } else {
                        // For exact matching, use phrase queries
                        return `"${token}"`;
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
            JOIN cells c ON cells_fts.rowid = c.id
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
                combined.content = row.content;
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
                bm25(cells_fts) as rank
            FROM cells_fts
            JOIN cells c ON cells_fts.rowid = c.id
            JOIN files f ON c.file_id = f.id
            WHERE cells_fts MATCH ?
        `;

        const params: any[] = [`content: ${ftsQuery}`];

        if (cellType) {
            sql += ` AND c.cell_type = ?`;
            params.push(cellType);
        }

        sql += ` ORDER BY rank LIMIT ?`;
        params.push(limit);

        const stmt = this.db.prepare(sql);
        const results = [];

        try {
            stmt.bind(params);
            while (stmt.step()) {
                const row = stmt.getAsObject();

                // Verify both columns contain data - no fallbacks
                if (!row.content || !row.raw_content) {
                    console.warn(`[SQLiteIndex] Cell ${row.cell_id} missing content data in searchCells:`, {
                        content: !!row.content,
                        raw_content: !!row.raw_content
                    });
                    continue; // Skip this result
                }

                // Choose which content to return based on parameter
                const contentField = returnRawContent ? row.raw_content : row.content;

                results.push({
                    ...row,
                    content: contentField,
                    // Always provide both versions for debugging/transparency
                    sanitizedContent: row.content,
                    rawContent: row.raw_content
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

    private debouncedSave(): void {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }

        this.saveDebounceTimer = setTimeout(() => {
            this.saveDatabase().catch(console.error);
        }, this.SAVE_DEBOUNCE_MS) as unknown as NodeJS.Timeout;
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
        // Clean up real-time progress timer
        if (this.currentProgressTimer) {
            clearInterval(this.currentProgressTimer);
            this.currentProgressTimer = null;
        }

        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            await this.saveDatabase();
        }

        if (this.db) {
            this.db.close();
            this.db = null;
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
}
