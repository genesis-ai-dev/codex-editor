import * as vscode from "vscode";
import { Database } from "sql.js-fts5";
import { getWorkSpaceUri } from "../utils";
import { FileData } from "../activationHelpers/contextAware/miniIndex/indexes/fileReaders";
import { TranslationPair } from "../../types";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";

// Path for the SQLite database
const translationDbPath = [".project", "translation_pairs.sqlite"];

// Initialize the database
export async function initializeTranslationPairsDb(db: Database): Promise<void> {
    console.time("initializeTranslationPairsDb");
    
    // First, migrate existing databases if needed
    await migrateFTS5Tables(db);
    
    // Create tables if they don't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS translation_pairs (
            id TEXT PRIMARY KEY,
            cell_id TEXT NOT NULL,
            document TEXT NOT NULL,
            section TEXT NOT NULL,
            cell TEXT NOT NULL,
            source_content TEXT,
            target_content TEXT,
            uri TEXT,
            line INTEGER,
            notebook_id TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_translation_pairs_cell_id ON translation_pairs(cell_id);
        CREATE INDEX IF NOT EXISTS idx_translation_pairs_document ON translation_pairs(document);
        CREATE INDEX IF NOT EXISTS idx_translation_pairs_document_section ON translation_pairs(document, section);
    `);
    
    // Always recreate FTS5 table and triggers to ensure compatibility
    db.exec(`
        DROP TABLE IF EXISTS translation_pairs_fts;
        DROP TRIGGER IF EXISTS translation_pairs_ai;
        DROP TRIGGER IF EXISTS translation_pairs_ad;  
        DROP TRIGGER IF EXISTS translation_pairs_au;
    `);
    
    // Create standalone FTS5 virtual table (not external content)
    db.exec(`
        CREATE VIRTUAL TABLE translation_pairs_fts USING fts5(
            id UNINDEXED,
            cell_id UNINDEXED,
            document UNINDEXED,
            section UNINDEXED,
            cell UNINDEXED,
            source_content,
            target_content,
            uri UNINDEXED,
            line UNINDEXED,
            notebook_id UNINDEXED
        );
    `);
    
    // Create new triggers for standalone FTS5 table
    db.exec(`
        CREATE TRIGGER translation_pairs_ai AFTER INSERT ON translation_pairs BEGIN
            INSERT INTO translation_pairs_fts(id, cell_id, document, section, cell, source_content, target_content, uri, line, notebook_id) 
            VALUES (new.id, new.cell_id, new.document, new.section, new.cell, new.source_content, new.target_content, new.uri, new.line, new.notebook_id);
        END;
        
        CREATE TRIGGER translation_pairs_ad AFTER DELETE ON translation_pairs BEGIN
            DELETE FROM translation_pairs_fts WHERE id = old.id;
        END;
        
        CREATE TRIGGER translation_pairs_au AFTER UPDATE ON translation_pairs BEGIN
            DELETE FROM translation_pairs_fts WHERE id = old.id;
            INSERT INTO translation_pairs_fts(id, cell_id, document, section, cell, source_content, target_content, uri, line, notebook_id) 
            VALUES (new.id, new.cell_id, new.document, new.section, new.cell, new.source_content, new.target_content, new.uri, new.line, new.notebook_id);
        END;
    `);
    
    // Populate FTS5 table from existing data
    try {
        populateFTS5FromMainTable(db);
    } catch (error) {
        console.warn("Failed to populate FTS5 table during initialization:", error);
    }
    
    console.timeEnd("initializeTranslationPairsDb");
}

// Migration function to handle existing external content FTS5 tables
async function migrateFTS5Tables(db: Database): Promise<void> {
    try {
        // Check if old external content FTS5 table exists
        const checkStmt = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='translation_pairs_fts'
        `);
        
        let hasOldFTS = false;
        let needsRecreation = false;
        
        if (checkStmt.step()) {
            // Check if it's an external content table by looking for content= in the schema
            const schemaStmt = db.prepare(`
                SELECT sql FROM sqlite_master 
                WHERE type='table' AND name='translation_pairs_fts'
            `);
            
            if (schemaStmt.step()) {
                const schema = schemaStmt.getAsObject().sql as string;
                if (schema && (schema.includes("content=") || schema.includes("rowid UNINDEXED"))) {
                    hasOldFTS = true;
                    needsRecreation = true;
                    console.log("Detected problematic FTS5 table, recreating...");
                }
            }
            schemaStmt.free();
            
            // Also test if the table actually works by attempting a simple query
            if (!needsRecreation) {
                try {
                    const testStmt = db.prepare("SELECT COUNT(*) FROM translation_pairs_fts");
                    testStmt.step();
                    testStmt.free();
                } catch (testError) {
                    console.log("FTS5 table test failed, needs recreation:", testError);
                    needsRecreation = true;
                }
            }
        }
        checkStmt.free();
        
        if (hasOldFTS || needsRecreation) {
            // Remove old external content table and triggers
            db.exec(`
                DROP TABLE IF EXISTS translation_pairs_fts;
                DROP TRIGGER IF EXISTS translation_pairs_ai;
                DROP TRIGGER IF EXISTS translation_pairs_ad;
                DROP TRIGGER IF EXISTS translation_pairs_au;
            `);
            console.log("Migration completed: Old problematic FTS5 table removed");
        }
    } catch (error) {
        console.warn("Error during FTS5 migration:", error);
        // If migration fails, force drop everything to start fresh
        try {
            db.exec(`
                DROP TABLE IF EXISTS translation_pairs_fts;
                DROP TRIGGER IF EXISTS translation_pairs_ai;
                DROP TRIGGER IF EXISTS translation_pairs_ad;
                DROP TRIGGER IF EXISTS translation_pairs_au;
            `);
            console.log("Force dropped all FTS5 components for clean recreation");
        } catch (dropError) {
            console.warn("Error forcing drop of old tables:", dropError);
        }
    }
}

// Create and populate the translation pairs index
export async function createTranslationPairsIndex(
    db: Database,
    sourceFiles: FileData[],
    targetFiles: FileData[],
    metadataManager: NotebookMetadataManager,
    force: boolean = false
): Promise<void> {
    console.time("createTranslationPairsIndex");
    
    const workspaceFolder = getWorkSpaceUri();
    if (!workspaceFolder) {
        console.warn("Workspace folder not found for Translation Pairs Index.");
        return;
    }
    
    if (force) {
        // Clear existing data if forced
        db.exec("DELETE FROM translation_pairs");
        db.exec("DELETE FROM translation_pairs_fts");
    }
    
    // Begin a transaction for better performance with batch inserts
    db.exec("BEGIN TRANSACTION");
    
    try {
        const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO translation_pairs (
                id, cell_id, document, section, cell, source_content, target_content, uri, line, notebook_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        // Process files and insert data
        const targetCellsMap = new Map<string, { content: string; uri: string; notebookId: string }>();
        
        // First, build a map of all target cells
        for (const targetFile of targetFiles) {
            for (const cell of targetFile.cells) {
                if (
                    cell.metadata?.type === "text" &&
                    cell.metadata?.id &&
                    cell.value.trim() !== ""
                ) {
                    targetCellsMap.set(cell.metadata.id, {
                        content: cell.value,
                        uri: targetFile.uri.toString(),
                        notebookId: targetFile.id,
                    });
                }
            }
        }
        
        // Then process source cells and link to target cells
        let insertCount = 0;
        for (const sourceFile of sourceFiles) {
            for (const sourceCell of sourceFile.cells) {
                if (
                    sourceCell.metadata?.type === "text" &&
                    sourceCell.metadata?.id &&
                    sourceCell.value.trim() !== ""
                ) {
                    const cellId = sourceCell.metadata.id;
                    const targetCell = targetCellsMap.get(cellId);
                    
                    if (targetCell) {
                        const [document, sectionCell] = cellId.split(" ");
                        const [section, cell] = sectionCell.split(":");
                        const id = `${sourceFile.uri.toString()}:${-1}:${cellId}`;
                        
                        // Insert into database (triggers will handle FTS5)
                        insertStmt.bind([
                            id,
                            cellId,
                            document,
                            section,
                            cell,
                            sourceCell.value,
                            targetCell.content,
                            sourceFile.uri.toString(),
                            -1,
                            sourceFile.id
                        ]);
                        
                        insertStmt.step();
                        insertStmt.reset();
                        insertCount++;
                        
                        // Commit in batches to avoid large transactions
                        if (insertCount % 1000 === 0) {
                            db.exec("COMMIT");
                            db.exec("BEGIN TRANSACTION");
                        }
                    }
                }
            }
        }
        
        // Commit any remaining inserts
        db.exec("COMMIT");
        insertStmt.free();
        
        console.log(`Translation pairs index created with ${insertCount} entries`);
        
        // Verify FTS5 population
        const ftsCountStmt = db.prepare("SELECT COUNT(*) as count FROM translation_pairs_fts");
        ftsCountStmt.step();
        const ftsCount = ftsCountStmt.getAsObject().count as number;
        ftsCountStmt.free();
        
        console.log(`FTS5 table has ${ftsCount} entries`);
        
    } catch (error) {
        // Rollback on error
        db.exec("ROLLBACK");
        console.error("Error creating translation pairs index:", error);
        throw error;
    }
    
    console.timeEnd("createTranslationPairsIndex");
}

// Function to populate FTS5 from existing main table data
export function populateFTS5FromMainTable(db: Database): void {
    console.log("Populating FTS5 table from main table data...");
    
    try {
        // Clear existing FTS5 data
        db.exec("DELETE FROM translation_pairs_fts");
        
        // Insert all existing data into FTS5
        db.exec(`
            INSERT INTO translation_pairs_fts(id, cell_id, document, section, cell, source_content, target_content, uri, line, notebook_id)
            SELECT id, cell_id, document, section, cell, source_content, target_content, uri, line, notebook_id 
            FROM translation_pairs
        `);
        
        const countStmt = db.prepare("SELECT COUNT(*) as count FROM translation_pairs_fts");
        countStmt.step();
        const count = countStmt.getAsObject().count as number;
        countStmt.free();
        
        console.log(`FTS5 table populated with ${count} entries`);
    } catch (error) {
        console.error("Error populating FTS5 table:", error);
        throw error;
    }
}

// Search target cells by query (similar to searchTargetCellsByQuery)
export function searchTargetCellsByQuery(
    db: Database,
    query: string,
    limit: number = 5
): TranslationPair[] {
    // First check if the FTS5 table has any data
    const countStmt = db.prepare("SELECT COUNT(*) as count FROM translation_pairs_fts");
    countStmt.step();
    const ftsCount = countStmt.getAsObject().count as number;
    countStmt.free();
    
    if (ftsCount === 0) {
        console.warn("FTS5 table is empty, populating it...");
        try {
            populateFTS5FromMainTable(db);
        } catch (rebuildError) {
            console.error("Failed to populate FTS5 table:", rebuildError);
            // Fall back to non-FTS search immediately
            return searchTargetCellsByQueryFallback(db, query, limit);
        }
    }
    
    try {
        // Format query for FTS5 - handle empty query
        if (!query || query.trim() === '') {
            return [];
        }
        
        // Escape special characters and format for FTS5
        const cleanQuery = query.replace(/['"]/g, '').trim();
        const ftsQuery = cleanQuery.split(/\s+/).filter(term => term.length > 0).map(term => `"${term}"*`).join(" OR ");
        
        if (!ftsQuery) {
            return [];
        }
        
        // Step 1: Query FTS5 table directly to get matching IDs
        const ftsStmt = db.prepare(`
            SELECT id FROM translation_pairs_fts 
            WHERE target_content MATCH ? 
            ORDER BY bm25(translation_pairs_fts)
            LIMIT ?
        `);
        
        ftsStmt.bind([ftsQuery, limit]);
        
        const matchingIds: string[] = [];
        while (ftsStmt.step()) {
            const row = ftsStmt.getAsObject();
            matchingIds.push(row["id"] as string);
        }
        ftsStmt.free();
        
        if (matchingIds.length === 0) {
            return [];
        }
        
        // Step 2: Get full data from main table using the IDs
        const placeholders = matchingIds.map(() => '?').join(',');
        const mainStmt = db.prepare(`SELECT * FROM translation_pairs WHERE id IN (${placeholders})`);
        mainStmt.bind(matchingIds);
        
        const results: TranslationPair[] = [];
        while (mainStmt.step()) {
            const row = mainStmt.getAsObject();
            results.push(rowToTranslationPair(row));
        }
        
        mainStmt.free();
        return results;
        
    } catch (error) {
        console.error("Error in searchTargetCellsByQuery:", error);
        // Fallback to non-FTS search if FTS fails
        return searchTargetCellsByQueryFallback(db, query, limit);
    }
}

// Fallback search function for target cells
function searchTargetCellsByQueryFallback(
    db: Database,
    query: string,
    limit: number
): TranslationPair[] {
    const fallbackStmt = db.prepare(`
        SELECT * FROM translation_pairs 
        WHERE target_content LIKE ? 
        LIMIT ?
    `);
    
    try {
        fallbackStmt.bind([`%${query}%`, limit]);
        const results: TranslationPair[] = [];
        while (fallbackStmt.step()) {
            const row = fallbackStmt.getAsObject();
            results.push(rowToTranslationPair(row));
        }
        return results;
    } finally {
        fallbackStmt.free();
    }
}

// Get translation pair from project by cell ID
export function getTranslationPairFromProject(
    db: Database,
    cellId: string
): TranslationPair | null {
    const stmt = db.prepare(`
        SELECT * FROM translation_pairs 
        WHERE cell_id = ? 
        LIMIT 1
    `);
    
    try {
        stmt.bind([cellId]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            return rowToTranslationPair(row);
        }
        
        return null;
    } finally {
        stmt.free();
    }
}

// Get target cell by cell ID
export function getTargetCellByCellId(db: Database, cellId: string): any | null {
    const stmt = db.prepare(`
        SELECT * FROM translation_pairs 
        WHERE cell_id = ? 
        LIMIT 1
    `);
    
    try {
        stmt.bind([cellId]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            return {
                cellId: row["cell_id"],
                sourceContent: row["source_content"],
                targetContent: row["target_content"],
                uri: row["uri"],
                line: row["line"]
            };
        }
        
        return null;
    } finally {
        stmt.free();
    }
}

// Search translation pairs (similar to searchTranslationPairs)
export function searchTranslationPairs(
    db: Database,
    query: string,
    includeIncomplete: boolean = false,
    limit: number = 15
): TranslationPair[] {
    if (!query || query.trim() === '') {
        return [];
    }
    
    // First check if the FTS5 table has any data
    try {
        const countStmt = db.prepare("SELECT COUNT(*) as count FROM translation_pairs_fts");
        countStmt.step();
        const ftsCount = countStmt.getAsObject().count as number;
        countStmt.free();
        
        if (ftsCount === 0) {
            console.warn("FTS5 table is empty, populating it...");
            try {
                populateFTS5FromMainTable(db);
            } catch (rebuildError) {
                console.error("Failed to populate FTS5 table:", rebuildError);
                // Fall back to non-FTS search immediately
                return searchTranslationPairsFallback(db, query, includeIncomplete, limit);
            }
        }
    } catch (ftsCheckError) {
        console.error("FTS5 table check failed, attempting to recreate:", ftsCheckError);
        try {
            // Recreate FTS5 table if it's corrupted
            recreateFTS5Table(db);
        } catch (recreateError) {
            console.error("Failed to recreate FTS5 table:", recreateError);
            return searchTranslationPairsFallback(db, query, includeIncomplete, limit);
        }
    }
    
    // Escape special characters and format for FTS5
    const cleanQuery = query.replace(/['"]/g, '').trim();
    const ftsQuery = cleanQuery.split(/\s+/).filter(term => term.length > 0).map(term => `"${term}"*`).join(" OR ");
    
    if (!ftsQuery) {
        return [];
    }
    
    try {
        // Step 1: Query FTS5 table directly to get matching IDs
        const ftsStmt = db.prepare(`
            SELECT id FROM translation_pairs_fts 
            WHERE (source_content MATCH ? OR target_content MATCH ?)
            ORDER BY bm25(translation_pairs_fts)
            LIMIT ?
        `);
        
        ftsStmt.bind([ftsQuery, ftsQuery, limit]);
        
        const matchingIds: string[] = [];
        while (ftsStmt.step()) {
            const row = ftsStmt.getAsObject();
            matchingIds.push(row["id"] as string);
        }
        ftsStmt.free();
        
        if (matchingIds.length === 0) {
            return [];
        }
        
        // Step 2: Get full data from main table using the IDs
        const placeholders = matchingIds.map(() => '?').join(',');
        let mainSql = `SELECT * FROM translation_pairs WHERE id IN (${placeholders})`;
        
        if (!includeIncomplete) {
            mainSql += " AND target_content != '' AND target_content IS NOT NULL";
        }
        
        const mainStmt = db.prepare(mainSql);
        mainStmt.bind(matchingIds);
        
        const results: TranslationPair[] = [];
        while (mainStmt.step()) {
            const row = mainStmt.getAsObject();
            results.push(rowToTranslationPair(row));
        }
        
        mainStmt.free();
        return results;
        
    } catch (error) {
        console.error("Error in searchTranslationPairs FTS5 query:", error);
        
        // If we get the MATCH error, try to recreate the FTS5 table
        if ((error as Error).message && (error as Error).message.includes("unable to use function MATCH")) {
            console.warn("Detected MATCH function error, recreating FTS5 table...");
            try {
                recreateFTS5Table(db);
                // Try the search again after recreation with the same approach
                const ftsStmt = db.prepare(`
                    SELECT id FROM translation_pairs_fts 
                    WHERE (source_content MATCH ? OR target_content MATCH ?)
                    ORDER BY bm25(translation_pairs_fts)
                    LIMIT ?
                `);
                
                ftsStmt.bind([ftsQuery, ftsQuery, limit]);
                
                const matchingIds: string[] = [];
                while (ftsStmt.step()) {
                    const row = ftsStmt.getAsObject();
                    matchingIds.push(row["id"] as string);
                }
                ftsStmt.free();
                
                if (matchingIds.length === 0) {
                    return [];
                }
                
                const placeholders = matchingIds.map(() => '?').join(',');
                let mainSql = `SELECT * FROM translation_pairs WHERE id IN (${placeholders})`;
                
                if (!includeIncomplete) {
                    mainSql += " AND target_content != '' AND target_content IS NOT NULL";
                }
                
                const mainStmt = db.prepare(mainSql);
                mainStmt.bind(matchingIds);
                
                const results: TranslationPair[] = [];
                while (mainStmt.step()) {
                    const row = mainStmt.getAsObject();
                    results.push(rowToTranslationPair(row));
                }
                
                mainStmt.free();
                return results;
                
            } catch (retryError) {
                console.error("Failed to retry search after FTS5 recreation:", retryError);
            }
        }
        
        // Fallback to non-FTS search if FTS fails
        return searchTranslationPairsFallback(db, query, includeIncomplete, limit);
    }
}

// Function to recreate FTS5 table when corrupted
function recreateFTS5Table(db: Database): void {
    console.log("Recreating FTS5 table and triggers...");
    
    try {
        // Drop and recreate FTS5 table and triggers
        db.exec(`
            DROP TABLE IF EXISTS translation_pairs_fts;
            DROP TRIGGER IF EXISTS translation_pairs_ai;
            DROP TRIGGER IF EXISTS translation_pairs_ad;
            DROP TRIGGER IF EXISTS translation_pairs_au;
        `);
        
        // Create standalone FTS5 virtual table
        db.exec(`
            CREATE VIRTUAL TABLE translation_pairs_fts USING fts5(
                id UNINDEXED,
                cell_id UNINDEXED,
                document UNINDEXED,
                section UNINDEXED,
                cell UNINDEXED,
                source_content,
                target_content,
                uri UNINDEXED,
                line UNINDEXED,
                notebook_id UNINDEXED
            );
        `);
        
        // Create triggers
        db.exec(`
            CREATE TRIGGER translation_pairs_ai AFTER INSERT ON translation_pairs BEGIN
                INSERT INTO translation_pairs_fts(id, cell_id, document, section, cell, source_content, target_content, uri, line, notebook_id) 
                VALUES (new.id, new.cell_id, new.document, new.section, new.cell, new.source_content, new.target_content, new.uri, new.line, new.notebook_id);
            END;
            
            CREATE TRIGGER translation_pairs_ad AFTER DELETE ON translation_pairs BEGIN
                DELETE FROM translation_pairs_fts WHERE id = old.id;
            END;
            
            CREATE TRIGGER translation_pairs_au AFTER UPDATE ON translation_pairs BEGIN
                DELETE FROM translation_pairs_fts WHERE id = old.id;
                INSERT INTO translation_pairs_fts(id, cell_id, document, section, cell, source_content, target_content, uri, line, notebook_id) 
                VALUES (new.id, new.cell_id, new.document, new.section, new.cell, new.source_content, new.target_content, new.uri, new.line, new.notebook_id);
            END;
        `);
        
        // Populate with existing data
        populateFTS5FromMainTable(db);
        
        console.log("FTS5 table recreation completed successfully");
    } catch (error) {
        console.error("Error recreating FTS5 table:", error);
        throw error;
    }
}

// Fallback search function for when FTS5 fails
function searchTranslationPairsFallback(
    db: Database,
    query: string,
    includeIncomplete: boolean,
    limit: number
): TranslationPair[] {
    const cleanQuery = query.replace(/['"]/g, '').trim();
    
    let fallbackSql = `
        SELECT * FROM translation_pairs 
        WHERE (source_content LIKE ? OR target_content LIKE ?)
    `;
    
    if (!includeIncomplete) {
        fallbackSql += " AND target_content != '' AND target_content IS NOT NULL";
    }
    
    fallbackSql += " LIMIT ?";
    
    const fallbackStmt = db.prepare(fallbackSql);
    
    try {
        const likeQuery = `%${cleanQuery}%`;
        fallbackStmt.bind([likeQuery, likeQuery, limit]);
        
        const results: TranslationPair[] = [];
        while (fallbackStmt.step()) {
            const row = fallbackStmt.getAsObject();
            results.push(rowToTranslationPair(row));
        }
        return results;
    } finally {
        fallbackStmt.free();
    }
}

// Get translation pairs from source cell query
export function getTranslationPairsFromSourceCellQuery(
    db: Database,
    query: string,
    limit: number = 5
): TranslationPair[] {
    if (!query || query.trim() === '') {
        return [];
    }
    
    // First check if the FTS5 table has any data
    const countStmt = db.prepare("SELECT COUNT(*) as count FROM translation_pairs_fts");
    countStmt.step();
    const ftsCount = countStmt.getAsObject().count as number;
    countStmt.free();
    
    if (ftsCount === 0) {
        console.warn("FTS5 table is empty, populating it...");
        try {
            populateFTS5FromMainTable(db);
        } catch (rebuildError) {
            console.error("Failed to populate FTS5 table:", rebuildError);
            // Fall back to non-FTS search immediately
            return getTranslationPairsFromSourceCellQueryFallback(db, query, limit);
        }
    }
    
    try {
        // Escape special characters and format for FTS5
        const cleanQuery = query.replace(/['"]/g, '').trim();
        const ftsQuery = cleanQuery.split(/\s+/).filter(term => term.length > 0).map(term => `"${term}"*`).join(" OR ");
        
        if (!ftsQuery) {
            return [];
        }
        
        // Step 1: Query FTS5 table directly to get matching IDs
        const ftsStmt = db.prepare(`
            SELECT id FROM translation_pairs_fts
            WHERE source_content MATCH ?
            ORDER BY bm25(translation_pairs_fts)
            LIMIT ?
        `);
        
        ftsStmt.bind([ftsQuery, limit]);
        
        const matchingIds: string[] = [];
        while (ftsStmt.step()) {
            const row = ftsStmt.getAsObject();
            matchingIds.push(row["id"] as string);
        }
        ftsStmt.free();
        
        if (matchingIds.length === 0) {
            return [];
        }
        
        // Step 2: Get full data from main table using the IDs
        const placeholders = matchingIds.map(() => '?').join(',');
        const mainStmt = db.prepare(`SELECT * FROM translation_pairs WHERE id IN (${placeholders})`);
        mainStmt.bind(matchingIds);
        
        const results: TranslationPair[] = [];
        while (mainStmt.step()) {
            const row = mainStmt.getAsObject();
            results.push(rowToTranslationPair(row));
        }
        
        mainStmt.free();
        return results;
        
    } catch (error) {
        console.error("Error in getTranslationPairsFromSourceCellQuery:", error);
        // Fallback to non-FTS search if FTS fails
        return getTranslationPairsFromSourceCellQueryFallback(db, query, limit);
    }
}

// Fallback search function for source cell query
function getTranslationPairsFromSourceCellQueryFallback(
    db: Database,
    query: string,
    limit: number
): TranslationPair[] {
    const cleanQuery = query.replace(/['"]/g, '').trim();
    
    const fallbackStmt = db.prepare(`
        SELECT * FROM translation_pairs 
        WHERE source_content LIKE ? 
        LIMIT ?
    `);
    
    try {
        fallbackStmt.bind([`%${cleanQuery}%`, limit]);
        const results: TranslationPair[] = [];
        while (fallbackStmt.step()) {
            const row = fallbackStmt.getAsObject();
            results.push(rowToTranslationPair(row));
        }
        return results;
    } finally {
        fallbackStmt.free();
    }
}

// Search all cells (combines translation pairs and source-only cells)
export function searchAllCells(
    db: Database,
    sourceTextDb: Database,
    query: string,
    limit: number = 15,
    includeIncomplete: boolean = true
): TranslationPair[] {
    // First, search translation pairs
    const translationPairs = searchTranslationPairs(db, query, includeIncomplete, limit);
    
    let combinedResults: TranslationPair[] = translationPairs;
    
    if (includeIncomplete) {
        // Also search source-only cells from the source text database
        // Import the function dynamically to avoid circular dependencies
        const sourceTextModule = require('./sourceTextDb');
        const sourceSearchResults = sourceTextModule.searchSourceCells(sourceTextDb, query, limit);
        
        // Convert source-only results to TranslationPair format
        const sourceOnlyCells: TranslationPair[] = sourceSearchResults.map((result: any) => ({
            cellId: result.cellId,
            sourceCell: {
                cellId: result.cellId,
                content: result.content,
                versions: result.versions,
                notebookId: result.notebookId,
                uri: "",
                line: 0
            },
            targetCell: {
                cellId: result.cellId,
                content: "",
                versions: [],
                notebookId: "",
                uri: "",
                line: 0
            },
            score: 0.5 // Default score for source-only results
        }));
        
        combinedResults = [...translationPairs, ...sourceOnlyCells];
    }
    
    // Remove duplicates based on cellId
    const uniqueResults = combinedResults.filter(
        (v, i, a) => a.findIndex((t) => t.cellId === v.cellId) === i
    );
    
    // Sort results by relevance (higher score means more relevant)
    uniqueResults.sort((a, b) => {
        const scoreA = "score" in a ? (a.score as number) : 0;
        const scoreB = "score" in b ? (b.score as number) : 0;
        return scoreB - scoreA;
    });
    
    return uniqueResults.slice(0, limit);
}

// Search similar cell IDs with enhanced pattern matching
export function searchSimilarCellIds(
    db: Database,
    cellId: string,
    limit: number = 5
): { cellId: string; score: number }[] {
    // Register custom SQL functions for enhanced similarity scoring
    registerSimilarityFunctions(db);
    
    // Parse the input cellId into components
    const parsed = parseCellId(cellId);
    
    if (!parsed) {
        // If parsing fails, fall back to exact match
        const stmt = db.prepare(`
            SELECT cell_id, 1.0 as score 
            FROM translation_pairs 
            WHERE cell_id = ? 
            LIMIT ?
        `);
        
        try {
            stmt.bind([cellId, limit]);
            const results: { cellId: string; score: number }[] = [];
            while (stmt.step()) {
                const row = stmt.getAsObject();
                results.push({
                    cellId: row["cell_id"] as string,
                    score: row["score"] as number
                });
            }
            return results;
        } finally {
            stmt.free();
        }
    }
    
    // Enhanced similarity search with multiple strategies
    const sql = `
        WITH similarity_scores AS (
            SELECT 
                cell_id,
                CASE 
                    -- Exact match gets highest score
                    WHEN cell_id = ? THEN 1.0
                    
                    -- Same book, chapter, and verse range (±2 verses)
                    WHEN calculate_verse_similarity(cell_id, ?, ?, ?) >= 0.8 THEN 
                        calculate_verse_similarity(cell_id, ?, ?, ?)
                    
                    -- Same book and chapter
                    WHEN calculate_chapter_similarity(cell_id, ?, ?) >= 0.6 THEN 
                        calculate_chapter_similarity(cell_id, ?, ?)
                    
                    -- Same book, nearby chapters (±2 chapters)
                    WHEN calculate_book_similarity(cell_id, ?) >= 0.4 THEN 
                        calculate_book_similarity(cell_id, ?)
                    
                    -- Different book but similar structure
                    ELSE calculate_structural_similarity(cell_id, ?, ?, ?)
                END as score
            FROM translation_pairs
            WHERE score > 0
        )
        SELECT cell_id, score
        FROM similarity_scores
        WHERE score > 0.1  -- Minimum threshold
        ORDER BY score DESC, cell_id ASC
        LIMIT ?
    `;
    
    const stmt = db.prepare(sql);
    
    try {
        // Bind parameters for all the custom function calls
        stmt.bind([
            cellId,                    // Exact match
            cellId, parsed.book, parsed.chapter,  // Verse similarity (first call)
            cellId, parsed.book, parsed.chapter,  // Verse similarity (second call)
            cellId, parsed.book,       // Chapter similarity (first call)
            cellId, parsed.book,       // Chapter similarity (second call)
            cellId,                    // Book similarity (first call)
            cellId,                    // Book similarity (second call)
            cellId, parsed.book, parsed.chapter,  // Structural similarity
            limit
        ]);
        
        const results: { cellId: string; score: number }[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                cellId: row["cell_id"] as string,
                score: row["score"] as number
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Helper function to parse cell ID into components
function parseCellId(cellId: string): { book: string; chapter: number; verse: number } | null {
    // Match patterns like "GEN 1:1", "MAT 28:20", etc.
    const match = cellId.match(/^([A-Z]{3})\s+(\d+):(\d+)$/);
    if (!match) {
        return null;
    }
    
    return {
        book: match[1],
        chapter: parseInt(match[2], 10),
        verse: parseInt(match[3], 10)
    };
}

// Register custom SQL functions for similarity calculations
function registerSimilarityFunctions(db: Database): void {
    // Function to calculate verse-level similarity
    db.create_function("calculate_verse_similarity", (targetCellId: string, inputCellId: string, inputBook: string, inputChapter: number) => {
        const targetParsed = parseCellId(targetCellId);
        if (!targetParsed || targetParsed.book !== inputBook || targetParsed.chapter !== inputChapter) {
            return 0;
        }
        
        const inputParsed = parseCellId(inputCellId);
        const verseDiff = Math.abs(targetParsed.verse - (inputParsed?.verse || 0));
        
        if (verseDiff === 0) return 1.0;      // Same verse
        if (verseDiff === 1) return 0.9;      // Adjacent verse
        if (verseDiff === 2) return 0.8;      // 2 verses away
        if (verseDiff <= 5) return 0.7;       // Within 5 verses
        if (verseDiff <= 10) return 0.6;      // Within 10 verses
        
        return 0;
    });
    
    // Function to calculate chapter-level similarity
    db.create_function("calculate_chapter_similarity", (targetCellId: string, inputCellId: string, inputBook: string) => {
        const targetParsed = parseCellId(targetCellId);
        if (!targetParsed || targetParsed.book !== inputBook) {
            return 0;
        }
        
        const inputParsed = parseCellId(inputCellId);
        if (!inputParsed) return 0;
        
        const chapterDiff = Math.abs(targetParsed.chapter - inputParsed.chapter);
        
        if (chapterDiff === 0) return 0.6;    // Same chapter (lower than verse match)
        if (chapterDiff === 1) return 0.5;    // Adjacent chapter
        if (chapterDiff === 2) return 0.4;    // 2 chapters away
        if (chapterDiff <= 5) return 0.3;     // Within 5 chapters
        
        return 0;
    });
    
    // Function to calculate book-level similarity
    db.create_function("calculate_book_similarity", (targetCellId: string, inputCellId: string) => {
        const targetParsed = parseCellId(targetCellId);
        const inputParsed = parseCellId(inputCellId);
        
        if (!targetParsed || !inputParsed) return 0;
        
        if (targetParsed.book === inputParsed.book) {
            // Same book, different chapter - use chapter similarity
            const chapterDiff = Math.abs(targetParsed.chapter - inputParsed.chapter);
            if (chapterDiff <= 2) return 0.4;
            if (chapterDiff <= 5) return 0.3;
            if (chapterDiff <= 10) return 0.2;
            return 0.1;
        }
        
        return 0;
    });
    
    // Function to calculate structural similarity (different books but similar patterns)
    db.create_function("calculate_structural_similarity", (targetCellId: string, inputCellId: string, inputBook: string, inputChapter: number) => {
        const targetParsed = parseCellId(targetCellId);
        const inputParsed = parseCellId(inputCellId);
        
        if (!targetParsed || !inputParsed || targetParsed.book === inputParsed.book) {
            return 0;
        }
        
        // Give slight preference to similar chapter:verse patterns
        if (targetParsed.chapter === inputParsed.chapter && targetParsed.verse === inputParsed.verse) {
            return 0.2;  // Same chapter:verse in different book
        }
        
        if (targetParsed.chapter === inputParsed.chapter) {
            return 0.15; // Same chapter in different book
        }
        
        if (targetParsed.verse === inputParsed.verse) {
            return 0.1;  // Same verse number in different book
        }
        
        return 0.05; // Different book, minimal similarity
    });
}

// Helper function to convert a database row to a TranslationPair
function rowToTranslationPair(row: any): TranslationPair {
    return {
        cellId: row["cell_id"] as string,
        sourceCell: {
            cellId: row["cell_id"] as string,
            content: row["source_content"] as string,
            uri: row["uri"] as string,
            line: row["line"] as number,
            notebookId: row["notebook_id"] as string
        },
        targetCell: {
            cellId: row["cell_id"] as string,
            content: row["target_content"] as string,
            uri: row["uri"] as string,
            line: row["line"] as number,
            notebookId: row["notebook_id"] as string
        }
    };
}

// Save the database to disk
export async function saveTranslationPairsDb(db: Database): Promise<void> {
    const workspaceFolder = getWorkSpaceUri();
    if (!workspaceFolder) {
        console.warn("Workspace folder not found. Cannot save translation pairs database.");
        return;
    }
    
    const dbPath = vscode.Uri.joinPath(workspaceFolder, ...translationDbPath);
    
    try {
        // Export the database to a binary array
        const data = db.export();
        
        // Create parent directory if it doesn't exist
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(workspaceFolder, ".project")
        );
        
        // Write to file
        await vscode.workspace.fs.writeFile(dbPath, data);
        console.log("Translation pairs database saved successfully");
    } catch (error) {
        console.error("Error saving translation pairs database:", error);
        throw error;
    }
} 