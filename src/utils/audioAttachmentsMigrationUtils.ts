import * as vscode from 'vscode';
import * as path from 'path';

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
            // Copy to both locations first
            await this.copyDirectory(sourceFolderUri, targetFilesUri);
            debug(`Copied ${folderName} to files folder`);

            await this.copyDirectory(sourceFolderUri, targetPointersUri);
            debug(`Copied ${folderName} to pointers folder`);

            // Only remove original folder after both copies succeed
            await vscode.workspace.fs.delete(sourceFolderUri, { recursive: true });
            debug(`Removed original ${folderName} folder after successful migration to both locations`);

        } catch (error) {
            console.error(`[AudioAttachmentsMigration] Error migrating folder ${folderName}:`, error);
            // Continue with other folders even if one fails
        }
    }

    /**
     * Copy a directory recursively, merging with existing content
     * Only copies files that don't already exist to preserve existing files
     */
    private async copyDirectory(sourceUri: vscode.Uri, targetUri: vscode.Uri): Promise<void> {
        try {
            // Create target directory if it doesn't exist
            try {
                await vscode.workspace.fs.createDirectory(targetUri);
                debug(`Created directory: ${targetUri.fsPath}`);
            } catch (error) {
                // Directory might already exist, which is fine for merging
                debug(`Directory already exists or creation failed: ${targetUri.fsPath}`);
            }

            // Read source directory
            const entries = await vscode.workspace.fs.readDirectory(sourceUri);

            // Copy each entry
            for (const [name, type] of entries) {
                const sourceEntryUri = vscode.Uri.joinPath(sourceUri, name);
                const targetEntryUri = vscode.Uri.joinPath(targetUri, name);

                if (type === vscode.FileType.File) {
                    // Only copy file if it doesn't already exist
                    try {
                        await vscode.workspace.fs.stat(targetEntryUri);
                        debug(`File already exists, skipping: ${targetEntryUri.fsPath}`);
                    } catch {
                        // File doesn't exist, safe to copy
                        const fileData = await vscode.workspace.fs.readFile(sourceEntryUri);
                        await vscode.workspace.fs.writeFile(targetEntryUri, fileData);
                        debug(`Copied file: ${sourceEntryUri.fsPath} → ${targetEntryUri.fsPath}`);
                    }
                } else if (type === vscode.FileType.Directory) {
                    // Recursively copy directory (will merge with existing)
                    await this.copyDirectory(sourceEntryUri, targetEntryUri);
                }
            }
        } catch (error) {
            console.error(`[AudioAttachmentsMigration] Error copying directory ${sourceUri.fsPath} to ${targetUri.fsPath}:`, error);
            throw error;
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
