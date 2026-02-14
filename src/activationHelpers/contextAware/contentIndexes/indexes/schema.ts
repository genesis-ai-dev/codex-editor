/**
 * Shared schema constants for the SQLite database layer.
 *
 * This is the single source of truth for all DDL (CREATE TABLE, CREATE INDEX,
 * CREATE TRIGGER) used by both the production SQLiteIndexManager and the test
 * suite.  Any schema change must be made here so the two stay in sync.
 */

// Schema version — bump this whenever the schema changes.
// Using a full recreation strategy (no incremental migrations).
export const CURRENT_SCHEMA_VERSION = 13; // Added project_id and project_name to schema_info for resilience

// ── Tables + FTS virtual table ──────────────────────────────────────────────

export const CREATE_TABLES_SQL = `
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
`;

// ── Initial indexes (created during schema setup) ───────────────────────────

export const CREATE_INDEXES_SQL = `
    CREATE INDEX IF NOT EXISTS idx_sync_metadata_path ON sync_metadata(file_path);
    CREATE INDEX IF NOT EXISTS idx_files_path ON files(file_path);
    CREATE INDEX IF NOT EXISTS idx_cells_s_file_id ON cells(s_file_id);
    CREATE INDEX IF NOT EXISTS idx_cells_t_file_id ON cells(t_file_id);
    CREATE INDEX IF NOT EXISTS idx_cells_milestone_index ON cells(milestone_index);
`;

// ── Deferred indexes (created after initial data load for performance) ──────

export const CREATE_DEFERRED_INDEXES_SQL = `
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
`;

// ── schema_info table (created separately because setSchemaVersion manages it) ─

export const CREATE_SCHEMA_INFO_SQL = `
    CREATE TABLE IF NOT EXISTS schema_info (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        version INTEGER NOT NULL,
        project_id TEXT,
        project_name TEXT
    )
`;

// ── Triggers ────────────────────────────────────────────────────────────────
//
// Each trigger must be executed as a separate statement because SQLite's exec()
// processes one statement at a time for triggers that contain BEGIN/END blocks.

/** Timestamp auto-update triggers for metadata tables */
export const TIMESTAMP_TRIGGERS = [
    `CREATE TRIGGER IF NOT EXISTS update_sync_metadata_timestamp 
     AFTER UPDATE ON sync_metadata
     BEGIN
         UPDATE sync_metadata SET updated_at = strftime('%s', 'now') * 1000 
         WHERE id = NEW.id;
     END`,
    `CREATE TRIGGER IF NOT EXISTS update_files_timestamp 
     AFTER UPDATE ON files
     BEGIN
         UPDATE files SET updated_at = strftime('%s', 'now') * 1000 
         WHERE id = NEW.id;
     END`,
    `CREATE TRIGGER IF NOT EXISTS update_cells_s_timestamp 
     AFTER UPDATE OF s_content, s_raw_content ON cells
     BEGIN
         UPDATE cells SET s_updated_at = strftime('%s', 'now') * 1000 
         WHERE cell_id = NEW.cell_id;
     END`,
    // Target timestamp trigger removed - timestamps now handled in application logic
];

/** FTS5 triggers that keep cells_fts in sync with the cells table */
export const FTS_TRIGGERS = [
    `CREATE TRIGGER IF NOT EXISTS cells_fts_source_insert 
     AFTER INSERT ON cells
     WHEN NEW.s_content IS NOT NULL
     BEGIN
         INSERT INTO cells_fts(cell_id, content, raw_content, content_type) 
         VALUES (NEW.cell_id, NEW.s_content, COALESCE(NEW.s_raw_content, NEW.s_content), 'source');
     END`,
    `CREATE TRIGGER IF NOT EXISTS cells_fts_target_insert 
     AFTER INSERT ON cells
     WHEN NEW.t_content IS NOT NULL
     BEGIN
         INSERT INTO cells_fts(cell_id, content, raw_content, content_type) 
         VALUES (NEW.cell_id, NEW.t_content, COALESCE(NEW.t_raw_content, NEW.t_content), 'target');
     END`,
    `CREATE TRIGGER IF NOT EXISTS cells_fts_source_update 
     AFTER UPDATE OF s_content, s_raw_content ON cells
     WHEN NEW.s_content IS NOT NULL
     BEGIN
         INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type) 
         VALUES (NEW.cell_id, NEW.s_content, COALESCE(NEW.s_raw_content, NEW.s_content), 'source');
     END`,
    `CREATE TRIGGER IF NOT EXISTS cells_fts_target_update 
     AFTER UPDATE OF t_content, t_raw_content ON cells
     WHEN NEW.t_content IS NOT NULL
     BEGIN
         INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type) 
         VALUES (NEW.cell_id, NEW.t_content, COALESCE(NEW.t_raw_content, NEW.t_content), 'target');
     END`,
    `CREATE TRIGGER IF NOT EXISTS cells_fts_delete 
     AFTER DELETE ON cells
     BEGIN
         DELETE FROM cells_fts WHERE cell_id = OLD.cell_id;
     END`,
];

/** All triggers combined (timestamp + FTS), for convenience */
export const ALL_TRIGGERS = [...TIMESTAMP_TRIGGERS, ...FTS_TRIGGERS];
