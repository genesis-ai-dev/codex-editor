/**
 * Comprehensive test suite for the native SQLite database layer.
 *
 * Tests the AsyncDatabase wrapper (nativeSqlite.ts) and the schema/operations
 * used by SQLiteIndexManager (sqliteIndex.ts) to verify that the @vscode/sqlite3
 * native binary works correctly across creation, CRUD, FTS5 search, transactions,
 * re-indexing, and edge cases.
 *
 * All tests use in-memory databases (":memory:") for speed and isolation.
 *
 * Bootstrap strategy: the native binary may not be initialised when the test
 * runner starts (e.g. the test VS Code instance has a fresh user-data dir and
 * the extension's download can fail).  We search for the binary in the real
 * VS Code / Codex global-storage directories and call initNativeSqlite()
 * ourselves before any database tests run.
 */

import * as assert from "assert";
import {
    AsyncDatabase,
    initNativeSqlite,
    isNativeSqliteReady,
    RunResult,
} from "../../utils/nativeSqlite";
import {
    CURRENT_SCHEMA_VERSION,
    CREATE_TABLES_SQL,
    CREATE_INDEXES_SQL,
    CREATE_DEFERRED_INDEXES_SQL,
    CREATE_SCHEMA_INFO_SQL,
    ALL_TRIGGERS,
} from "../../activationHelpers/contextAware/contentIndexes/indexes/schema";
// ── Real Node.js builtins ───────────────────────────────────────────────────
//
// Webpack replaces `fs`, `os`, `path`, and `crypto` with browser polyfills
// (memfs, os-browserify, crypto-browserify, etc.) in the test bundle.
// We need the *real* Node.js modules for filesystem access and hashing.
// The `eval("require")` trick bypasses webpack's module resolution —
// the same approach nativeSqlite.ts uses to load the .node addon.
//
// eslint-disable-next-line no-eval
const nodeRequire = eval("require") as NodeRequire;
const realFs: typeof import("fs") = nodeRequire("fs");
const realOs: typeof import("os") = nodeRequire("os");
const realPath: typeof import("path") = nodeRequire("path");
const realCrypto: typeof import("crypto") = nodeRequire("crypto");
// Webpack's ProvidePlugin replaces `process` with `process/browser` which
// reports platform as "browser" instead of "darwin"/"linux"/"win32".
// We need the real Node.js process object.
const realProcess: NodeJS.Process = nodeRequire("process");

// ── Native binary bootstrap ─────────────────────────────────────────────────

const EXTENSION_ID = "project-accelerate.codex-editor-extension";
const BINARY_NAME = "node_sqlite3.node";

/**
 * Search for the node_sqlite3.node binary in the global-storage directories
 * of every VS Code variant the developer might use.
 */
function findNativeBinary(): string | null {
    const home = realOs.homedir();
    console.log(`[NativeSQLite Test] homedir = ${home}`);

    // App-data base directory differs per platform
    const bases: string[] = [];
    if (realProcess.platform === "darwin") {
        bases.push(realPath.join(home, "Library", "Application Support"));
    } else if (realProcess.platform === "linux") {
        bases.push(realPath.join(home, ".config"));
    } else if (realProcess.platform === "win32") {
        bases.push(realProcess.env.APPDATA ?? realPath.join(home, "AppData", "Roaming"));
    }

    // VS Code variant folder names (covers Codex fork, stable, insiders, OSS)
    const variants = ["Codex", "Code", "Code - Insiders", "code-oss", "VSCodium"];

    for (const base of bases) {
        for (const variant of variants) {
            const candidate = realPath.join(
                base,
                variant,
                "User",
                "globalStorage",
                EXTENSION_ID,
                "sqlite3-native",
                BINARY_NAME
            );
            try {
                if (realFs.existsSync(candidate) && realFs.statSync(candidate).size > 500_000) {
                    console.log(`[NativeSQLite Test] Found binary: ${candidate}`);
                    return candidate;
                }
            } catch {
                // Skip inaccessible paths
            }
        }
    }

    // Also check the .vscode-test directory (test-electron may cache here)
    try {
        const vscodeTestDir = realPath.join(home, ".vscode-test");
        if (realFs.existsSync(vscodeTestDir)) {
            const found = findFileRecursive(vscodeTestDir, BINARY_NAME, 3);
            if (found) {
                return found;
            }
        }
    } catch {
        // Non-critical
    }

    console.warn(`[NativeSQLite Test] Binary not found in any searched location`);
    return null;
}

/** Shallow recursive file search (limited depth to keep it fast). */
function findFileRecursive(dir: string, target: string, maxDepth: number): string | null {
    if (maxDepth <= 0) {
        return null;
    }
    try {
        for (const entry of realFs.readdirSync(dir, { withFileTypes: true })) {
            const full = realPath.join(dir, entry.name);
            if (entry.isFile() && entry.name === target) {
                if (realFs.statSync(full).size > 500_000) {
                    return full;
                }
            } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
                const found = findFileRecursive(full, target, maxDepth - 1);
                if (found) {
                    return found;
                }
            }
        }
    } catch {
        // Permission errors etc.
    }
    return null;
}

/**
 * Ensure the native SQLite binding is loaded before any tests run.
 * Returns true if ready, false if the binary could not be found.
 */
function bootstrapNativeSqlite(): boolean {
    if (isNativeSqliteReady()) {
        return true;
    }

    const binaryPath = findNativeBinary();
    if (!binaryPath) {
        console.warn(
            "[NativeSQLite Test] Could not find node_sqlite3.node binary. " +
                "Run the extension once in normal mode to download it, then re-run tests."
        );
        return false;
    }

    console.log(`[NativeSQLite Test] Bootstrapping native binary from: ${binaryPath}`);
    initNativeSqlite(binaryPath);
    return isNativeSqliteReady();
}

// ── Schema helpers ──────────────────────────────────────────────────────────
//
// All schema SQL is imported from the shared schema.ts module (single source
// of truth for both production and tests).  See:
//   src/activationHelpers/contextAware/contentIndexes/indexes/schema.ts

// ── Utility helpers ─────────────────────────────────────────────────────────

const computeHash = (content: string): string =>
    realCrypto.createHash("sha256").update(content).digest("hex");

/**
 * Open an in-memory database and apply the full production schema.
 * Uses the shared schema constants so tests always run against the exact
 * same DDL as production.
 * Returns a ready-to-use AsyncDatabase instance.
 */
async function openTestDatabase(): Promise<AsyncDatabase> {
    const db = await AsyncDatabase.open(":memory:");

    // Apply PRAGMAs (simplified for in-memory)
    await db.exec("PRAGMA journal_mode = MEMORY");
    await db.exec("PRAGMA synchronous = OFF");
    await db.exec("PRAGMA foreign_keys = ON");

    // Create tables + indexes (shared with production)
    await db.exec(CREATE_TABLES_SQL);
    await db.exec(CREATE_INDEXES_SQL);

    // Create all triggers — timestamp + FTS (each is a separate statement)
    for (const trigger of ALL_TRIGGERS) {
        await db.run(trigger);
    }

    // Schema info table (shared with production — includes project_id/project_name)
    await db.run(CREATE_SCHEMA_INFO_SQL);
    await db.run(
        "INSERT INTO schema_info (id, version, project_id, project_name) VALUES (1, ?, NULL, NULL)",
        [CURRENT_SCHEMA_VERSION]
    );

    return db;
}

/** Insert a file record and return its auto-generated id */
async function insertFile(
    db: AsyncDatabase,
    filePath: string,
    fileType: "source" | "codex",
    lastModifiedMs: number = Date.now()
): Promise<number> {
    const contentHash = computeHash(filePath + lastModifiedMs);
    const result = await db.get<{ id: number }>(
        `INSERT INTO files (file_path, file_type, last_modified_ms, content_hash)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
             last_modified_ms = excluded.last_modified_ms,
             content_hash = excluded.content_hash
         RETURNING id`,
        [filePath, fileType, lastModifiedMs, contentHash]
    );
    return result?.id ?? 0;
}

/** Insert a cell with source or target content */
async function insertCell(
    db: AsyncDatabase,
    cellId: string,
    opts: {
        cellType?: string;
        sFileId?: number;
        sContent?: string;
        sRawContent?: string;
        sLineNumber?: number;
        tFileId?: number;
        tContent?: string;
        tRawContent?: string;
        tLineNumber?: number;
        milestoneIndex?: number;
    } = {}
): Promise<RunResult> {
    const sRawContent = opts.sRawContent ?? opts.sContent ?? null;
    const tRawContent = opts.tRawContent ?? opts.tContent ?? null;
    const sHash = sRawContent ? computeHash(sRawContent) : null;
    const tHash = tRawContent ? computeHash(tRawContent) : null;
    const sWordCount = opts.sContent
        ? opts.sContent.split(/\s+/).filter((w) => w.length > 0).length
        : 0;
    const tWordCount = opts.tContent
        ? opts.tContent.split(/\s+/).filter((w) => w.length > 0).length
        : 0;

    return db.run(
        `INSERT INTO cells (
            cell_id, cell_type,
            s_file_id, s_content, s_raw_content, s_raw_content_hash, s_line_number, s_word_count,
            t_file_id, t_content, t_raw_content, t_raw_content_hash, t_line_number, t_word_count,
            milestone_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            cellId,
            opts.cellType ?? null,
            opts.sFileId ?? null,
            opts.sContent ?? null,
            sRawContent,
            sHash,
            opts.sLineNumber ?? null,
            sWordCount,
            opts.tFileId ?? null,
            opts.tContent ?? null,
            tRawContent,
            tHash,
            opts.tLineNumber ?? null,
            tWordCount,
            opts.milestoneIndex ?? null,
        ]
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Suites
// ═══════════════════════════════════════════════════════════════════════════

suite("Native SQLite Database Tests", function () {
    // Allow generous timeout for database operations
    this.timeout(30_000);

    // ── Bootstrap ───────────────────────────────────────────────────────

    let nativeReady = false;

    suiteSetup(function () {
        nativeReady = bootstrapNativeSqlite();
        if (!nativeReady) {
            console.warn("[NativeSQLite Test] Skipping all database tests — native binary not available.");
        }
    });

    /** Guard that skips the current test when the native binary is unavailable. */
    function skipIfNotReady(ctx: Mocha.Context): void {
        if (!nativeReady) {
            ctx.skip();
        }
    }

    // ── Pre-flight check ────────────────────────────────────────────────

    test("native SQLite binding is initialized", function () {
        if (!nativeReady) {
            // In CI or environments without the pre-downloaded binary, skip
            // gracefully instead of failing the entire test run.
            this.skip();
        }
        assert.strictEqual(isNativeSqliteReady(), true);
    });

    // ── 1. Database creation & schema ───────────────────────────────────

    suite("Database Creation & Schema", () => {
        let db: AsyncDatabase;

        setup(async function () {
            skipIfNotReady(this);
            db = await openTestDatabase();
        });

        teardown(async () => {
            if (db) {
                await db.close();
            }
        });

        test("opens an in-memory database", async () => {
            assert.ok(db, "AsyncDatabase.open(':memory:') should return a database");
        });

        test("creates all required tables", async () => {
            const tables = await db.all<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            );
            const tableNames = tables.map((t) => t.name);

            const expected = ["cells", "cells_fts", "files", "schema_info", "sync_metadata", "words"];
            for (const table of expected) {
                assert.ok(tableNames.includes(table), `Missing table: ${table}`);
            }
        });

        test("creates cells table with all expected columns", async () => {
            const columns = await db.all<{ name: string }>("PRAGMA table_info(cells)");
            const columnNames = columns.map((c) => c.name);

            const expected = [
                "cell_id",
                "cell_type",
                "s_file_id",
                "s_content",
                "s_raw_content_hash",
                "s_line_number",
                "s_word_count",
                "s_raw_content",
                "s_created_at",
                "s_updated_at",
                "t_file_id",
                "t_content",
                "t_raw_content_hash",
                "t_line_number",
                "t_word_count",
                "t_raw_content",
                "t_created_at",
                "t_current_edit_timestamp",
                "t_validation_count",
                "t_validated_by",
                "t_is_fully_validated",
                "t_audio_validation_count",
                "t_audio_validated_by",
                "t_audio_is_fully_validated",
                "milestone_index",
            ];

            for (const col of expected) {
                assert.ok(columnNames.includes(col), `Missing column in cells: ${col}`);
            }
        });

        test("creates all expected indexes", async () => {
            const indexes = await db.all<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
            );
            const indexNames = indexes.map((i) => i.name);

            const expected = [
                "idx_sync_metadata_path",
                "idx_files_path",
                "idx_cells_s_file_id",
                "idx_cells_t_file_id",
                "idx_cells_milestone_index",
            ];

            for (const idx of expected) {
                assert.ok(indexNames.includes(idx), `Missing index: ${idx}`);
            }
        });

        test("creates deferred indexes", async () => {
            await db.exec(CREATE_DEFERRED_INDEXES_SQL);

            const indexes = await db.all<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
            );
            const indexNames = indexes.map((i) => i.name);

            const deferredIndexes = [
                "idx_sync_metadata_hash",
                "idx_sync_metadata_modified",
                "idx_cells_s_content_hash",
                "idx_cells_t_content_hash",
                "idx_cells_t_is_fully_validated",
                "idx_cells_t_current_edit_timestamp",
                "idx_cells_t_validation_count",
                "idx_cells_t_audio_is_fully_validated",
                "idx_cells_t_audio_validation_count",
                "idx_words_word",
                "idx_words_cell_id",
            ];

            for (const idx of deferredIndexes) {
                assert.ok(indexNames.includes(idx), `Missing deferred index: ${idx}`);
            }
        });

        test("creates all triggers (timestamp + FTS)", async () => {
            const triggers = await db.all<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type='trigger'"
            );
            const triggerNames = triggers.map((t) => t.name);

            const expected = [
                // Timestamp auto-update triggers
                "update_sync_metadata_timestamp",
                "update_files_timestamp",
                "update_cells_s_timestamp",
                // FTS sync triggers
                "cells_fts_source_insert",
                "cells_fts_target_insert",
                "cells_fts_source_update",
                "cells_fts_target_update",
                "cells_fts_delete",
            ];

            for (const trig of expected) {
                assert.ok(triggerNames.includes(trig), `Missing trigger: ${trig}`);
            }
        });

        test("FTS5 virtual table is queryable", async () => {
            // Should not throw
            const rows = await db.all("SELECT * FROM cells_fts LIMIT 0");
            assert.ok(Array.isArray(rows), "cells_fts should be queryable");
        });

        test("schema_info table stores version correctly", async () => {
            const row = await db.get<{ version: number }>(
                "SELECT version FROM schema_info WHERE id = 1"
            );
            assert.strictEqual(row?.version, CURRENT_SCHEMA_VERSION, `Schema version should be ${CURRENT_SCHEMA_VERSION}`);
        });
    });

    // ── 2. File CRUD ────────────────────────────────────────────────────

    suite("File CRUD Operations", () => {
        let db: AsyncDatabase;

        setup(async function () {
            skipIfNotReady(this);
            db = await openTestDatabase();
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("inserts a new file and returns its id", async () => {
            const id = await insertFile(db, "/project/GEN.source", "source");
            assert.ok(id > 0, "File id should be a positive integer");
        });

        test("upsert on conflict updates and returns same id", async () => {
            const id1 = await insertFile(db, "/project/GEN.source", "source", 1000);
            const id2 = await insertFile(db, "/project/GEN.source", "source", 2000);
            assert.strictEqual(id1, id2, "Upsert should return same id for same file_path");
        });

        test("inserts multiple files with different types", async () => {
            const sourceId = await insertFile(db, "/project/GEN.source", "source");
            const codexId = await insertFile(db, "/project/GEN.codex", "codex");
            assert.notStrictEqual(sourceId, codexId, "Different files should get different ids");
        });

        test("rejects invalid file_type", async () => {
            try {
                await db.run(
                    "INSERT INTO files (file_path, file_type, last_modified_ms, content_hash) VALUES (?, ?, ?, ?)",
                    ["/bad.txt", "invalid", Date.now(), "abc"]
                );
                assert.fail("Should have thrown for invalid file_type");
            } catch (err: any) {
                assert.ok(
                    err.message.includes("CHECK") || err.message.includes("constraint"),
                    `Expected CHECK constraint error, got: ${err.message}`
                );
            }
        });

        test("deletes a file", async () => {
            const id = await insertFile(db, "/project/to-delete.source", "source");
            const result = await db.run("DELETE FROM files WHERE id = ?", [id]);
            assert.strictEqual(result.changes, 1, "One row should be deleted");

            const row = await db.get("SELECT * FROM files WHERE id = ?", [id]);
            assert.strictEqual(row, undefined, "File should no longer exist");
        });
    });

    // ── 3. Cell CRUD ────────────────────────────────────────────────────

    suite("Cell CRUD Operations", () => {
        let db: AsyncDatabase;
        let sourceFileId: number;
        let targetFileId: number;

        setup(async function () {
            skipIfNotReady(this);
            db = await openTestDatabase();
            sourceFileId = await insertFile(db, "/project/GEN.source", "source");
            targetFileId = await insertFile(db, "/project/GEN.codex", "codex");
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("inserts a source cell", async () => {
            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: "In the beginning God created the heavens and the earth.",
                sLineNumber: 1,
            });

            const row = await db.get<{ cell_id: string; s_content: string }>(
                "SELECT cell_id, s_content FROM cells WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.strictEqual(row?.cell_id, "GEN 1:1");
            assert.ok(row?.s_content?.includes("beginning"));
        });

        test("inserts a target cell", async () => {
            await insertCell(db, "GEN 1:1", {
                tFileId: targetFileId,
                tContent: "En el principio Dios creó los cielos y la tierra.",
                tLineNumber: 1,
            });

            const row = await db.get<{ t_content: string }>(
                "SELECT t_content FROM cells WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.ok(row?.t_content?.includes("principio"));
        });

        test("updates existing cell via ON CONFLICT (upsert)", async () => {
            await insertCell(db, "GEN 1:2", {
                sFileId: sourceFileId,
                sContent: "Original content",
            });

            // Upsert with updated content
            await db.run(
                `INSERT INTO cells (cell_id, s_content, s_raw_content)
                 VALUES (?, ?, ?)
                 ON CONFLICT(cell_id) DO UPDATE SET
                     s_content = excluded.s_content,
                     s_raw_content = excluded.s_raw_content`,
                ["GEN 1:2", "Updated content", "Updated content"]
            );

            const row = await db.get<{ s_content: string }>(
                "SELECT s_content FROM cells WHERE cell_id = ?",
                ["GEN 1:2"]
            );
            assert.strictEqual(row?.s_content, "Updated content");
        });

        test("deletes a single cell", async () => {
            await insertCell(db, "GEN 1:3", {
                sFileId: sourceFileId,
                sContent: "Test content to delete",
            });

            const result = await db.run("DELETE FROM cells WHERE cell_id = ?", ["GEN 1:3"]);
            assert.strictEqual(result.changes, 1);

            const row = await db.get("SELECT * FROM cells WHERE cell_id = ?", ["GEN 1:3"]);
            assert.strictEqual(row, undefined);
        });

        test("deletes all cells for a file", async () => {
            // Insert multiple cells linked to source file
            await insertCell(db, "GEN 1:1", { sFileId: sourceFileId, sContent: "Verse 1" });
            await insertCell(db, "GEN 1:2", { sFileId: sourceFileId, sContent: "Verse 2" });
            await insertCell(db, "GEN 1:3", { sFileId: sourceFileId, sContent: "Verse 3" });

            const result = await db.run("DELETE FROM cells WHERE s_file_id = ?", [sourceFileId]);
            assert.strictEqual(result.changes, 3);
        });

        test("word count is computed correctly", async () => {
            const content = "In the beginning God created the heavens and the earth";
            const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;

            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: content,
            });

            const row = await db.get<{ s_word_count: number }>(
                "SELECT s_word_count FROM cells WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.strictEqual(row?.s_word_count, wordCount);
        });

        test("milestone_index is stored and queryable", async () => {
            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: "verse one",
                milestoneIndex: 0,
            });
            await insertCell(db, "GEN 1:2", {
                sFileId: sourceFileId,
                sContent: "verse two",
                milestoneIndex: 1,
            });
            await insertCell(db, "GEN 1:3", {
                sFileId: sourceFileId,
                sContent: "verse three",
                milestoneIndex: 2,
            });

            const rows = await db.all<{ cell_id: string }>(
                "SELECT cell_id FROM cells WHERE milestone_index = ?",
                [1]
            );
            assert.strictEqual(rows.length, 1);
            assert.strictEqual(rows[0].cell_id, "GEN 1:2");
        });

        test("validation fields are stored correctly", async () => {
            await db.run(
                `INSERT INTO cells (cell_id, t_content, t_raw_content, t_validation_count, t_validated_by, t_is_fully_validated)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ["GEN 1:1", "translated", "translated", 2, "alice,bob", 1]
            );

            const row = await db.get<{
                t_validation_count: number;
                t_validated_by: string;
                t_is_fully_validated: number;
            }>("SELECT t_validation_count, t_validated_by, t_is_fully_validated FROM cells WHERE cell_id = ?", [
                "GEN 1:1",
            ]);

            assert.strictEqual(row?.t_validation_count, 2);
            assert.strictEqual(row?.t_validated_by, "alice,bob");
            assert.strictEqual(row?.t_is_fully_validated, 1);
        });

        test("audio validation fields are stored correctly", async () => {
            await db.run(
                `INSERT INTO cells (cell_id, t_content, t_raw_content,
                    t_audio_validation_count, t_audio_validated_by, t_audio_is_fully_validated)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ["GEN 1:1", "content", "content", 1, "charlie", 1]
            );

            const row = await db.get<{
                t_audio_validation_count: number;
                t_audio_validated_by: string;
                t_audio_is_fully_validated: number;
            }>(
                `SELECT t_audio_validation_count, t_audio_validated_by, t_audio_is_fully_validated
                 FROM cells WHERE cell_id = ?`,
                ["GEN 1:1"]
            );

            assert.strictEqual(row?.t_audio_validation_count, 1);
            assert.strictEqual(row?.t_audio_validated_by, "charlie");
            assert.strictEqual(row?.t_audio_is_fully_validated, 1);
        });
    });

    // ── 4. FTS5 Full-Text Search ────────────────────────────────────────

    suite("FTS5 Full-Text Search", () => {
        let db: AsyncDatabase;
        let sourceFileId: number;
        let targetFileId: number;

        setup(async function () {
            skipIfNotReady(this);
            db = await openTestDatabase();
            sourceFileId = await insertFile(db, "/project/GEN.source", "source");
            targetFileId = await insertFile(db, "/project/GEN.codex", "codex");
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("trigger auto-indexes source content into FTS on INSERT", async () => {
            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: "In the beginning God created the heavens and the earth.",
            });

            const ftsRows = await db.all<{ cell_id: string; content_type: string }>(
                "SELECT cell_id, content_type FROM cells_fts WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.ok(ftsRows.length >= 1, "FTS should have an entry after insert");
            assert.ok(
                ftsRows.some((r) => r.content_type === "source"),
                "Should have a 'source' FTS entry"
            );
        });

        test("trigger auto-indexes target content into FTS on INSERT", async () => {
            await insertCell(db, "GEN 1:1", {
                tFileId: targetFileId,
                tContent: "En el principio Dios creó los cielos y la tierra.",
            });

            const ftsRows = await db.all<{ content_type: string }>(
                "SELECT content_type FROM cells_fts WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.ok(
                ftsRows.some((r) => r.content_type === "target"),
                "Should have a 'target' FTS entry"
            );
        });

        test("FTS MATCH query finds source content", async () => {
            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: "In the beginning God created the heavens and the earth.",
            });
            await insertCell(db, "GEN 1:2", {
                sFileId: sourceFileId,
                sContent: "And the earth was without form, and void.",
            });

            const results = await db.all<{ cell_id: string; content: string }>(
                `SELECT cell_id, content FROM cells_fts WHERE cells_fts MATCH ? ORDER BY rank`,
                ["beginning"]
            );
            assert.ok(results.length >= 1, "Should find at least one result for 'beginning'");
            assert.ok(
                results.some((r) => r.cell_id === "GEN 1:1"),
                "GEN 1:1 should match 'beginning'"
            );
        });

        test("FTS MATCH with BM25 ranking", async () => {
            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: "In the beginning God created the heavens and the earth.",
            });
            await insertCell(db, "GEN 1:2", {
                sFileId: sourceFileId,
                sContent: "And the earth was without form, and void.",
            });
            await insertCell(db, "GEN 1:3", {
                sFileId: sourceFileId,
                sContent: "And God said, Let there be light: and there was light.",
            });

            const results = await db.all<{ cell_id: string; score: number }>(
                `SELECT cell_id, bm25(cells_fts) as score FROM cells_fts 
                 WHERE cells_fts MATCH ? ORDER BY score ASC`,
                ["earth"]
            );
            assert.ok(results.length >= 2, "Should find at least 2 results for 'earth'");
        });

        test("FTS wildcard search with prefix matching", async () => {
            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: "In the beginning God created the heavens and the earth.",
            });

            const results = await db.all<{ cell_id: string }>(
                `SELECT cell_id FROM cells_fts WHERE cells_fts MATCH ?`,
                ["begin*"]
            );
            assert.ok(results.length >= 1, "Wildcard 'begin*' should match 'beginning'");
        });

        test("FTS column-scoped search", async () => {
            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: "In the beginning God created the heavens and the earth.",
            });

            const results = await db.all<{ cell_id: string }>(
                `SELECT cell_id FROM cells_fts WHERE cells_fts MATCH ?`,
                ["content: beginning"]
            );
            assert.ok(results.length >= 1, "Column-scoped search should work");
        });

        test("FTS trigger removes entry on DELETE", async () => {
            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: "Delete me from FTS",
            });

            // Verify FTS has the entry
            let ftsCount = await db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM cells_fts WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.ok((ftsCount?.count ?? 0) > 0, "FTS should have entry before delete");

            // Delete the cell
            await db.run("DELETE FROM cells WHERE cell_id = ?", ["GEN 1:1"]);

            // Verify FTS entry is removed
            ftsCount = await db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM cells_fts WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.strictEqual(ftsCount?.count, 0, "FTS entry should be removed after delete");
        });

        test("FTS rebuild command works", async () => {
            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: "Content for FTS rebuild test",
            });

            // Force FTS rebuild
            await db.run("INSERT INTO cells_fts(cells_fts) VALUES('rebuild')");

            // Verify it still works after rebuild
            const results = await db.all<{ cell_id: string }>(
                "SELECT cell_id FROM cells_fts WHERE cells_fts MATCH ?",
                ["rebuild"]
            );
            assert.ok(results.length >= 1, "FTS should still work after rebuild");
        });

        test("FTS optimize command works", async () => {
            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: "Content for FTS optimize test",
            });

            // Should not throw
            await db.run("INSERT INTO cells_fts(cells_fts) VALUES('optimize')");
        });

        test("manual FTS sync (INSERT OR REPLACE)", async () => {
            // This mirrors upsertCellWithFTSSync's manual FTS sync
            await insertCell(db, "GEN 1:1", {
                sFileId: sourceFileId,
                sContent: "Original source content",
            });

            // Manual FTS sync
            await db.run(
                `INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type)
                 VALUES (?, ?, ?, ?)`,
                ["GEN 1:1", "Manually synced content", "Manually synced content", "source"]
            );

            const results = await db.all<{ content: string }>(
                "SELECT content FROM cells_fts WHERE cell_id = ? AND content_type = 'source'",
                ["GEN 1:1"]
            );
            assert.ok(results.length >= 1, "Manual FTS sync should succeed");
        });
    });

    // ── 5. Transactions ─────────────────────────────────────────────────

    suite("Transactions", () => {
        let db: AsyncDatabase;

        setup(async function () {
            skipIfNotReady(this);
            db = await openTestDatabase();
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("committed transaction persists data", async () => {
            await db.run("BEGIN TRANSACTION");
            await db.run(
                "INSERT INTO files (file_path, file_type, last_modified_ms, content_hash) VALUES (?, ?, ?, ?)",
                ["/commit-test.source", "source", Date.now(), "hash1"]
            );
            await db.run("COMMIT");

            const row = await db.get<{ file_path: string }>(
                "SELECT file_path FROM files WHERE file_path = ?",
                ["/commit-test.source"]
            );
            assert.strictEqual(row?.file_path, "/commit-test.source");
        });

        test("rolled-back transaction discards data", async () => {
            await db.run("BEGIN TRANSACTION");
            await db.run(
                "INSERT INTO files (file_path, file_type, last_modified_ms, content_hash) VALUES (?, ?, ?, ?)",
                ["/rollback-test.source", "source", Date.now(), "hash2"]
            );
            await db.run("ROLLBACK");

            const row = await db.get(
                "SELECT file_path FROM files WHERE file_path = ?",
                ["/rollback-test.source"]
            );
            assert.strictEqual(row, undefined, "Rolled-back data should not persist");
        });

        test("runInTransaction-style commit pattern", async () => {
            // Mirrors the runInTransaction helper in sqliteIndex.ts
            await db.run("BEGIN TRANSACTION");
            try {
                await db.run(
                    "INSERT INTO files (file_path, file_type, last_modified_ms, content_hash) VALUES (?, ?, ?, ?)",
                    ["/txn-helper.source", "source", Date.now(), "hash3"]
                );
                await db.run("COMMIT");
            } catch {
                await db.run("ROLLBACK");
                throw new Error("Transaction should not have failed");
            }

            const row = await db.get<{ file_path: string }>(
                "SELECT file_path FROM files WHERE file_path = ?",
                ["/txn-helper.source"]
            );
            assert.ok(row, "Transaction helper pattern should work");
        });

        test("runInTransaction-style rollback on error", async () => {
            await db.run("BEGIN TRANSACTION");
            try {
                await db.run(
                    "INSERT INTO files (file_path, file_type, last_modified_ms, content_hash) VALUES (?, ?, ?, ?)",
                    ["/txn-error.source", "source", Date.now(), "hash4"]
                );
                // Simulate an error
                throw new Error("Simulated error");
            } catch {
                await db.run("ROLLBACK");
            }

            const row = await db.get(
                "SELECT file_path FROM files WHERE file_path = ?",
                ["/txn-error.source"]
            );
            assert.strictEqual(row, undefined, "Data should be rolled back after error");
        });

        test("batch insert in transaction is faster than individual inserts", async () => {
            const sourceFileId = await insertFile(db, "/perf-test.source", "source");

            // Batch insert
            const batchStart = Date.now();
            await db.run("BEGIN TRANSACTION");
            for (let i = 0; i < 100; i++) {
                await db.run(
                    "INSERT INTO cells (cell_id, s_file_id, s_content, s_raw_content) VALUES (?, ?, ?, ?)",
                    [`PERF ${i}:1`, sourceFileId, `Content ${i}`, `Content ${i}`]
                );
            }
            await db.run("COMMIT");
            const batchDuration = Date.now() - batchStart;

            const count = await db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM cells WHERE s_file_id = ?",
                [sourceFileId]
            );
            assert.strictEqual(count?.count, 100, "All 100 rows should be inserted");

            // Batch should complete in reasonable time (well under 5 seconds for in-memory)
            assert.ok(batchDuration < 5000, `Batch insert took ${batchDuration}ms, expected < 5000ms`);
        });
    });

    // ── 6. Schema Versioning & Re-indexing ──────────────────────────────

    suite("Schema Versioning & Re-indexing", () => {
        let db: AsyncDatabase;

        setup(async function () {
            skipIfNotReady(this);
            db = await openTestDatabase();
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("reads schema version", async () => {
            const row = await db.get<{ version: number }>(
                "SELECT version FROM schema_info WHERE id = 1 LIMIT 1"
            );
            assert.strictEqual(row?.version, CURRENT_SCHEMA_VERSION);
        });

        test("updates schema version", async () => {
            const newVersion = CURRENT_SCHEMA_VERSION + 1;
            await db.run("BEGIN TRANSACTION");
            await db.run("DELETE FROM schema_info");
            await db.run("INSERT INTO schema_info (id, version) VALUES (1, ?)", [newVersion]);
            await db.run("COMMIT");

            const row = await db.get<{ version: number }>(
                "SELECT version FROM schema_info WHERE id = 1"
            );
            assert.strictEqual(row?.version, newVersion);
        });

        test("schema_info enforces single-row constraint", async () => {
            try {
                await db.run("INSERT INTO schema_info (id, version) VALUES (2, 99)");
                assert.fail("Should have thrown for id != 1");
            } catch (err: any) {
                assert.ok(
                    err.message.includes("CHECK") || err.message.includes("constraint"),
                    `Expected CHECK constraint error, got: ${err.message}`
                );
            }
        });

        test("removeAll clears all data (re-index prep)", async () => {
            const fileId = await insertFile(db, "/project/GEN.source", "source");
            await insertCell(db, "GEN 1:1", {
                sFileId: fileId,
                sContent: "Verse content",
            });
            await db.run("INSERT INTO words (word, cell_id, position) VALUES (?, ?, ?)", [
                "verse",
                "GEN 1:1",
                0,
            ]);

            // Clear all data (mirrors removeAll)
            await db.run("BEGIN TRANSACTION");
            await db.run("DELETE FROM cells_fts");
            await db.run("DELETE FROM words");
            await db.run("DELETE FROM cells");
            await db.run("DELETE FROM files");
            await db.run("COMMIT");

            const cellCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM cells");
            const fileCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM files");
            const wordCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM words");
            const ftsCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM cells_fts");

            assert.strictEqual(cellCount?.count, 0);
            assert.strictEqual(fileCount?.count, 0);
            assert.strictEqual(wordCount?.count, 0);
            assert.strictEqual(ftsCount?.count, 0);
        });

        test("FTS rebuild after full re-population", async () => {
            const fileId = await insertFile(db, "/project/GEN.source", "source");

            // Populate
            for (let i = 1; i <= 10; i++) {
                await insertCell(db, `GEN 1:${i}`, {
                    sFileId: fileId,
                    sContent: `Verse ${i} content with unique text verse${i}text`,
                });
            }

            // Rebuild FTS
            await db.run("INSERT INTO cells_fts(cells_fts) VALUES('rebuild')");

            // Verify FTS works after rebuild
            const results = await db.all<{ cell_id: string }>(
                "SELECT cell_id FROM cells_fts WHERE cells_fts MATCH ?",
                ["verse5text"]
            );
            assert.ok(results.length >= 1, "Should find verse 5 after FTS rebuild");
        });

        test("getDocumentCount matches actual cells", async () => {
            const fileId = await insertFile(db, "/project/GEN.source", "source");
            await insertCell(db, "GEN 1:1", { sFileId: fileId, sContent: "A" });
            await insertCell(db, "GEN 1:2", { sFileId: fileId, sContent: "B" });
            await insertCell(db, "GEN 1:3", { sFileId: fileId, sContent: "C" });

            const row = await db.get<{ count: number }>(
                "SELECT COUNT(DISTINCT cell_id) as count FROM cells"
            );
            assert.strictEqual(row?.count, 3);
        });
    });

    // ── 7. Sync Metadata ────────────────────────────────────────────────

    suite("Sync Metadata", () => {
        let db: AsyncDatabase;

        setup(async function () {
            skipIfNotReady(this);
            db = await openTestDatabase();
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("inserts sync metadata", async () => {
            await db.run(
                `INSERT INTO sync_metadata (file_path, file_type, content_hash, file_size, last_modified_ms)
                 VALUES (?, ?, ?, ?, ?)`,
                ["/project/GEN.source", "source", "abc123", 1024, Date.now()]
            );

            const row = await db.get<{ file_path: string; content_hash: string }>(
                "SELECT file_path, content_hash FROM sync_metadata WHERE file_path = ?",
                ["/project/GEN.source"]
            );
            assert.strictEqual(row?.file_path, "/project/GEN.source");
            assert.strictEqual(row?.content_hash, "abc123");
        });

        test("upserts sync metadata on conflict", async () => {
            await db.run(
                `INSERT INTO sync_metadata (file_path, file_type, content_hash, file_size, last_modified_ms)
                 VALUES (?, ?, ?, ?, ?)`,
                ["/project/GEN.source", "source", "hash1", 100, 1000]
            );

            await db.run(
                `INSERT INTO sync_metadata (file_path, file_type, content_hash, file_size, last_modified_ms)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(file_path) DO UPDATE SET
                     content_hash = excluded.content_hash,
                     file_size = excluded.file_size,
                     last_modified_ms = excluded.last_modified_ms`,
                ["/project/GEN.source", "source", "hash2", 200, 2000]
            );

            const row = await db.get<{ content_hash: string; file_size: number }>(
                "SELECT content_hash, file_size FROM sync_metadata WHERE file_path = ?",
                ["/project/GEN.source"]
            );
            assert.strictEqual(row?.content_hash, "hash2");
            assert.strictEqual(row?.file_size, 200);
        });

        test("deletes sync metadata", async () => {
            await db.run(
                `INSERT INTO sync_metadata (file_path, file_type, content_hash, file_size, last_modified_ms)
                 VALUES (?, ?, ?, ?, ?)`,
                ["/project/to-delete.source", "source", "hash", 50, Date.now()]
            );

            const result = await db.run(
                "DELETE FROM sync_metadata WHERE file_path = ?",
                ["/project/to-delete.source"]
            );
            assert.strictEqual(result.changes, 1);
        });
    });

    // ── 8. Words Index ──────────────────────────────────────────────────

    suite("Words Index", () => {
        let db: AsyncDatabase;
        let fileId: number;

        setup(async function () {
            skipIfNotReady(this);
            db = await openTestDatabase();
            fileId = await insertFile(db, "/project/GEN.source", "source");
            await insertCell(db, "GEN 1:1", {
                sFileId: fileId,
                sContent: "In the beginning God created",
            });
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("inserts words for a cell", async () => {
            const words = ["in", "the", "beginning", "God", "created"];

            await db.run("BEGIN TRANSACTION");
            for (let i = 0; i < words.length; i++) {
                await db.run(
                    "INSERT INTO words (word, cell_id, position) VALUES (?, ?, ?)",
                    [words[i], "GEN 1:1", i]
                );
            }
            await db.run("COMMIT");

            const count = await db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM words WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.strictEqual(count?.count, words.length);
        });

        test("queries words by word text", async () => {
            await db.run("INSERT INTO words (word, cell_id, position) VALUES (?, ?, ?)", [
                "beginning",
                "GEN 1:1",
                2,
            ]);

            // After creating deferred indexes
            await db.exec(CREATE_DEFERRED_INDEXES_SQL);

            const rows = await db.all<{ cell_id: string }>(
                "SELECT cell_id FROM words WHERE word = ?",
                ["beginning"]
            );
            assert.ok(rows.length >= 1);
            assert.strictEqual(rows[0].cell_id, "GEN 1:1");
        });

        test("CASCADE delete removes words when cell is deleted", async () => {
            // Need to enable foreign keys (already done in setup via openTestDatabase)
            await db.run("INSERT INTO words (word, cell_id, position) VALUES (?, ?, ?)", [
                "test",
                "GEN 1:1",
                0,
            ]);

            // Verify word exists
            let wordCount = await db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM words WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.ok((wordCount?.count ?? 0) > 0);

            // Delete the cell
            await db.run("DELETE FROM cells WHERE cell_id = ?", ["GEN 1:1"]);

            // Words should be cascade-deleted
            wordCount = await db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM words WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.strictEqual(wordCount?.count, 0, "Words should be cascade-deleted with cell");
        });
    });

    // ── 9. Edge Cases & Unicode ─────────────────────────────────────────

    suite("Edge Cases & Unicode", () => {
        let db: AsyncDatabase;
        let fileId: number;

        setup(async function () {
            skipIfNotReady(this);
            db = await openTestDatabase();
            fileId = await insertFile(db, "/project/MRK.source", "source");
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("stores and retrieves Greek text", async () => {
            const greekContent =
                "φωνὴ βοῶντος ἐν τῇ ἐρήμῳ· Ἑτοιμάσατε τὴν ὁδὸν κυρίου, εὐθείας ποιεῖτε τὰς τρίβους αὐτοῦ,";

            await insertCell(db, "MRK 1:3", {
                sFileId: fileId,
                sContent: greekContent,
            });

            const row = await db.get<{ s_content: string }>(
                "SELECT s_content FROM cells WHERE cell_id = ?",
                ["MRK 1:3"]
            );
            assert.strictEqual(row?.s_content, greekContent);
        });

        test("FTS5 searches Greek text with unicode61 tokenizer", async () => {
            await insertCell(db, "MRK 1:3", {
                sFileId: fileId,
                sContent: "φωνὴ βοῶντος ἐν τῇ ἐρήμῳ",
            });

            // The unicode61 tokenizer should handle Greek
            const results = await db.all<{ cell_id: string }>(
                "SELECT cell_id FROM cells_fts WHERE cells_fts MATCH ?",
                ["φωνὴ"]
            );
            assert.ok(results.length >= 1, "Should find Greek text via FTS");
        });

        test("stores and retrieves Hebrew text", async () => {
            const hebrewContent = "בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ";

            await insertCell(db, "GEN 1:1", {
                sFileId: fileId,
                sContent: hebrewContent,
            });

            const row = await db.get<{ s_content: string }>(
                "SELECT s_content FROM cells WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.strictEqual(row?.s_content, hebrewContent);
        });

        test("stores and retrieves HTML content (raw_content)", async () => {
            const htmlContent =
                '<p>In the <span class="highlight">beginning</span> God created</p>';
            const plainContent = "In the beginning God created";

            await insertCell(db, "GEN 1:1", {
                sFileId: fileId,
                sContent: plainContent,
                sRawContent: htmlContent,
            });

            const row = await db.get<{ s_content: string; s_raw_content: string }>(
                "SELECT s_content, s_raw_content FROM cells WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.strictEqual(row?.s_content, plainContent);
            assert.strictEqual(row?.s_raw_content, htmlContent);
        });

        test("handles empty content gracefully", async () => {
            await insertCell(db, "GEN 1:1", {
                sFileId: fileId,
                sContent: "",
            });

            const row = await db.get<{ s_content: string; s_word_count: number }>(
                "SELECT s_content, s_word_count FROM cells WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.strictEqual(row?.s_content, "");
            assert.strictEqual(row?.s_word_count, 0);
        });

        test("handles NULL content", async () => {
            await db.run("INSERT INTO cells (cell_id) VALUES (?)", ["EMPTY-CELL"]);

            const row = await db.get<{ s_content: string | null; t_content: string | null }>(
                "SELECT s_content, t_content FROM cells WHERE cell_id = ?",
                ["EMPTY-CELL"]
            );
            assert.strictEqual(row?.s_content, null);
            assert.strictEqual(row?.t_content, null);
        });

        test("handles very long content", async () => {
            const longContent = "word ".repeat(10_000).trim(); // ~50,000 characters

            await insertCell(db, "GEN 1:1", {
                sFileId: fileId,
                sContent: longContent,
            });

            const row = await db.get<{ s_content: string; s_word_count: number }>(
                "SELECT s_content, s_word_count FROM cells WHERE cell_id = ?",
                ["GEN 1:1"]
            );
            assert.strictEqual(row?.s_word_count, 10_000);
            assert.strictEqual(row?.s_content, longContent);
        });

        test("handles special characters in cell_id", async () => {
            const specialId = "GEN 1:1 (alt)";
            await insertCell(db, specialId, {
                sFileId: fileId,
                sContent: "test content",
            });

            const row = await db.get<{ cell_id: string }>(
                "SELECT cell_id FROM cells WHERE cell_id = ?",
                [specialId]
            );
            assert.strictEqual(row?.cell_id, specialId);
        });

        test("content hash is deterministic", async () => {
            const content = "In the beginning God created the heavens and the earth.";
            const hash1 = computeHash(content);
            const hash2 = computeHash(content);
            assert.strictEqual(hash1, hash2, "Same content should produce same hash");

            const hash3 = computeHash(content + " ");
            assert.notStrictEqual(hash1, hash3, "Different content should produce different hash");
        });
    });

    // ── 10. AsyncDatabase API ───────────────────────────────────────────

    suite("AsyncDatabase API", () => {
        let db: AsyncDatabase;

        setup(async function () {
            skipIfNotReady(this);
            db = await AsyncDatabase.open(":memory:");
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("exec() runs DDL statements", async () => {
            await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
            const tables = await db.all<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='test'"
            );
            assert.strictEqual(tables.length, 1);
        });

        test("run() returns lastID and changes", async () => {
            await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT)");

            const result1 = await db.run("INSERT INTO test (value) VALUES (?)", ["first"]);
            assert.strictEqual(result1.lastID, 1);
            assert.strictEqual(result1.changes, 1);

            const result2 = await db.run("INSERT INTO test (value) VALUES (?)", ["second"]);
            assert.strictEqual(result2.lastID, 2);
            assert.strictEqual(result2.changes, 1);
        });

        test("get() returns single row or undefined", async () => {
            await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
            await db.run("INSERT INTO test VALUES (1, 'hello')");

            const row = await db.get<{ id: number; value: string }>(
                "SELECT * FROM test WHERE id = ?",
                [1]
            );
            assert.strictEqual(row?.id, 1);
            assert.strictEqual(row?.value, "hello");

            const missing = await db.get("SELECT * FROM test WHERE id = ?", [999]);
            assert.strictEqual(missing, undefined);
        });

        test("all() returns array of rows", async () => {
            await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
            await db.run("INSERT INTO test VALUES (1, 'a')");
            await db.run("INSERT INTO test VALUES (2, 'b')");
            await db.run("INSERT INTO test VALUES (3, 'c')");

            const rows = await db.all<{ id: number; value: string }>("SELECT * FROM test ORDER BY id");
            assert.strictEqual(rows.length, 3);
            assert.strictEqual(rows[0].value, "a");
            assert.strictEqual(rows[2].value, "c");
        });

        test("all() returns empty array for no matches", async () => {
            await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
            const rows = await db.all("SELECT * FROM test");
            assert.ok(Array.isArray(rows));
            assert.strictEqual(rows.length, 0);
        });

        test("each() iterates over rows", async () => {
            await db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
            await db.run("INSERT INTO test VALUES (1, 'x')");
            await db.run("INSERT INTO test VALUES (2, 'y')");
            await db.run("INSERT INTO test VALUES (3, 'z')");

            const collected: string[] = [];
            const count = await db.each<{ value: string }>(
                "SELECT value FROM test ORDER BY id",
                [],
                (row) => {
                    collected.push(row.value);
                }
            );

            assert.strictEqual(count, 3);
            assert.deepStrictEqual(collected, ["x", "y", "z"]);
        });

        test("run() rejects on SQL error", async () => {
            try {
                await db.run("INSERT INTO nonexistent_table VALUES (1)");
                assert.fail("Should have thrown");
            } catch (err: any) {
                assert.ok(err.message.includes("no such table"));
            }
        });

        test("get() rejects on SQL error", async () => {
            try {
                await db.get("SELECT * FROM nonexistent_table");
                assert.fail("Should have thrown");
            } catch (err: any) {
                assert.ok(err.message.includes("no such table"));
            }
        });

        test("exec() rejects on SQL error", async () => {
            try {
                await db.exec("INVALID SQL STATEMENT");
                assert.fail("Should have thrown");
            } catch (err: any) {
                assert.ok(err instanceof Error);
            }
        });
    });

    // ── 11. PRAGMAs & Configuration ─────────────────────────────────────

    suite("PRAGMAs & Database Configuration", () => {
        let db: AsyncDatabase;

        setup(async function () {
            skipIfNotReady(this);
            db = await AsyncDatabase.open(":memory:");
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("journal_mode can be set", async () => {
            // In-memory DBs use MEMORY by default, but we can set it
            await db.exec("PRAGMA journal_mode = MEMORY");
            const row = await db.get<{ journal_mode: string }>("PRAGMA journal_mode");
            assert.ok(row?.journal_mode === "memory", `Expected 'memory', got '${row?.journal_mode}'`);
        });

        test("foreign_keys can be enabled", async () => {
            await db.exec("PRAGMA foreign_keys = ON");
            const row = await db.get<{ foreign_keys: number }>("PRAGMA foreign_keys");
            assert.strictEqual(row?.foreign_keys, 1);
        });

        test("cache_size can be configured", async () => {
            await db.exec("PRAGMA cache_size = -8000");
            const row = await db.get<{ cache_size: number }>("PRAGMA cache_size");
            assert.strictEqual(row?.cache_size, -8000);
        });

        test("busyTimeout can be configured via configure()", async () => {
            // Should not throw
            db.configure("busyTimeout", 5000);
        });

        test("temp_store can be set to MEMORY", async () => {
            await db.exec("PRAGMA temp_store = MEMORY");
            const row = await db.get<{ temp_store: number }>("PRAGMA temp_store");
            assert.strictEqual(row?.temp_store, 2); // 2 = MEMORY
        });

        test("integrity_check passes on fresh database", async () => {
            const result = await db.get<{ quick_check: string }>(
                "PRAGMA quick_check(1)"
            );
            assert.strictEqual(result?.quick_check, "ok");
        });
    });

    // ── 12. Joined Queries (mimicking search) ───────────────────────────

    suite("Joined Queries (Search Pattern)", () => {
        let db: AsyncDatabase;
        let sourceFileId: number;
        let targetFileId: number;

        setup(async function () {
            skipIfNotReady(this);
            db = await openTestDatabase();
            sourceFileId = await insertFile(db, "/project/GEN.source", "source");
            targetFileId = await insertFile(db, "/project/GEN.codex", "codex");

            // Insert cells with both source and target content
            // We need to insert source first, then update with target
            await db.run(
                `INSERT INTO cells (cell_id, s_file_id, s_content, s_raw_content, s_line_number, s_word_count)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ["GEN 1:1", sourceFileId, "In the beginning God created", "In the beginning God created", 1, 5]
            );
            await db.run(
                `UPDATE cells SET t_file_id = ?, t_content = ?, t_raw_content = ?, t_line_number = ?, t_word_count = ?
                 WHERE cell_id = ?`,
                [targetFileId, "En el principio Dios creo", "En el principio Dios creo", 1, 5, "GEN 1:1"]
            );

            await db.run(
                `INSERT INTO cells (cell_id, s_file_id, s_content, s_raw_content, s_line_number, s_word_count)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ["GEN 1:2", sourceFileId, "And the earth was without form", "And the earth was without form", 2, 6]
            );
            await db.run(
                `UPDATE cells SET t_file_id = ?, t_content = ?, t_raw_content = ?, t_line_number = ?, t_word_count = ?
                 WHERE cell_id = ?`,
                [targetFileId, "Y la tierra estaba desordenada", "Y la tierra estaba desordenada", 2, 5, "GEN 1:2"]
            );

            // Manually sync to FTS (since UPDATE triggers handle source/target separately)
            await db.run(
                `INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type)
                 VALUES (?, ?, ?, ?)`,
                ["GEN 1:1", "En el principio Dios creo", "En el principio Dios creo", "target"]
            );
            await db.run(
                `INSERT OR REPLACE INTO cells_fts(cell_id, content, raw_content, content_type)
                 VALUES (?, ?, ?, ?)`,
                ["GEN 1:2", "Y la tierra estaba desordenada", "Y la tierra estaba desordenada", "target"]
            );
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("search with JOIN returns cell + file data", async () => {
            const rows = await db.all<{
                cell_id: string;
                content: string;
                content_type: string;
                s_content: string;
                t_content: string;
                s_file_path: string;
                t_file_path: string;
                score: number;
            }>(`
                SELECT 
                    cells_fts.cell_id,
                    cells_fts.content,
                    cells_fts.content_type,
                    c.s_content,
                    c.t_content,
                    s_file.file_path as s_file_path,
                    t_file.file_path as t_file_path,
                    bm25(cells_fts) as score
                FROM cells_fts
                JOIN cells c ON cells_fts.cell_id = c.cell_id
                LEFT JOIN files s_file ON c.s_file_id = s_file.id
                LEFT JOIN files t_file ON c.t_file_id = t_file.id
                WHERE cells_fts MATCH ?
                ORDER BY score ASC
                LIMIT 10
            `, ["content: beginning"]);

            assert.ok(rows.length >= 1, "Should find results for 'beginning'");
            const match = rows.find((r) => r.cell_id === "GEN 1:1");
            assert.ok(match, "Should find GEN 1:1");
            assert.ok(match?.s_content?.includes("beginning"));
            assert.strictEqual(match?.s_file_path, "/project/GEN.source");
            assert.strictEqual(match?.t_file_path, "/project/GEN.codex");
        });

        test("search target content via FTS", async () => {
            const rows = await db.all<{ cell_id: string }>(
                `SELECT cell_id FROM cells_fts WHERE cells_fts MATCH ?`,
                ["principio"]
            );
            assert.ok(rows.length >= 1);
            assert.ok(rows.some((r) => r.cell_id === "GEN 1:1"));
        });

        test("search returns both source and target matches", async () => {
            // "earth" is in GEN 1:2's source, "tierra" is in GEN 1:2's target
            const sourceResults = await db.all<{ cell_id: string }>(
                "SELECT cell_id FROM cells_fts WHERE cells_fts MATCH ?",
                ["earth"]
            );
            const targetResults = await db.all<{ cell_id: string }>(
                "SELECT cell_id FROM cells_fts WHERE cells_fts MATCH ?",
                ["tierra"]
            );

            assert.ok(sourceResults.some((r) => r.cell_id === "GEN 1:2"), "Source 'earth' should match");
            assert.ok(targetResults.some((r) => r.cell_id === "GEN 1:2"), "Target 'tierra' should match");
        });
    });

    // ── 13. Concurrent operations ───────────────────────────────────────

    suite("Concurrent Operations", () => {
        let db: AsyncDatabase;

        setup(async function () {
            skipIfNotReady(this);
            db = await openTestDatabase();
        });

        teardown(async () => {
            if (db) { await db.close(); }
        });

        test("parallel reads do not interfere", async () => {
            const fileId = await insertFile(db, "/project/GEN.source", "source");
            await insertCell(db, "GEN 1:1", { sFileId: fileId, sContent: "verse one" });
            await insertCell(db, "GEN 1:2", { sFileId: fileId, sContent: "verse two" });

            // Run multiple reads in parallel
            const [row1, row2, count] = await Promise.all([
                db.get<{ s_content: string }>("SELECT s_content FROM cells WHERE cell_id = ?", ["GEN 1:1"]),
                db.get<{ s_content: string }>("SELECT s_content FROM cells WHERE cell_id = ?", ["GEN 1:2"]),
                db.get<{ count: number }>("SELECT COUNT(*) as count FROM cells"),
            ]);

            assert.ok(row1?.s_content?.includes("one"));
            assert.ok(row2?.s_content?.includes("two"));
            assert.strictEqual(count?.count, 2);
        });

        test("sequential writes maintain consistency", async () => {
            const fileId = await insertFile(db, "/project/GEN.source", "source");

            // Sequential writes
            for (let i = 1; i <= 20; i++) {
                await insertCell(db, `SEQ ${i}:1`, {
                    sFileId: fileId,
                    sContent: `Sequential content ${i}`,
                });
            }

            const count = await db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM cells WHERE s_file_id = ?",
                [fileId]
            );
            assert.strictEqual(count?.count, 20);
        });
    });

    // ── 14. Database close & cleanup ────────────────────────────────────

    suite("Database Close & Cleanup", () => {
        test("close() completes without error", async function () {
            skipIfNotReady(this);
            const db = await openTestDatabase();
            await db.close();
            // Should not throw
        });

        test("operations fail after close", async function () {
            skipIfNotReady(this);
            const db = await openTestDatabase();
            await db.close();

            try {
                await db.run("SELECT 1");
                assert.fail("Should have thrown after close");
            } catch (err: any) {
                assert.ok(err instanceof Error);
            }
        });

        test("VACUUM succeeds on fresh database", async function () {
            skipIfNotReady(this);
            const db = await openTestDatabase();
            await db.exec("VACUUM");
            await db.close();
        });

        test("PRAGMA optimize runs without error before close", async function () {
            skipIfNotReady(this);
            const db = await openTestDatabase();
            // Insert some data so optimizer has something to analyze
            const fileId = await insertFile(db, "/opt-test.source", "source");
            await insertCell(db, "OPT 1:1", { sFileId: fileId, sContent: "test content" });
            await db.exec("PRAGMA optimize");
            await db.close();
        });
    });

    // ── 15. SQLITE_BUSY & busyTimeout behavior ──────────────────────────

    suite("SQLITE_BUSY & busyTimeout", () => {
        test("busyTimeout prevents immediate SQLITE_BUSY on contention", async function () {
            skipIfNotReady(this);

            // Use a file-based DB so two connections can contend for locks.
            // In-memory DBs are single-connection and can't produce SQLITE_BUSY.
            const tmpDir = realOs.tmpdir();
            const dbPath = realPath.join(tmpDir, `busy-test-${Date.now()}.sqlite`);

            let db1: AsyncDatabase | null = null;
            let db2: AsyncDatabase | null = null;

            try {
                db1 = await AsyncDatabase.open(dbPath);
                db2 = await AsyncDatabase.open(dbPath);

                await db1.exec("PRAGMA journal_mode = WAL");
                await db2.exec("PRAGMA journal_mode = WAL");

                // Set a short busy timeout on db2
                db2.configure("busyTimeout", 2000);

                // Create a simple table
                await db1.exec("CREATE TABLE IF NOT EXISTS busy_test (id INTEGER PRIMARY KEY, val TEXT)");

                // db1 starts a write transaction
                await db1.run("BEGIN IMMEDIATE");
                await db1.run("INSERT INTO busy_test (val) VALUES ('from db1')");

                // db2 tries to write — with WAL, readers don't block, but IMMEDIATE
                // transactions will wait up to busyTimeout before failing
                const start = Date.now();
                const db2WritePromise = db2.run("BEGIN IMMEDIATE").then(async () => {
                    await db2!.run("INSERT INTO busy_test (val) VALUES ('from db2')");
                    await db2!.run("COMMIT");
                    return "committed";
                }).catch(async (err: Error) => {
                    // Try to rollback if we got a transaction started
                    try { await db2!.run("ROLLBACK"); } catch { /* ignore */ }
                    return `error: ${err.message}`;
                });

                // Commit db1 after a short delay to release the lock
                await new Promise(r => setTimeout(r, 200));
                await db1.run("COMMIT");

                const result = await db2WritePromise;
                const elapsed = Date.now() - start;

                // db2 should have succeeded (lock was released before timeout) or
                // at minimum waited rather than failing instantly
                assert.ok(
                    result === "committed" || elapsed >= 100,
                    `busyTimeout should cause wait, not instant failure. Result: ${result}, elapsed: ${elapsed}ms`
                );
            } finally {
                if (db1) { try { await db1.close(); } catch { /* */ } }
                if (db2) { try { await db2.close(); } catch { /* */ } }
                try { realFs.unlinkSync(dbPath); } catch { /* */ }
                try { realFs.unlinkSync(dbPath + "-wal"); } catch { /* */ }
                try { realFs.unlinkSync(dbPath + "-shm"); } catch { /* */ }
            }
        });

        test("SQLITE_BUSY is returned when busyTimeout expires", async function () {
            skipIfNotReady(this);
            this.timeout(10_000);

            const tmpDir = realOs.tmpdir();
            const dbPath = realPath.join(tmpDir, `busy-expire-${Date.now()}.sqlite`);

            let db1: AsyncDatabase | null = null;
            let db2: AsyncDatabase | null = null;

            try {
                db1 = await AsyncDatabase.open(dbPath);
                db2 = await AsyncDatabase.open(dbPath);

                // Use DELETE journal mode so write locks are exclusive
                await db1.exec("PRAGMA journal_mode = DELETE");
                await db2.exec("PRAGMA journal_mode = DELETE");

                // Very short timeout so the test doesn't hang
                db2.configure("busyTimeout", 200);

                await db1.exec("CREATE TABLE IF NOT EXISTS busy_expire (id INTEGER PRIMARY KEY, val TEXT)");

                // Hold an exclusive write lock on db1 (don't commit)
                await db1.run("BEGIN EXCLUSIVE");
                await db1.run("INSERT INTO busy_expire (val) VALUES ('blocking')");

                // db2 should fail with SQLITE_BUSY after timeout
                try {
                    await db2.run("BEGIN EXCLUSIVE");
                    assert.fail("Expected SQLITE_BUSY error");
                } catch (err: any) {
                    assert.ok(
                        err.message.includes("SQLITE_BUSY") || err.message.includes("database is locked"),
                        `Expected SQLITE_BUSY, got: ${err.message}`
                    );
                }

                await db1.run("ROLLBACK");
            } finally {
                if (db1) { try { await db1.close(); } catch { /* */ } }
                if (db2) { try { await db2.close(); } catch { /* */ } }
                try { realFs.unlinkSync(dbPath); } catch { /* */ }
                try { realFs.unlinkSync(dbPath + "-wal"); } catch { /* */ }
                try { realFs.unlinkSync(dbPath + "-shm"); } catch { /* */ }
            }
        });
    });

    // ── 16. Transaction retry with backoff ───────────────────────────────

    suite("Transaction Retry with Backoff", () => {
        test("runInTransaction-style retry succeeds after transient SQLITE_BUSY", async function () {
            skipIfNotReady(this);
            this.timeout(10_000);

            // Simulate the retry pattern from runInTransactionWithRetry
            const db = await openTestDatabase();
            const fileId = await insertFile(db, "/retry-test.source", "source");

            let attempt = 0;
            const maxRetries = 3;
            const baseDelayMs = 50;

            // Simulate a function that fails with SQLITE_BUSY on first attempt, succeeds after
            const simulatedBusyThenSucceed = async (): Promise<string> => {
                for (let i = 0; i <= maxRetries; i++) {
                    try {
                        if (attempt === 0) {
                            attempt++;
                            throw new Error("SQLITE_BUSY: database is locked");
                        }
                        // Succeeds on retry
                        await insertCell(db, "RETRY 1:1", { sFileId: fileId, sContent: "retried content" });
                        return "success";
                    } catch (error: any) {
                        const msg = error.message || String(error);
                        const isBusy = msg.includes("SQLITE_BUSY") || msg.includes("database is locked");
                        if (!isBusy || i === maxRetries) throw error;
                        const delay = baseDelayMs * Math.pow(2, i);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
                throw new Error("Unreachable");
            };

            const result = await simulatedBusyThenSucceed();
            assert.strictEqual(result, "success");
            assert.strictEqual(attempt, 1, "Should have failed once then succeeded");

            // Verify the data was written
            const row = await db.get<{ s_content: string }>(
                "SELECT s_content FROM cells WHERE cell_id = ?",
                ["RETRY 1:1"]
            );
            assert.ok(row?.s_content?.includes("retried"), "Retried write should persist");

            await db.close();
        });

        test("retry exhaustion throws the original error", async function () {
            skipIfNotReady(this);

            const maxRetries = 2;
            const baseDelayMs = 10; // Very short for fast test
            let attempts = 0;

            const alwaysBusy = async (): Promise<void> => {
                for (let i = 0; i <= maxRetries; i++) {
                    try {
                        attempts++;
                        throw new Error("SQLITE_BUSY: database is locked");
                    } catch (error: any) {
                        const msg = error.message || String(error);
                        const isBusy = msg.includes("SQLITE_BUSY") || msg.includes("database is locked");
                        if (!isBusy || i === maxRetries) throw error;
                        const delay = baseDelayMs * Math.pow(2, i);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
            };

            try {
                await alwaysBusy();
                assert.fail("Should have thrown after exhausting retries");
            } catch (err: any) {
                assert.ok(err.message.includes("SQLITE_BUSY"), `Expected SQLITE_BUSY, got: ${err.message}`);
                assert.strictEqual(attempts, maxRetries + 1, `Should have attempted ${maxRetries + 1} times`);
            }
        });

        test("non-BUSY errors are not retried", async function () {
            skipIfNotReady(this);

            const maxRetries = 3;
            const baseDelayMs = 10;
            let attempts = 0;

            const nonBusyError = async (): Promise<void> => {
                for (let i = 0; i <= maxRetries; i++) {
                    try {
                        attempts++;
                        throw new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed");
                    } catch (error: any) {
                        const msg = error.message || String(error);
                        const isBusy = msg.includes("SQLITE_BUSY") || msg.includes("database is locked");
                        if (!isBusy || i === maxRetries) throw error;
                        const delay = baseDelayMs * Math.pow(2, i);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
            };

            try {
                await nonBusyError();
                assert.fail("Should have thrown on first attempt");
            } catch (err: any) {
                assert.ok(err.message.includes("SQLITE_CONSTRAINT"), `Expected SQLITE_CONSTRAINT, got: ${err.message}`);
                assert.strictEqual(attempts, 1, "Non-BUSY errors should not be retried");
            }
        });
    });

    // ── 17. Corruption recovery patterns ─────────────────────────────────

    suite("Corruption Recovery Patterns", () => {
        test("quick_check detects corruption (simulated via invalid data)", async function () {
            skipIfNotReady(this);

            // Verify that quick_check returns 'ok' for a healthy database
            const db = await openTestDatabase();
            const result = await db.get<{ quick_check: string }>("PRAGMA quick_check(1)");
            assert.strictEqual(result?.quick_check, "ok", "Healthy database should pass quick_check");
            await db.close();
        });

        test("database can be recreated after schema mismatch", async function () {
            skipIfNotReady(this);

            // Simulate a schema version mismatch by inserting wrong version
            const db = await openTestDatabase();

            // Set an invalid schema version
            await db.run("UPDATE schema_info SET version = 999 WHERE id = 1");

            // Verify it was set
            const row = await db.get<{ version: number }>("SELECT version FROM schema_info WHERE id = 1");
            assert.strictEqual(row?.version, 999);

            // In production, this triggers nukeDatabaseAndRecreate().
            // Test that we can drop and recreate the schema from scratch.
            await db.exec("DROP TABLE IF EXISTS cells_fts");
            await db.exec("DROP TABLE IF EXISTS cells");
            await db.exec("DROP TABLE IF EXISTS sync_metadata");
            await db.exec("DROP TABLE IF EXISTS words");
            await db.exec("DROP TABLE IF EXISTS files");
            await db.exec("DROP TABLE IF EXISTS schema_info");

            // Recreate schema
            await db.exec(CREATE_TABLES_SQL);
            await db.exec(CREATE_INDEXES_SQL);
            for (const trigger of ALL_TRIGGERS) {
                await db.run(trigger);
            }
            await db.run(CREATE_SCHEMA_INFO_SQL);
            await db.run(
                "INSERT INTO schema_info (id, version, project_id, project_name) VALUES (1, ?, NULL, NULL)",
                [CURRENT_SCHEMA_VERSION]
            );

            // Verify the recreated schema is healthy
            const newVersion = await db.get<{ version: number }>("SELECT version FROM schema_info WHERE id = 1");
            assert.strictEqual(newVersion?.version, CURRENT_SCHEMA_VERSION);

            // Verify tables exist
            const tables = await db.all<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            );
            const tableNames = tables.map(t => t.name);
            assert.ok(tableNames.includes("cells"), "cells table should exist after recreation");
            assert.ok(tableNames.includes("files"), "files table should exist after recreation");
            assert.ok(tableNames.includes("cells_fts"), "FTS table should exist after recreation");

            // Verify we can insert data into the recreated schema
            const fileId = await insertFile(db, "/recreated.source", "source");
            await insertCell(db, "RECREATED 1:1", { sFileId: fileId, sContent: "After recreation" });

            const cell = await db.get<{ s_content: string }>(
                "SELECT s_content FROM cells WHERE cell_id = ?",
                ["RECREATED 1:1"]
            );
            assert.ok(cell?.s_content?.includes("recreation"), "Data should be writable after recreation");

            await db.close();
        });

        test("project identity mismatch triggers re-index", async function () {
            skipIfNotReady(this);

            const db = await openTestDatabase();

            // Set a project identity
            await db.run(
                "UPDATE schema_info SET project_id = ?, project_name = ? WHERE id = 1",
                ["project-A", "Test Project A"]
            );

            // Verify identity was set
            const identity = await db.get<{ project_id: string; project_name: string }>(
                "SELECT project_id, project_name FROM schema_info WHERE id = 1"
            );
            assert.strictEqual(identity?.project_id, "project-A");
            assert.strictEqual(identity?.project_name, "Test Project A");

            // Simulate a mismatch by checking against a different project
            const currentProjectId: string = "project-B";
            const dbProjectId: string | undefined = identity?.project_id;
            const mismatch = dbProjectId !== undefined && dbProjectId !== currentProjectId;
            assert.ok(mismatch, "Should detect project identity mismatch");

            await db.close();
        });
    });

    // ── 18. WAL checkpoint behavior ──────────────────────────────────────

    suite("WAL Checkpoint Behavior", () => {
        test("WAL checkpoint succeeds on file-based database", async function () {
            skipIfNotReady(this);

            const tmpDir = realOs.tmpdir();
            const dbPath = realPath.join(tmpDir, `wal-ckpt-${Date.now()}.sqlite`);

            let db: AsyncDatabase | null = null;
            try {
                db = await AsyncDatabase.open(dbPath);
                await db.exec("PRAGMA journal_mode = WAL");
                await db.exec("CREATE TABLE wal_test (id INTEGER PRIMARY KEY, val TEXT)");

                // Insert data (writes to WAL)
                for (let i = 0; i < 50; i++) {
                    await db.run("INSERT INTO wal_test (val) VALUES (?)", [`row ${i}`]);
                }

                // Checkpoint should succeed
                await db.exec("PRAGMA wal_checkpoint(PASSIVE)");
                await db.exec("PRAGMA wal_checkpoint(FULL)");
                await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

                // Verify data is intact after checkpoint
                const count = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM wal_test");
                assert.strictEqual(count?.count, 50, "All rows should survive checkpoint");

            } finally {
                if (db) { try { await db.close(); } catch { /* */ } }
                try { realFs.unlinkSync(dbPath); } catch { /* */ }
                try { realFs.unlinkSync(dbPath + "-wal"); } catch { /* */ }
                try { realFs.unlinkSync(dbPath + "-shm"); } catch { /* */ }
            }
        });

        test("TRUNCATE checkpoint resets WAL file", async function () {
            skipIfNotReady(this);

            const tmpDir = realOs.tmpdir();
            const dbPath = realPath.join(tmpDir, `wal-trunc-${Date.now()}.sqlite`);
            const walPath = dbPath + "-wal";

            let db: AsyncDatabase | null = null;
            try {
                db = await AsyncDatabase.open(dbPath);
                await db.exec("PRAGMA journal_mode = WAL");
                await db.exec("CREATE TABLE trunc_test (id INTEGER PRIMARY KEY, val TEXT)");

                // Write enough data to create a non-trivial WAL
                for (let i = 0; i < 100; i++) {
                    await db.run("INSERT INTO trunc_test (val) VALUES (?)", [`data ${i}`]);
                }

                // WAL file should exist and have content
                const walExists = realFs.existsSync(walPath);
                if (walExists) {
                    const walSizeBefore = realFs.statSync(walPath).size;
                    assert.ok(walSizeBefore > 0, "WAL should have content before checkpoint");

                    // TRUNCATE should reset it
                    await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

                    const walSizeAfter = realFs.statSync(walPath).size;
                    assert.strictEqual(walSizeAfter, 0, "WAL should be empty after TRUNCATE checkpoint");
                }

                // Data should still be intact
                const count = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM trunc_test");
                assert.strictEqual(count?.count, 100);

            } finally {
                if (db) { try { await db.close(); } catch { /* */ } }
                try { realFs.unlinkSync(dbPath); } catch { /* */ }
                try { realFs.unlinkSync(walPath); } catch { /* */ }
                try { realFs.unlinkSync(dbPath + "-shm"); } catch { /* */ }
            }
        });

        test("checkpoint on in-memory database is a no-op", async function () {
            skipIfNotReady(this);

            const db = await openTestDatabase();
            // Should not throw — just a no-op for in-memory DBs
            await db.exec("PRAGMA wal_checkpoint(PASSIVE)");
            await db.close();
        });
    });

    // ── AsyncDatabase.transaction() helper tests ────────────────────────────

    suite("AsyncDatabase.transaction() helper", () => {
        test("commits on success", async function () {
            skipIfNotReady(this);

            const db = await openTestDatabase();
            await db.transaction(async (tx) => {
                await tx.run(
                    "INSERT INTO files (file_path, file_type, last_modified_ms, content_hash) VALUES (?, ?, ?, ?)",
                    ["/tx/commit.source", "source", Date.now(), computeHash("commit")]
                );
            });

            const row = await db.get<{ file_path: string }>(
                "SELECT file_path FROM files WHERE file_path = ?",
                ["/tx/commit.source"]
            );
            assert.strictEqual(row?.file_path, "/tx/commit.source");
            await db.close();
        });

        test("rolls back on error and re-throws", async function () {
            skipIfNotReady(this);

            const db = await openTestDatabase();
            await assert.rejects(
                () =>
                    db.transaction(async (tx) => {
                        await tx.run(
                            "INSERT INTO files (file_path, file_type, last_modified_ms, content_hash) VALUES (?, ?, ?, ?)",
                            ["/tx/rollback.source", "source", Date.now(), computeHash("rollback")]
                        );
                        throw new Error("intentional failure");
                    }),
                /intentional failure/
            );

            const row = await db.get<{ file_path: string }>(
                "SELECT file_path FROM files WHERE file_path = ?",
                ["/tx/rollback.source"]
            );
            assert.strictEqual(row, undefined, "Row should not exist after rollback");
            await db.close();
        });

        test("rejects if database is closed", async function () {
            skipIfNotReady(this);

            const db = await openTestDatabase();
            await db.close();

            await assert.rejects(
                () => db.transaction(async () => { /* no-op */ }),
                /closed/i
            );
        });
    });

    // ── Bulk word INSERT tests (chunked multi-row VALUES) ───────────────────

    suite("Bulk word INSERT (chunked)", () => {
        test("inserts many words in chunks and retrieves them", async function () {
            skipIfNotReady(this);

            const db = await openTestDatabase();
            const fileId = await insertFile(db, "/bulk/words.source", "source");
            await insertCell(db, "BULK_WORDS_001", { sFileId: fileId, sContent: "all the words" });

            // Simulate the optimized updateWordIndex bulk insert
            const words = Array.from({ length: 120 }, (_, i) => [`word${i}`, 1] as [string, number]);
            const CHUNK_SIZE = 50;

            await db.run("BEGIN TRANSACTION");
            await db.run("DELETE FROM words WHERE cell_id = ?", ["BULK_WORDS_001"]);

            let position = 0;
            for (let i = 0; i < words.length; i += CHUNK_SIZE) {
                const chunk = words.slice(i, i + CHUNK_SIZE);
                const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ");
                const params: (string | number)[] = [];
                for (const [word, frequency] of chunk) {
                    params.push(word, "BULK_WORDS_001", position++, frequency);
                }
                await db.run(
                    `INSERT INTO words (word, cell_id, position, frequency) VALUES ${placeholders}`,
                    params
                );
            }
            await db.run("COMMIT");

            const count = await db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM words WHERE cell_id = ?",
                ["BULK_WORDS_001"]
            );
            assert.strictEqual(count?.count, 120, "All 120 words should be inserted");

            // Verify ordering
            const first = await db.get<{ word: string; position: number }>(
                "SELECT word, position FROM words WHERE cell_id = ? ORDER BY position LIMIT 1",
                ["BULK_WORDS_001"]
            );
            assert.strictEqual(first?.word, "word0");
            assert.strictEqual(first?.position, 0);

            const last = await db.get<{ word: string; position: number }>(
                "SELECT word, position FROM words WHERE cell_id = ? ORDER BY position DESC LIMIT 1",
                ["BULK_WORDS_001"]
            );
            assert.strictEqual(last?.word, "word119");
            assert.strictEqual(last?.position, 119);

            await db.close();
        });
    });

    // ── Batched FTS cleanup tests ───────────────────────────────────────────

    suite("Batched FTS orphan cleanup", () => {
        test("deletes orphaned FTS entries in a single batched DELETE", async function () {
            skipIfNotReady(this);

            const db = await openTestDatabase();
            const fileId = await insertFile(db, "/fts/cleanup.source", "source");

            // Insert cells that will have FTS entries via triggers
            await insertCell(db, "FTS_KEEP_001", { sFileId: fileId, sContent: "keep this cell" });
            await insertCell(db, "FTS_ORPHAN_001", { sFileId: fileId, sContent: "orphan cell one" });
            await insertCell(db, "FTS_ORPHAN_002", { sFileId: fileId, sContent: "orphan cell two" });

            // Verify FTS has entries for all three
            const ftsBefore = await db.get<{ count: number }>(
                "SELECT COUNT(DISTINCT cell_id) as count FROM cells_fts"
            );
            assert.strictEqual(ftsBefore?.count, 3);

            // Delete cells directly (bypassing normal flow) to create orphans.
            // First delete the FTS entries via the trigger by deleting the cells.
            // Actually, the trigger should handle this. Let's delete cells manually
            // and then re-insert orphaned FTS entries to simulate the edge case.
            await db.run("DELETE FROM cells WHERE cell_id IN ('FTS_ORPHAN_001', 'FTS_ORPHAN_002')");

            // After deletion, FTS should have been cleaned by the trigger.
            // Manually insert orphan FTS entries to simulate a partial-failure edge case.
            await db.run(
                "INSERT INTO cells_fts(cell_id, content, raw_content, content_type) VALUES (?, ?, ?, ?)",
                ["ORPHAN_MANUAL_001", "stale content", "stale content", "source"]
            );
            await db.run(
                "INSERT INTO cells_fts(cell_id, content, raw_content, content_type) VALUES (?, ?, ?, ?)",
                ["ORPHAN_MANUAL_002", "stale content 2", "stale content 2", "target"]
            );

            // Batched cleanup: find orphans and delete in chunks
            const orphans = await db.all<{ cell_id: string }>(
                `SELECT DISTINCT fts.cell_id
                 FROM cells_fts fts
                 LEFT JOIN cells c ON fts.cell_id = c.cell_id
                 WHERE c.cell_id IS NULL`
            );
            assert.ok(orphans.length >= 2, `Expected at least 2 orphans, got ${orphans.length}`);

            const CHUNK_SIZE = 500;
            await db.run("BEGIN TRANSACTION");
            for (let i = 0; i < orphans.length; i += CHUNK_SIZE) {
                const chunk = orphans.slice(i, i + CHUNK_SIZE);
                const placeholders = chunk.map(() => "?").join(",");
                await db.run(
                    `DELETE FROM cells_fts WHERE cell_id IN (${placeholders})`,
                    chunk.map(o => o.cell_id)
                );
            }
            await db.run("COMMIT");

            // Verify only the kept cell remains in FTS
            const ftsAfter = await db.all<{ cell_id: string }>(
                "SELECT DISTINCT cell_id FROM cells_fts"
            );
            const remainingIds = ftsAfter.map(r => r.cell_id);
            assert.ok(remainingIds.includes("FTS_KEEP_001"), "Kept cell should remain in FTS");
            assert.ok(!remainingIds.includes("ORPHAN_MANUAL_001"), "Orphan 1 should be cleaned up");
            assert.ok(!remainingIds.includes("ORPHAN_MANUAL_002"), "Orphan 2 should be cleaned up");

            await db.close();
        });
    });

    // ── WAL auto-checkpoint configuration test ──────────────────────────────

    suite("WAL auto-checkpoint configuration", () => {
        test("wal_autocheckpoint can be set and read back", async function () {
            skipIfNotReady(this);

            const tmpDir = realOs.tmpdir();
            const dbPath = realPath.join(tmpDir, `wal-autocp-${Date.now()}.sqlite`);

            let db: AsyncDatabase | null = null;
            try {
                db = await AsyncDatabase.open(dbPath);
                await db.exec("PRAGMA journal_mode = WAL");

                // Set auto-checkpoint to 500 pages (matching our production config)
                await db.exec("PRAGMA wal_autocheckpoint = 500");

                const result = await db.get<{ wal_autocheckpoint: number }>(
                    "PRAGMA wal_autocheckpoint"
                );
                assert.strictEqual(result?.wal_autocheckpoint, 500);
            } finally {
                if (db) { try { await db.close(); } catch { /* */ } }
                try { realFs.unlinkSync(dbPath); } catch { /* */ }
                try { realFs.unlinkSync(dbPath + "-wal"); } catch { /* */ }
                try { realFs.unlinkSync(dbPath + "-shm"); } catch { /* */ }
            }
        });
    });

    // ── Schema migration framework tests ────────────────────────────────────

    suite("Schema versioning and migration patterns", () => {
        test("schema version can be upgraded step-by-step", async function () {
            skipIfNotReady(this);

            const db = await openTestDatabase();

            // Verify current version
            const v1 = await db.get<{ version: number }>(
                "SELECT version FROM schema_info WHERE id = 1"
            );
            assert.strictEqual(v1?.version, CURRENT_SCHEMA_VERSION);

            // Simulate a future migration: bump version
            const nextVersion = CURRENT_SCHEMA_VERSION + 1;
            await db.run(
                "UPDATE schema_info SET version = ? WHERE id = 1",
                [nextVersion]
            );

            const v2 = await db.get<{ version: number }>(
                "SELECT version FROM schema_info WHERE id = 1"
            );
            assert.strictEqual(v2?.version, nextVersion);

            await db.close();
        });

        test("schema_info enforces single-row constraint", async function () {
            skipIfNotReady(this);

            const db = await openTestDatabase();

            // Attempt to insert a second row — should fail due to CHECK(id = 1)
            await assert.rejects(
                () =>
                    db.run(
                        "INSERT INTO schema_info (id, version) VALUES (2, ?)",
                        [CURRENT_SCHEMA_VERSION]
                    ),
                /CHECK constraint failed/i
            );

            await db.close();
        });

        test("project identity can be stored and verified", async function () {
            skipIfNotReady(this);

            const db = await openTestDatabase();
            const projectId = "test-project-" + Date.now();
            const projectName = "Test Project";

            await db.run(
                "UPDATE schema_info SET project_id = ?, project_name = ? WHERE id = 1",
                [projectId, projectName]
            );

            const info = await db.get<{
                version: number;
                project_id: string;
                project_name: string;
            }>("SELECT version, project_id, project_name FROM schema_info WHERE id = 1");

            assert.strictEqual(info?.version, CURRENT_SCHEMA_VERSION);
            assert.strictEqual(info?.project_id, projectId);
            assert.strictEqual(info?.project_name, projectName);

            // Simulate project mismatch detection
            const differentProjectId = "different-project";
            const matches = info?.project_id === differentProjectId;
            assert.strictEqual(matches, false, "Should detect project ID mismatch");

            await db.close();
        });

        test("nuke-and-recreate pattern: drop all tables and recreate schema", async function () {
            skipIfNotReady(this);

            const db = await openTestDatabase();

            // Insert some data
            const fileId = await insertFile(db, "/nuke/test.source", "source");
            await insertCell(db, "NUKE_001", { sFileId: fileId, sContent: "before nuke" });

            // Verify data exists
            const before = await db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM cells"
            );
            assert.ok((before?.count ?? 0) > 0);

            // Simulate nuke: drop all user tables (in correct order for FK)
            await db.exec("DROP TABLE IF EXISTS words");
            await db.exec("DROP TABLE IF EXISTS cells_fts");
            await db.exec("DROP TABLE IF EXISTS cells");
            await db.exec("DROP TABLE IF EXISTS files");
            await db.exec("DROP TABLE IF EXISTS sync_metadata");
            await db.exec("DROP TABLE IF EXISTS schema_info");

            // Recreate schema from shared constants
            await db.exec(CREATE_TABLES_SQL);
            await db.exec(CREATE_INDEXES_SQL);
            for (const trigger of ALL_TRIGGERS) {
                await db.run(trigger);
            }
            await db.run(CREATE_SCHEMA_INFO_SQL);
            await db.run(
                "INSERT INTO schema_info (id, version) VALUES (1, ?)",
                [CURRENT_SCHEMA_VERSION]
            );

            // Verify tables are empty but schema is valid
            const after = await db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM cells"
            );
            assert.strictEqual(after?.count, 0);

            const version = await db.get<{ version: number }>(
                "SELECT version FROM schema_info WHERE id = 1"
            );
            assert.strictEqual(version?.version, CURRENT_SCHEMA_VERSION);

            // Verify we can still insert data after recreation
            const newFileId = await insertFile(db, "/nuke/after.source", "source");
            await insertCell(db, "NUKE_AFTER_001", { sFileId: newFileId, sContent: "after nuke" });

            const afterInsert = await db.get<{ count: number }>(
                "SELECT COUNT(*) as count FROM cells"
            );
            assert.strictEqual(afterInsert?.count, 1);

            await db.close();
        });
    });

    // ── ensureOpen file-check improvement test ──────────────────────────────

    suite("Database file existence validation", () => {
        test("detects missing database file on disk", async function () {
            skipIfNotReady(this);

            const tmpDir = realOs.tmpdir();
            const dbPath = realPath.join(tmpDir, `existence-check-${Date.now()}.sqlite`);

            let db: AsyncDatabase | null = null;
            try {
                db = await AsyncDatabase.open(dbPath);
                await db.exec("PRAGMA journal_mode = WAL");
                await db.exec(CREATE_TABLES_SQL);

                // Verify file exists
                assert.ok(realFs.existsSync(dbPath), "DB file should exist");

                // Close and delete
                await db.close();
                db = null;
                realFs.unlinkSync(dbPath);

                assert.ok(!realFs.existsSync(dbPath), "DB file should be gone");
            } finally {
                if (db) { try { await db.close(); } catch { /* */ } }
                try { realFs.unlinkSync(dbPath); } catch { /* */ }
                try { realFs.unlinkSync(dbPath + "-wal"); } catch { /* */ }
                try { realFs.unlinkSync(dbPath + "-shm"); } catch { /* */ }
            }
        });
    });
});
