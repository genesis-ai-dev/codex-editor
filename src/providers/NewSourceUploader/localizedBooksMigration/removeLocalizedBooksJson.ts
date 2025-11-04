import * as vscode from "vscode";

/**
 * Removes the workspace-level localized-books.json file if present.
 * This ensures that newly uploaded sources don't inherit stale overrides.
 */
export async function removeLocalizedBooksJsonIfPresent(): Promise<void> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }
        const localizedUri = vscode.Uri.joinPath(workspaceFolder.uri, "localized-books.json");
        try {
            // If the file exists, delete it (no trash, non-recursive)
            await vscode.workspace.fs.stat(localizedUri);
            await vscode.workspace.fs.delete(localizedUri, { recursive: false, useTrash: false });
            console.log("Removed localized-books.json after source upload");
        } catch {
            // File does not exist; nothing to remove
        }
    } catch (err) {
        console.warn("Failed to remove localized-books.json:", err);
    }
}

