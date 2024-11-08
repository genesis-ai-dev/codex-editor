import { StatusBarItem } from "vscode";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import path from "path";
import vscode from "vscode";
import { parseAndImportJSONL } from "./parseAndImportJSONL";

export function getDefinitions(db: Database, word: string): string[] {
    const stmt = db.prepare("SELECT definition FROM entries WHERE word = ?");
    stmt.bind([word]);

    const results: string[] = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row["definition"] as string);
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

        console.log("SQL.js initialized successfullyy");
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
        // Try to read existing database
        console.log("trying to read existing database");
        fileBuffer = await vscode.workspace.fs.readFile(dbPath);
        console.log("fileBuffer found", fileBuffer);
    } catch {
        console.log("fileBuffer not found, creating new database");
        // If file doesn't exist, create new database
        const newDb = new SQL.Database();
        // Create your table structure
        newDb.run(`
             CREATE TABLE entries (
                 word TEXT PRIMARY KEY,
                 definition TEXT NOT NULL
             );
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

export const addWord = (db: Database, word: string, definition: string) => {
    const stmt = db.prepare(
        `INSERT INTO entries (word, definition) 
         VALUES (?, ?)
         ON CONFLICT(word) DO UPDATE SET 
         definition = excluded.definition`
    );
    try {
        stmt.bind([word, definition]);
        stmt.step();
    } finally {
        stmt.free();
    }
};

export const bulkAddWords = (db: Database, words: { word: string; definition: string }[]) => {
    const stmt = db.prepare(
        `INSERT INTO entries (word, definition) 
         VALUES (?, ?)
         ON CONFLICT(word) DO UPDATE SET 
         definition = excluded.definition`
    );
    try {
        db.run("BEGIN TRANSACTION");
        words.forEach((wordObj) => {
            stmt.bind([wordObj.word, wordObj.definition]);
            stmt.step();
            stmt.reset(); // Reset the statement to be used again
        });
        db.run("COMMIT");
    } catch (error) {
        db.run("ROLLBACK");
        throw error;
    } finally {
        stmt.free();
    }
};

export const removeWord = (db: Database, word: string) => {
    const stmt = db.prepare("DELETE FROM entries WHERE word = ?");
    stmt.bind([word]);
    stmt.step();
    stmt.free();
};

export const getWords = (db: Database) => {
    const stmt = db.prepare("SELECT word FROM entries");
    const words: string[] = [];
    while (stmt.step()) {
        words.push(stmt.getAsObject()["word"] as string);
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

export const updateWord = (db: Database, word: string, definition: string) => {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO entries (word, definition)
        VALUES (?, ?)
    `);
    try {
        stmt.bind([word, definition]);
        stmt.step();
    } finally {
        stmt.free();
    }
};

export const deleteWord = (db: Database, word: string) => {
    const stmt = db.prepare("DELETE FROM entries WHERE word = ?");
    try {
        stmt.bind([word]);
        stmt.step();
    } finally {
        stmt.free();
    }
};

export const getPagedWords = (
    db: Database,
    page: number,
    pageSize: number,
    searchQuery?: string
): { words: string[]; total: number } => {
    let total = 0;
    const words: string[] = [];

    // Get total count
    const countStmt = searchQuery
        ? db.prepare("SELECT COUNT(*) as count FROM entries WHERE word LIKE ?")
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
        ? db.prepare("SELECT word FROM entries WHERE word LIKE ? ORDER BY word LIMIT ? OFFSET ?")
        : db.prepare("SELECT word FROM entries ORDER BY word LIMIT ? OFFSET ?");

    try {
        if (searchQuery) {
            stmt.bind([`%${searchQuery}%`, pageSize, offset]);
        } else {
            stmt.bind([pageSize, offset]);
        }

        while (stmt.step()) {
            const row = stmt.getAsObject();
            words.push(row.word as string);
        }
    } finally {
        stmt.free();
    }

    return { words, total };
};
