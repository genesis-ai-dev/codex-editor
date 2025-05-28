import * as vscode from "vscode";
import { Database } from "sql.js-fts5";
import { getWorkSpaceUri } from "../utils";
import { ZeroDraftIndexRecord, CellWithMetadata } from "../activationHelpers/contextAware/miniIndex/indexes/zeroDraftIndex";
import { zeroDraftDocumentLoader } from "../utils/zeroDraftUtils";

// Path for the SQLite database
const zeroDraftDbPath = [".project", "zero_draft.sqlite"];

// Initialize the database
export async function initializeZeroDraftDb(db: Database): Promise<void> {
    console.time("initializeZeroDraftDb");
    
    // Create tables if they don't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS zero_draft_records (
            cell_id TEXT PRIMARY KEY,
            cells_json TEXT NOT NULL -- JSON array of CellWithMetadata
        );

        CREATE TABLE IF NOT EXISTS zero_draft_cells (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cell_id TEXT NOT NULL,
            content TEXT NOT NULL,
            source TEXT NOT NULL,
            uploaded_at TEXT NOT NULL,
            original_file_created_at TEXT,
            original_file_modified_at TEXT,
            metadata_json TEXT, -- JSON object for metadata
            FOREIGN KEY (cell_id) REFERENCES zero_draft_records(cell_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_zero_draft_cells_cell_id ON zero_draft_cells(cell_id);
        CREATE INDEX IF NOT EXISTS idx_zero_draft_cells_content ON zero_draft_cells(content);
        CREATE INDEX IF NOT EXISTS idx_zero_draft_cells_source ON zero_draft_cells(source);

        -- Create FTS5 virtual table if it doesn't exist
        CREATE VIRTUAL TABLE IF NOT EXISTS zero_draft_fts USING fts5(
            cell_id, 
            content,
            content='zero_draft_cells',
            content_rowid='id'
        );
    `);
    
    // Check if triggers exist and create them if they don't
    const triggerCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?");
    
    const triggers = [
        {
            name: 'zero_draft_ai',
            sql: `CREATE TRIGGER zero_draft_ai AFTER INSERT ON zero_draft_cells BEGIN
                INSERT INTO zero_draft_fts(rowid, cell_id, content) 
                VALUES (new.id, new.cell_id, new.content);
            END;`
        },
        {
            name: 'zero_draft_ad',
            sql: `CREATE TRIGGER zero_draft_ad AFTER DELETE ON zero_draft_cells BEGIN
                INSERT INTO zero_draft_fts(zero_draft_fts, rowid, cell_id, content) 
                VALUES('delete', old.id, old.cell_id, old.content);
            END;`
        },
        {
            name: 'zero_draft_au',
            sql: `CREATE TRIGGER zero_draft_au AFTER UPDATE ON zero_draft_cells BEGIN
                INSERT INTO zero_draft_fts(zero_draft_fts, rowid, cell_id, content) 
                VALUES('delete', old.id, old.cell_id, old.content);
                INSERT INTO zero_draft_fts(rowid, cell_id, content) 
                VALUES (new.id, new.cell_id, new.content);
            END;`
        }
    ];
    
    triggers.forEach(trigger => {
        triggerCheck.bind([trigger.name]);
        if (!triggerCheck.step()) {
            db.exec(trigger.sql);
        }
        triggerCheck.reset();
    });
    
    triggerCheck.free();
    
    console.timeEnd("initializeZeroDraftDb");
}

// Create and populate the zero draft index
export async function createZeroDraftIndex(
    db: Database,
    force: boolean = false
): Promise<void> {
    console.time("createZeroDraftIndex");
    
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.error("No workspace folder found");
        return;
    }
    
    if (force) {
        // Clear existing data if forced
        db.exec("DELETE FROM zero_draft_records");
        db.exec("DELETE FROM zero_draft_cells");
    }
    
    const zeroDraftFolder = vscode.Uri.joinPath(workspaceFolders[0].uri, "files", "zero_drafts");
    const zeroDraftFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(zeroDraftFolder, "*.{jsonl,json,tsv,txt}")
    );
    console.log("Found", zeroDraftFiles.length, "Zero Draft files");
    
    // Begin a transaction for better performance with batch inserts
    db.exec("BEGIN TRANSACTION");
    
    try {
        const recordStmt = db.prepare(`
            INSERT OR REPLACE INTO zero_draft_records (cell_id, cells_json) 
            VALUES (?, ?)
        `);
        
        const cellStmt = db.prepare(`
            INSERT INTO zero_draft_cells (
                cell_id, content, source, uploaded_at, 
                original_file_created_at, original_file_modified_at, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        let totalRecordsProcessed = 0;
        
        // Batch process files
        const batchSize = 10;
        for (let i = 0; i < zeroDraftFiles.length; i += batchSize) {
            const batch = zeroDraftFiles.slice(i, i + batchSize);
            
            for (const file of batch) {
                const recordsProcessed = await processZeroDraftFile(db, file, recordStmt, cellStmt);
                totalRecordsProcessed += recordsProcessed;
                
                // Commit in batches to avoid large transactions
                if (totalRecordsProcessed % 1000 === 0) {
                    db.exec("COMMIT");
                    db.exec("BEGIN TRANSACTION");
                }
            }
        }
        
        // Commit any remaining inserts
        db.exec("COMMIT");
        recordStmt.free();
        cellStmt.free();
        
        console.log(`Zero Draft index created with ${totalRecordsProcessed} total records`);
    } catch (error) {
        // Rollback on error
        db.exec("ROLLBACK");
        console.error("Error creating zero draft index:", error);
        throw error;
    }
    
    console.timeEnd("createZeroDraftIndex");
}

// Process a single zero draft file
async function processZeroDraftFile(
    db: Database,
    uri: vscode.Uri,
    recordStmt: any,
    cellStmt: any
): Promise<number> {
    const document = await vscode.workspace.openTextDocument(uri);
    const records = zeroDraftDocumentLoader(document);

    const fileStats = await vscode.workspace.fs.stat(uri);
    const originalFileCreatedAt = new Date(fileStats.ctime).toISOString();
    const originalFileModifiedAt = new Date(fileStats.mtime).toISOString();

    let recordsProcessed = 0;

    for (const record of records) {
        recordsProcessed++;
        
        // Update file timestamps for all cells
        record.cells.forEach((cell) => {
            cell.originalFileCreatedAt = originalFileCreatedAt;
            cell.originalFileModifiedAt = originalFileModifiedAt;
        });

        // Check if record already exists
        const existingStmt = db.prepare("SELECT cells_json FROM zero_draft_records WHERE cell_id = ?");
        existingStmt.bind([record.cellId]);
        
        let existingCells: CellWithMetadata[] = [];
        if (existingStmt.step()) {
            const row = existingStmt.getAsObject();
            existingCells = JSON.parse(row["cells_json"] as string || "[]");
        }
        existingStmt.free();
        
        // Merge with existing cells
        const updatedCells = [...existingCells, ...record.cells];
        
        // Insert/update record
        recordStmt.bind([record.cellId, JSON.stringify(updatedCells)]);
        recordStmt.step();
        recordStmt.reset();
        
        // Clear existing cells for this record
        const deleteStmt = db.prepare("DELETE FROM zero_draft_cells WHERE cell_id = ?");
        deleteStmt.bind([record.cellId]);
        deleteStmt.step();
        deleteStmt.free();
        
        // Insert all cells
        for (const cell of updatedCells) {
            cellStmt.bind([
                record.cellId,
                cell.content,
                cell.source,
                cell.uploadedAt,
                cell.originalFileCreatedAt || "",
                cell.originalFileModifiedAt || "",
                JSON.stringify(cell.metadata || {})
            ]);
            cellStmt.step();
            cellStmt.reset();
        }
    }

    console.log(`Processed file ${uri.fsPath}, processed ${recordsProcessed} records`);
    return recordsProcessed;
}

// Search functions equivalent to MiniSearch operations

// Get content options for a given cellId (similar to getContentOptionsForCellId)
export function getContentOptionsForCellId(
    db: Database,
    cellId: string
): Partial<ZeroDraftIndexRecord> | null {
    const stmt = db.prepare(`
        SELECT cell_id, cells_json FROM zero_draft_records 
        WHERE cell_id = ? 
        LIMIT 1
    `);
    
    try {
        stmt.bind([cellId]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            const cells = JSON.parse(row["cells_json"] as string || "[]");
            
            return {
                cellId: row["cell_id"] as string,
                cells: cells as CellWithMetadata[],
            };
        }
        
        return null;
    } finally {
        stmt.free();
    }
}

// Search zero draft content
export function searchZeroDraftContent(
    db: Database,
    query: string,
    limit: number = 15
): ZeroDraftIndexRecord[] {
    const stmt = db.prepare(`
        SELECT DISTINCT r.cell_id, r.cells_json 
        FROM zero_draft_records r
        JOIN zero_draft_fts fts ON r.cell_id = fts.cell_id
        WHERE fts.content MATCH ? 
        ORDER BY rank 
        LIMIT ?
    `);
    
    try {
        // Format query for FTS5
        const ftsQuery = query.split(/\s+/).map(term => `"${term}"*`).join(" OR ");
        stmt.bind([ftsQuery, limit]);
        
        const results: ZeroDraftIndexRecord[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const cells = JSON.parse(row["cells_json"] as string || "[]");
            
            results.push({
                id: row["cell_id"] as string,
                cellId: row["cell_id"] as string,
                cells: cells as CellWithMetadata[],
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get all zero draft records
export function getAllZeroDraftRecords(db: Database): ZeroDraftIndexRecord[] {
    const stmt = db.prepare(`
        SELECT cell_id, cells_json FROM zero_draft_records 
        ORDER BY cell_id
    `);
    
    try {
        const results: ZeroDraftIndexRecord[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const cells = JSON.parse(row["cells_json"] as string || "[]");
            
            results.push({
                id: row["cell_id"] as string,
                cellId: row["cell_id"] as string,
                cells: cells as CellWithMetadata[],
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Remove records by source file
export function removeRecordsBySource(db: Database, sourceUri: string): number {
    const stmt = db.prepare(`
        DELETE FROM zero_draft_records 
        WHERE cell_id IN (
            SELECT DISTINCT cell_id FROM zero_draft_cells 
            WHERE source = ?
        )
    `);
    
    try {
        stmt.bind([sourceUri]);
        stmt.step();
        return db.getRowsModified();
    } finally {
        stmt.free();
    }
}

// Get document count
export function getDocumentCount(db: Database): number {
    const stmt = db.prepare("SELECT COUNT(*) as count FROM zero_draft_records");
    
    try {
        if (stmt.step()) {
            const row = stmt.getAsObject();
            return row["count"] as number;
        }
        return 0;
    } finally {
        stmt.free();
    }
}

// Save the database to disk
export async function saveZeroDraftDb(db: Database): Promise<void> {
    const workspaceFolder = getWorkSpaceUri();
    if (!workspaceFolder) {
        console.warn("Workspace folder not found. Cannot save zero draft database.");
        return;
    }
    
    const dbPath = vscode.Uri.joinPath(workspaceFolder, ...zeroDraftDbPath);
    
    try {
        // Export the database to a binary array
        const data = db.export();
        
        // Create parent directory if it doesn't exist
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(workspaceFolder, ".project")
        );
        
        // Write to file
        await vscode.workspace.fs.writeFile(dbPath, data);
        console.log("Zero draft database saved successfully");
    } catch (error) {
        console.error("Error saving zero draft database:", error);
        throw error;
    }
} 