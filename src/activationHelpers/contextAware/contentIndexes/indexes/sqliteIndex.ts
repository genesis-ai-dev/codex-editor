import * as vscode from "vscode";
import initSqlJs, { Database, SqlJsStatic } from "fts5-sql-bundle";
import { createHash } from "crypto";
import { TranslationPair, MinimalCellResult } from "../../../../../types";

const INDEX_DB_PATH = [".project", "indexes.sqlite"];

export class SQLiteIndexManager {
    private sql: SqlJsStatic | null = null;
    private db: Database | null = null;
    private saveDebounceTimer: NodeJS.Timeout | null = null;
    private readonly SAVE_DEBOUNCE_MS = 0;

    async initialize(context: vscode.ExtensionContext): Promise<void> {
        // Initialize SQL.js
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

        // Load or create database
        await this.loadOrCreateDatabase();
    }

    private async loadOrCreateDatabase(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        const dbPath = vscode.Uri.joinPath(workspaceFolder.uri, ...INDEX_DB_PATH);

        try {
            const fileContent = await vscode.workspace.fs.readFile(dbPath);
            this.db = new this.sql!.Database(fileContent);
            console.log("Loaded existing index database");

            // Ensure schema is up to date
            await this.ensureSchema();
        } catch {
            console.log("Creating new index database");
            this.db = new this.sql!.Database();
            await this.createSchema();
            await this.saveDatabase();
        }
    }

    private async createSchema(): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        // Enable foreign keys
        this.db.run("PRAGMA foreign_keys = ON");

        // Files table - tracks file metadata
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
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
                UNIQUE(cell_id, file_id, cell_type)
            )
        `);

        // Translation pairs table - links source and target cells
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
        this.db.run(`
            CREATE VIRTUAL TABLE IF NOT EXISTS cells_fts USING fts5(
                cell_id,
                content,
                content_type,
                tokenize='porter unicode61'
            )
        `); // NOTE: we might not be able to use the porter

        // Create indexes for performance
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
        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS cells_fts_insert 
            AFTER INSERT ON cells
            BEGIN
                INSERT INTO cells_fts(cell_id, content, content_type) 
                VALUES (NEW.cell_id, NEW.content, NEW.cell_type);
            END
        `);

        this.db.run(`
            CREATE TRIGGER IF NOT EXISTS cells_fts_update 
            AFTER UPDATE OF content ON cells
            BEGIN
                UPDATE cells_fts 
                SET content = NEW.content 
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
    }

    private async ensureSchema(): Promise<void> {
        // This would check for schema migrations if needed
        // For now, just ensure the schema exists
        await this.createSchema();
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
        metadata?: any
    ): Promise<{ id: number; isNew: boolean; contentChanged: boolean }> {
        if (!this.db) throw new Error("Database not initialized");

        const contentHash = this.computeContentHash(content);
        const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;

        // Check if cell exists and if content changed
        const checkStmt = this.db.prepare(`
            SELECT id, content_hash FROM cells 
            WHERE cell_id = ? AND file_id = ? AND cell_type = ?
        `);

        let existingCell: { id: number; content_hash: string } | null = null;
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
            INSERT INTO cells (cell_id, file_id, cell_type, content, content_hash, line_number, word_count, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cell_id, file_id, cell_type) DO UPDATE SET
                content = excluded.content,
                content_hash = excluded.content_hash,
                line_number = excluded.line_number,
                word_count = excluded.word_count,
                metadata = excluded.metadata,
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
            await this.upsertCell(doc.cellId, fileId, "source", doc.content, doc.line, {
                versions: doc.versions,
            });
        } else if (doc.cellId && (doc.sourceContent || doc.targetContent)) {
            // Translation pair document
            if (doc.sourceContent) {
                await this.upsertCell(doc.cellId, fileId, "source", doc.sourceContent, doc.line, {
                    document: doc.document,
                    section: doc.section,
                });
            }
            if (doc.targetContent) {
                await this.upsertCell(doc.cellId, fileId, "target", doc.targetContent, doc.line, {
                    document: doc.document,
                    section: doc.section,
                });
            }
        }
    }

    // Add multiple documents
    async addAll(documents: any[]): Promise<void> {
        if (!this.db) throw new Error("Database not initialized");

        await this.runInTransaction(() => {
            for (const doc of documents) {
                this.add(doc);
            }
        });
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
    search(query: string, options?: any): any[] {
        if (!this.db) return [];

        const limit = options?.limit || 50;
        const fuzzy = options?.fuzzy || 0.2;
        const boost = options?.boost || {};

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
                                .map((t) => `${t}*`)
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
            stmt.bind([ftsQuery, limit]);
            while (stmt.step()) {
                const row = stmt.getAsObject();
                const metadata = row.metadata ? JSON.parse(row.metadata as string) : {};

                // Format result to match MiniSearch output (minisearch was deprecated–thankfully. We're now using SQLite3 and FTS5.)
                const result: any = {
                    id: row.cell_id,
                    cellId: row.cell_id,
                    score: row.score,
                    match: {}, // MiniSearch compatibility (minisearch was deprecated–thankfully. We're now using SQLite3 and FTS5.)
                    uri: row.uri,
                    line: row.line,
                };

                // Add content based on cell type
                if (row.cell_type === "source") {
                    result.sourceContent = row.content;
                    result.content = row.content;
                } else {
                    result.targetContent = row.content;
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

    async searchCells(
        query: string,
        cellType?: "source" | "target",
        limit: number = 50
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
                c.id, c.cell_id, c.content, c.cell_type, c.word_count,
                f.file_path, f.file_type,
                bm25(cells_fts) as rank
            FROM cells_fts
            JOIN cells c ON cells_fts.rowid = c.id
            JOIN files f ON c.file_id = f.id
            WHERE cells_fts MATCH ?
        `;

        if (cellType) {
            sql += ` AND c.cell_type = '${cellType}'`;
        }

        sql += ` ORDER BY rank LIMIT ?`;

        const stmt = this.db.prepare(sql);
        const results = [];

        try {
            stmt.bind([ftsQuery, limit]);
            while (stmt.step()) {
                results.push(stmt.getAsObject());
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
