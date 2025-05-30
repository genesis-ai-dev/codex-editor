import * as vscode from "vscode";
import { Database } from "sql.js-fts5";
import { getWorkSpaceUri } from "../utils";

// Path for the SQLite database
const dynamicTableDbPath = [".project", "dynamic_table.sqlite"];

// Interface for table records with dynamic fields
export interface TableRecord {
    id: string;
    file_path: string;
    file_name: string;
    row_number: number;
    [key: string]: any; // Allow for dynamic keys based on table columns
}

// Interface for table metadata
export interface TableMetadata {
    filePath: string;
    fileName: string;
    headers: string[];
    delimiter: string;
    totalRows: number;
    lastModified: string;
}

// Supported file extensions
const SUPPORTED_EXTENSIONS = [".csv", ".tsv", ".tab"];

// Initialize the database
export async function initializeDynamicTableDb(db: Database): Promise<void> {
    console.time("initializeDynamicTableDb");
    
    // Create tables if they don't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS table_metadata (
            file_path TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            headers TEXT NOT NULL, -- JSON array of column headers
            delimiter TEXT NOT NULL,
            total_rows INTEGER NOT NULL,
            last_modified TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS table_records (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            file_name TEXT NOT NULL,
            row_number INTEGER NOT NULL,
            record_data TEXT NOT NULL, -- JSON object containing all column data
            FOREIGN KEY (file_path) REFERENCES table_metadata(file_path) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_table_records_file_path ON table_records(file_path);
        CREATE INDEX IF NOT EXISTS idx_table_records_row_number ON table_records(row_number);
        CREATE INDEX IF NOT EXISTS idx_table_metadata_file_name ON table_metadata(file_name);

        -- Create standalone FTS5 virtual table (not external content)
        CREATE VIRTUAL TABLE IF NOT EXISTS table_records_fts USING fts5(
            id UNINDEXED,
            file_path UNINDEXED,
            file_name,
            record_data
        );
    `);
    
    // Drop existing triggers if they exist to recreate them properly
    db.exec(`
        DROP TRIGGER IF EXISTS table_records_ai;
        DROP TRIGGER IF EXISTS table_records_ad;  
        DROP TRIGGER IF EXISTS table_records_au;
    `);
    
    // Create new triggers for standalone FTS5 table
    db.exec(`
        CREATE TRIGGER table_records_ai AFTER INSERT ON table_records BEGIN
            INSERT INTO table_records_fts(id, file_path, file_name, record_data) 
            VALUES (new.id, new.file_path, new.file_name, new.record_data);
        END;
        
        CREATE TRIGGER table_records_ad AFTER DELETE ON table_records BEGIN
            DELETE FROM table_records_fts WHERE rowid = old.rowid;
        END;
        
        CREATE TRIGGER table_records_au AFTER UPDATE ON table_records BEGIN
            DELETE FROM table_records_fts WHERE rowid = old.rowid;
            INSERT INTO table_records_fts(id, file_path, file_name, record_data) 
            VALUES (new.id, new.file_path, new.file_name, new.record_data);
        END;
    `);
    
    console.timeEnd("initializeDynamicTableDb");
}

// Create and populate the dynamic table index
export async function createDynamicTableIndex(
    db: Database,
    force: boolean = false
): Promise<void> {
    const timerId = `createDynamicTableIndex-${Date.now()}`;
    console.time(timerId);
    
    const workspaceFolder = getWorkSpaceUri();
    if (!workspaceFolder) {
        console.warn("Workspace folder not found for Dynamic Table Index.");
        return;
    }
    
    if (force) {
        // Clear existing data if forced
        db.exec("DELETE FROM table_records");
        db.exec("DELETE FROM table_metadata");
    }
    
    // Find all supported table files
    const tableFiles = await vscode.workspace.findFiles(`**/*{${SUPPORTED_EXTENSIONS.join(",")}}`);
    console.log(`Found ${tableFiles.length} table files to index`);
    
    if (tableFiles.length === 0) {
        console.log("No table files found to index");
        console.timeEnd(timerId);
        return;
    }
    
    // Process files in parallel with controlled concurrency
    const BATCH_SIZE = 5; // Process 5 files at a time to avoid overwhelming the system
    const batches: vscode.Uri[][] = [];
    
    // Split files into batches
    for (let i = 0; i < tableFiles.length; i += BATCH_SIZE) {
        batches.push(tableFiles.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`Processing ${tableFiles.length} files in ${batches.length} batches of ${BATCH_SIZE}`);
    
    // Prepare statements outside the transaction for reuse
        const metadataStmt = db.prepare(`
            INSERT OR REPLACE INTO table_metadata (
                file_path, file_name, headers, delimiter, total_rows, last_modified
            ) VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        const recordStmt = db.prepare(`
            INSERT OR REPLACE INTO table_records (
                id, file_path, file_name, row_number, record_data
            ) VALUES (?, ?, ?, ?, ?)
        `);
        
        let totalRecords = 0;
    let processedFiles = 0;
    
    try {
        // Process batches sequentially, but files within each batch in parallel
        for (const batch of batches) {
            console.log(`Processing batch ${Math.floor(processedFiles / BATCH_SIZE) + 1}/${batches.length}...`);
            
            // Parse all files in the current batch in parallel
            const batchResults = await Promise.allSettled(
                batch.map(async (uri) => {
            try {
                const [records, headers, delimiter] = await parseTableFile(uri);
                
                if (headers.length === 0) {
                    console.warn(`No headers found in table file: ${uri.fsPath}. Skipping file.`);
                            return null;
                }
                
                const fileName = uri.fsPath.split('/').pop() || uri.fsPath;
                const filePath = uri.fsPath;
                
                // Get file stats
                const fileStat = await vscode.workspace.fs.stat(uri);
                const lastModified = new Date(fileStat.mtime).toISOString();
                        
                        return {
                            filePath,
                            fileName,
                            headers,
                            delimiter,
                            records,
                            lastModified
                        };
                    } catch (error) {
                        console.error(`Error processing table file ${uri.fsPath}:`, error);
                        return null;
                    }
                })
            );
            
            // Begin transaction for this batch
            db.exec("BEGIN TRANSACTION");
            
            try {
                // Insert all successful results from the batch
                for (const result of batchResults) {
                    if (result.status === 'fulfilled' && result.value) {
                        const { filePath, fileName, headers, delimiter, records, lastModified } = result.value;
                
                // Insert metadata
                metadataStmt.bind([
                    filePath,
                    fileName,
                    JSON.stringify(headers),
                    delimiter,
                    records.length,
                    lastModified
                ]);
                metadataStmt.step();
                metadataStmt.reset();
                
                // Insert records
                for (const record of records) {
                    recordStmt.bind([
                        record.id,
                        filePath,
                        fileName,
                        record.row_number || 0,
                        JSON.stringify(record)
                    ]);
                    recordStmt.step();
                    recordStmt.reset();
                    totalRecords++;
                }
                
                console.log(`Indexed ${records.length} records from ${fileName}`);
                        processedFiles++;
                    } else if (result.status === 'rejected') {
                        console.error(`Failed to process file in batch:`, result.reason);
                    }
                }
                
                // Commit the batch transaction
                db.exec("COMMIT");
                
            } catch (error) {
                // Rollback the batch on error
                db.exec("ROLLBACK");
                console.error("Error inserting batch data:", error);
                throw error;
            }
        }
        
        metadataStmt.free();
        recordStmt.free();
        
        console.log(`Dynamic table index created with ${totalRecords} total records from ${processedFiles} files`);
    } catch (error) {
        // Clean up statements on error
        metadataStmt.free();
        recordStmt.free();
        console.error("Error creating dynamic table index:", error);
        throw error;
    }
    
    console.timeEnd(timerId);
}

// Helper function to detect delimiter
function detectDelimiter(firstLine: string): string {
    const delimiters = {
        "\t": (firstLine.match(/\t/g) || []).length,
        ",": (firstLine.match(/,/g) || []).length,
    };

    return delimiters["\t"] > delimiters[","] ? "\t" : ",";
}

// Parse table file and return records, headers, and delimiter
export async function parseTableFile(uri: vscode.Uri): Promise<[TableRecord[], string[], string]> {
    const document = await vscode.workspace.openTextDocument(uri);
    const content = document.getText();
    const records: TableRecord[] = [];
    const lines = content.split("\n").filter((line) => line.trim() !== "");

    if (lines.length === 0) return [records, [], ""];

    // Detect the delimiter from the first line
    const delimiter = detectDelimiter(lines[0]);

    // Assume the first non-empty line contains headers
    const headers = lines[0].split(delimiter).map((header) => header.trim());

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "") continue;

        const fields = line.split(delimiter);
        if (fields.length !== headers.length) {
            console.warn(`Malformed line at ${uri.fsPath}:${i + 1}. Skipping line.`);
            continue;
        }

        const record: TableRecord = { 
            id: generateUniqueId(uri.fsPath, i),
            file_path: uri.fsPath,
            file_name: uri.fsPath.split('/').pop() || uri.fsPath,
            row_number: i
        };

        headers.forEach((header, index) => {
            record[header] = fields[index].trim();
        });

        records.push(record);
    }

    return [records, headers, delimiter];
}

// Function to generate a unique ID for each record
function generateUniqueId(filePath: string, lineNumber: number): string {
    // Use file path and line number to ensure uniqueness
    return `${filePath}:${lineNumber}`;
}

// Search functions for dynamic table data

// Search across all table records
export function searchTableRecords(
    db: Database,
    query: string,
    filePath?: string,
    limit: number = 50
): TableRecord[] {
    let sql = `
        SELECT tr.* FROM table_records tr
        JOIN table_records_fts fts ON tr.rowid = fts.rowid
        WHERE fts.record_data MATCH ?
    `;
    
    const params: any[] = [];
    
    // Format query for FTS5
    const ftsQuery = query.split(/\s+/).map(term => `"${term}"*`).join(" OR ");
    params.push(ftsQuery);
    
    if (filePath) {
        sql += ` AND tr.file_path = ?`;
        params.push(filePath);
    }
    
    sql += ` ORDER BY fts.rank LIMIT ?`;
    params.push(limit);
    
    const stmt = db.prepare(sql);
    
    try {
        stmt.bind(params);
        
        const results: TableRecord[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const recordData = JSON.parse(row["record_data"] as string);
            results.push({
                ...recordData,
                id: row["id"] as string,
                file_path: row["file_path"] as string,
                file_name: row["file_name"] as string,
                row_number: row["row_number"] as number,
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Search within a specific column across all files
export function searchTableColumn(
    db: Database,
    columnName: string,
    query: string,
    filePath?: string,
    limit: number = 50
): TableRecord[] {
    let sql = `
        SELECT tr.* FROM table_records tr
        WHERE json_extract(tr.record_data, '$."' || ? || '"') LIKE ?
    `;
    
    const params: any[] = [columnName, `%${query}%`];
    
    if (filePath) {
        sql += ` AND tr.file_path = ?`;
        params.push(filePath);
    }
    
    sql += ` ORDER BY tr.file_name, tr.row_number LIMIT ?`;
    params.push(limit);
    
    const stmt = db.prepare(sql);
    
    try {
        stmt.bind(params);
        
        const results: TableRecord[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const recordData = JSON.parse(row["record_data"] as string);
            results.push({
                ...recordData,
                id: row["id"] as string,
                file_path: row["file_path"] as string,
                file_name: row["file_name"] as string,
                row_number: row["row_number"] as number,
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get all records from a specific file
export function getTableRecordsByFile(
    db: Database,
    filePath: string,
    limit: number = 1000
): TableRecord[] {
    const stmt = db.prepare(`
        SELECT * FROM table_records 
        WHERE file_path = ?
        ORDER BY row_number
        LIMIT ?
    `);
    
    try {
        stmt.bind([filePath, limit]);
        
        const results: TableRecord[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const recordData = JSON.parse(row["record_data"] as string);
            results.push({
                ...recordData,
                id: row["id"] as string,
                file_path: row["file_path"] as string,
                file_name: row["file_name"] as string,
                row_number: row["row_number"] as number,
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get table metadata for all indexed files
export function getAllTableMetadata(db: Database): TableMetadata[] {
    const stmt = db.prepare(`
        SELECT * FROM table_metadata 
        ORDER BY file_name
    `);
    
    try {
        const results: TableMetadata[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                filePath: row["file_path"] as string,
                fileName: row["file_name"] as string,
                headers: JSON.parse(row["headers"] as string),
                delimiter: row["delimiter"] as string,
                totalRows: row["total_rows"] as number,
                lastModified: row["last_modified"] as string,
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get metadata for a specific file
export function getTableMetadata(db: Database, filePath: string): TableMetadata | null {
    const stmt = db.prepare(`
        SELECT * FROM table_metadata 
        WHERE file_path = ?
    `);
    
    try {
        stmt.bind([filePath]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            return {
                filePath: row["file_path"] as string,
                fileName: row["file_name"] as string,
                headers: JSON.parse(row["headers"] as string),
                delimiter: row["delimiter"] as string,
                totalRows: row["total_rows"] as number,
                lastModified: row["last_modified"] as string,
            };
        }
        
        return null;
    } finally {
        stmt.free();
    }
}

// Get unique values for a specific column across all files or a specific file
export function getColumnValues(
    db: Database,
    columnName: string,
    filePath?: string,
    limit: number = 100
): string[] {
    let sql = `
        SELECT DISTINCT json_extract(record_data, '$."' || ? || '"') as value
        FROM table_records
        WHERE value IS NOT NULL AND value != ''
    `;
    
    const params: any[] = [columnName];
    
    if (filePath) {
        sql += ` AND file_path = ?`;
        params.push(filePath);
    }
    
    sql += ` ORDER BY value LIMIT ?`;
    params.push(limit);
    
    const stmt = db.prepare(sql);
    
    try {
        stmt.bind(params);
        
        const results: string[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const value = row["value"];
            if (value) {
                results.push(value as string);
            }
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get statistics for a specific file
export function getTableStatistics(db: Database, filePath: string): {
    totalRows: number;
    columnCount: number;
    columns: { name: string; uniqueValues: number; nullCount: number }[];
} | null {
    const metadata = getTableMetadata(db, filePath);
    if (!metadata) return null;
    
    const columnStats: { name: string; uniqueValues: number; nullCount: number }[] = [];
    
    for (const columnName of metadata.headers) {
        // Get unique value count
        const uniqueStmt = db.prepare(`
            SELECT COUNT(DISTINCT json_extract(record_data, '$."' || ? || '"')) as unique_count
            FROM table_records
            WHERE file_path = ?
        `);
        
        // Get null count
        const nullStmt = db.prepare(`
            SELECT COUNT(*) as null_count
            FROM table_records
            WHERE file_path = ?
            AND (json_extract(record_data, '$."' || ? || '"') IS NULL 
                 OR json_extract(record_data, '$."' || ? || '"') = '')
        `);
        
        try {
            uniqueStmt.bind([columnName, filePath]);
            let uniqueCount = 0;
            if (uniqueStmt.step()) {
                uniqueCount = uniqueStmt.getAsObject()["unique_count"] as number;
            }
            
            nullStmt.bind([filePath, columnName, columnName]);
            let nullCount = 0;
            if (nullStmt.step()) {
                nullCount = nullStmt.getAsObject()["null_count"] as number;
            }
            
            columnStats.push({
                name: columnName,
                uniqueValues: uniqueCount,
                nullCount: nullCount,
            });
        } finally {
            uniqueStmt.free();
            nullStmt.free();
        }
    }
    
    return {
        totalRows: metadata.totalRows,
        columnCount: metadata.headers.length,
        columns: columnStats,
    };
}

// Remove a file from the index
export function removeTableFile(db: Database, filePath: string): boolean {
    const stmt = db.prepare(`
        DELETE FROM table_metadata WHERE file_path = ?
    `);
    
    try {
        stmt.bind([filePath]);
        stmt.step();
        return true;
    } catch (error) {
        console.error(`Error removing table file ${filePath}:`, error);
        return false;
    } finally {
        stmt.free();
    }
}

// Update a single file in the index
export async function updateTableFile(db: Database, uri: vscode.Uri): Promise<boolean> {
    try {
        const [records, headers, delimiter] = await parseTableFile(uri);
        
        if (headers.length === 0) {
            console.warn(`No headers found in table file: ${uri.fsPath}. Cannot update.`);
            return false;
        }
        
        const fileName = uri.fsPath.split('/').pop() || uri.fsPath;
        const filePath = uri.fsPath;
        
        // Get file stats
        const fileStat = await vscode.workspace.fs.stat(uri);
        const lastModified = new Date(fileStat.mtime).toISOString();
        
        // Begin transaction
        db.exec("BEGIN TRANSACTION");
        
        try {
            // Remove existing records for this file
            const deleteStmt = db.prepare("DELETE FROM table_records WHERE file_path = ?");
            deleteStmt.bind([filePath]);
            deleteStmt.step();
            deleteStmt.free();
            
            // Update metadata
            const metadataStmt = db.prepare(`
                INSERT OR REPLACE INTO table_metadata (
                    file_path, file_name, headers, delimiter, total_rows, last_modified
                ) VALUES (?, ?, ?, ?, ?, ?)
            `);
            
            metadataStmt.bind([
                filePath,
                fileName,
                JSON.stringify(headers),
                delimiter,
                records.length,
                lastModified
            ]);
            metadataStmt.step();
            metadataStmt.free();
            
            // Insert new records
            const recordStmt = db.prepare(`
                INSERT INTO table_records (
                    id, file_path, file_name, row_number, record_data
                ) VALUES (?, ?, ?, ?, ?)
            `);
            
            for (const record of records) {
                recordStmt.bind([
                    record.id,
                    filePath,
                    fileName,
                    record.row_number || 0,
                    JSON.stringify(record)
                ]);
                recordStmt.step();
                recordStmt.reset();
            }
            
            recordStmt.free();
            
            // Commit transaction
            db.exec("COMMIT");
            
            console.log(`Updated table file ${fileName} with ${records.length} records`);
            return true;
            
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
        
    } catch (error) {
        console.error(`Error updating table file ${uri.fsPath}:`, error);
        return false;
    }
}

// Save the database to disk
export async function saveDynamicTableDb(db: Database): Promise<void> {
    const workspaceFolder = getWorkSpaceUri();
    if (!workspaceFolder) {
        console.warn("Workspace folder not found. Cannot save dynamic table database.");
        return;
    }
    
    const dbPath = vscode.Uri.joinPath(workspaceFolder, ...dynamicTableDbPath);
    
    try {
        // Export the database to a binary array
        const data = db.export();
        
        // Create parent directory if it doesn't exist
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(workspaceFolder, ".project")
        );
        
        // Write to file
        await vscode.workspace.fs.writeFile(dbPath, data);
        console.log("Dynamic table database saved successfully");
    } catch (error) {
        console.error("Error saving dynamic table database:", error);
        throw error;
    }
} 