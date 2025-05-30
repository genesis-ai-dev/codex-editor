import * as vscode from "vscode";
import { Database } from "sql.js-fts5";
import { getWorkSpaceUri } from "../utils";
import { FileData } from "../activationHelpers/contextAware/miniIndex/indexes/fileReaders";
import { SourceCellVersions } from "../../types";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";

// Path for the SQLite database
const sourceTextDbPath = [".project", "source_text.sqlite"];

// Initialize the database
export async function initializeSourceTextDb(db: Database): Promise<void> {
    console.time("initializeSourceTextDb");
    
    // Create tables if they don't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS source_text (
            cell_id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            versions TEXT, -- JSON array of versions
            notebook_id TEXT,
            uri TEXT,
            line INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_source_text_notebook_id ON source_text(notebook_id);
        CREATE INDEX IF NOT EXISTS idx_source_text_content ON source_text(content);

        -- Create standalone FTS5 virtual table (not external content)
        CREATE VIRTUAL TABLE IF NOT EXISTS source_text_fts USING fts5(
            cell_id UNINDEXED, 
            content
        );
    `);
    
    // Drop existing triggers if they exist to recreate them properly
    db.exec(`
        DROP TRIGGER IF EXISTS source_text_ai;
        DROP TRIGGER IF EXISTS source_text_ad;  
        DROP TRIGGER IF EXISTS source_text_au;
    `);
    
    // Create new triggers for standalone FTS5 table
    db.exec(`
        CREATE TRIGGER source_text_ai AFTER INSERT ON source_text BEGIN
            INSERT INTO source_text_fts(cell_id, content) 
            VALUES (new.cell_id, new.content);
        END;
        
        CREATE TRIGGER source_text_ad AFTER DELETE ON source_text BEGIN
            DELETE FROM source_text_fts WHERE rowid = old.rowid;
        END;
        
        CREATE TRIGGER source_text_au AFTER UPDATE ON source_text BEGIN
            DELETE FROM source_text_fts WHERE rowid = old.rowid;
            INSERT INTO source_text_fts(cell_id, content) 
            VALUES (new.cell_id, new.content);
        END;
    `);
    
    console.timeEnd("initializeSourceTextDb");
}

// Create and populate the source text index
export async function createSourceTextIndex(
    db: Database,
    sourceFiles: FileData[],
    metadataManager: NotebookMetadataManager,
    force: boolean = false
): Promise<void> {
    console.time("createSourceTextIndex");
    
    const workspaceFolder = getWorkSpaceUri();
    if (!workspaceFolder) {
        console.warn("Workspace folder not found for Source Text Index.");
        return;
    }
    
    if (force) {
        // Clear existing data if forced
        db.exec("DELETE FROM source_text");
        db.exec("DELETE FROM source_text_fts");
    }
    
    // Begin a transaction for better performance with batch inserts
    db.exec("BEGIN TRANSACTION");
    
    try {
        const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO source_text (
                cell_id, content, versions, notebook_id, uri, line
            ) VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        let insertCount = 0;
        for (const sourceFile of sourceFiles) {
            for (const sourceCell of sourceFile.cells) {
                if (
                    sourceCell.metadata?.type === "text" &&
                    sourceCell.metadata?.id &&
                    sourceCell.value.trim() !== ""
                ) {
                    const cellId = sourceCell.metadata.id;
                    
                    // Get versions from metadata if available (fallback to empty array)
                    const versions: string[] = [];
                    const versionsJson = JSON.stringify(versions);
                    
                    // Insert into database (triggers will handle FTS5)
                    insertStmt.bind([
                        cellId,
                        sourceCell.value,
                        versionsJson,
                        sourceFile.id,
                        sourceFile.uri.toString(),
                        -1 // line number placeholder
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
        
        // Commit any remaining inserts
        db.exec("COMMIT");
        insertStmt.free();
        
        console.log(`Source text index created with ${insertCount} entries`);
        
        // Verify FTS5 population
        const ftsCountStmt = db.prepare("SELECT COUNT(*) as count FROM source_text_fts");
        ftsCountStmt.step();
        const ftsCount = ftsCountStmt.getAsObject().count as number;
        ftsCountStmt.free();
        
        console.log(`Source text FTS5 table has ${ftsCount} entries`);
        
    } catch (error) {
        // Rollback on error
        db.exec("ROLLBACK");
        console.error("Error creating source text index:", error);
        throw error;
    }
    
    console.timeEnd("createSourceTextIndex");
}

// Function to populate FTS5 from existing main table data
export function populateSourceTextFTS5FromMainTable(db: Database): void {
    console.log("Populating source text FTS5 table from main table data...");
    
    try {
        // Clear existing FTS5 data
        db.exec("DELETE FROM source_text_fts");
        
        // Insert all existing data into FTS5
        db.exec(`
            INSERT INTO source_text_fts(cell_id, content)
            SELECT cell_id, content 
            FROM source_text
        `);
        
        const countStmt = db.prepare("SELECT COUNT(*) as count FROM source_text_fts");
        countStmt.step();
        const count = countStmt.getAsObject().count as number;
        countStmt.free();
        
        console.log(`Source text FTS5 table populated with ${count} entries`);
    } catch (error) {
        console.error("Error populating source text FTS5 table:", error);
        throw error;
    }
}

// Search functions equivalent to MiniSearch operations

// Get source cell by cell ID (similar to getSourceCellByCellIdFromAllSourceCells)
export function getSourceCellByCellIdFromAllSourceCells(
    db: Database,
    cellId: string
): SourceCellVersions | null {
    const stmt = db.prepare(`
        SELECT * FROM source_text 
        WHERE cell_id = ? 
        LIMIT 1
    `);
    
    try {
        stmt.bind([cellId]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            return {
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
                versions: JSON.parse(row["versions"] as string || "[]"),
                notebookId: row["notebook_id"] as string,
            };
        }
        
        return null;
    } finally {
        stmt.free();
    }
}

// Search source cells by content
export function searchSourceCells(
    db: Database,
    query: string,
    limit: number = 15
): SourceCellVersions[] {
    if (!query || query.trim() === '') {
        return [];
    }
    
    // First check if the FTS5 table has any data
    const countStmt = db.prepare("SELECT COUNT(*) as count FROM source_text_fts");
    countStmt.step();
    const ftsCount = countStmt.getAsObject().count as number;
    countStmt.free();
    
    if (ftsCount === 0) {
        console.warn("Source text FTS5 table is empty, populating it...");
        try {
            populateSourceTextFTS5FromMainTable(db);
        } catch (rebuildError) {
            console.error("Failed to populate source text FTS5 table:", rebuildError);
            // Fall back to non-FTS search immediately
            return searchSourceCellsFallback(db, query, limit);
        }
    }
    
    // Escape special characters and format for FTS5
    const cleanQuery = query.replace(/['"]/g, '').trim();
    const ftsQuery = cleanQuery.split(/\s+/).filter(term => term.length > 0).map(term => `"${term}"*`).join(" OR ");
    
    if (!ftsQuery) {
        return [];
    }
    
    try {
        // Step 1: Query FTS5 table directly to get matching cell_ids
        const ftsStmt = db.prepare(`
            SELECT cell_id FROM source_text_fts 
            WHERE content MATCH ? 
            ORDER BY bm25(source_text_fts)
            LIMIT ?
        `);
        
        ftsStmt.bind([ftsQuery, limit]);
        
        const matchingIds: string[] = [];
        while (ftsStmt.step()) {
            const row = ftsStmt.getAsObject();
            matchingIds.push(row["cell_id"] as string);
        }
        ftsStmt.free();
        
        if (matchingIds.length === 0) {
            return [];
        }
        
        // Step 2: Get full data from main table using the cell_ids
        const placeholders = matchingIds.map(() => '?').join(',');
        const mainStmt = db.prepare(`SELECT * FROM source_text WHERE cell_id IN (${placeholders})`);
        mainStmt.bind(matchingIds);
        
        const results: SourceCellVersions[] = [];
        while (mainStmt.step()) {
            const row = mainStmt.getAsObject();
            results.push({
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
                versions: JSON.parse(row["versions"] as string || "[]"),
                notebookId: row["notebook_id"] as string,
            });
        }
        
        mainStmt.free();
        return results;
        
    } catch (error) {
        console.error("Error in searchSourceCells:", error);
        // Fallback to non-FTS search if FTS fails
        return searchSourceCellsFallback(db, query, limit);
    }
}

// Fallback search function for source cells
function searchSourceCellsFallback(
    db: Database,
    query: string,
    limit: number
): SourceCellVersions[] {
    const cleanQuery = query.replace(/['"]/g, '').trim();
    
    const fallbackStmt = db.prepare(`
        SELECT * FROM source_text 
        WHERE content LIKE ? 
        LIMIT ?
    `);
    
    try {
        fallbackStmt.bind([`%${cleanQuery}%`, limit]);
        const results: SourceCellVersions[] = [];
        while (fallbackStmt.step()) {
            const row = fallbackStmt.getAsObject();
            results.push({
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
                versions: JSON.parse(row["versions"] as string || "[]"),
                notebookId: row["notebook_id"] as string,
            });
        }
        return results;
    } finally {
        fallbackStmt.free();
    }
}

// Search similar cell IDs with enhanced pattern matching
export function searchSimilarCellIds(
    db: Database,
    cellId: string,
    limit: number = 5
): { cellId: string; score: number }[] {
    // Import the similarity functions from translationPairsDb
    const translationPairsModule = require('./translationPairsDb');
    
    // Register custom SQL functions for enhanced similarity scoring
    registerSimilarityFunctions(db);
    
    // Parse the input cellId into components
    const parsed = parseCellId(cellId);
    
    if (!parsed) {
        // If parsing fails, fall back to exact match
        const stmt = db.prepare(`
            SELECT cell_id, 1.0 as score 
            FROM source_text 
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
            FROM source_text
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

// Find next untranslated source cell with enhanced search strategies
export async function findNextUntranslatedSourceCell(
    db: Database,
    translationPairsDb: Database,
    query: string,
    currentCellId: string
): Promise<{ cellId: string; content: string } | null> {
    // Register similarity functions for enhanced search
    registerSimilarityFunctions(db);
    
    // Parse current cell ID for proximity-based search
    const currentParsed = parseCellId(currentCellId);
    
    // Strategy 1: Content-based search with untranslated filter
    const contentBasedResult = await findUntranslatedByContent(db, translationPairsDb, query, currentCellId);
    if (contentBasedResult) {
        return contentBasedResult;
    }
    
    // Strategy 2: Proximity-based search (if current cell ID is parseable)
    if (currentParsed) {
        const proximityBasedResult = await findUntranslatedByProximity(db, translationPairsDb, currentCellId, currentParsed);
        if (proximityBasedResult) {
            return proximityBasedResult;
        }
    }
    
    // Strategy 3: Sequential search (find next untranslated cell in order)
    const sequentialResult = await findNextUntranslatedSequentially(db, translationPairsDb, currentCellId);
    if (sequentialResult) {
        return sequentialResult;
    }
    
    // Strategy 4: Fallback to any untranslated cell
    const fallbackResult = await findAnyUntranslatedCell(db, translationPairsDb, currentCellId);
    return fallbackResult;
}

// Strategy 1: Content-based search with untranslated filter
async function findUntranslatedByContent(
    db: Database,
    translationPairsDb: Database,
    query: string,
    currentCellId: string
): Promise<{ cellId: string; content: string } | null> {
    if (!query || query.trim() === '') {
        return null;
    }
    
    // First check if the FTS5 table has any data
    const countStmt = db.prepare("SELECT COUNT(*) as count FROM source_text_fts");
    countStmt.step();
    const ftsCount = countStmt.getAsObject().count as number;
    countStmt.free();
    
    if (ftsCount === 0) {
        console.warn("Source text FTS5 table is empty for untranslated search, populating it...");
        try {
            populateSourceTextFTS5FromMainTable(db);
        } catch (rebuildError) {
            console.error("Failed to populate source text FTS5 table:", rebuildError);
            // Fall back to non-FTS search immediately
            return findUntranslatedByContentFallback(db, translationPairsDb, query, currentCellId);
        }
    }
    
    // Escape special characters and format for FTS5
    const cleanQuery = query.replace(/['"]/g, '').trim();
    const ftsQuery = cleanQuery.split(/\s+/).filter(term => term.length > 0).map(term => `"${term}"*`).join(" OR ");
    
    if (!ftsQuery) {
        return null;
    }
    
    // Use FTS5 search to find relevant content, then filter for untranslated
    try {
        // Step 1: Query FTS5 table directly to get matching cell_ids
        const ftsStmt = db.prepare(`
            SELECT cell_id FROM source_text_fts 
            WHERE content MATCH ? 
            ORDER BY bm25(source_text_fts)
            LIMIT 20
        `);
        
        ftsStmt.bind([ftsQuery]);
        
        const matchingIds: string[] = [];
        while (ftsStmt.step()) {
            const row = ftsStmt.getAsObject();
            const cellId = row["cell_id"] as string;
            if (cellId !== currentCellId) {
                matchingIds.push(cellId);
            }
        }
        ftsStmt.free();
        
        if (matchingIds.length === 0) {
            return null;
        }
        
        // Step 2: Get content and check translation status
        const placeholders = matchingIds.map(() => '?').join(',');
        const mainStmt = db.prepare(`
            SELECT s.cell_id, s.content
            FROM source_text s
            LEFT JOIN translation_pairs tp ON s.cell_id = tp.cell_id
            WHERE s.cell_id IN (${placeholders})
            AND (tp.cell_id IS NULL OR tp.target_content = '' OR tp.target_content IS NULL)
            LIMIT 1
        `);
        
        mainStmt.bind(matchingIds);
        
        if (mainStmt.step()) {
            const row = mainStmt.getAsObject();
            mainStmt.free();
            return {
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
            };
        }
        
        mainStmt.free();
        return null;
    } catch (error) {
        console.error("Error in findUntranslatedByContent:", error);
        // Fallback to non-FTS search
        return findUntranslatedByContentFallback(db, translationPairsDb, query, currentCellId);
    }
}

// Fallback function for untranslated content search
async function findUntranslatedByContentFallback(
    db: Database,
    translationPairsDb: Database,
    query: string,
    currentCellId: string
): Promise<{ cellId: string; content: string } | null> {
    const cleanQuery = query.replace(/['"]/g, '').trim();
    
    const fallbackSql = `
        SELECT s.cell_id, s.content
        FROM source_text s
        LEFT JOIN translation_pairs tp ON s.cell_id = tp.cell_id
        WHERE s.content LIKE ?
        AND s.cell_id != ?
        AND (tp.cell_id IS NULL OR tp.target_content = '' OR tp.target_content IS NULL)
        LIMIT 1
    `;
    
    const fallbackStmt = db.prepare(fallbackSql);
    
    try {
        fallbackStmt.bind([`%${cleanQuery}%`, currentCellId]);
        
        if (fallbackStmt.step()) {
            const row = fallbackStmt.getAsObject();
            return {
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
            };
        }
        
        return null;
    } finally {
        fallbackStmt.free();
    }
}

// Strategy 2: Proximity-based search (find untranslated cells near current cell)
async function findUntranslatedByProximity(
    db: Database,
    translationPairsDb: Database,
    currentCellId: string,
    currentParsed: { book: string; chapter: number; verse: number }
): Promise<{ cellId: string; content: string } | null> {
    // Register similarity functions
    registerSimilarityFunctions(db);
    
    const sql = `
        WITH proximity_scores AS (
            SELECT 
                s.cell_id,
                s.content,
                CASE 
                    -- Same book, chapter, nearby verses (±5 verses)
                    WHEN calculate_verse_similarity(s.cell_id, ?, ?, ?) > 0.6 THEN 
                        calculate_verse_similarity(s.cell_id, ?, ?, ?)
                    
                    -- Same book, nearby chapters (±3 chapters)
                    WHEN calculate_chapter_similarity(s.cell_id, ?, ?) > 0.3 THEN 
                        calculate_chapter_similarity(s.cell_id, ?, ?)
                    
                    -- Same book, any chapter
                    WHEN calculate_book_similarity(s.cell_id, ?) > 0.1 THEN 
                        calculate_book_similarity(s.cell_id, ?)
                    
                    ELSE 0
                END as proximity_score
            FROM source_text s
            WHERE s.cell_id != ?
            AND proximity_score > 0.1
        )
        SELECT ps.cell_id, ps.content
        FROM proximity_scores ps
        LEFT JOIN translation_pairs tp ON ps.cell_id = tp.cell_id
        WHERE (tp.cell_id IS NULL OR tp.target_content = '' OR tp.target_content IS NULL)
        ORDER BY ps.proximity_score DESC
        LIMIT 1
    `;
    
    const stmt = db.prepare(sql);
    
    try {
        stmt.bind([
            currentCellId, currentParsed.book, currentParsed.chapter,  // Verse similarity (first call)
            currentCellId, currentParsed.book, currentParsed.chapter,  // Verse similarity (second call)
            currentCellId, currentParsed.book,                         // Chapter similarity (first call)
            currentCellId, currentParsed.book,                         // Chapter similarity (second call)
            currentCellId,                                             // Book similarity (first call)
            currentCellId,                                             // Book similarity (second call)
            currentCellId                                              // Exclude current cell
        ]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            return {
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
            };
        }
        
        return null;
    } finally {
        stmt.free();
    }
}

// Strategy 3: Sequential search (find next untranslated cell in biblical order)
async function findNextUntranslatedSequentially(
    db: Database,
    translationPairsDb: Database,
    currentCellId: string
): Promise<{ cellId: string; content: string } | null> {
    const sql = `
        SELECT s.cell_id, s.content
        FROM source_text s
        LEFT JOIN translation_pairs tp ON s.cell_id = tp.cell_id
        WHERE s.cell_id > ?
        AND (tp.cell_id IS NULL OR tp.target_content = '' OR tp.target_content IS NULL)
        ORDER BY s.cell_id
        LIMIT 1
    `;
    
    const stmt = db.prepare(sql);
    
    try {
        stmt.bind([currentCellId]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            return {
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
            };
        }
        
        return null;
    } finally {
        stmt.free();
    }
}

// Strategy 4: Fallback to any untranslated cell
async function findAnyUntranslatedCell(
    db: Database,
    translationPairsDb: Database,
    currentCellId: string
): Promise<{ cellId: string; content: string } | null> {
    const sql = `
        SELECT s.cell_id, s.content
        FROM source_text s
        LEFT JOIN translation_pairs tp ON s.cell_id = tp.cell_id
        WHERE s.cell_id != ?
        AND (tp.cell_id IS NULL OR tp.target_content = '' OR tp.target_content IS NULL)
        ORDER BY s.cell_id
        LIMIT 1
    `;
    
    const stmt = db.prepare(sql);
    
    try {
        stmt.bind([currentCellId]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            return {
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
            };
        }
        
        return null;
    } finally {
        stmt.free();
    }
}

// Get all untranslated source cells with enhanced filtering
export function getAllUntranslatedCells(
    db: Database,
    translationPairsDb: Database,
    limit: number = 50
): { cellId: string; content: string; notebookId: string }[] {
    const sql = `
        SELECT s.cell_id, s.content, s.notebook_id
        FROM source_text s
        LEFT JOIN translation_pairs tp ON s.cell_id = tp.cell_id
        WHERE (tp.cell_id IS NULL OR tp.target_content = '' OR tp.target_content IS NULL)
        ORDER BY s.cell_id
        LIMIT ?
    `;
    
    const stmt = db.prepare(sql);
    
    try {
        stmt.bind([limit]);
        
        const results: { cellId: string; content: string; notebookId: string }[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
                notebookId: row["notebook_id"] as string,
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get untranslated cells by book with progress statistics
export function getUntranslatedCellsByBook(
    db: Database,
    translationPairsDb: Database,
    book: string
): { 
    untranslatedCells: { cellId: string; content: string }[];
    totalCells: number;
    translatedCells: number;
    progressPercentage: number;
} {
    // Get untranslated cells for the book
    const untranslatedSql = `
        SELECT s.cell_id, s.content
        FROM source_text s
        LEFT JOIN translation_pairs tp ON s.cell_id = tp.cell_id
        WHERE s.cell_id LIKE ? || ' %'
        AND (tp.cell_id IS NULL OR tp.target_content = '' OR tp.target_content IS NULL)
        ORDER BY s.cell_id
    `;
    
    // Get total and translated counts for the book
    const statsSql = `
        SELECT 
            COUNT(s.cell_id) as total_cells,
            COUNT(CASE WHEN tp.target_content IS NOT NULL AND tp.target_content != '' THEN 1 END) as translated_cells
        FROM source_text s
        LEFT JOIN translation_pairs tp ON s.cell_id = tp.cell_id
        WHERE s.cell_id LIKE ? || ' %'
    `;
    
    const untranslatedStmt = db.prepare(untranslatedSql);
    const statsStmt = db.prepare(statsSql);
    
    try {
        // Get untranslated cells
        untranslatedStmt.bind([book]);
        const untranslatedCells: { cellId: string; content: string }[] = [];
        while (untranslatedStmt.step()) {
            const row = untranslatedStmt.getAsObject();
            untranslatedCells.push({
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
            });
        }
        
        // Get statistics
        statsStmt.bind([book]);
        let totalCells = 0;
        let translatedCells = 0;
        if (statsStmt.step()) {
            const row = statsStmt.getAsObject();
            totalCells = row["total_cells"] as number;
            translatedCells = row["translated_cells"] as number;
        }
        
        const progressPercentage = totalCells > 0 ? Math.round((translatedCells / totalCells) * 100) : 0;
        
        return {
            untranslatedCells,
            totalCells,
            translatedCells,
            progressPercentage,
        };
    } finally {
        untranslatedStmt.free();
        statsStmt.free();
    }
}

// Find untranslated cells in a specific chapter
export function getUntranslatedCellsInChapter(
    db: Database,
    translationPairsDb: Database,
    book: string,
    chapter: number
): { cellId: string; content: string }[] {
    const sql = `
        SELECT s.cell_id, s.content
        FROM source_text s
        LEFT JOIN translation_pairs tp ON s.cell_id = tp.cell_id
        WHERE s.cell_id LIKE ? || ' ' || ? || ':%'
        AND (tp.cell_id IS NULL OR tp.target_content = '' OR tp.target_content IS NULL)
        ORDER BY s.cell_id
    `;
    
    const stmt = db.prepare(sql);
    
    try {
        stmt.bind([book, chapter.toString()]);
        
        const results: { cellId: string; content: string }[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get translation progress summary for all books
export function getTranslationProgressSummary(
    db: Database,
    translationPairsDb: Database
): { book: string; totalCells: number; translatedCells: number; progressPercentage: number }[] {
    const sql = `
        SELECT 
            SUBSTR(s.cell_id, 1, INSTR(s.cell_id, ' ') - 1) as book,
            COUNT(s.cell_id) as total_cells,
            COUNT(CASE WHEN tp.target_content IS NOT NULL AND tp.target_content != '' THEN 1 END) as translated_cells
        FROM source_text s
        LEFT JOIN translation_pairs tp ON s.cell_id = tp.cell_id
        GROUP BY book
        ORDER BY book
    `;
    
    const stmt = db.prepare(sql);
    
    try {
        const results: { book: string; totalCells: number; translatedCells: number; progressPercentage: number }[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const totalCells = row["total_cells"] as number;
            const translatedCells = row["translated_cells"] as number;
            const progressPercentage = totalCells > 0 ? Math.round((translatedCells / totalCells) * 100) : 0;
            
            results.push({
                book: row["book"] as string,
                totalCells,
                translatedCells,
                progressPercentage,
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get all source cells
export function getAllSourceCells(db: Database): SourceCellVersions[] {
    const stmt = db.prepare(`
        SELECT * FROM source_text 
        ORDER BY cell_id
    `);
    
    try {
        const results: SourceCellVersions[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
                versions: JSON.parse(row["versions"] as string || "[]"),
                notebookId: row["notebook_id"] as string,
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get source cells by notebook ID
export function getSourceCellsByNotebook(db: Database, notebookId: string): SourceCellVersions[] {
    const stmt = db.prepare(`
        SELECT * FROM source_text 
        WHERE notebook_id = ?
        ORDER BY cell_id
    `);
    
    try {
        stmt.bind([notebookId]);
        
        const results: SourceCellVersions[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
                versions: JSON.parse(row["versions"] as string || "[]"),
                notebookId: row["notebook_id"] as string,
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

// Save the database to disk
export async function saveSourceTextDb(db: Database): Promise<void> {
    const workspaceFolder = getWorkSpaceUri();
    if (!workspaceFolder) {
        console.warn("Workspace folder not found. Cannot save source text database.");
        return;
    }
    
    const dbPath = vscode.Uri.joinPath(workspaceFolder, ...sourceTextDbPath);
    
    try {
        // Export the database to a binary array
        const data = db.export();
        
        // Create parent directory if it doesn't exist
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(workspaceFolder, ".project")
        );
        
        // Write to file
        await vscode.workspace.fs.writeFile(dbPath, data);
        console.log("Source text database saved successfully");
    } catch (error) {
        console.error("Error saving source text database:", error);
        throw error;
    }
} 