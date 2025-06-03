import { Database } from "sql.js";
import * as vscode from "vscode";
import { bulkAddWords } from ".";
import { DictionaryEntry } from "types";
import crypto from "crypto";
import { TextDecoder } from 'util';

interface WiktionaryEntry {
    word: string;
    senses: Array<{
        glosses: string[];
    }>;
}

const generateId = () => {
    return crypto.randomUUID();
};

export async function parseAndImportJSONL(
    filePath: string,
    db: Database,
    progressCallback?: (progress: number) => void
): Promise<void> {
    const wordsBuffer: DictionaryEntry[] = [];
    const BATCH_SIZE = 1000;
    let entryCount = 0;

    try {
        // Read the entire file content
        const fileUri = vscode.Uri.file(filePath);
        const content = await vscode.workspace.fs.readFile(fileUri);
        const text = new TextDecoder().decode(content);
        
        // Get file size for progress calculation
        const stats = await vscode.workspace.fs.stat(fileUri);
        const totalSize = stats.size;
        let processedSize = 0;
        
        // Process the content line by line
        const lines = text.split('\n');
        
        for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
                const entry: WiktionaryEntry = JSON.parse(line);

                // Combine all glosses into a single definition
                const definitions = entry.senses
                    .flatMap((sense) => sense.glosses)
                    .filter((gloss) => gloss && !gloss.startsWith("Alternative form of"));

                if (definitions.length > 0) {
                    definitions.forEach((definition = "") => {
                        wordsBuffer.push({
                            id: generateId(),
                            headWord: entry.word,
                            definition,
                            authorId: undefined,
                            isUserEntry: false,
                        });
                        entryCount++;
                    });
                }

                // Insert in batches
                if (wordsBuffer.length >= BATCH_SIZE) {
                    bulkAddWords(db, wordsBuffer);
                    wordsBuffer.length = 0;
                }

                // Update progress
                processedSize += line.length + 1; // +1 for newline
                if (progressCallback) {
                    progressCallback(processedSize / totalSize);
                }
            } catch (err) {
                console.error('Error processing line:', err);
                continue;
            }
        }

        // Insert any remaining entries
        if (wordsBuffer.length > 0) {
            bulkAddWords(db, wordsBuffer);
        }
    } catch (err) {
        console.error('Error reading file:', err);
        throw err;
    }
}
