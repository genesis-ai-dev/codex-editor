import * as vscode from "vscode";
import MiniSearch from "minisearch";

// Define the structure of your TSV records with dynamic fields
export interface TSVRecord {
    id: string;
    [key: string]: any; // Allow for dynamic keys based on TSV columns
}

// Map to store a MiniSearch index for each TSV file
export const tsvIndexMap: Map<string, MiniSearch<TSVRecord>> = new Map();

export async function createTSVIndexes(): Promise<Map<string, MiniSearch<TSVRecord>>> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        throw new Error("No workspace folder found");
    }

    // Find all TSV files in the project
    const tsvFiles = await vscode.workspace.findFiles("**/*.tsv");

    for (const uri of tsvFiles) {
        const [records, fields] = await parseTSVFile(uri);

        if (fields.length === 0) {
            console.warn(`No headers found in TSV file: ${uri.fsPath}. Skipping file.`);
            continue;
        }

        // Initialize MiniSearch with dynamic fields for this file
        const tsvIndex = new MiniSearch<TSVRecord>({
            fields: fields, // Fields to index for full-text search
            storeFields: ["id", ...fields], // Fields to return with search results
            idField: "id", // Unique identifier for each record
        });

        // Add records to the index
        tsvIndex.addAll(records);

        // Store the index in the map using the file path as key
        tsvIndexMap.set(uri.fsPath, tsvIndex);
    }

    return tsvIndexMap;
}

// Function to read and parse a TSV file
export async function parseTSVFile(uri: vscode.Uri): Promise<[TSVRecord[], string[]]> {
    const document = await vscode.workspace.openTextDocument(uri);
    const content = document.getText();

    const records: TSVRecord[] = [];
    const lines = content.split("\n").filter((line) => line.trim() !== "");

    // Assume the first non-empty line contains headers
    const headerLineIndex = lines.findIndex((line) => line.trim() !== "");
    if (headerLineIndex === -1) return [records, []];

    const headers = lines[headerLineIndex].split("\t").map((header) => header.trim());

    for (let i = headerLineIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "") continue; // Skip empty lines

        const fields = line.split("\t");
        if (fields.length !== headers.length) {
            console.warn(`Malformed line at ${uri.fsPath}:${i + 1}. Skipping line.`);
            continue; // Skip malformed lines
        }

        const record: TSVRecord = { id: generateUniqueId(uri.fsPath, i) }; // Use file path and line number for uniqueness

        headers.forEach((header, index) => {
            record[header] = fields[index].trim();
        });

        records.push(record);
    }

    return [records, headers];
}

// Function to generate a unique ID for each record
function generateUniqueId(filePath: string, lineNumber: number): string {
    // Use file path and line number to ensure uniqueness
    return `${filePath}:${lineNumber}`;
}

// Example usage
// (async () => {
//   try {
//     const tsvIndexes = await createTSVIndexes();

//     // Iterate over each index
//     for (const [filePath, tsvIndex] of tsvIndexes) {
//       console.log(`Index for file: ${filePath}`);

//       // Perform searches on the individual index
//       const results = tsvIndex.search('your search query');
//       console.log('Search results:', results);
//     }
//   } catch (error) {
//     console.error('Error creating TSV indexes:', error);
//   }
// })();
