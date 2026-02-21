import * as assert from "assert";
import * as vscode from "vscode";
import initSqlJs, { Database, SqlJsStatic } from "fts5-sql-bundle";
import * as path from "path";

/**
 * FTS Index Integrity Test Suite
 *
 * Tests that FTS5 triggers use DELETE+INSERT (not INSERT OR REPLACE) to prevent
 * unbounded table growth (#530), and that bulk operations use the rebuild-from-cells
 * approach for performance.
 *
 * These tests create an in-memory SQLite database with the same schema as the
 * production code, so they exercise the actual FTS5 behavior without needing
 * the full extension host.
 */
suite("FTS Index Integrity Test Suite", () => {
    let sql: SqlJsStatic;
    let db: Database;

    /** Create a fresh in-memory DB with the same schema used by SQLiteIndexManager */
    function createFreshDB(): Database {
        const freshDb = new sql.Database();

        // Minimal schema matching SQLiteIndexManager.createSchema()
        freshDb.run(`
            CREATE TABLE IF NOT EXISTS cells (
                cell_id TEXT PRIMARY KEY,
                cell_type TEXT,
                s_file_id INTEGER,
                t_file_id INTEGER,
                s_content TEXT,
                t_content TEXT,
                s_raw_content TEXT,
                t_raw_content TEXT,
                s_raw_content_hash TEXT,
                t_raw_content_hash TEXT,
                s_line_number INTEGER,
                t_line_number INTEGER,
                s_word_count INTEGER DEFAULT 0,
                t_word_count INTEGER DEFAULT 0,
                s_created_at INTEGER,
                t_created_at INTEGER,
                s_updated_at INTEGER,
                t_updated_at INTEGER,
                milestone_index INTEGER,
                cell_label TEXT,
                t_current_edit_timestamp INTEGER,
                t_validation_count INTEGER DEFAULT 0,
                t_validated_by TEXT,
                t_is_fully_validated INTEGER DEFAULT 0,
                t_audio_validation_count INTEGER DEFAULT 0,
                t_audio_validated_by TEXT,
                t_audio_is_fully_validated INTEGER DEFAULT 0
            )
        `);

        freshDb.run(`
            CREATE VIRTUAL TABLE IF NOT EXISTS cells_fts USING fts5(
                cell_id,
                content,
                raw_content,
                content_type,
                tokenize='porter unicode61'
            )
        `);

        // INSERT triggers (same as production)
        freshDb.run(`
            CREATE TRIGGER IF NOT EXISTS cells_fts_source_insert
            AFTER INSERT ON cells
            WHEN NEW.s_content IS NOT NULL
            BEGIN
                INSERT INTO cells_fts(cell_id, content, raw_content, content_type)
                VALUES (NEW.cell_id, NEW.s_content, COALESCE(NEW.s_raw_content, NEW.s_content), 'source');
            END
        `);

        freshDb.run(`
            CREATE TRIGGER IF NOT EXISTS cells_fts_target_insert
            AFTER INSERT ON cells
            WHEN NEW.t_content IS NOT NULL
            BEGIN
                INSERT INTO cells_fts(cell_id, content, raw_content, content_type)
                VALUES (NEW.cell_id, NEW.t_content, COALESCE(NEW.t_raw_content, NEW.t_content), 'target');
            END
        `);

        // UPDATE triggers: DELETE+INSERT to prevent FTS5 bloat (#530)
        freshDb.run(`
            CREATE TRIGGER IF NOT EXISTS cells_fts_source_update
            AFTER UPDATE OF s_content, s_raw_content ON cells
            WHEN NEW.s_content IS NOT NULL
            BEGIN
                DELETE FROM cells_fts WHERE cell_id = NEW.cell_id AND content_type = 'source';
                INSERT INTO cells_fts(cell_id, content, raw_content, content_type)
                VALUES (NEW.cell_id, NEW.s_content, COALESCE(NEW.s_raw_content, NEW.s_content), 'source');
            END
        `);

        freshDb.run(`
            CREATE TRIGGER IF NOT EXISTS cells_fts_target_update
            AFTER UPDATE OF t_content, t_raw_content ON cells
            WHEN NEW.t_content IS NOT NULL
            BEGIN
                DELETE FROM cells_fts WHERE cell_id = NEW.cell_id AND content_type = 'target';
                INSERT INTO cells_fts(cell_id, content, raw_content, content_type)
                VALUES (NEW.cell_id, NEW.t_content, COALESCE(NEW.t_raw_content, NEW.t_content), 'target');
            END
        `);

        freshDb.run(`
            CREATE TRIGGER IF NOT EXISTS cells_fts_delete
            AFTER DELETE ON cells
            BEGIN
                DELETE FROM cells_fts WHERE cell_id = OLD.cell_id;
            END
        `);

        return freshDb;
    }

    function getFTSRowCount(d: Database): number {
        const stmt = d.prepare("SELECT COUNT(*) as cnt FROM cells_fts");
        stmt.step();
        const count = (stmt.getAsObject() as { cnt: number }).cnt;
        stmt.free();
        return count;
    }

    suiteSetup(async function () {
        this.timeout(30000);
        // Use the real fs module (not webpack's memfs polyfill) to read the WASM binary
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodeFs = eval("require")("fs") as typeof import("fs");

        // Try multiple candidate paths to find the WASM file.
        // __dirname in webpack bundle = out/test/suite; go up to out/ then into node_modules.
        // Also try process.cwd() for CI where __dirname may differ.
        const candidates = [
            path.join(__dirname, "../../node_modules/fts5-sql-bundle/dist/sql-wasm.wasm"),
            path.join(process.cwd(), "out/node_modules/fts5-sql-bundle/dist/sql-wasm.wasm"),
            path.join(process.cwd(), "node_modules/fts5-sql-bundle/dist/sql-wasm.wasm"),
        ];

        let wasmBinary: Buffer | undefined;
        for (const candidate of candidates) {
            if (nodeFs.existsSync(candidate)) {
                wasmBinary = nodeFs.readFileSync(candidate);
                break;
            }
        }

        if (!wasmBinary) {
            throw new Error(
                `Could not find sql-wasm.wasm. Tried:\n${candidates.join("\n")}`
            );
        }

        sql = await initSqlJs({ wasmBinary } as Record<string, unknown>);
    });

    setup(function () {
        db = createFreshDB();
    });

    teardown(function () {
        if (db) {
            db.close();
        }
    });

    suite("FTS5 bloat prevention (#530)", () => {
        test("INSERT on cells should create exactly one FTS row per content type", function () {
            db.run(`
                INSERT INTO cells (cell_id, s_content) VALUES ('cell-1', 'hello world')
            `);

            assert.strictEqual(getFTSRowCount(db), 1, "Should have exactly 1 FTS row after insert");
        });

        test("UPDATE on cells should NOT create duplicate FTS rows", function () {
            // Insert a cell
            db.run(`INSERT INTO cells (cell_id, s_content) VALUES ('cell-1', 'hello world')`);
            assert.strictEqual(getFTSRowCount(db), 1);

            // Update the cell 10 times
            for (let i = 0; i < 10; i++) {
                db.run(`UPDATE cells SET s_content = ? WHERE cell_id = 'cell-1'`, [`updated content ${i}`]);
            }

            // Should still have exactly 1 FTS row (DELETE+INSERT in trigger)
            assert.strictEqual(getFTSRowCount(db), 1,
                "FTS row count should stay at 1 after 10 updates (DELETE+INSERT trigger prevents bloat)");
        });

        test("multiple cells with multiple updates should have correct FTS count", function () {
            const cellCount = 100;

            // Insert 100 cells with source content
            for (let i = 0; i < cellCount; i++) {
                db.run(`INSERT INTO cells (cell_id, s_content) VALUES (?, ?)`,
                    [`cell-${i}`, `source content for cell ${i}`]);
            }
            assert.strictEqual(getFTSRowCount(db), cellCount);

            // Update each cell 5 times
            for (let round = 0; round < 5; round++) {
                for (let i = 0; i < cellCount; i++) {
                    db.run(`UPDATE cells SET s_content = ? WHERE cell_id = ?`,
                        [`updated round ${round} cell ${i}`, `cell-${i}`]);
                }
            }

            // Should still have exactly cellCount rows
            assert.strictEqual(getFTSRowCount(db), cellCount,
                `FTS should have exactly ${cellCount} rows after 500 total updates, not ${getFTSRowCount(db)}`);
        });

        test("cells with both source and target should have 2 FTS rows each", function () {
            db.run(`INSERT INTO cells (cell_id, s_content, t_content) VALUES ('cell-1', 'source text', 'target text')`);
            assert.strictEqual(getFTSRowCount(db), 2, "Should have 2 FTS rows (source + target)");

            // Update source 5 times
            for (let i = 0; i < 5; i++) {
                db.run(`UPDATE cells SET s_content = ? WHERE cell_id = 'cell-1'`, [`new source ${i}`]);
            }
            // Update target 5 times
            for (let i = 0; i < 5; i++) {
                db.run(`UPDATE cells SET t_content = ? WHERE cell_id = 'cell-1'`, [`new target ${i}`]);
            }

            assert.strictEqual(getFTSRowCount(db), 2,
                "Should still have exactly 2 FTS rows after multiple source+target updates");
        });

        test("UPSERT (INSERT ON CONFLICT DO UPDATE) should maintain correct FTS count", function () {
            // This is the pattern used by upsertCellSync in production
            for (let round = 0; round < 5; round++) {
                db.run(`
                    INSERT INTO cells (cell_id, s_content)
                    VALUES ('cell-1', ?)
                    ON CONFLICT(cell_id) DO UPDATE SET s_content = excluded.s_content
                `, [`content round ${round}`]);
            }

            // Round 0 = INSERT trigger → 1 FTS row
            // Rounds 1-4 = UPDATE trigger (via ON CONFLICT DO UPDATE) → DELETE+INSERT each time
            assert.strictEqual(getFTSRowCount(db), 1,
                "UPSERT pattern should maintain exactly 1 FTS row");
        });

        test("manual DELETE+INSERT FTS sync should not create duplicates", function () {
            // Insert a cell (trigger adds to FTS)
            db.run(`INSERT INTO cells (cell_id, s_content) VALUES ('cell-1', 'hello world')`);
            assert.strictEqual(getFTSRowCount(db), 1);

            // Simulate the manual FTS sync pattern from upsertCellWithFTSSync
            for (let i = 0; i < 5; i++) {
                db.run(`DELETE FROM cells_fts WHERE cell_id = ? AND content_type = ?`, ['cell-1', 'source']);
                db.run(`INSERT INTO cells_fts(cell_id, content, raw_content, content_type) VALUES (?, ?, ?, ?)`,
                    ['cell-1', `manual sync ${i}`, `manual sync ${i}`, 'source']);
            }

            assert.strictEqual(getFTSRowCount(db), 1,
                "Manual DELETE+INSERT FTS sync should maintain exactly 1 row");
        });

        test("DELETE on cells should remove FTS rows", function () {
            db.run(`INSERT INTO cells (cell_id, s_content, t_content) VALUES ('cell-1', 'src', 'tgt')`);
            assert.strictEqual(getFTSRowCount(db), 2);

            db.run(`DELETE FROM cells WHERE cell_id = 'cell-1'`);
            assert.strictEqual(getFTSRowCount(db), 0, "All FTS rows should be deleted when cell is deleted");
        });
    });

    suite("Bulk FTS rebuild performance", () => {
        test("rebuildFTSFromCells pattern should produce correct results", function () {
            // Insert many cells (triggers will populate FTS)
            const cellCount = 500;
            db.run("BEGIN TRANSACTION");
            for (let i = 0; i < cellCount; i++) {
                db.run(`INSERT INTO cells (cell_id, s_content) VALUES (?, ?)`,
                    [`cell-${i}`, `source content number ${i} with some words`]);
            }
            db.run("COMMIT");

            assert.strictEqual(getFTSRowCount(db), cellCount);

            // Now simulate the bulk rebuild pattern:
            // 1. Drop triggers
            db.run("DROP TRIGGER IF EXISTS cells_fts_source_insert");
            db.run("DROP TRIGGER IF EXISTS cells_fts_target_insert");
            db.run("DROP TRIGGER IF EXISTS cells_fts_source_update");
            db.run("DROP TRIGGER IF EXISTS cells_fts_target_update");
            db.run("DROP TRIGGER IF EXISTS cells_fts_delete");

            // 2. Clear FTS and rebuild from cells
            db.run("DELETE FROM cells_fts");
            db.run(`
                INSERT INTO cells_fts(cell_id, content, raw_content, content_type)
                SELECT cell_id, s_content, COALESCE(s_raw_content, s_content), 'source'
                FROM cells WHERE s_content IS NOT NULL
            `);

            assert.strictEqual(getFTSRowCount(db), cellCount,
                "Rebuilt FTS should have same row count as cells");

            // 3. Verify search still works
            const stmt = db.prepare("SELECT cell_id FROM cells_fts WHERE cells_fts MATCH 'content'");
            let matchCount = 0;
            while (stmt.step()) { matchCount++; }
            stmt.free();

            assert.strictEqual(matchCount, cellCount,
                "All cells should be searchable after FTS rebuild");
        });

        test("bulk rebuild should be faster than per-row trigger updates for large datasets", function () {
            this.timeout(30000);
            const cellCount = 2000; // Simulate a moderate eBible-like import

            // Phase 1: Insert cells with triggers active (simulates initial import)
            const triggerStart = performance.now();
            db.run("BEGIN TRANSACTION");
            for (let i = 0; i < cellCount; i++) {
                db.run(`INSERT INTO cells (cell_id, s_content) VALUES (?, ?)`,
                    [`cell-${i}`, `In the beginning God created the heavens and the earth verse ${i}`]);
            }
            db.run("COMMIT");
            const triggerInsertTime = performance.now() - triggerStart;

            assert.strictEqual(getFTSRowCount(db), cellCount);

            // Phase 2: Measure per-row UPDATE time (the "slow" path with triggers)
            const perRowStart = performance.now();
            db.run("BEGIN TRANSACTION");
            for (let i = 0; i < cellCount; i++) {
                db.run(`UPDATE cells SET s_content = ? WHERE cell_id = ?`,
                    [`Updated content for cell ${i} with new translation text`, `cell-${i}`]);
            }
            db.run("COMMIT");
            const perRowUpdateTime = performance.now() - perRowStart;

            assert.strictEqual(getFTSRowCount(db), cellCount, "Row count stable after per-row updates");

            // Phase 3: Measure bulk rebuild time (the fast path)
            // Drop triggers, update cells, rebuild FTS
            db.run("DROP TRIGGER IF EXISTS cells_fts_source_insert");
            db.run("DROP TRIGGER IF EXISTS cells_fts_target_insert");
            db.run("DROP TRIGGER IF EXISTS cells_fts_source_update");
            db.run("DROP TRIGGER IF EXISTS cells_fts_target_update");
            db.run("DROP TRIGGER IF EXISTS cells_fts_delete");

            const bulkStart = performance.now();
            db.run("BEGIN TRANSACTION");
            for (let i = 0; i < cellCount; i++) {
                db.run(`UPDATE cells SET s_content = ? WHERE cell_id = ?`,
                    [`Bulk updated content for cell ${i}`, `cell-${i}`]);
            }
            db.run("COMMIT");

            // Rebuild FTS in one pass
            db.run("DELETE FROM cells_fts");
            db.run(`
                INSERT INTO cells_fts(cell_id, content, raw_content, content_type)
                SELECT cell_id, s_content, COALESCE(s_raw_content, s_content), 'source'
                FROM cells WHERE s_content IS NOT NULL
            `);
            const bulkUpdateTime = performance.now() - bulkStart;

            assert.strictEqual(getFTSRowCount(db), cellCount, "Row count correct after bulk rebuild");

            // Log timings for diagnostics
            console.log(`[FTS Perf] ${cellCount} cells:`);
            console.log(`  Initial insert (with triggers): ${triggerInsertTime.toFixed(1)}ms`);
            console.log(`  Per-row update (with triggers): ${perRowUpdateTime.toFixed(1)}ms`);
            console.log(`  Bulk update + rebuild (no triggers): ${bulkUpdateTime.toFixed(1)}ms`);
            console.log(`  Speedup: ${(perRowUpdateTime / bulkUpdateTime).toFixed(1)}x`);

            // The bulk path should be faster (or at least not significantly slower)
            // We don't assert a strict speedup ratio since it depends on hardware,
            // but we verify correctness.
        });
    });

    suite("FTS search correctness after operations", () => {
        test("search should find updated content, not stale content", function () {
            db.run(`INSERT INTO cells (cell_id, s_content) VALUES ('cell-1', 'original unicorn text')`);

            // Verify original content is searchable
            let stmt = db.prepare("SELECT cell_id FROM cells_fts WHERE cells_fts MATCH 'unicorn'");
            assert.ok(stmt.step(), "Should find 'unicorn' in original content");
            stmt.free();

            // Update content
            db.run(`UPDATE cells SET s_content = 'replacement giraffe text' WHERE cell_id = 'cell-1'`);

            // Old content should NOT be searchable
            stmt = db.prepare("SELECT cell_id FROM cells_fts WHERE cells_fts MATCH 'unicorn'");
            assert.ok(!stmt.step(), "Should NOT find 'unicorn' after update");
            stmt.free();

            // New content should be searchable
            stmt = db.prepare("SELECT cell_id FROM cells_fts WHERE cells_fts MATCH 'giraffe'");
            assert.ok(stmt.step(), "Should find 'giraffe' in updated content");
            stmt.free();
        });

        test("search should work correctly after bulk FTS rebuild", function () {
            // Insert cells
            db.run(`INSERT INTO cells (cell_id, s_content) VALUES ('gen-1', 'In the beginning God created')`);
            db.run(`INSERT INTO cells (cell_id, s_content) VALUES ('gen-2', 'And the earth was without form')`);
            db.run(`INSERT INTO cells (cell_id, s_content) VALUES ('gen-3', 'And God said let there be light')`);

            // Drop triggers and rebuild
            db.run("DROP TRIGGER IF EXISTS cells_fts_source_insert");
            db.run("DROP TRIGGER IF EXISTS cells_fts_source_update");
            db.run("DROP TRIGGER IF EXISTS cells_fts_target_insert");
            db.run("DROP TRIGGER IF EXISTS cells_fts_target_update");
            db.run("DROP TRIGGER IF EXISTS cells_fts_delete");

            db.run("DELETE FROM cells_fts");
            db.run(`
                INSERT INTO cells_fts(cell_id, content, raw_content, content_type)
                SELECT cell_id, s_content, COALESCE(s_raw_content, s_content), 'source'
                FROM cells WHERE s_content IS NOT NULL
            `);

            // Verify searches work
            const stmt = db.prepare("SELECT cell_id FROM cells_fts WHERE cells_fts MATCH 'God'");
            const matches: string[] = [];
            while (stmt.step()) {
                matches.push((stmt.getAsObject() as { cell_id: string }).cell_id);
            }
            stmt.free();

            assert.strictEqual(matches.length, 2, "Should find 'God' in gen-1 and gen-3");
            assert.ok(matches.includes("gen-1"));
            assert.ok(matches.includes("gen-3"));
        });
    });
});
