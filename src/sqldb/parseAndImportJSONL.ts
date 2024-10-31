import * as fs from "fs";
import { Database } from "sql.js";
import * as vscode from "vscode";
import { bulkAddWords } from ".";

interface WiktionaryEntry {
    word: string;
    senses: Array<{
        glosses: string[];
    }>;
}

export async function parseAndImportJSONL(
    jsonlFilePath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    db: Database
    // limit?: number
) {
    return new Promise<void>((resolve, reject) => {
        const wordsBuffer: { word: string; definition: string }[] = [];
        const BATCH_SIZE = 1000;
        let entryCount = 0;

        const fileStream = fs.createReadStream(jsonlFilePath, { encoding: "utf-8" });
        let remainder = "";

        const totalSize = fs.statSync(jsonlFilePath).size;
        let processedSize = 0;

        fileStream.on("data", (chunk: string) => {
            processedSize += chunk.length;
            const percentComplete = (processedSize / totalSize) * 100;
            progress.report({
                increment: 0,
                message: `Processing... ${percentComplete.toFixed(2)}%`,
            });

            const lines = (remainder + chunk).split("\n");
            remainder = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    // Check if we've hit the limit
                    // if (limit && entryCount >= limit) {
                    //     fileStream.destroy();
                    //     return;
                    // }

                    const entry: WiktionaryEntry = JSON.parse(line);

                    // Combine all glosses into a single definition
                    const definitions = entry.senses
                        .flatMap((sense) => sense.glosses)
                        .filter((gloss) => gloss && !gloss.startsWith("Alternative form of"));

                    if (definitions.length > 0) {
                        definitions.forEach((definition) => {
                            wordsBuffer.push({
                                word: entry.word,
                                definition,
                            });
                            entryCount++;
                        });
                    }

                    // Insert in batches
                    if (wordsBuffer.length >= BATCH_SIZE) {
                        bulkAddWords(db, wordsBuffer);
                        wordsBuffer.length = 0;
                    }
                } catch (error) {
                    console.error("Error processing line:", error);
                }
            }
        });

        fileStream.on("end", () => {
            // Process any remaining partial line
            if (remainder) {
                try {
                    const entry: WiktionaryEntry = JSON.parse(remainder);
                    const definitions = entry.senses
                        .flatMap((sense) => sense.glosses)
                        .filter((gloss) => gloss && !gloss.startsWith("Alternative form of"));

                    if (definitions.length > 0) {
                        definitions.forEach((definition) => {
                            wordsBuffer.push({ word: entry.word, definition });
                        });
                    }
                } catch (error) {
                    console.error("Error processing final line:", error);
                }
            }

            // Insert any remaining entries
            if (wordsBuffer.length > 0) {
                bulkAddWords(db, wordsBuffer);
            }
            resolve();
        });

        fileStream.on("error", (error) => {
            reject(error);
        });
    });
}
