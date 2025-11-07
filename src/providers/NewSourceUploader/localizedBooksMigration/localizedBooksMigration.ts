import * as vscode from "vscode";
import { CodexContentSerializer } from "../../../serializer";
import { findCodexFilesByBookAbbr } from "../../../utils/codexNotebookUtils";

export interface LocalizedBook {
    abbr: string;
    name: string;
    ord?: string;
    testament?: string;
}

/**
 * Migrates book display names from localized-books.json into individual codex file metadata.
 * Reads localized-books.json, finds matching codex files, and updates their fileDisplayName metadata.
 * @param codexUris Optional array of codex URIs to migrate. If provided, uses these directly instead of searching.
 * @returns The number of files that were successfully migrated
 */
export async function migrateLocalizedBooksToMetadata(codexUris?: vscode.Uri[]): Promise<number> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return 0;
        }

        const localizedUri = vscode.Uri.joinPath(workspaceFolder.uri, "localized-books.json");
        let localizedBooks: LocalizedBook[] = [];

        // Check if localized-books.json exists and read it
        try {
            await vscode.workspace.fs.stat(localizedUri);
        } catch (statError: any) {
            // File doesn't exist, nothing to migrate
            return 0;
        }

        try {
            const fileContent = await vscode.workspace.fs.readFile(localizedUri);
            const content = new TextDecoder().decode(fileContent);
            localizedBooks = JSON.parse(content);

            if (!Array.isArray(localizedBooks)) {
                console.warn("localized-books.json is not an array, skipping migration");
                return 0;
            }
        } catch (err: any) {
            // File doesn't exist or is invalid, nothing to migrate
            if (err.code !== "FileNotFound") {
                console.warn("Failed to read localized-books.json:", err);
            }
            return 0;
        }

        if (localizedBooks.length === 0) {
            return 0;
        }

        const serializer = new CodexContentSerializer();
        let migratedCount = 0;

        // Process each book in localized-books.json
        for (const book of localizedBooks) {
            if (!book.abbr || !book.name) {
                console.warn(`Skipping book entry with missing abbr or name:`, book);
                continue;
            }

            // Find matching codex files by book abbreviation
            const { matchingUris } = await findCodexFilesByBookAbbr(book.abbr, {
                codexUris: codexUris
            });

            // Update each matching codex file
            for (const uri of matchingUris) {
                try {
                    const content = await vscode.workspace.fs.readFile(uri);
                    const notebookData = await serializer.deserializeNotebook(
                        content,
                        new vscode.CancellationTokenSource().token
                    );

                    // Ensure metadata exists, then update it with fileDisplayName
                    const existingMetadata = notebookData.metadata || {};
                    notebookData.metadata = {
                        ...existingMetadata,
                        fileDisplayName: book.name.trim(),
                    };

                    // Serialize and save the updated notebook
                    const updatedContent = await serializer.serializeNotebook(
                        notebookData,
                        new vscode.CancellationTokenSource().token
                    );

                    await vscode.workspace.fs.writeFile(uri, updatedContent);
                    migratedCount++;
                } catch (error) {
                    console.error(`Error migrating fileDisplayName for ${uri.fsPath}:`, error);
                    // Continue with other files even if one fails
                }
            }
        }

        if (migratedCount > 0) {
            console.log(`Migrated ${migratedCount} book display name(s) from localized-books.json to codex metadata`);
        }

        return migratedCount;
    } catch (err) {
        console.error("Failed to migrate localized-books.json:", err);
        return 0;
    }
}

