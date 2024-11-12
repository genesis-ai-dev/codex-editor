import { StatusBarItem } from "vscode";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import path from "path";
import vscode from "vscode";
import { parseAndImportJSONL } from "./parseAndImportJSONL";
import crypto from "crypto";
import { DictionaryEntry } from "types";
import fs from "fs";

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

const dictionaryDbPath = ["data", "dictionary.sqlite"];

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
    // Initialize sql.js
    let SQL: SqlJsStatic | undefined;
    try {
        const sqlWasmPath = vscode.Uri.joinPath(context.extensionUri, "out", "sql-wasm.wasm");
        console.log("SQL WASM Path:", sqlWasmPath.fsPath);

        SQL = await initSqlJs({
            locateFile: (file: string) => {
                console.log("Locating file:", file);
                return sqlWasmPath.fsPath;
            },
            // Add this to ensure proper module loading
            wasmBinary: await vscode.workspace.fs.readFile(sqlWasmPath),
        });

        if (!SQL) {
            throw new Error("Failed to initialize SQL.js");
        }

        console.log("SQL.js initialized successfully");
    } catch (error) {
        console.error("Error initializing sql.js:", error);
        vscode.window.showErrorMessage(`Failed to initialize SQL.js: ${error}`);
        return;
    }

    // Load or create the database file
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
    }
    const dbPath = vscode.Uri.joinPath(workspaceFolder.uri, ...dictionaryDbPath);

    let fileBuffer: Uint8Array;
    console.log("dbPath", dbPath);
    try {
        // Use a stream to read the database file
        console.log("Trying to read existing database using stream");
        const fileStream = fs.createReadStream(dbPath.fsPath);
        const chunks: Buffer[] = [];

        for await (const chunk of fileStream) {
            chunks.push(chunk);
        }

        fileBuffer = Buffer.concat(chunks);
        console.log("File buffer loaded using stream");
    } catch {
        console.log("File buffer not found, creating new database");
        // If file doesn't exist, create new database
        const newDb = new SQL.Database();
        // Create your table structure
        newDb.run(`
            CREATE TABLE entries (
                id TEXT PRIMARY KEY,
                head_word TEXT NOT NULL DEFAULT '',
                definition TEXT,
                is_user_entry INTEGER NOT NULL DEFAULT 0,
                author_id TEXT
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
    return new SQL.Database(fileBuffer);
};

export const registerLookupWordCommand = (db: Database, context: vscode.ExtensionContext) => {
    console.log("registerLookupWordCommand called");
    const disposable = vscode.commands.registerCommand("extension.lookupWord", () => {
        console.log("lookupWord command called");
        console.log({ allEntries: getWords(db) });
        return lookupWord(db);
    });
    context.subscriptions.push(disposable);
};

export const addWord = ({
    db,
    headWord,
    definition,
    authorId,
    isUserEntry = false,
}: {
    db: Database;
    headWord: string;
    definition: string;
    authorId: string;
    isUserEntry?: boolean;
}) => {
    console.log("addWord called", { headWord, definition, authorId, isUserEntry });
    const stmt = db.prepare(
        `INSERT INTO entries (id, head_word, definition, is_user_entry, author_id) 
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET 
         definition = excluded.definition,
         is_user_entry = excluded.is_user_entry,
         author_id = excluded.author_id`
    );
    try {
        const id = crypto.randomUUID(); // You'll need to import crypto
        stmt.bind([id, headWord, definition, isUserEntry ? 1 : 0, authorId]);
        stmt.step();
    } finally {
        stmt.free();
    }
};

export const bulkAddWords = (db: Database, entries: DictionaryEntry[]) => {
    const stmt = db.prepare(
        `INSERT INTO entries (id, head_word, definition, is_user_entry, author_id) 
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET 
         definition = excluded.definition,
         is_user_entry = excluded.is_user_entry,
         author_id = excluded.author_id`
    );
    try {
        db.run("BEGIN TRANSACTION");
        entries.forEach((entry) => {
            const id = crypto.randomUUID();
            stmt.bind([
                id,
                entry.headWord,
                entry.definition ?? "",
                entry.isUserEntry ? 1 : 0,
                entry.authorId ?? "",
            ]);
            stmt.step();
            stmt.reset();
        });
        db.run("COMMIT");
    } catch (error) {
        db.run("ROLLBACK");
        throw error;
    } finally {
        stmt.free();
    }
};

export const removeWord = ({ db, id }: { db: Database; id: string }) => {
    const stmt = db.prepare("DELETE FROM entries WHERE id = ?");
    stmt.bind([id]);
    stmt.step();
    stmt.free();
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
                    await parseAndImportJSONL(jsonlFilePath, progress, db);
                    progress.report({ increment: 100, message: "Import completed!" });
                    const fileBuffer = db.export();
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (!workspaceFolder) {
                        vscode.window.showErrorMessage("No workspace folder found");
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

export const updateWord = ({
    db,
    id,
    definition,
    headWord,
    authorId,
    isUserEntry,
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
            is_user_entry = COALESCE(?, is_user_entry),
            author_id = COALESCE(?, author_id)
        WHERE id = ?
    `);
    try {
        stmt.bind([
            headWord,
            definition,
            isUserEntry === undefined ? null : isUserEntry ? 1 : 0,
            authorId,
            id,
        ]);
        stmt.step();
    } finally {
        stmt.free();
    }
};

export const deleteWord = ({ db, id }: { db: Database; id: string }) => {
    const stmt = db.prepare("DELETE FROM entries WHERE id = ?");
    try {
        stmt.bind([id]);
        stmt.step();
    } finally {
        stmt.free();
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
}): { words: string[]; total: number } => {
    let total = 0;
    const words: string[] = [];

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
            words.push(row.head_word as string);
        }
    } finally {
        stmt.free();
    }

    return { words, total };
};
