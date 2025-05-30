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

        -- Create standalone FTS5 virtual table (not external content)
        CREATE VIRTUAL TABLE IF NOT EXISTS verse_refs_fts USING fts5(
            vref, 
            uri UNINDEXED
        );
    `);
    
    // Drop existing triggers if they exist to recreate them properly
    db.exec(`
        DROP TRIGGER IF EXISTS verse_refs_ai;
        DROP TRIGGER IF EXISTS verse_refs_ad;  
        DROP TRIGGER IF EXISTS verse_refs_au;
    `);
    
    // Create new triggers for standalone FTS5 table
    db.exec(`
        CREATE TRIGGER verse_refs_ai AFTER INSERT ON verse_refs BEGIN
            INSERT INTO verse_refs_fts(vref, uri) 
            VALUES (new.vref, new.uri);
        END;
        
        CREATE TRIGGER verse_refs_ad AFTER DELETE ON verse_refs BEGIN
            DELETE FROM verse_refs_fts WHERE rowid = old.rowid;
        END;
        
        CREATE TRIGGER verse_refs_au AFTER UPDATE ON verse_refs BEGIN
            DELETE FROM verse_refs_fts WHERE rowid = old.rowid;
            INSERT INTO verse_refs_fts(vref, uri) 
            VALUES (new.vref, new.uri);
        END;
    `);
    
    console.timeEnd("initializeVerseRefDb");
}

// Function to populate FTS5 from existing main table data
export function populateVerseRefsFTS5FromMainTable(db: Database): void {
    console.log("Populating verse refs FTS5 table from main table data...");
    
    try {
        // Clear existing FTS5 data
        db.exec("DELETE FROM verse_refs_fts");
        
        // Insert all existing data into FTS5
        db.exec(`
            INSERT INTO verse_refs_fts(vref, uri)
            SELECT vref, uri 
            FROM verse_refs
        `);
        
        const countStmt = db.prepare("SELECT COUNT(*) as count FROM verse_refs_fts");
        countStmt.step();
        const count = countStmt.getAsObject().count as number;
        countStmt.free();
        
        console.log(`Verse refs FTS5 table populated with ${count} entries`);
    } catch (error) {
        console.error("Error populating verse refs FTS5 table:", error);
        throw error;
    }
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
    if (!query || query.trim() === '') {
        return [];
    }
    
    // First check if the FTS5 table has any data
    const countStmt = db.prepare("SELECT COUNT(*) as count FROM verse_refs_fts");
    countStmt.step();
    const ftsCount = countStmt.getAsObject().count as number;
    countStmt.free();
    
    if (ftsCount === 0) {
        console.warn("Verse refs FTS5 table is empty, populating it...");
        try {
            populateVerseRefsFTS5FromMainTable(db);
        } catch (rebuildError) {
            console.error("Failed to populate verse refs FTS5 table:", rebuildError);
            // Fall back to non-FTS search immediately
            return searchVerseRefsFallback(db, query, limit);
        }
    }
    
    // Escape special characters and format for FTS5
    const cleanQuery = query.replace(/['"]/g, '').trim();
    const ftsQuery = cleanQuery.split(/\s+/).filter(term => term.length > 0).map(term => `"${term}"*`).join(" OR ");
    
    if (!ftsQuery) {
        return [];
    }
    
    try {
        // Step 1: Query FTS5 table directly to get matching vrefs
        const ftsStmt = db.prepare(`
            SELECT vref FROM verse_refs_fts 
            WHERE vref MATCH ? 
            ORDER BY bm25(verse_refs_fts)
            LIMIT ?
        `);
        
        ftsStmt.bind([ftsQuery, limit]);
        
        const matchingVrefs: string[] = [];
        while (ftsStmt.step()) {
            const row = ftsStmt.getAsObject();
            matchingVrefs.push(row["vref"] as string);
        }
        ftsStmt.free();
        
        if (matchingVrefs.length === 0) {
            return [];
        }
        
        // Step 2: Get full data from main table using the vrefs
        const placeholders = matchingVrefs.map(() => '?').join(',');
        const mainStmt = db.prepare(`SELECT * FROM verse_refs WHERE vref IN (${placeholders})`);
        mainStmt.bind(matchingVrefs);
        
        const results: VrefSearchResult[] = [];
        while (mainStmt.step()) {
            const row = mainStmt.getAsObject();
            results.push({
                vref: row["vref"] as string,
                uri: row["uri"] as string,
                position: {
                    line: row["line"] as number,
                    character: row["character_pos"] as number,
                },
            });
        }
        
        mainStmt.free();
        return results;
        
    } catch (error) {
        console.error("Error in searchVerseRefs:", error);
        // Fallback to non-FTS search if FTS fails
        return searchVerseRefsFallback(db, query, limit);
    }
}

// Fallback search function for verse refs
function searchVerseRefsFallback(
    db: Database,
    query: string,
    limit: number
): VrefSearchResult[] {
    const cleanQuery = query.replace(/['"]/g, '').trim();
    
    const fallbackStmt = db.prepare(`
        SELECT vref, uri, line, character_pos 
        FROM verse_refs 
        WHERE vref LIKE ? 
        ORDER BY vref
        LIMIT ?
    `);
    
    try {
        fallbackStmt.bind([`%${cleanQuery}%`, limit]);
        const results: VrefSearchResult[] = [];
        while (fallbackStmt.step()) {
            const row = fallbackStmt.getAsObject();
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
        fallbackStmt.free();
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