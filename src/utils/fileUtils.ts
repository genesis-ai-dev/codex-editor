// eslint-disable-next-line @typescript-eslint/naming-convention
import * as vscode from "vscode";
import * as path from "path";
import { ChatMessageThread, NotebookCommentThread } from "../../types";
import { getWorkSpaceUri } from "./index";

function sanitizePath(workspaceUri: vscode.Uri, filepath: string): string {
    const workspacePath = workspaceUri.fsPath;
    if (filepath.startsWith(workspacePath)) {
        console.warn(`Duplicate workspace path detected in filepath: ${filepath}`);
        console.warn(`Removing duplicate path.`);
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
        console.log(`[getCommentsFromFile] Reading from: ${uri.fsPath}`);
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
        console.error(`[getCommentsFromFile] Error reading file:`, error);
        throw new Error("Failed to parse notebook comments from file");
    }
};

export const getChatMessagesFromFile = async (fileName: string): Promise<ChatMessageThread[]> => {
    try {
        const workspaceUri = getWorkSpaceUri();
        if (!workspaceUri) {
            throw new Error("No workspace folder found.");
        }
        const uri = vscode.Uri.joinPath(workspaceUri, fileName);
        const fileContentUint8Array = await vscode.workspace.fs.readFile(uri);
        const fileContent = new TextDecoder().decode(fileContentUint8Array);
        return JSON.parse(fileContent);
    } catch (error) {
        console.error(error);
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
