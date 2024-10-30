import * as sax from "sax";
import * as fs from "fs";
import { Database } from "sql.js";
import { Readable } from "stream";
import * as vscode from "vscode";
import { bulkAddWords } from ".";

function extractDefinitions(wikitext: string): string[] {
    // Simplified extraction: You may need a proper parser for accurate results
    const definitions: string[] = [];

    const lines = wikitext.split("\n");
    let isDefinitionSection = false;

    for (const line of lines) {
        if (line.startsWith("===") && line.includes("Definitions")) {
            isDefinitionSection = true;
            continue;
        }

        if (isDefinitionSection) {
            if (line.startsWith("#")) {
                // Remove leading '#' and any wiki markup
                const definition = line.replace(/^#\s*/, "").replace(/\[\[(.*?)\]\]/g, "$1");
                definitions.push(definition);
            } else if (line.trim() === "") {
                // Empty line indicates end of definitions section
                break;
            }
        }
    }

    return definitions;
}

export async function parseAndImportXML(
    xmlFilePath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    db: Database
) {
    return new Promise<void>((resolve, reject) => {
        const parser = sax.createStream(true, {});

        let currentTag: string = "";
        let currentWord: string = "";
        let currentDefinition: string = "";
        let isEntry: boolean = false;
        let wordsBuffer: { word: string; definition: string }[] = [];
        const BATCH_SIZE = 1000; // Adjust based on memory considerations

        const totalSize = fs.statSync(xmlFilePath).size;
        let processedSize = 0;

        const readStream = fs.createReadStream(xmlFilePath, { encoding: "utf-8" });

        readStream.on("data", (chunk) => {
            processedSize += chunk.length;
            const percentComplete = (processedSize / totalSize) * 100;
            progress.report({
                increment: 0,
                message: `Processing... ${percentComplete.toFixed(2)}%`,
            });
        });

        parser.on("opentag", (node) => {
            currentTag = node.name;

            if (node.name === "page") {
                isEntry = true;
                currentWord = "";
                currentDefinition = "";
            }
        });

        parser.on("text", (text) => {
            if (!isEntry) return;

            switch (currentTag) {
                case "title":
                    currentWord += text;
                    break;
                case "text":
                    currentDefinition += text;
                    break;
            }
        });

        parser.on("closetag", (tagName) => {
            if (tagName === "page") {
                // Process the entry
                if (currentWord && currentDefinition) {
                    // Extract definitions (simplified)
                    const definitions = extractDefinitions(currentDefinition);
                    definitions.forEach((definition) => {
                        wordsBuffer.push({ word: currentWord, definition });
                    });

                    // Insert in batches
                    if (wordsBuffer.length >= BATCH_SIZE) {
                        bulkAddWords(db, wordsBuffer);
                        wordsBuffer = [];
                    }
                }
                isEntry = false;
                currentWord = "";
                currentDefinition = "";
            }
            currentTag = "";
        });

        parser.on("error", (error) => {
            readStream.close();
            reject(error);
        });

        parser.on("end", () => {
            // Insert any remaining entries
            if (wordsBuffer.length > 0) {
                bulkAddWords(db, wordsBuffer);
            }
            resolve();
        });

        // Pipe the read stream into the parser
        readStream.pipe(parser);
    });
}
