import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';

const DEBUG_MODE = false;
const debug = (message: string) => {
    if (DEBUG_MODE) {
        console.log(`[AudioAttachmentsMigration] ${message}`);
    }
};

/**
 * Migrates audio attachments from old structure to new structure
 * 
 * Old structure: .project/attachments/{BOOK}/
 * New structure: .project/attachments/files/{BOOK}/ and .project/attachments/pointers/{BOOK}/
 * 
 * Runs whenever there are folders in .project/attachments/ other than "files" and "pointers"
 * This handles both initial migration and ongoing sync scenarios where new book folders appear
 */
export class AudioAttachmentsMigrator {
    private workspaceFolder: vscode.WorkspaceFolder;

    constructor(workspaceFolder: vscode.WorkspaceFolder) {
        this.workspaceFolder = workspaceFolder;
    }

    /**
     * Main migration function
     */
    async migrate(): Promise<void> {
        try {
            debug('Starting audio attachments migration check...');

            const attachmentsDir = vscode.Uri.joinPath(this.workspaceFolder.uri, '.project', 'attachments');
            const filesDir = vscode.Uri.joinPath(attachmentsDir, 'files');
            const pointersDir = vscode.Uri.joinPath(attachmentsDir, 'pointers');

            // Check if migration is needed
            if (await this.shouldMigrate(attachmentsDir)) {
                debug('Migration needed - starting migration process...');
                await this.performMigration(attachmentsDir, filesDir, pointersDir);
                debug('Audio attachments migration completed successfully');
            } else {
                debug('Migration not needed - no folders to migrate');
            }
        } catch (error) {
            console.error('[AudioAttachmentsMigration] Error during migration:', error);
            // Don't throw - we don't want to block startup for migration failures
        }
    }

    /**
     * Check if migration is needed (there are folders other than files/pointers)
     */
    private async shouldMigrate(attachmentsDir: vscode.Uri): Promise<boolean> {
        try {
            // Check if attachments directory exists
            await vscode.workspace.fs.stat(attachmentsDir);
        } catch {
            debug('Attachments directory does not exist - no migration needed');
            return false;
        }

        // Get all folders in attachments directory
        const attachmentEntries = await vscode.workspace.fs.readDirectory(attachmentsDir);
        const foldersToMigrate = attachmentEntries
            .filter(([name, type]) =>
                type === vscode.FileType.Directory &&
                name !== 'files' &&
                name !== 'pointers'
            )
            .map(([name]) => name);

        if (foldersToMigrate.length > 0) {
            debug(`Found ${foldersToMigrate.length} folders that need migration: ${foldersToMigrate.join(', ')}`);
            return true;
        }

        debug('No folders found that need migration');
        return false;
    }

    /**
     * Perform the actual migration
     */
    private async performMigration(
        attachmentsDir: vscode.Uri,
        filesDir: vscode.Uri,
        pointersDir: vscode.Uri
    ): Promise<void> {
        debug('Starting migration process...');

        // Get all folders in attachments directory that need migration
        const attachmentEntries = await vscode.workspace.fs.readDirectory(attachmentsDir);
        const foldersToMigrate = attachmentEntries
            .filter(([name, type]) =>
                type === vscode.FileType.Directory &&
                name !== 'files' &&
                name !== 'pointers'
            )
            .map(([name]) => name);

        debug(`Found ${foldersToMigrate.length} folders to migrate: ${foldersToMigrate.join(', ')}`);

        // Create new folder structure (safe to call even if they already exist)
        await this.createNewFolderStructure(filesDir, pointersDir);

        // Migrate each folder
        for (const folderName of foldersToMigrate) {
            await this.migrateFolderToNewStructure(attachmentsDir, filesDir, pointersDir, folderName);
        }

        debug(`Successfully migrated ${foldersToMigrate.length} folders`);
    }

    /**
     * Create the new folder structure
     */
    private async createNewFolderStructure(filesDir: vscode.Uri, pointersDir: vscode.Uri): Promise<void> {
        try {
            await vscode.workspace.fs.createDirectory(filesDir);
            debug('Created files directory');
        } catch (error) {
            debug(`Files directory creation failed or already exists: ${error}`);
        }

        try {
            await vscode.workspace.fs.createDirectory(pointersDir);
            debug('Created pointers directory');
        } catch (error) {
            debug(`Pointers directory creation failed or already exists: ${error}`);
        }
    }

    /**
     * Migrate a single folder to the new structure
     */
    private async migrateFolderToNewStructure(
        attachmentsDir: vscode.Uri,
        filesDir: vscode.Uri,
        pointersDir: vscode.Uri,
        folderName: string
    ): Promise<void> {
        debug(`Migrating folder: ${folderName}`);

        const sourceFolderUri = vscode.Uri.joinPath(attachmentsDir, folderName);
        const targetFilesUri = vscode.Uri.joinPath(filesDir, folderName);
        const targetPointersUri = vscode.Uri.joinPath(pointersDir, folderName);

        try {
            // Track which files actually get copied to files/
            const copiedFiles = new Set<string>();

            // Copy to files folder and track what actually gets copied
            await this.copyDirectoryWithTracking(sourceFolderUri, targetFilesUri, copiedFiles);
            debug(`Processed ${folderName} to files folder (${copiedFiles.size} files copied)`);

            // Only copy files to pointers that were actually copied to files
            if (copiedFiles.size > 0) {
                await this.copyTrackedFilesToPointers(targetFilesUri, targetPointersUri, copiedFiles);
                debug(`Copied ${copiedFiles.size} files from ${folderName} to pointers folder`);
            } else {
                debug(`No files needed copying to pointers for ${folderName}`);
            }

            // Check if source folder is now empty (all files were identical and deleted)
            const remainingEntries = await vscode.workspace.fs.readDirectory(sourceFolderUri);
            if (remainingEntries.length === 0) {
                debug(`Source folder ${folderName} is empty after removing identical files - deleting folder`);
                await vscode.workspace.fs.delete(sourceFolderUri, { recursive: true });
            } else {
                debug(`Source folder ${folderName} still has ${remainingEntries.length} items remaining`);
            }

        } catch (error) {
            console.error(`[AudioAttachmentsMigration] Error migrating folder ${folderName}:`, error);
            // Continue with other folders even if one fails
        }
    }

    /**
     * Copy a directory recursively with intelligent file comparison and tracking
     * Compares file content and deletes identical files from source, tracks what gets copied
     */
    private async copyDirectoryWithTracking(
        sourceUri: vscode.Uri,
        targetUri: vscode.Uri,
        copiedFiles: Set<string>,
        relativePath: string = ''
    ): Promise<void> {
        try {
            // Create target directory if it doesn't exist
            try {
                await vscode.workspace.fs.createDirectory(targetUri);
                debug(`Created directory: ${targetUri.fsPath}`);
            } catch (error) {
                // Directory might already exist, which is fine for merging
                debug(`Directory already exists: ${targetUri.fsPath}`);
            }

            // Read source directory
            const entries = await vscode.workspace.fs.readDirectory(sourceUri);

            // Process each entry
            for (const [name, type] of entries) {
                const sourceEntryUri = vscode.Uri.joinPath(sourceUri, name);
                const targetEntryUri = vscode.Uri.joinPath(targetUri, name);
                const fileRelativePath = relativePath ? `${relativePath}/${name}` : name;

                if (type === vscode.FileType.File) {
                    // Check if target file exists
                    try {
                        await vscode.workspace.fs.stat(targetEntryUri);

                        // File exists - compare content
                        const areIdentical = await this.areFilesIdentical(sourceEntryUri, targetEntryUri);

                        if (areIdentical) {
                            // Files are identical - delete source file (no need to copy)
                            await vscode.workspace.fs.delete(sourceEntryUri);
                            debug(`Deleted identical file from source: ${sourceEntryUri.fsPath}`);
                        } else {
                            // Files are different - overwrite with source (newer/different content)
                            const fileData = await vscode.workspace.fs.readFile(sourceEntryUri);
                            await vscode.workspace.fs.writeFile(targetEntryUri, fileData);
                            copiedFiles.add(fileRelativePath);
                            debug(`Overwrote with different content: ${sourceEntryUri.fsPath} → ${targetEntryUri.fsPath}`);
                        }
                    } catch {
                        // Target file doesn't exist - copy it
                        const fileData = await vscode.workspace.fs.readFile(sourceEntryUri);
                        await vscode.workspace.fs.writeFile(targetEntryUri, fileData);
                        copiedFiles.add(fileRelativePath);
                        debug(`Copied new file: ${sourceEntryUri.fsPath} → ${targetEntryUri.fsPath}`);
                    }
                } else if (type === vscode.FileType.Directory) {
                    // Recursively process subdirectory
                    await this.copyDirectoryWithTracking(sourceEntryUri, targetEntryUri, copiedFiles, fileRelativePath);
                }
            }
        } catch (error) {
            console.error(`[AudioAttachmentsMigration] Error processing directory ${sourceUri.fsPath} to ${targetUri.fsPath}:`, error);
            throw error;
        }
    }

    /**
     * Copy only the tracked files to pointers directory from the files directory
     */
    private async copyTrackedFilesToPointers(
        filesRootUri: vscode.Uri,
        targetPointersUri: vscode.Uri,
        copiedFiles: Set<string>
    ): Promise<void> {
        try {
            // Create pointers directory structure
            await this.ensureDirectoryExists(targetPointersUri);

            // Copy each tracked file from files/ to pointers/
            for (const relativePath of copiedFiles) {
                const filesSourceUri = vscode.Uri.joinPath(filesRootUri, relativePath);
                const targetFileUri = vscode.Uri.joinPath(targetPointersUri, relativePath);

                // Ensure parent directory exists
                const pathParts = relativePath.split('/');
                if (pathParts.length > 1) {
                    const parentPath = pathParts.slice(0, -1).join('/');
                    const parentDir = vscode.Uri.joinPath(targetPointersUri, parentPath);
                    await this.ensureDirectoryExists(parentDir);
                }

                // Copy the file from files/ to pointers/
                try {
                    const fileData = await vscode.workspace.fs.readFile(filesSourceUri);
                    await vscode.workspace.fs.writeFile(targetFileUri, fileData);
                    debug(`Copied tracked file to pointers: ${relativePath}`);
                } catch (error) {
                    console.error(`Failed to copy ${relativePath} to pointers:`, error);
                }
            }
        } catch (error) {
            console.error(`[AudioAttachmentsMigration] Error copying tracked files to pointers:`, error);
            throw error;
        }
    }

    /**
     * Efficiently compare two files for identical content using hash comparison
     */
    private async areFilesIdentical(file1Uri: vscode.Uri, file2Uri: vscode.Uri): Promise<boolean> {
        try {
            // Quick size comparison first
            const [stats1, stats2] = await Promise.all([
                vscode.workspace.fs.stat(file1Uri),
                vscode.workspace.fs.stat(file2Uri)
            ]);

            if (stats1.size !== stats2.size) {
                debug(`Files have different sizes: ${file1Uri.fsPath} (${stats1.size}) vs ${file2Uri.fsPath} (${stats2.size})`);
                return false;
            }

            // If sizes are the same, compare file hashes (much more efficient than byte-by-byte)
            const [hash1, hash2] = await Promise.all([
                this.getFileHash(file1Uri),
                this.getFileHash(file2Uri)
            ]);

            const areIdentical = hash1 === hash2;

            if (areIdentical) {
                debug(`Files are identical (hash: ${hash1}): ${file1Uri.fsPath} vs ${file2Uri.fsPath}`);
            } else {
                debug(`Files have different content (${hash1} vs ${hash2}): ${file1Uri.fsPath} vs ${file2Uri.fsPath}`);
            }

            return areIdentical;
        } catch (error) {
            console.error(`[AudioAttachmentsMigration] Error comparing files:`, error);
            return false;
        }
    }

    /**
     * Calculate MD5 hash of a file for efficient content comparison
     */
    private async getFileHash(fileUri: vscode.Uri): Promise<string> {
        try {
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            const hash = crypto.createHash('md5');
            hash.update(fileContent);
            return hash.digest('hex');
        } catch (error) {
            console.error(`[AudioAttachmentsMigration] Error calculating hash for ${fileUri.fsPath}:`, error);
            throw error;
        }
    }

    /**
     * Ensure a directory exists
     */
    private async ensureDirectoryExists(dirUri: vscode.Uri): Promise<void> {
        try {
            await vscode.workspace.fs.createDirectory(dirUri);
        } catch (error) {
            // Directory might already exist
        }
    }
}

/**
 * Ensure new audio attachments folder structure exists for new projects
 * Creating empty files/ and pointers/ folders prevents unnecessary migration attempts
 */
export async function ensureAudioAttachmentsFolderStructure(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    try {
        debug('Ensuring audio attachments folder structure exists...');

        const attachmentsDir = vscode.Uri.joinPath(workspaceFolder.uri, '.project', 'attachments');
        const filesDir = vscode.Uri.joinPath(attachmentsDir, 'files');
        const pointersDir = vscode.Uri.joinPath(attachmentsDir, 'pointers');

        // Create attachments directory if it doesn't exist
        try {
            await vscode.workspace.fs.createDirectory(attachmentsDir);
            debug('Created attachments directory');
        } catch (error) {
            debug(`Attachments directory creation failed or already exists: ${error}`);
        }

        // Create files directory
        try {
            await vscode.workspace.fs.createDirectory(filesDir);
            debug('Created files directory');
        } catch (error) {
            debug(`Files directory creation failed or already exists: ${error}`);
        }

        // Create pointers directory
        try {
            await vscode.workspace.fs.createDirectory(pointersDir);
            debug('Created pointers directory');
        } catch (error) {
            debug(`Pointers directory creation failed or already exists: ${error}`);
        }

        debug('Audio attachments folder structure ensured');
    } catch (error) {
        console.error('[AudioAttachmentsMigration] Error ensuring folder structure:', error);
        // Don't throw - we don't want to block project creation
    }
}

/**
 * Public function to run the migration for a workspace
 */
export async function migrateAudioAttachments(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    const migrator = new AudioAttachmentsMigrator(workspaceFolder);
    await migrator.migrate();
}
