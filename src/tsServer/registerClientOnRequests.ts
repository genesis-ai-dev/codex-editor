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
    client.onRequest(
        CustomRequests.CheckWord,
        async ({ word, caseSensitive = false }: { word: string; caseSensitive: boolean }) => {
            try {
                if (!db) return { exists: false };

                let query;
                if (caseSensitive) {
                    query = "SELECT word FROM entries WHERE word = ?";
                } else {
                    query = "SELECT word FROM entries WHERE word = ? COLLATE NOCASE";
                }

                const stmt = db.prepare(query);
                stmt.bind([word]);
                const exists = stmt.step();
                stmt.free();
                return { exists };
            } catch (error) {
                console.error("Error in checkWord:", error);
                return { exists: false };
            }
        }
    );

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

    client.onRequest(CustomRequests.GetSuggestions, async (word: string) => {
        try {
            if (!db) return [];

            // First, create the Levenshtein function if it doesn't exist
            db.create_function("levenshtein", (a: string, b: string) => {
                if (a.length === 0) return b.length;
                if (b.length === 0) return a.length;

                const matrix = Array(b.length + 1)
                    .fill(null)
                    .map(() => Array(a.length + 1).fill(null));

                for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
                for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

                for (let j = 1; j <= b.length; j++) {
                    for (let i = 1; i <= a.length; i++) {
                        const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
                        matrix[j][i] = Math.min(
                            matrix[j][i - 1] + 1,
                            matrix[j - 1][i] + 1,
                            matrix[j - 1][i - 1] + substitutionCost
                        );
                    }
                }
                return matrix[b.length][a.length];
            });

            // Use Levenshtein distance to find similar words
            const stmt = db.prepare(`
               SELECT word 
                FROM entries 
                WHERE word LIKE '%' || ? || '%' COLLATE NOCASE
                ORDER BY levenshtein(LOWER(word), LOWER(?)) 
                LIMIT 10
            `);

            const words: string[] = [];
            stmt.bind([word[0], word]);

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

    client.onRequest(CustomRequests.AddWords, async (words: string[]) => {
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
