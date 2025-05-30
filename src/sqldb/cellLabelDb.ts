import * as vscode from "vscode";
import { Database } from "sql.js-fts5";
import { getWorkSpaceUri } from "../utils";
import { FileData } from "../activationHelpers/contextAware/miniIndex/indexes/fileReaders";

// Path for the SQLite database
const cellLabelDbPath = [".project", "cell_labels.sqlite"];

// Interface for cell label data
export interface CellLabelData {
    cellId: string;
    startTime: string;
    endTime: string;
    character?: string;
    dialogue?: string;
    newLabel: string;
    currentLabel?: string;
    matched: boolean;
}

// Interface for cell metadata with labels
export interface CellMetadata {
    type?: string;
    id?: string;
    edits?: Array<{
        cellValue: string;
        timestamp: number;
        type: string;
        author?: string;
    }>;
    cellLabel?: string;
}

// Interface for source cell versions with labels
export interface SourceCellVersions {
    cellId: string;
    content: string;
    versions: any[];
    notebookId: string;
    cellLabel?: string;
}

// Initialize the database
export async function initializeCellLabelDb(db: Database): Promise<void> {
    console.time("initializeCellLabelDb");
    
    // Create tables if they don't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS cell_labels (
            cell_id TEXT PRIMARY KEY,
            cell_label TEXT,
            start_time TEXT,
            end_time TEXT,
            character TEXT,
            dialogue TEXT,
            notebook_id TEXT,
            uri TEXT,
            line INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS source_cells_with_labels (
            cell_id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            versions TEXT, -- JSON array of versions
            notebook_id TEXT,
            uri TEXT,
            line INTEGER,
            cell_label TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_cell_labels_cell_id ON cell_labels(cell_id);
        CREATE INDEX IF NOT EXISTS idx_cell_labels_notebook_id ON cell_labels(notebook_id);
        CREATE INDEX IF NOT EXISTS idx_cell_labels_start_time ON cell_labels(start_time);
        CREATE INDEX IF NOT EXISTS idx_source_cells_labels_cell_id ON source_cells_with_labels(cell_id);
        CREATE INDEX IF NOT EXISTS idx_source_cells_labels_notebook_id ON source_cells_with_labels(notebook_id);
        CREATE INDEX IF NOT EXISTS idx_source_cells_labels_content ON source_cells_with_labels(content);

        -- Create standalone FTS5 virtual table (not external content)
        CREATE VIRTUAL TABLE IF NOT EXISTS source_cells_labels_fts USING fts5(
            cell_id UNINDEXED,
            content,
            cell_label
        );
    `);
    
    // Drop existing triggers if they exist to recreate them properly
    db.exec(`
        DROP TRIGGER IF EXISTS source_cells_labels_ai;
        DROP TRIGGER IF EXISTS source_cells_labels_ad;  
        DROP TRIGGER IF EXISTS source_cells_labels_au;
    `);
    
    // Create new triggers for standalone FTS5 table
    db.exec(`
        CREATE TRIGGER source_cells_labels_ai AFTER INSERT ON source_cells_with_labels BEGIN
            INSERT INTO source_cells_labels_fts(cell_id, content, cell_label) 
            VALUES (new.cell_id, new.content, COALESCE(new.cell_label, ''));
        END;
        
        CREATE TRIGGER source_cells_labels_ad AFTER DELETE ON source_cells_with_labels BEGIN
            DELETE FROM source_cells_labels_fts WHERE rowid = old.rowid;
        END;
        
        CREATE TRIGGER source_cells_labels_au AFTER UPDATE ON source_cells_with_labels BEGIN
            DELETE FROM source_cells_labels_fts WHERE rowid = old.rowid;
            INSERT INTO source_cells_labels_fts(cell_id, content, cell_label) 
            VALUES (new.cell_id, new.content, COALESCE(new.cell_label, ''));
        END;
    `);
    
    console.timeEnd("initializeCellLabelDb");
}

// Function to populate FTS5 from existing main table data
export function populateCellLabelsFTS5FromMainTable(db: Database): void {
    console.log("Populating cell labels FTS5 table from main table data...");
    
    try {
        // First check if the main table exists
        const tableExistsStmt = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='source_cells_with_labels'
        `);
        tableExistsStmt.step();
        const tableExists = tableExistsStmt.getAsObject();
        tableExistsStmt.free();
        
        if (!tableExists || !tableExists.name) {
            console.log("Source cells with labels table does not exist, skipping FTS5 population");
            return;
        }
        
        // Check if the main table has data
        const checkStmt = db.prepare("SELECT COUNT(*) as count FROM source_cells_with_labels");
        checkStmt.step();
        const mainTableCount = checkStmt.getAsObject().count as number;
        checkStmt.free();
        
        if (mainTableCount === 0) {
            console.log("Source cells with labels table is empty, skipping FTS5 population");
            return;
        }
        
        // Clear existing FTS5 data
        db.exec("DELETE FROM source_cells_labels_fts");
        
        // Insert all existing data into FTS5
        db.exec(`
            INSERT INTO source_cells_labels_fts(cell_id, content, cell_label)
            SELECT cell_id, content, COALESCE(cell_label, '') 
            FROM source_cells_with_labels
        `);
        
        const countStmt = db.prepare("SELECT COUNT(*) as count FROM source_cells_labels_fts");
        countStmt.step();
        const count = countStmt.getAsObject().count as number;
        countStmt.free();
        
        console.log(`Cell labels FTS5 table populated with ${count} entries`);
    } catch (error) {
        console.error("Error populating cell labels FTS5 table:", error);
        // Don't throw the error, just log it to prevent breaking the entire rebuild process
        console.log("Continuing with empty cell labels FTS5 table");
    }
}

// Create and populate the cell label index
export async function createCellLabelIndex(
    db: Database,
    sourceFiles: FileData[],
    targetFiles: FileData[],
    force: boolean = false
): Promise<void> {
    console.time("createCellLabelIndex");
    
    if (force) {
        // Clear existing data if forced
        db.exec("DELETE FROM source_cells_with_labels");
        db.exec("DELETE FROM cell_labels");
    }
    
    // Begin a transaction for better performance with batch inserts
    db.exec("BEGIN TRANSACTION");
    
    try {
        const sourceCellStmt = db.prepare(`
            INSERT OR REPLACE INTO source_cells_with_labels (
                cell_id, content, versions, notebook_id, uri, line, cell_label, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        const cellLabelStmt = db.prepare(`
            INSERT OR REPLACE INTO cell_labels (
                cell_id, cell_label, notebook_id, uri, line, updated_at
            ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        let totalCells = 0;
        
        // Process source files
        for (const file of sourceFiles) {
            for (let cellIndex = 0; cellIndex < file.cells.length; cellIndex++) {
                const cell = file.cells[cellIndex];
                if (cell.metadata?.id) {
                    const cellId = cell.metadata.id;
                    const cellLabel = (cell.metadata as CellMetadata).cellLabel;
                    
                    // Insert into source_cells_with_labels
                    sourceCellStmt.bind([
                        cellId,
                        cell.value || '',
                        JSON.stringify([]), // versions placeholder
                        file.id || '',
                        file.uri.fsPath,
                        cellIndex,
                        cellLabel || null
                    ]);
                    sourceCellStmt.step();
                    sourceCellStmt.reset();
                    
                    // Insert into cell_labels if label exists
                    if (cellLabel) {
                        cellLabelStmt.bind([
                            cellId,
                            cellLabel,
                            file.id || '',
                            file.uri.fsPath,
                            cellIndex
                        ]);
                        cellLabelStmt.step();
                        cellLabelStmt.reset();
                    }
                    
                    totalCells++;
                }
            }
        }
        
        // Process target files
        for (const file of targetFiles) {
            for (let cellIndex = 0; cellIndex < file.cells.length; cellIndex++) {
                const cell = file.cells[cellIndex];
                if (cell.metadata?.id) {
                    const cellId = cell.metadata.id;
                    const cellLabel = (cell.metadata as CellMetadata).cellLabel;
                    
                    // Insert into source_cells_with_labels (target cells can also have labels)
                    sourceCellStmt.bind([
                        cellId,
                        cell.value || '',
                        JSON.stringify([]), // versions placeholder
                        file.id || '',
                        file.uri.fsPath,
                        cellIndex,
                        cellLabel || null
                    ]);
                    sourceCellStmt.step();
                    sourceCellStmt.reset();
                    
                    // Insert into cell_labels if label exists
                    if (cellLabel) {
                        cellLabelStmt.bind([
                            cellId,
                            cellLabel,
                            file.id || '',
                            file.uri.fsPath,
                            cellIndex
                        ]);
                        cellLabelStmt.step();
                        cellLabelStmt.reset();
                    }
                    
                    totalCells++;
                }
            }
        }
        
        sourceCellStmt.free();
        cellLabelStmt.free();
        
        db.exec("COMMIT");
        
        console.log(`Cell label index created with ${totalCells} cells`);
        
    } catch (error) {
        db.exec("ROLLBACK");
        console.error("Error creating cell label index:", error);
        throw error;
    }
    
    console.timeEnd("createCellLabelIndex");
}

// Search functions for cell label importer

// Search source cells by time-based matching (for cell label import matching)
export function searchSourceCellsByTime(
    db: Database,
    startTimeSeconds: number,
    threshold: number = 0.5
): { cellId: string; currentLabel?: string }[] {
    const stmt = db.prepare(`
        SELECT cell_id, cell_label
        FROM source_cells_with_labels
        WHERE cell_id LIKE 'cue-%'
        ORDER BY ABS(
            CAST(SUBSTR(cell_id, 5, INSTR(SUBSTR(cell_id, 5), '-') - 1) AS REAL) - ?
        ) ASC
        LIMIT 10
    `);
    
    try {
        stmt.bind([startTimeSeconds]);
        
        const results: { cellId: string; currentLabel?: string }[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            
            // Extract start time from cell ID and check if within threshold
            const cellId = row["cell_id"] as string;
            const timeMatch = cellId.match(/cue-(\d+(?:\.\d+)?)-/);
            if (timeMatch && timeMatch[1]) {
                const cellStartTime = parseFloat(timeMatch[1]);
                const diff = Math.abs(cellStartTime - startTimeSeconds);
                
                if (diff <= threshold) {
                    results.push({
                        cellId,
                        currentLabel: row["cell_label"] as string || undefined
                    });
                }
            }
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get cell by exact cell ID
export function getCellByCellId(
    db: Database,
    cellId: string
): { cellId: string; content: string; currentLabel?: string } | null {
    const stmt = db.prepare(`
        SELECT cell_id, content, cell_label
        FROM source_cells_with_labels
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
                currentLabel: row["cell_label"] as string || undefined
            };
        }
        
        return null;
    } finally {
        stmt.free();
    }
}

// Update cell labels in the database
export function updateCellLabels(
    db: Database,
    labels: CellLabelData[]
): void {
    db.exec("BEGIN TRANSACTION");
    
    try {
        const updateSourceStmt = db.prepare(`
            UPDATE source_cells_with_labels 
            SET cell_label = ?, updated_at = CURRENT_TIMESTAMP
            WHERE cell_id = ?
        `);
        
        const updateLabelStmt = db.prepare(`
            INSERT OR REPLACE INTO cell_labels (
                cell_id, cell_label, updated_at
            ) VALUES (?, ?, CURRENT_TIMESTAMP)
        `);
        
        for (const label of labels) {
            if (label.cellId && label.newLabel) {
                // Update source_cells_with_labels
                updateSourceStmt.bind([label.newLabel, label.cellId]);
                updateSourceStmt.step();
                updateSourceStmt.reset();
                
                // Update cell_labels
                updateLabelStmt.bind([label.cellId, label.newLabel]);
                updateLabelStmt.step();
                updateLabelStmt.reset();
            }
        }
        
        updateSourceStmt.free();
        updateLabelStmt.free();
        
        db.exec("COMMIT");
        
        console.log(`Updated ${labels.length} cell labels in database`);
        
    } catch (error) {
        db.exec("ROLLBACK");
        console.error("Error updating cell labels:", error);
        throw error;
    }
}

// Search cells by content and labels using FTS5
export function searchCellsByContent(
    db: Database,
    query: string,
    limit: number = 15
): SourceCellVersions[] {
    if (!query || query.trim() === '') {
        return [];
    }
    
    // First check if the FTS5 table has any data
    const countStmt = db.prepare("SELECT COUNT(*) as count FROM source_cells_labels_fts");
    countStmt.step();
    const ftsCount = countStmt.getAsObject().count as number;
    countStmt.free();
    
    if (ftsCount === 0) {
        console.warn("Cell labels FTS5 table is empty, populating it...");
        try {
            populateCellLabelsFTS5FromMainTable(db);
        } catch (rebuildError) {
            console.error("Failed to populate cell labels FTS5 table:", rebuildError);
            // Fall back to non-FTS search immediately
            return searchCellsByContentFallback(db, query, limit);
        }
    }
    
    try {
        // Escape special characters and format for FTS5
        const cleanQuery = query.replace(/['"]/g, '').trim();
        const ftsQuery = cleanQuery.split(/\s+/).filter(term => term.length > 0).map(term => `"${term}"*`).join(" OR ");
        
        if (!ftsQuery) {
            return [];
        }
        
        // Step 1: Query FTS5 table directly to get matching cell_ids
        const ftsStmt = db.prepare(`
            SELECT cell_id FROM source_cells_labels_fts 
            WHERE (content MATCH ? OR cell_label MATCH ?)
            ORDER BY bm25(source_cells_labels_fts)
            LIMIT ?
        `);
        
        ftsStmt.bind([ftsQuery, ftsQuery, limit]);
        
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
        const mainStmt = db.prepare(`SELECT * FROM source_cells_with_labels WHERE cell_id IN (${placeholders})`);
        mainStmt.bind(matchingIds);
        
        const results: SourceCellVersions[] = [];
        while (mainStmt.step()) {
            const row = mainStmt.getAsObject();
            results.push({
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
                versions: JSON.parse(row["versions"] as string || "[]"),
                notebookId: row["notebook_id"] as string,
                cellLabel: row["cell_label"] as string || undefined
            });
        }
        
        mainStmt.free();
        return results;
        
    } catch (error) {
        console.error("Error in searchCellsByContent:", error);
        // Fallback to non-FTS search if FTS fails
        return searchCellsByContentFallback(db, query, limit);
    }
}

// Fallback search function for cells by content
function searchCellsByContentFallback(
    db: Database,
    query: string,
    limit: number
): SourceCellVersions[] {
    const cleanQuery = query.replace(/['"]/g, '').trim();
    
    const fallbackStmt = db.prepare(`
        SELECT * FROM source_cells_with_labels 
        WHERE content LIKE ? OR cell_label LIKE ?
        ORDER BY cell_id
        LIMIT ?
    `);
    
    try {
        const likeQuery = `%${cleanQuery}%`;
        fallbackStmt.bind([likeQuery, likeQuery, limit]);
        const results: SourceCellVersions[] = [];
        while (fallbackStmt.step()) {
            const row = fallbackStmt.getAsObject();
            results.push({
                cellId: row["cell_id"] as string,
                content: row["content"] as string,
                versions: JSON.parse(row["versions"] as string || "[]"),
                notebookId: row["notebook_id"] as string,
                cellLabel: row["cell_label"] as string || undefined
            });
        }
        return results;
    } finally {
        fallbackStmt.free();
    }
}

// Get all cells with labels
export function getAllCellsWithLabels(db: Database): SourceCellVersions[] {
    const stmt = db.prepare(`
        SELECT * FROM source_cells_with_labels
        WHERE cell_label IS NOT NULL AND cell_label != ''
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
                cellLabel: row["cell_label"] as string
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Save the database to disk
export async function saveCellLabelDb(db: Database): Promise<void> {
    const workspaceUri = getWorkSpaceUri();
    if (!workspaceUri) {
        console.warn("No workspace found, cannot save cell label database");
        return;
    }
    
    const dbUri = vscode.Uri.joinPath(workspaceUri, ...cellLabelDbPath);
    
    try {
        // Ensure the directory exists
        const dirUri = vscode.Uri.joinPath(dbUri, "..");
        await vscode.workspace.fs.createDirectory(dirUri);
        
        // Export database to buffer and save
        const data = db.export();
        await vscode.workspace.fs.writeFile(dbUri, data);
        
        console.log(`Cell label database saved to ${dbUri.fsPath}`);
    } catch (error) {
        console.error("Error saving cell label database:", error);
        throw error;
    }
} 