import * as vscode from "vscode";
import { CodexNotebookAsJSONData } from "../../types";

/**
 * Reads a .codex notebook from disk and parses its JSON content
 */
export async function readCodexNotebookFromUri(
    uri: vscode.Uri
): Promise<CodexNotebookAsJSONData> {
    const fileData = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(fileData).toString()) as CodexNotebookAsJSONData;
}

/**
 * Returns only active cells, excluding merged and deleted ones (based on metadata.data)
 * Keeps the original cell order intact
 */
export function getActiveCells(cells: CodexNotebookAsJSONData["cells"]) {
    return cells.filter((cell) => {
        const data = (cell.metadata as any)?.data;
        const isMerged = !!(data && data.merged);
        const isDeleted = !!(data && data.deleted);
        return !isMerged && !isDeleted;
    });
}
