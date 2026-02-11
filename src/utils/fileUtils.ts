// eslint-disable-next-line @typescript-eslint/naming-convention
import * as vscode from "vscode";
import * as path from "path";
import { NotebookCommentThread } from "../../types";
import { getWorkSpaceUri } from "./index";

function sanitizePath(workspaceUri: vscode.Uri, filepath: string): string {
    const workspacePath = workspaceUri.fsPath;
    if (filepath.startsWith(workspacePath)) {
        // Remove duplicate workspace path if present
        return filepath.slice(workspacePath.length).replace(/^[/\\]+/, "");
    }
    return filepath;
}

export const generateFiles = async ({
    filepath,
    fileContent,
    shouldOverWrite,
}: {
    filepath: string;
    fileContent: Uint8Array;
    shouldOverWrite: boolean;
}) => {
    const workspaceUri = getWorkSpaceUri();

    if (!workspaceUri) {
        return false;
    }

    const sanitizedFilepath = sanitizePath(workspaceUri, filepath);
    const newFilePath = vscode.Uri.joinPath(workspaceUri, sanitizedFilepath);
    let fileSuccessfullyCreated: boolean = false;

    try {
        await vscode.workspace.fs.stat(newFilePath);
        if (shouldOverWrite) {
            await vscode.workspace.fs.writeFile(newFilePath, fileContent);
            fileSuccessfullyCreated = true;
        }
    } catch {
        // File doesn't exist, create it
        await vscode.workspace.fs.writeFile(newFilePath, fileContent);
        fileSuccessfullyCreated = true;
    }

    return fileSuccessfullyCreated;
};

export async function writeSerializedData(serializedData: string, filename: string) {
    const fileHandler = new FileHandler();

    try {
        await fileHandler.writeFile(filename, serializedData);
        console.log("Write operation completed.");
    } catch (error) {
        console.error("Error writing file:", error);
    }
}

export class FileHandler {
    async writeFile(filename: string, data: string): Promise<void> {
        const workspaceUri = getWorkSpaceUri();
        if (!workspaceUri) {
            throw new Error("No workspace folder found.");
        }
        const sanitizedFilename = sanitizePath(workspaceUri, filename);
        const uri = vscode.Uri.joinPath(workspaceUri, sanitizedFilename);
        console.log(`Attempting to write file: ${uri.fsPath}`);

        const uint8Array = new TextEncoder().encode(data);

        try {
            await vscode.workspace.fs.writeFile(uri, uint8Array);
            console.log("File written successfully:", uri.fsPath);
        } catch (error) {
            console.error("Error writing file:", error, `Path: ${uri.fsPath}`);
        }
    }

    async readFile(filename: string): Promise<string> {
        const workspaceUri = getWorkSpaceUri();
        if (!workspaceUri) {
            throw new Error("No workspace folder found.");
        }

        const sanitizedFilename = sanitizePath(workspaceUri, filename);
        const uri = vscode.Uri.joinPath(workspaceUri, sanitizedFilename);

        try {
            const uint8Array = await vscode.workspace.fs.readFile(uri);
            return new TextDecoder().decode(uint8Array);
        } catch (error) {
            console.error("Error reading file:", error, `Path: ${uri.fsPath}`);
            throw error;
        }
    }
}

export const getCommentsFromFile = async (fileName: string): Promise<NotebookCommentThread[]> => {
    try {
        const workspaceUri = getWorkSpaceUri();
        if (!workspaceUri) {
            throw new Error("No workspace folder found.");
        }
        const sanitizedFileName = sanitizePath(workspaceUri, fileName);
        const uri = vscode.Uri.joinPath(workspaceUri, sanitizedFileName);
        const fileContentUint8Array = await vscode.workspace.fs.readFile(uri);
        const fileContent = new TextDecoder().decode(fileContentUint8Array);
        const rawComments = JSON.parse(fileContent);

        // Check if structural migration is needed and trigger it
        const { CommentsMigrator } = await import("./commentsMigrationUtils");
        const needsStructuralMigration = CommentsMigrator.needsStructuralMigration(rawComments);

        if (needsStructuralMigration) {
            try {
                // Trigger async migration but don't wait for it to complete
                CommentsMigrator.migrateProjectComments(workspaceUri).catch(() => {
                    // Silent fallback
                });
            } catch (error) {
                // Silent fallback
            }
        }

        // Note: Repair is handled during startup/migration to avoid interfering with active editing
        // See CommentsMigrator.repairExistingCommentsFile() for data integrity repairs

        // ============= MIGRATION CLEANUP (TODO: Remove after all users updated) =============
        // Always clean up legacy fields when reading
        const cleanedComments = rawComments.map((thread: any) => {
            const result = { ...thread };

            // Remove legacy fields if they exist
            delete result.version;
            delete result.uri; // Remove redundant uri field

            // Clean up legacy contextValue from all comments
            if (result.comments) {
                result.comments.forEach((comment: any) => {
                    delete comment.contextValue;
                });
            }

            return result;
        });
        // ============= END MIGRATION CLEANUP =============

        return cleanedComments;
    } catch (error) {
        // Handle file not found gracefully without logging
        if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
            return []; // Return empty array when comments file doesn't exist yet
        }

        // Only log errors for actual file system or parsing issues
        console.error(`[getCommentsFromFile] Error reading file:`, error);
        throw new Error("Failed to parse notebook comments from file");
    }
};

export const projectFileExists = async () => {
    const workspaceUri = getWorkSpaceUri();
    if (!workspaceUri) {
        return false;
    }
    const projectFilePath = vscode.Uri.joinPath(workspaceUri, "metadata.json");
    const fileExists = await vscode.workspace.fs.stat(projectFilePath).then(
        () => true,
        () => false
    );
    return fileExists;
};

/**
 * Paths (relative to workspace root) of files from removed features
 * that should be deleted when a project is opened.
 *
 * - dictionary.sqlite: old dictionary database (dictionary feature removed)
 * - project.dictionary: old JSONL dictionary file (dictionary feature removed)
 * - smart_passages_memories.json: never read or written by any code
 * - chat-threads.json: old chat threads file, never read or written
 * - chat_history.jsonl: old chat history file, never read or written
 * - ab-test-results.jsonl: documented but never read or written by any code
 */
const ORPHANED_PROJECT_FILES = [
    ".project/dictionary.sqlite",
    "files/project.dictionary",
    "files/smart_passages_memories.json",
    "chat-threads.json",
    "files/chat_history.jsonl",
    "files/ab-test-results.jsonl",
];

/**
 * Delete leftover files from removed features so they don't accumulate as
 * junk inside user projects. Runs once on extension activation; each
 * deletion is best-effort (silently ignored if the file doesn't exist).
 */
export const cleanupOrphanedProjectFiles = async (): Promise<void> => {
    const workspaceUri = getWorkSpaceUri();
    if (!workspaceUri) {
        return;
    }

    for (const relativePath of ORPHANED_PROJECT_FILES) {
        const fileUri = vscode.Uri.joinPath(workspaceUri, relativePath);
        try {
            await vscode.workspace.fs.delete(fileUri);
            console.log(`[Cleanup] Deleted orphaned file: ${relativePath}`);
        } catch {
            // File doesn't exist or can't be deleted — that's fine
        }
    }
};
