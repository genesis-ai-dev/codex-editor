import * as vscode from "vscode";
import * as path from "path";

/**
 * Helper function to convert timestamp from various formats to seconds
 * Supports: HH:MM:SS,mmm, MM:SS.mmm, and raw seconds
 */
export function convertTimestampToSeconds(timestamp: string): number {
    if (!timestamp) return 0;

    // Handle different timestamp formats
    let match;

    // Format: HH:MM:SS,mmm
    match = timestamp.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    if (match) {
        const hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const seconds = parseInt(match[3]);
        const milliseconds = parseInt(match[4]);
        return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
    }

    // Format: MM:SS.mmm
    match = timestamp.match(/(\d+):(\d+)[,.](\d+)/);
    if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const milliseconds = parseInt(match[3]);
        return minutes * 60 + seconds + milliseconds / 1000;
    }

    // If it's already in seconds format
    if (!isNaN(parseFloat(timestamp))) {
        return parseFloat(timestamp);
    }

    return 0;
}

/**
 * Helper function to copy a file to temporary storage
 */
export async function copyToTempStorage(
    sourceUri: vscode.Uri,
    context: vscode.ExtensionContext
): Promise<vscode.Uri> {
    // Create a temp file path in extension's storage area
    const tempDirUri = vscode.Uri.joinPath(context.globalStorageUri, "temp");
    await vscode.workspace.fs.createDirectory(tempDirUri);

    const fileName = path.basename(sourceUri.fsPath);
    const tempFileUri = vscode.Uri.joinPath(tempDirUri, `${Date.now()}-${fileName}`);

    // Read the original file using VS Code's API
    const fileData = await vscode.workspace.fs.readFile(sourceUri);

    // Write it to the temp location
    await vscode.workspace.fs.writeFile(tempFileUri, fileData);

    return tempFileUri;
}

/**
 * Helper function to get column headers from imported data
 */
export function getColumnHeaders(importedData: any[]): string[] {
    if (importedData.length === 0) {
        return [];
    }

    // Get the first row and extract all keys
    const firstRow = importedData[0];
    return Object.keys(firstRow);
}

/**
 * Generate a nonce for CSP
 */
export function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
