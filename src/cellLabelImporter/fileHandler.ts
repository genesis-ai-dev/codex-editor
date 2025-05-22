import * as vscode from "vscode";
import * as path from "path";
import * as xlsx from "xlsx";
import { ImportedRow } from "./types";

/**
 * Import labels from Excel/CSV/TSV file using VSCode's file system API
 */
export async function importLabelsFromVscodeUri(fileUri: vscode.Uri): Promise<ImportedRow[]> {
    try {
        // Read the file using VSCode's file system API
        const fileData = await vscode.workspace.fs.readFile(fileUri);

        // Determine file type based on extension
        const fileExt = path.extname(fileUri.fsPath).toLowerCase();

        let workbook;
        // Use xlsx to parse the file data directly from the buffer
        if (fileExt === ".csv" || fileExt === ".tsv") {
            const content = new TextDecoder().decode(fileData);
            const delimiter = fileExt === ".tsv" ? "\t" : ",";
            workbook = xlsx.read(content, { type: "string", raw: true, FS: delimiter });
        } else {
            // Default to xlsx
            workbook = xlsx.read(fileData, { type: "buffer" });
        }

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert to JSON, preserving the original column names
        const rows: any[] = xlsx.utils.sheet_to_json(worksheet, { raw: false });

        // If no rows found, throw an error
        if (rows.length === 0) {
            throw new Error(`No data found in the file: ${fileUri.fsPath}`);
        }

        // Return data with original column names
        return rows as ImportedRow[];
    } catch (error) {
        console.error("Error importing labels:", error);
        throw new Error(
            `Failed to import file: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Import labels from file path (for backward compatibility)
 */
export async function importLabelsFromFile(filePath: string): Promise<ImportedRow[]> {
    try {
        // Convert file path to URI and use the VSCode API to read it
        const fileUri = vscode.Uri.file(filePath);
        return await importLabelsFromVscodeUri(fileUri);
    } catch (error) {
        console.error("Error importing labels from file path:", error);
        throw new Error(
            `Failed to import file: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
