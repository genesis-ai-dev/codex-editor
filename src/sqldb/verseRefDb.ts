import * as vscode from "vscode";
import { Database } from "sql.js-fts5";
import { getWorkSpaceUri } from "../utils";
import { getFullListOfOrgVerseRefs } from "../utils";

// Path for the SQLite database
const verseRefDbPath = [".project", "verse_ref.sqlite"];

// Interface for verse reference index records
export interface VrefIndex {
    id: string;
    vref: string;
    uri: string;
    position: { line: number; character: number };
}

export interface VrefSearchResult {
    vref: string;
    uri: string;
    position: { line: number; character: number };
}

// Initialize the database
export async function initializeVerseRefDb(db: Database): Promise<void> {
    console.time("initializeVerseRefDb");
    
    // Create tables if they don't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS verse_refs (
            id TEXT PRIMARY KEY,
            vref TEXT NOT NULL,
            uri TEXT NOT NULL,
            line INTEGER NOT NULL,
            character_pos INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_verse_refs_vref ON verse_refs(vref);
        CREATE INDEX IF NOT EXISTS idx_verse_refs_uri ON verse_refs(uri);

        -- Create FTS5 virtual table if it doesn't exist
        CREATE VIRTUAL TABLE IF NOT EXISTS verse_refs_fts USING fts5(
            vref, 
            uri,
            content='verse_refs',
            content_rowid='rowid'
        );
    `);
    
    // Check if triggers exist and create them if they don't
    const triggerCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?");
    
    const triggers = [
        {
            name: 'verse_refs_ai',
            sql: `CREATE TRIGGER verse_refs_ai AFTER INSERT ON verse_refs BEGIN
                INSERT INTO verse_refs_fts(rowid, vref, uri) 
                VALUES (new.rowid, new.vref, new.uri);
            END;`
        },
        {
            name: 'verse_refs_ad',
            sql: `CREATE TRIGGER verse_refs_ad AFTER DELETE ON verse_refs BEGIN
                INSERT INTO verse_refs_fts(verse_refs_fts, rowid, vref, uri) 
                VALUES('delete', old.rowid, old.vref, old.uri);
            END;`
        },
        {
            name: 'verse_refs_au',
            sql: `CREATE TRIGGER verse_refs_au AFTER UPDATE ON verse_refs BEGIN
                INSERT INTO verse_refs_fts(verse_refs_fts, rowid, vref, uri) 
                VALUES('delete', old.rowid, old.vref, old.uri);
                INSERT INTO verse_refs_fts(rowid, vref, uri) 
                VALUES (new.rowid, new.vref, new.uri);
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
    
    console.timeEnd("initializeVerseRefDb");
}

// Create and populate the verse reference index
export async function indexVerseRefsInSourceText(db: Database): Promise<void> {
    console.time("indexVerseRefsInSourceText");
    
    const orgVerseRefsSet = new Set(getFullListOfOrgVerseRefs());
    
    // Clear existing data
    db.exec("DELETE FROM verse_refs");
    
    try {
        const files = await vscode.workspace.findFiles("**/*.source");
        console.log(`Found ${files.length} source files to index for verse references`);
        
        if (files.length === 0) {
            console.log("No source files found to index");
            console.timeEnd("indexVerseRefsInSourceText");
            return;
        }
        
        // Process files in batches with controlled concurrency
        const BATCH_SIZE = 10; // Process 10 files at a time
        const batches: vscode.Uri[][] = [];
        
        // Split files into batches
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            batches.push(files.slice(i, i + BATCH_SIZE));
        }
        
        console.log(`Processing ${files.length} files in ${batches.length} batches of ${BATCH_SIZE}`);
        
        const insertStmt = db.prepare(`
            INSERT INTO verse_refs (id, vref, uri, line, character_pos) 
            VALUES (?, ?, ?, ?, ?)
        `);
        
        let totalVerseRefs = 0;
        let processedFiles = 0;
        
        // Process batches sequentially, but files within each batch in parallel
        for (const batch of batches) {
            console.log(`Processing batch ${Math.floor(processedFiles / BATCH_SIZE) + 1}/${batches.length}...`);
            
            // Parse all files in the current batch in parallel
            const batchResults = await Promise.allSettled(
                batch.map(async (file) => {
                try {
                    const document = await vscode.workspace.openTextDocument(file);
                    const text = document.getText();
                    const lines = text.split(/\r?\n/);
                        
                        const verseRefs: Array<{
                            id: string;
                            vref: string;
                            uri: string;
                            line: number;
                            character_pos: number;
                        }> = [];
                    
                    lines.forEach((line, lineIndex) => {
                        // Extract potential verse references from the line
                        const potentialVrefs = extractPotentialVrefs(line);
                        potentialVrefs.forEach((vref) => {
                            if (orgVerseRefsSet.has(vref)) {
                                const id = `${file.fsPath.replace(/[^a-zA-Z0-9-_]/g, "_")}_${lineIndex}_${line.indexOf(vref)}`;
                                
                                    verseRefs.push({
                                    id,
                                    vref,
                                        uri: file.fsPath,
                                        line: lineIndex,
                                        character_pos: line.indexOf(vref)
                                    });
                            }
                        });
                    });
                        
                        return {
                            filePath: file.fsPath,
                            verseRefs
                        };
                } catch (error) {
                    console.error(`Error processing file in indexVerseRefsInSourceText ${file.fsPath}: ${error}`);
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
                        const { filePath, verseRefs } = result.value;
                        
                        for (const vref of verseRefs) {
                            insertStmt.bind([
                                vref.id,
                                vref.vref,
                                vref.uri,
                                vref.line,
                                vref.character_pos
                            ]);
                            insertStmt.step();
                            insertStmt.reset();
                            totalVerseRefs++;
                        }
                        
                        if (verseRefs.length > 0) {
                            console.log(`Indexed ${verseRefs.length} verse references from ${filePath.split('/').pop()}`);
                        }
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
        
        insertStmt.free();
        
        console.log(`Verse reference index created successfully with ${totalVerseRefs} references from ${processedFiles} files`);
    } catch (error) {
        console.error(`Error indexing verse references: ${error}`);
        throw error;
    }
    
    console.timeEnd("indexVerseRefsInSourceText");
}

// Extract potential verse references from a line
function extractPotentialVrefs(line: string): string[] {
    const verseRefPattern = /\b(?:[1-3])?[A-Za-z]+(?:\s\d+:\d+(-\d+)?)/g;
    const matches = line.match(verseRefPattern);
    return matches || [];
}

// Search verse reference position index
export function searchVerseRefPositionIndex(
    db: Database,
    searchString: string
): VrefSearchResult[] {
    const stmt = db.prepare(`
        SELECT vref, uri, line, character_pos 
        FROM verse_refs 
        WHERE vref = ? 
        ORDER BY uri, line
    `);
    
    try {
        stmt.bind([searchString]);
        
        const results: VrefSearchResult[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                vref: row["vref"] as string,
                uri: row["uri"] as string,
                position: {
                    line: row["line"] as number,
                    character: row["character_pos"] as number,
                },
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Search verse references with FTS
export function searchVerseRefs(
    db: Database,
    query: string,
    limit: number = 15
): VrefSearchResult[] {
    const stmt = db.prepare(`
        SELECT v.vref, v.uri, v.line, v.character_pos 
        FROM verse_refs v
        JOIN verse_refs_fts fts ON v.rowid = fts.rowid
        WHERE fts.vref MATCH ? 
        ORDER BY rank 
        LIMIT ?
    `);
    
    try {
        // Format query for FTS5
        const ftsQuery = query.split(/\s+/).map(term => `"${term}"*`).join(" OR ");
        stmt.bind([ftsQuery, limit]);
        
        const results: VrefSearchResult[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                vref: row["vref"] as string,
                uri: row["uri"] as string,
                position: {
                    line: row["line"] as number,
                    character: row["character_pos"] as number,
                },
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get all verse references
export function getAllVerseRefs(db: Database): VrefSearchResult[] {
    const stmt = db.prepare(`
        SELECT vref, uri, line, character_pos 
        FROM verse_refs 
        ORDER BY vref, uri, line
    `);
    
    try {
        const results: VrefSearchResult[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                vref: row["vref"] as string,
                uri: row["uri"] as string,
                position: {
                    line: row["line"] as number,
                    character: row["character_pos"] as number,
                },
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get verse references by URI
export function getVerseRefsByUri(db: Database, uri: string): VrefSearchResult[] {
    const stmt = db.prepare(`
        SELECT vref, uri, line, character_pos 
        FROM verse_refs 
        WHERE uri = ? 
        ORDER BY line
    `);
    
    try {
        stmt.bind([uri]);
        
        const results: VrefSearchResult[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                vref: row["vref"] as string,
                uri: row["uri"] as string,
                position: {
                    line: row["line"] as number,
                    character: row["character_pos"] as number,
                },
            });
        }
        
        return results;
    } finally {
        stmt.free();
    }
}

// Get document count
export function getVerseRefCount(db: Database): number {
    const stmt = db.prepare("SELECT COUNT(*) as count FROM verse_refs");
    
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
export async function saveVerseRefDb(db: Database): Promise<void> {
    const workspaceFolder = getWorkSpaceUri();
    if (!workspaceFolder) {
        console.warn("Workspace folder not found. Cannot save verse reference database.");
        return;
    }
    
    const dbPath = vscode.Uri.joinPath(workspaceFolder, ...verseRefDbPath);
    
    try {
        // Export the database to a binary array
        const data = db.export();
        
        // Create parent directory if it doesn't exist
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(workspaceFolder, ".project")
        );
        
        // Write to file
        await vscode.workspace.fs.writeFile(dbPath, data);
        console.log("Verse reference database saved successfully");
    } catch (error) {
        console.error("Error saving verse reference database:", error);
        throw error;
    }
} 