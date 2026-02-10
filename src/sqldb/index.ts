import * as vscode from "vscode";
import { StatusBarItem } from "vscode";
import path from "path";
import { parseAndImportJSONL } from "./parseAndImportJSONL";
import crypto from "crypto";
import { DictionaryEntry } from "types";
import { AsyncDatabase } from "../utils/nativeSqlite";

export async function getDefinitions(db: AsyncDatabase, headWord: string): Promise<string[]> {
    const rows = await db.all<{ definition: string }>(
        "SELECT definition FROM entries WHERE head_word = ?",
        [headWord]
    );
    return rows.filter((r) => r.definition).map((r) => r.definition);
}

const dictionaryDbPath = [".project", "dictionary.sqlite"];

export async function lookupWord(db: AsyncDatabase) {
    try {
        const word = await vscode.window.showInputBox({ prompt: "Enter a word to look up" });
        if (word) {
            const definitions = await getDefinitions(db, word);
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

/**
 * Initialize the dictionary database using native SQLite (downloaded on first run).
 * Opens the file directly (no WASM, no in-memory buffer).
 */
export const initializeDictionary = async (
    context: vscode.ExtensionContext
): Promise<AsyncDatabase | undefined> => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return;
    }

    // Ensure the .project directory exists
    const projectDir = vscode.Uri.joinPath(workspaceFolder.uri, ".project");
    try {
        await vscode.workspace.fs.createDirectory(projectDir);
    } catch (dirError) {
        // Directory might already exist, which is fine
        console.debug("[Dictionary DB] .project directory already exists or could not be created:", dirError);
    }

    const dbPath = vscode.Uri.joinPath(workspaceFolder.uri, ...dictionaryDbPath);

    let db: AsyncDatabase;

    try {
        // Open (or create) the database file directly - no buffer loading needed
        db = await AsyncDatabase.open(dbPath.fsPath);
    } catch (error) {
        console.error("[Dictionary DB] Failed to open database:", error);
        vscode.window.showErrorMessage(`Failed to open dictionary database: ${error}`);
        return;
    }

    // Ensure schema exists by using CREATE TABLE IF NOT EXISTS
    try {
        await db.exec(`
            CREATE TABLE IF NOT EXISTS entries (
                id TEXT PRIMARY KEY,
                head_word TEXT NOT NULL DEFAULT '',
                definition TEXT,
                is_user_entry INTEGER NOT NULL DEFAULT 0,
                author_id TEXT,
                createdAt TEXT NOT NULL DEFAULT (datetime('now')),
                updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_entries_head_word ON entries(head_word);
        `);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isCorruption =
            errorMessage.includes("database disk image is malformed") ||
            errorMessage.includes("file is not a database") ||
            errorMessage.includes("database is locked") ||
            errorMessage.includes("database corruption");

        if (isCorruption) {
            console.error("[Dictionary DB] Database corruption detected:", errorMessage);
            console.warn("[Dictionary DB] Deleting corrupt database and recreating");

            await db.close();

            // Delete the corrupted database file
            try {
                await vscode.workspace.fs.delete(dbPath);
            } catch (deleteError) {
                console.warn("[Dictionary DB] Could not delete corrupted database file:", deleteError);
            }

            // Recreate
            try {
                db = await AsyncDatabase.open(dbPath.fsPath);
                await db.exec(`
                    CREATE TABLE IF NOT EXISTS entries (
                        id TEXT PRIMARY KEY,
                        head_word TEXT NOT NULL DEFAULT '',
                        definition TEXT,
                        is_user_entry INTEGER NOT NULL DEFAULT 0,
                        author_id TEXT,
                        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
                        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_entries_head_word ON entries(head_word);
                `);
                vscode.window.showWarningMessage(
                    "Dictionary database was corrupted and has been recreated. You may need to re-import your dictionary entries."
                );
            } catch (recreateError) {
                console.error("[Dictionary DB] Failed to recreate database:", recreateError);
                return;
            }
        } else {
            console.error("Error checking/creating entries table:", error);
            vscode.window.showErrorMessage(`Failed to initialize database schema: ${error}`);
        }
    }

    // Schema migration: ensure columns exist
    try {
        const columns = await db.all<{ name: string }>("PRAGMA table_info(entries)");
        const columnNames = columns.map((c) => c.name);

        if (!columnNames.includes("createdAt")) {
            await db.run("ALTER TABLE entries ADD COLUMN createdAt TEXT");
            await db.run("UPDATE entries SET createdAt = datetime('now') WHERE createdAt IS NULL");
        }
        if (!columnNames.includes("updatedAt")) {
            await db.run("ALTER TABLE entries ADD COLUMN updatedAt TEXT");
            await db.run("UPDATE entries SET updatedAt = datetime('now') WHERE updatedAt IS NULL");
        }
    } catch (error) {
        console.error("Error checking/adding columns to entries table:", error);
    }

    // Apply production PRAGMAs — must be set on every connection open
    await db.exec("PRAGMA journal_mode = WAL");        // Best for read-heavy workloads
    await db.exec("PRAGMA synchronous = NORMAL");      // Safe with WAL; 2x faster than FULL
    await db.exec("PRAGMA cache_size = -4000");        // 4 MB page cache (dictionary is smaller)
    await db.exec("PRAGMA temp_store = MEMORY");       // In-memory temp tables
    db.configure("busyTimeout", 5000);                 // Wait 5s for locks instead of failing

    return db;
};

/** @deprecated Use initializeDictionary instead. Kept as alias for backward compatibility. */
export const initializeSqlJs = initializeDictionary;

export const registerLookupWordCommand = (db: AsyncDatabase, context: vscode.ExtensionContext) => {
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
    db: AsyncDatabase;
    headWord: string;
    definition: string;
    authorId: string;
    isUserEntry?: boolean;
}) => {
    const id = crypto.randomUUID();
    await db.run(
        `INSERT INTO entries (id, head_word, definition, is_user_entry, author_id, createdAt, updatedAt) 
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET 
             definition = excluded.definition,
             is_user_entry = excluded.is_user_entry,
             author_id = excluded.author_id,
             updatedAt = datetime('now')`,
        [id, headWord, definition, isUserEntry ? 1 : 0, authorId]
    );

    if (isUserEntry) {
        await exportUserEntries(db);
    }
};

export const bulkAddWords = async (db: AsyncDatabase, entries: DictionaryEntry[]) => {
    try {
        await db.run("BEGIN TRANSACTION");
        for (const entry of entries) {
            await db.run(
                `INSERT INTO entries (id, head_word, definition, is_user_entry, author_id, createdAt, updatedAt) 
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET 
                     definition = excluded.definition,
                     is_user_entry = excluded.is_user_entry,
                     author_id = excluded.author_id,
                     updatedAt = datetime('now')`,
                [
                    entry.id,
                    entry.headWord,
                    entry.definition ?? "",
                    entry.isUserEntry ? 1 : 0,
                    entry.authorId ?? "",
                    entry.createdAt ?? "",
                    entry.updatedAt ?? "",
                ]
            );
        }
        await db.run("COMMIT");
        // No saveDatabase() needed - native SQLite writes to disk automatically
    } catch (error) {
        await db.run("ROLLBACK");
        throw error;
    }
};

export const getWords = async (db: AsyncDatabase): Promise<string[]> => {
    // Cap at 50,000 entries to prevent unbounded memory usage on very large dictionaries
    const rows = await db.all<{ head_word: string }>(
        "SELECT head_word FROM entries ORDER BY head_word LIMIT 50000"
    );
    return rows.map((r) => r.head_word);
};

export const getEntry = async (db: AsyncDatabase, headWord: string, caseSensitive = false): Promise<boolean> => {
    let query = "SELECT 1 FROM entries WHERE head_word = ?";
    if (!caseSensitive) {
        query += " COLLATE NOCASE";
    }
    const row = await db.get(query, [headWord]);
    return !!row;
};

export async function importWiktionaryJSONL(db: AsyncDatabase) {
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
                    // No db.export() or writeFile needed - native SQLite writes to disk automatically
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
    db: AsyncDatabase;
    id: string;
    definition: string;
    headWord: string;
    authorId: string;
    isUserEntry?: boolean;
}) => {
    const result = await db.run(
        `UPDATE entries 
        SET head_word = ?,
            definition = ?,
            is_user_entry = ?,
            author_id = ?,
            updatedAt = datetime('now')
        WHERE id = ?`,
        [headWord, definition, isUserEntry ? 1 : 0, authorId, id]
    );

    if (result.changes === 0) {
        console.warn(`No rows were updated. Check if the id ${id} exists.`);
    }

    if (isUserEntry) {
        await exportUserEntries(db);
    }
};

export const deleteWord = async ({ db, id }: { db: AsyncDatabase; id: string }) => {
    // First check if it's a user entry
    const row = await db.get<{ is_user_entry: number }>(
        "SELECT is_user_entry FROM entries WHERE id = ?",
        [id]
    );
    const isUserEntry = !!row?.is_user_entry;

    // Delete the entry
    await db.run("DELETE FROM entries WHERE id = ?", [id]);

    // If it was a user entry, trigger export
    if (isUserEntry) {
        await exportUserEntries(db);
    }
};

export const getPagedWords = async ({
    db,
    page,
    pageSize,
    searchQuery,
}: {
    db: AsyncDatabase;
    page: number;
    pageSize: number;
    searchQuery?: string;
}): Promise<{ entries: DictionaryEntry[]; total: number }> => {
    // Escape SQL LIKE wildcards in user input to prevent pattern manipulation
    const escapedSearch = searchQuery
        ? searchQuery.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
        : undefined;

    // Get total count
    const countRow = escapedSearch
        ? await db.get<{ count: number }>(
              "SELECT COUNT(*) as count FROM entries WHERE head_word LIKE ? ESCAPE '\\'",
              [`%${escapedSearch}%`]
          )
        : await db.get<{ count: number }>("SELECT COUNT(*) as count FROM entries");
    const total = countRow?.count ?? 0;

    // Get page of words
    const offset = (page - 1) * pageSize;
    const rows = escapedSearch
        ? await db.all<Record<string, any>>(
              `SELECT id, head_word, definition, is_user_entry, author_id 
               FROM entries 
               WHERE head_word LIKE ? ESCAPE '\\' 
               ORDER BY head_word 
               LIMIT ? OFFSET ?`,
              [`%${escapedSearch}%`, pageSize, offset]
          )
        : await db.all<Record<string, any>>(
              `SELECT id, head_word, definition, is_user_entry, author_id 
               FROM entries 
               ORDER BY head_word 
               LIMIT ? OFFSET ?`,
              [pageSize, offset]
          );

    const entries: DictionaryEntry[] = rows.map((row) => ({
        id: row.id as string,
        headWord: row.head_word as string,
        definition: row.definition as string,
        authorId: row.author_id as string,
        isUserEntry: row.is_user_entry === 1,
    }));

    return { entries, total };
};

export const exportUserEntries = async (db: AsyncDatabase) => {
    const rows = await db.all<Record<string, any>>(
        "SELECT id, head_word, definition, author_id, is_user_entry, createdAt, updatedAt FROM entries WHERE is_user_entry = 1"
    );

    const entries: DictionaryEntry[] = rows.map((row) => ({
        id: row.id as string,
        headWord: row.head_word as string,
        definition: row.definition as string,
        authorId: row.author_id as string,
        isUserEntry: row.is_user_entry === 1,
        createdAt: row.createdAt as string,
        updatedAt: row.updatedAt as string,
    }));

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

export const ingestJsonlDictionaryEntries = async (db: AsyncDatabase) => {
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
        if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
            return;
        }
        console.error("Error reading dictionary file:", error);
    }
};

/**
 * No longer needed with native SQLite - the database writes to disk automatically.
 * Kept as a no-op for backward compatibility.
 * @deprecated Native SQLite writes incrementally to disk; no explicit save needed.
 */
export const saveDatabase = async (_db: AsyncDatabase) => {
    // No-op: native SQLite writes to disk automatically via WAL mode.
    // This function previously serialized the entire in-memory database and wrote
    // the full buffer to disk. With native SQLite, only modified pages are flushed.
};
