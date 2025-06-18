import * as vscode from "vscode";
import { StatusBarItem } from "vscode";
import initSqlJs, { Database, SqlJsStatic } from "fts5-sql-bundle";
import path from "path";
import { parseAndImportJSONL } from "./parseAndImportJSONL";
import crypto from "crypto";
import { DictionaryEntry } from "types";

export function getDefinitions(db: Database, headWord: string): string[] {
    const stmt = db.prepare("SELECT definition FROM entries WHERE head_word = ?");
    stmt.bind([headWord]);

    const results: string[] = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row["definition"]) {
            results.push(row["definition"] as string);
        }
    }
    stmt.free();
    return results;
}

const dictionaryDbPath = [".project", "dictionary.sqlite"];

export async function lookupWord(db: Database) {
    try {
        const word = await vscode.window.showInputBox({ prompt: "Enter a word to look up" });
        if (word) {
            const definitions = getDefinitions(db, word);
            if (definitions.length > 0) {
                await vscode.window.showQuickPick(definitions, {
                    placeHolder: `Definitions for "${word}"`,
                });
            } else {
                vscode.window.showInformationMessage(`No definitions found for "${word}".`);
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage(`An error occurred: ${(error as Error).message}`);
    }
}

export const initializeSqlJs = async (context: vscode.ExtensionContext) => {
    // Initialize fts5-sql-bundle
    let SQL: SqlJsStatic | undefined;
    try {
        const sqlWasmPath = vscode.Uri.joinPath(context.extensionUri, "out/node_modules/fts5-sql-bundle/dist/sql-wasm.wasm");

        SQL = await initSqlJs({
            locateFile: (file: string) => {

                return sqlWasmPath.fsPath;
            },
        });

        if (!SQL) {
            throw new Error("Failed to initialize fts5-sql-bundle");
        }


    } catch (error) {
        console.error("Error initializing fts5-sql-bundle:", error);
        vscode.window.showErrorMessage(`Failed to initialize fts5-sql-bundle: ${error}`);
        return;
    }

    // Load or create the database file
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return;
    }
    const dbPath = vscode.Uri.joinPath(workspaceFolder.uri, ...dictionaryDbPath);

    let fileBuffer: Uint8Array;

    try {
        // NOTE: Use a stream to read the database file to avoid memory issues that can arise from large files and crashes the app
        const fileContent = await vscode.workspace.fs.readFile(dbPath);
        fileBuffer = fileContent;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isCorruption = errorMessage.includes("database disk image is malformed") ||
            errorMessage.includes("file is not a database") ||
            errorMessage.includes("database is locked") ||
            errorMessage.includes("database corruption");

        if (isCorruption) {
            console.warn(`[Dictionary DB] Database corruption detected: ${errorMessage}`);
            console.warn("[Dictionary DB] Deleting corrupt database and creating new one");

            // Delete the corrupted database file
            try {
                await vscode.workspace.fs.delete(dbPath);

            } catch (deleteError) {
                console.warn("[Dictionary DB] Could not delete corrupted database file:", deleteError);
            }
        } else {

        }

        // Create new database
        const newDb = new SQL.Database();
        // Create your table structure
        newDb.run(`
            CREATE TABLE entries (
                id TEXT PRIMARY KEY,
                head_word TEXT NOT NULL DEFAULT '',
                definition TEXT,
                is_user_entry INTEGER NOT NULL DEFAULT 0,
                author_id TEXT,
                createdAt TEXT NOT NULL DEFAULT (datetime('now')),
                updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
            );
    
            CREATE INDEX idx_entries_head_word ON entries(head_word);
        `);
        // Save the new database to file
        fileBuffer = newDb.export();
        // Ensure data directory exists
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, "data"));
        await vscode.workspace.fs.writeFile(dbPath, fileBuffer);
    }

    // Create/load the database
    const db = new SQL.Database(fileBuffer);

    // After loading the database
    try {
        const columnCheckStmt = db.prepare("PRAGMA table_info(entries)");
        const columns = [];
        while (columnCheckStmt.step()) {
            const columnInfo = columnCheckStmt.getAsObject();
            columns.push(columnInfo.name);
        }
        columnCheckStmt.free();

        if (!columns.includes("createdAt")) {
            db.run("ALTER TABLE entries ADD COLUMN createdAt TEXT");
            db.run("UPDATE entries SET createdAt = datetime('now') WHERE createdAt IS NULL");
        }
        if (!columns.includes("updatedAt")) {
            db.run("ALTER TABLE entries ADD COLUMN updatedAt TEXT");
            db.run("UPDATE entries SET updatedAt = datetime('now') WHERE updatedAt IS NULL");
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isCorruption = errorMessage.includes("database disk image is malformed") ||
            errorMessage.includes("file is not a database") ||
            errorMessage.includes("database is locked") ||
            errorMessage.includes("database corruption");

        if (isCorruption) {
            console.error("[Dictionary DB] Database corruption detected during schema update:", errorMessage);
            console.warn("[Dictionary DB] Recreating corrupted database");

            // Recreate the database from scratch
            const newDb = new SQL.Database();
            newDb.run(`
                CREATE TABLE entries (
                    id TEXT PRIMARY KEY,
                    head_word TEXT NOT NULL DEFAULT '',
                    definition TEXT,
                    is_user_entry INTEGER NOT NULL DEFAULT 0,
                    author_id TEXT,
                    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
                    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
                );
        
                CREATE INDEX idx_entries_head_word ON entries(head_word);
            `);

            // Save the new database to file
            const newFileBuffer = newDb.export();
            await vscode.workspace.fs.writeFile(dbPath, newFileBuffer);


            vscode.window.showWarningMessage("Dictionary database was corrupted and has been recreated. You may need to re-import your dictionary entries.");

            // Return the new database
            return newDb;
        } else {
            console.error("Error checking/adding columns to entries table:", error);
            vscode.window.showErrorMessage(`Failed to update database schema: ${error}`);
        }
    }

    return db;
};

export const registerLookupWordCommand = (db: Database, context: vscode.ExtensionContext) => {
    const disposable = vscode.commands.registerCommand("extension.lookupWord", () => {
        return lookupWord(db);
    });
    context.subscriptions.push(disposable);
};

export const addWord = async ({
    db,
    headWord,
    definition,
    authorId,
    isUserEntry = true,
}: {
    db: Database;
    headWord: string;
    definition: string;
    authorId: string;
    isUserEntry?: boolean;
}) => {

    const stmt = db.prepare(
        `INSERT INTO entries (id, head_word, definition, is_user_entry, author_id, createdAt, updatedAt) 
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET 
             definition = excluded.definition,
             is_user_entry = excluded.is_user_entry,
             author_id = excluded.author_id,
             updatedAt = datetime('now')`
    );
    try {
        const id = crypto.randomUUID();
        stmt.bind([id, headWord, definition, isUserEntry ? 1 : 0, authorId]);
        stmt.step();

        if (isUserEntry) {
            await exportUserEntries(db);
        }
    } finally {
        stmt.free();
    }
};

export const bulkAddWords = async (db: Database, entries: DictionaryEntry[]) => {
    const stmt = db.prepare(
        `INSERT INTO entries (id, head_word, definition, is_user_entry, author_id, createdAt, updatedAt) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET 
             definition = excluded.definition,
             is_user_entry = excluded.is_user_entry,
             author_id = excluded.author_id,
             updatedAt = datetime('now')`
    );
    try {
        db.run("BEGIN TRANSACTION");
        entries.forEach((entry) => {
            stmt.bind([
                entry.id,
                entry.headWord,
                entry.definition ?? "",
                entry.isUserEntry ? 1 : 0,
                entry.authorId ?? "",
                entry.createdAt ?? "",
                entry.updatedAt ?? "",
            ]);
            stmt.step();
            stmt.reset();
        });
        db.run("COMMIT");
        await saveDatabase(db);
    } catch (error) {
        db.run("ROLLBACK");
        throw error;
    } finally {
        stmt.free();
    }
};

export const getWords = (db: Database) => {
    const stmt = db.prepare("SELECT head_word FROM entries");
    const words: string[] = [];
    while (stmt.step()) {
        words.push(stmt.getAsObject()["head_word"] as string);
    }
    stmt.free();
    return words;
};

export const getEntry = (db: Database, headWord: string, caseSensitive = false) => {
    let query = "SELECT * FROM entries WHERE head_word = ?";
    if (!caseSensitive) {
        query += " COLLATE NOCASE";
    }
    const stmt = db.prepare(query);
    stmt.bind([headWord]);
    const entry = stmt.step();
    stmt.free();
    return entry;
};

export async function importWiktionaryJSONL(db: Database) {
    try {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: "Import",
            filters: {
                "JSONL files": ["jsonl"],
                "All files": ["*"],
            },
        };

        const fileUri = await vscode.window.showOpenDialog(options);

        if (fileUri && fileUri[0]) {
            const jsonlFilePath = fileUri[0].fsPath;
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Importing Wiktionary JSONL",
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ increment: 0, message: "Starting import..." });
                    await parseAndImportJSONL(jsonlFilePath, db, (progressValue) => {
                        progress.report({ increment: progressValue * 100, message: "Importing..." });
                    });
                    progress.report({ increment: 100, message: "Import completed!" });
                    const fileBuffer = db.export();
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (!workspaceFolder) {
                        return;
                    }
                    const dbPath = vscode.Uri.joinPath(workspaceFolder.uri, ...dictionaryDbPath);
                    await vscode.workspace.fs.writeFile(dbPath, fileBuffer);
                    vscode.window.showInformationMessage("Wiktionary JSONL import completed.");
                }
            );
        } else {
            vscode.window.showWarningMessage("No file selected.");
        }
    } catch (error) {
        vscode.window.showErrorMessage(`An error occurred: ${(error as Error).message}`);
    }
}

export const updateWord = async ({
    db,
    id,
    definition,
    headWord,
    authorId,
    isUserEntry = true,
}: {
    db: Database;
    id: string;
    definition: string;
    headWord: string;
    authorId: string;
    isUserEntry?: boolean;
}) => {

    const stmt = db.prepare(`
        UPDATE entries 
        SET head_word = ?,
            definition = ?,
            is_user_entry = ?,
            author_id = ?,
            updatedAt = datetime('now')
        WHERE id = ?
    `);
    try {
        stmt.bind([headWord, definition, isUserEntry ? 1 : 0, authorId, id]);
        const result = stmt.step();
        const rowsModified = db.getRowsModified();
        if (rowsModified === 0) {
            console.warn(`No rows were updated. Check if the id ${id} exists.`);
        }
    } catch (error) {
        console.error("Error executing update statement:", error);
    } finally {
        stmt.free();
    }
    if (isUserEntry) {
        await exportUserEntries(db);
    }
};

export const deleteWord = async ({ db, id }: { db: Database; id: string; }) => {
    // First check if it's a user entry
    const checkStmt = db.prepare("SELECT is_user_entry FROM entries WHERE id = ?");
    let isUserEntry = false;
    try {
        checkStmt.bind([id]);
        if (checkStmt.step()) {
            isUserEntry = !!checkStmt.get()[0];
        }
    } finally {
        checkStmt.free();
    }

    // Delete the entry
    const deleteStmt = db.prepare("DELETE FROM entries WHERE id = ?");
    try {
        deleteStmt.bind([id]);
        deleteStmt.step();

        // If it was a user entry, trigger export
        if (isUserEntry) {
            await exportUserEntries(db);
        }
    } finally {
        deleteStmt.free();
    }
};

export const getPagedWords = ({
    db,
    page,
    pageSize,
    searchQuery,
}: {
    db: Database;
    page: number;
    pageSize: number;
    searchQuery?: string;
}): { entries: DictionaryEntry[]; total: number; } => {
    let total = 0;
    const entries: DictionaryEntry[] = [];

    // Get total count
    const countStmt = searchQuery
        ? db.prepare("SELECT COUNT(*) as count FROM entries WHERE head_word LIKE ?")
        : db.prepare("SELECT COUNT(*) as count FROM entries");

    try {
        if (searchQuery) {
            countStmt.bind([`%${searchQuery}%`]);
        }
        countStmt.step();
        total = countStmt.getAsObject().count as number;
    } finally {
        countStmt.free();
    }

    // Get page of words
    const offset = (page - 1) * pageSize;
    const stmt = searchQuery
        ? db.prepare(`
            SELECT id, head_word, definition, is_user_entry, author_id 
            FROM entries 
            WHERE head_word LIKE ? 
            ORDER BY head_word 
            LIMIT ? OFFSET ?`)
        : db.prepare(`
            SELECT id, head_word, definition, is_user_entry, author_id 
            FROM entries 
            ORDER BY head_word 
            LIMIT ? OFFSET ?`);

    try {
        if (searchQuery) {
            stmt.bind([`%${searchQuery}%`, pageSize, offset]);
        } else {
            stmt.bind([pageSize, offset]);
        }

        while (stmt.step()) {
            const row = stmt.getAsObject();
            entries.push({
                id: row.id as string,
                headWord: row.head_word as string,
                definition: row.definition as string,
                authorId: row.author_id as string,
                isUserEntry: row.is_user_entry === 1,
            });
        }
    } finally {
        stmt.free();
    }

    return { entries, total };
};

export const exportUserEntries = async (db: Database) => {
    const stmt = db.prepare(
        "SELECT id, head_word, definition, author_id, is_user_entry, createdAt, updatedAt FROM entries WHERE is_user_entry = 1"
    );
    const entries: DictionaryEntry[] = [];

    try {
        while (stmt.step()) {
            const row = stmt.getAsObject();
            entries.push({
                id: row.id as string,
                headWord: row.head_word as string,
                definition: row.definition as string,
                authorId: row.author_id as string,
                isUserEntry: row.is_user_entry === 1,
                createdAt: row.createdAt as string,
                updatedAt: row.updatedAt as string,
            });
        }
    } finally {
        stmt.free();
    }

    // Convert entries to JSONL format
    const jsonlContent = entries.map((entry) => JSON.stringify(entry)).join("\n");

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return;
    }

    // Ensure the files directory exists
    const filesDir = vscode.Uri.joinPath(workspaceFolder.uri, "files");
    try {
        await vscode.workspace.fs.createDirectory(filesDir);
    } catch (error) {
        // Directory might already exist, which is fine

    }

    const exportPath = vscode.Uri.joinPath(workspaceFolder.uri, "files", "project.dictionary");
    if (exportPath) {
        // Export user entries to a file for persistence
        await vscode.workspace.fs.writeFile(exportPath, Buffer.from(jsonlContent, "utf-8"));
    }
};

export const ingestJsonlDictionaryEntries = async (db: Database) => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return;
    }
    const exportPath = vscode.Uri.joinPath(workspaceFolder.uri, "files", "project.dictionary");
    if (!exportPath) {
        return;
    }

    try {
        // First check if the file exists
        await vscode.workspace.fs.stat(exportPath);

        // If we get here, the file exists, so read it
        const fileContent = await vscode.workspace.fs.readFile(exportPath);
        const jsonlContent = new TextDecoder().decode(fileContent);
        const entries = jsonlContent
            .split("\n")
            .filter((line: string) => line)
            .map((line: string) => JSON.parse(line));


        await bulkAddWords(db, entries);
    } catch (error) {
        // Check if it's a file not found error
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {

            return;
        }
        console.error("Error reading dictionary file:", error);
    }
};

// Function to save the database to file
export const saveDatabase = async (db: Database) => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.error("Cannot save database: No workspace folder found.");
        return;
    }
    const dbPath = vscode.Uri.joinPath(workspaceFolder.uri, ...dictionaryDbPath);
    try {
        const fileBuffer = db.export();
        await vscode.workspace.fs.writeFile(dbPath, fileBuffer);

    } catch (error) {
        console.error("Error saving database:", error);
        vscode.window.showErrorMessage(`Failed to save dictionary database: ${error}`);
    }
};
