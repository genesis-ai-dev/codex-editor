import { LanguageClient } from "vscode-languageclient/node";
import { Database } from "fts5-sql-bundle";
import * as vscode from "vscode";
import { getEntry, bulkAddWords } from "../sqldb";

// Define message types
export const CustomRequests = {
    CheckWord: "custom/checkWord",
    GetSuggestions: "custom/getSuggestions",
    AddWords: "custom/addWords",
} as const;

function generateId(): string {
    return Math.random().toString(36).substring(2, 15);
}

export default async function registerClientOnRequests(client: LanguageClient, db: Database) {
    try {
        console.log("[Language Server] Registering client request handlers with database...");

        // Register handlers
        await client.start(); // Make sure client is started first

        // Register the handlers
        client.onRequest(
            CustomRequests.CheckWord,
            async ({ word, caseSensitive = false }: { word: string; caseSensitive: boolean; }) => {
                try {
                    if (!db) {
                        console.error("[Language Server] Database not available for checkWord request:", {
                            word,
                            caseSensitive
                        });
                        return { exists: false };
                    }

                    const entry = getEntry(db, word, caseSensitive);
                    return { exists: entry };
                } catch (error) {
                    console.error("[Language Server] CheckWord request failed:", {
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                        word,
                        caseSensitive,
                        databaseAvailable: !!db
                    });
                    return { exists: false };
                }
            }
        );

        client.onRequest(
            "workspace/executeCommand",
            async (params: { command: string; args: any[]; }) => {
                try {
                    // Execute the command in the main extension context
                    const result = await vscode.commands.executeCommand(params.command, ...params.args);
                    return result;
                } catch (error) {
                    console.error("[Language Server] Workspace command execution failed:", {
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                        command: params?.command,
                        argsCount: params?.args?.length || 0
                    });
                    throw error; // Re-throw to let caller handle command-specific errors
                }
            }
        );

        client.onRequest(CustomRequests.GetSuggestions, async (word: string) => {
            try {
                if (!db) {
                    console.error("[Language Server] Database not available for getSuggestions request:", {
                        word
                    });
                    return [];
                }

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
                   SELECT head_word 
                    FROM entries 
                    WHERE head_word LIKE '%' || ? || '%' COLLATE NOCASE
                    ORDER BY levenshtein(LOWER(head_word), LOWER(?)) 
                    LIMIT 100
                `);

                const words: string[] = [];
                stmt.bind([word[0], word]);

                while (stmt.step()) {
                    words.push(stmt.getAsObject()["head_word"] as string);
                }
                stmt.free();
                return words;
            } catch (error) {
                console.error("[Language Server] GetSuggestions request failed:", {
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    word,
                    databaseAvailable: !!db
                });
                return [];
            }
        });

        client.onRequest(CustomRequests.AddWords, async (words: string[]) => {
            try {
                if (!db) {
                    console.error("[Language Server] Database not available for addWords request:", {
                        words,
                        wordsCount: words?.length || 0
                    });
                    return false;
                }

                await bulkAddWords(
                    db,
                    words.map((word) => ({
                        headWord: word,
                        definition: "",
                        authorId: "",
                        isUserEntry: true,
                        id: generateId(),
                    }))
                );
                return true;
            } catch (error) {
                console.error("[Language Server] AddWords request failed:", {
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    words,
                    wordsCount: words?.length || 0,
                    databaseAvailable: !!db
                });
                return false;
            }
        });

        console.log("[Language Server] Client request handlers registered successfully");
    } catch (error) {
        console.error("[Language Server] Critical failure registering client request handlers:", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            clientAvailable: !!client,
            databaseAvailable: !!db
        });
        throw error; // Re-throw to let calling code handle the initialization failure
    }
}
