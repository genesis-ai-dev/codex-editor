import * as vscode from "vscode";
import MiniSearch from "minisearch";

// Define the structure of your TSV records with dynamic fields
export interface TableRecord {
    id: string;
    [key: string]: any; // Allow for dynamic keys based on TSV columns
}

// Map to store a MiniSearch index for each TSV file
const tableIndexMap: Map<string, MiniSearch<TableRecord>> = new Map();

// Add supported file extensions
const SUPPORTED_EXTENSIONS = [".csv", ".tsv", ".tab"];

export async function createTableIndexes(): Promise<Map<string, MiniSearch<TableRecord>>> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        throw new Error("No workspace folder found");
    }

    console.log("Creating table indexes", { SUPPORTED_EXTENSIONS });
    // Update file pattern to include all supported formats
    const tableFiles = await vscode.workspace.findFiles(`**/*{${SUPPORTED_EXTENSIONS.join(",")}}`);
    console.log({ tableFiles });

    for (const uri of tableFiles) {
        const [records, fields] = await parseTableFile(uri);

        if (fields.length === 0) {
            console.warn(`No headers found in TSV file: ${uri.fsPath}. Skipping file.`);
            continue;
        }

        // Initialize MiniSearch with dynamic fields for this file
        const tableIndex = new MiniSearch<TableRecord>({
            fields: fields, // Fields to index for full-text search
            storeFields: ["id", ...fields], // Fields to return with search results
            idField: "id", // Unique identifier for each record
        });

        // Add records to the index
        tableIndex.addAll(records);

        // Store the index in the map using the file path as key
        tableIndexMap.set(uri.fsPath, tableIndex);
    }

    return tableIndexMap;
}

// Helper function to detect delimiter
function detectDelimiter(firstLine: string): string {
    const delimiters = {
        "\t": (firstLine.match(/\t/g) || []).length,
        ",": (firstLine.match(/,/g) || []).length,
    };

    return delimiters["\t"] > delimiters[","] ? "\t" : ",";
}

// Update the parse function to handle multiple formats
export async function parseTableFile(uri: vscode.Uri): Promise<[TableRecord[], string[]]> {
    const document = await vscode.workspace.openTextDocument(uri);
    const content = document.getText();
    console.log({ content });
    const records: TableRecord[] = [];
    const lines = content.split("\n").filter((line) => line.trim() !== "");

    if (lines.length === 0) return [records, []];

    // Detect the delimiter from the first line
    const delimiter = detectDelimiter(lines[0]);

    // Assume the first non-empty line contains headers
    const headers = lines[0].split(delimiter).map((header) => header.trim());

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "") continue;

        const fields = line.split(delimiter);
        if (fields.length !== headers.length) {
            // console.warn(`Malformed line at ${uri.fsPath}:${i + 1}. Skipping line.`);
            continue;
        }

        const record: TableRecord = { id: generateUniqueId(uri.fsPath, i) };

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
