import { LanguageClient } from "vscode-languageclient/node";
import { Database } from "sql.js";
import * as vscode from "vscode";
// Define message types
export const CustomRequests = {
    CheckWord: "custom/checkWord",
    GetSuggestions: "custom/getSuggestions",
    AddWords: "custom/addWords",
} as const;

export default async function registerClientOnRequests(client: LanguageClient, db: Database) {
    // Register handlers
    await client.start(); // Make sure client is started first

    // Register the handlers
    client.onRequest(CustomRequests.CheckWord, async (word: string) => {
        try {
            if (!db) return { exists: false };
            const stmt = db.prepare("SELECT word FROM entries WHERE word = ?");
            stmt.bind([word]);
            const exists = stmt.step();
            stmt.free();
            return { exists };
        } catch (error) {
            console.error("Error in checkWord:", error);
            return { exists: false };
        }
    });

    client.onRequest(
        "workspace/executeCommand",
        async (params: { command: string; args: any[] }) => {
            try {
                // Execute the command in the main extension context
                const result = await vscode.commands.executeCommand(params.command, ...params.args);
                return result;
            } catch (error) {
                console.error("Error executing command:", error);
                throw error;
            }
        }
    );

    client.onRequest("custom/getSuggestions", async (word: string) => {
        try {
            if (!db) return [];
            const stmt = db.prepare("SELECT word FROM entries");
            const words: string[] = [];
            while (stmt.step()) {
                words.push(stmt.getAsObject()["word"] as string);
            }
            stmt.free();
            return words;
        } catch (error) {
            console.error("Error in getSuggestions:", error);
            return [];
        }
    });

    client.onRequest("custom/addWords", async (words: string[]) => {
        try {
            if (!db) return false;
            const stmt = db.prepare(
                "INSERT OR IGNORE INTO entries (word, definition) VALUES (?, ?)"
            );
            try {
                db.run("BEGIN TRANSACTION");
                words.forEach((word) => {
                    stmt.bind([word, ""]);
                    stmt.step();
                    stmt.reset();
                });
                db.run("COMMIT");
                return true;
            } catch (error) {
                db.run("ROLLBACK");
                return false;
            } finally {
                stmt.free();
            }
        } catch (error) {
            console.error("Error in addWords:", error);
            return false;
        }
    });
}
