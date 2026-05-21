import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { toPosixPath, normalizeAttachmentUrl } from './pathUtils';
import { setMissingFlagOnAttachmentObject } from './audioMissingUtils';
import {
    CURRENT_AUDIO_SCHEMA_VERSION,
    getAudioSchemaVersion,
    setAudioSchemaVersion,
} from './localProjectSettings';

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
 * Also migrates attachment metadata from old format to new format:
 * Old: { url: "...", type: "audio" }
 * New: { url: "...", type: "audio", createdAt: timestamp, updatedAt: timestamp, isDeleted: false }
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

            // Always ensure that every file in files/ has a corresponding pointer in pointers/
            // This restores missing pointers that can occur when projects are moved between machines
            try {
                await this.restoreMissingPointers(filesDir, pointersDir);
            } catch (error) {
                console.error('[AudioAttachmentsMigration] Error restoring missing pointers:', error);
            }

            // Always check for attachment metadata migration (may be needed even if files don't need migration)
            await this.migrateAttachmentMetadata();

            // After restoring pointers and normalizing metadata, mark/unmark missing attachments in .codex files
            try {
                await this.updateMissingFlagsForCodexDocuments();
            } catch (error) {
                console.error('[AudioAttachmentsMigration] Error updating missing flags on attachments:', error);
            }

            // With `isMissing` flags now reflecting filesystem reality, run any
            // one-shot audio schema migrations (e.g. backfilling legacy
            // `selectedAudioId` selections). Gated by a per-machine version
            // flag in `localProjectSettings.json`, so this is a no-op on
            // already-migrated machines.
            try {
                await this.runAudioSchemaMigrations();
            } catch (error) {
                console.error('[AudioAttachmentsMigration] Error running audio schema migrations:', error);
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
        const attachmentEntries: [string, vscode.FileType][] = await vscode.workspace.fs.readDirectory(attachmentsDir);
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
        const attachmentEntries: [string, vscode.FileType][] = await vscode.workspace.fs.readDirectory(attachmentsDir);
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
            // Process all files in the folder - each file is handled immediately (no tracking needed)
            await this.copyDirectoryWithTracking(sourceFolderUri, targetFilesUri, targetPointersUri, new Set<string>());
            debug(`Processed ${folderName} folder`);

            // Check if source folder is now empty (all files were processed and deleted)
            let remainingEntries;
            try {
                remainingEntries = await vscode.workspace.fs.readDirectory(sourceFolderUri);
            } catch {
                // Folder might already be deleted if it was empty
                remainingEntries = [];
            }

            if (remainingEntries.length === 0) {
                debug(`Source folder ${folderName} is empty after processing - deleting folder`);
                try {
                    await vscode.workspace.fs.delete(sourceFolderUri, { recursive: true });
                } catch {
                    // Folder might already be deleted
                    debug(`Source folder ${folderName} was already deleted`);
                }
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
     * Compares with files/ folder, checks pointers/ existence, deletes if fully migrated
     */
    private async copyDirectoryWithTracking(
        sourceUri: vscode.Uri,
        targetFilesUri: vscode.Uri,
        targetPointersUri: vscode.Uri,
        copiedFiles: Set<string>,
        relativePath: string = ''
    ): Promise<void> {
        try {
            // Create target directories if they don't exist
            try {
                await vscode.workspace.fs.createDirectory(targetFilesUri);
                debug(`Created files directory: ${targetFilesUri.fsPath}`);
            } catch (error) {
                // Directory might already exist, which is fine for merging
                debug(`Files directory already exists: ${targetFilesUri.fsPath}`);
            }

            try {
                await vscode.workspace.fs.createDirectory(targetPointersUri);
                debug(`Created pointers directory: ${targetPointersUri.fsPath}`);
            } catch (error) {
                // Directory might already exist, which is fine for merging
                debug(`Pointers directory already exists: ${targetPointersUri.fsPath}`);
            }

            // Read source directory
            const entries = await vscode.workspace.fs.readDirectory(sourceUri);

            // Process each entry
            for (const [name, type] of entries) {
                const sourceEntryUri = vscode.Uri.joinPath(sourceUri, name);
                const targetFilesEntryUri = vscode.Uri.joinPath(targetFilesUri, name);
                const targetPointersEntryUri = vscode.Uri.joinPath(targetPointersUri, name);
                const fileRelativePath = relativePath ? `${relativePath}/${name}` : name;

                if (type === vscode.FileType.File) {
                    // Check if file exists in both files/ and pointers/ folders
                    let filesEntryExists = false;
                    let pointersEntryExists = false;

                    try {
                        await vscode.workspace.fs.stat(targetFilesEntryUri);
                        filesEntryExists = true;
                    } catch {
                        filesEntryExists = false;
                    }

                    try {
                        await vscode.workspace.fs.stat(targetPointersEntryUri);
                        pointersEntryExists = true;
                    } catch {
                        pointersEntryExists = false;
                    }

                    if (!filesEntryExists && !pointersEntryExists) {
                        // File doesn't exist in either location - this is a new file, copy to both
                        const fileData = await vscode.workspace.fs.readFile(sourceEntryUri);
                        await vscode.workspace.fs.writeFile(targetFilesEntryUri, fileData);
                        await vscode.workspace.fs.writeFile(targetPointersEntryUri, fileData);
                        await vscode.workspace.fs.delete(sourceEntryUri);
                        debug(`Copied new file to both files/ and pointers/ and deleted: ${sourceEntryUri.fsPath}`);

                    } else if (!filesEntryExists || !pointersEntryExists) {
                        // File missing from only one folder - skip and hope it syncs properly next time
                        debug(`Skipping file with incomplete migration state: ${sourceEntryUri.fsPath} (files: ${filesEntryExists}, pointers: ${pointersEntryExists})`);

                    } else {
                        // File exists in both files/ and pointers/ - check hash with files/
                        const areIdentical = await this.areFilesIdentical(sourceEntryUri, targetFilesEntryUri);

                        if (areIdentical) {
                            // Hash matches with files/ - file is already fully migrated, just delete
                            await vscode.workspace.fs.delete(sourceEntryUri);
                            debug(`Deleted already migrated file: ${sourceEntryUri.fsPath} (exists in both files/ and pointers/ with matching hash)`);

                        } else {
                            // Hash is different - overwrite both files/ and pointers/, then delete
                            const fileData = await vscode.workspace.fs.readFile(sourceEntryUri);
                            await vscode.workspace.fs.writeFile(targetFilesEntryUri, fileData);
                            await vscode.workspace.fs.writeFile(targetPointersEntryUri, fileData);
                            await vscode.workspace.fs.delete(sourceEntryUri);
                            debug(`Overwrote both files/ and pointers/ with different content and deleted: ${sourceEntryUri.fsPath}`);
                        }
                    }
                } else if (type === vscode.FileType.Directory) {
                    // Recursively process subdirectory
                    const targetFilesSubUri = vscode.Uri.joinPath(targetFilesUri, name);
                    const targetPointersSubUri = vscode.Uri.joinPath(targetPointersUri, name);
                    await this.copyDirectoryWithTracking(sourceEntryUri, targetFilesSubUri, targetPointersSubUri, copiedFiles, fileRelativePath);
                }
            }
        } catch (error) {
            console.error(`[AudioAttachmentsMigration] Error processing directory ${sourceUri.fsPath} to ${targetFilesUri.fsPath}:`, error);
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
     * Restore any missing pointer files by mirroring the structure of files/ into pointers/.
     * For every file present in files/, ensure a byte-for-byte copy exists at the same relative path in pointers/.
     * This is non-destructive and idempotent.
     */
    private async restoreMissingPointers(filesDir: vscode.Uri, pointersDir: vscode.Uri): Promise<void> {
        // Ensure root dirs exist (no-op if already present)
        try { await vscode.workspace.fs.createDirectory(filesDir); } catch { /* ignore */ }
        try { await vscode.workspace.fs.createDirectory(pointersDir); } catch { /* ignore */ }

        let restoredCount = 0;

        const walk = async (currentFilesDir: vscode.Uri, currentPointersDir: vscode.Uri) => {
            let entries: [string, vscode.FileType][] = [];
            try {
                entries = await vscode.workspace.fs.readDirectory(currentFilesDir);
            } catch {
                // Nothing to do if files directory does not exist
                return;
            }

            // Ensure pointer subdir exists for this level
            try { await vscode.workspace.fs.createDirectory(currentPointersDir); } catch { /* ignore */ }

            for (const [name, type] of entries) {
                const src = vscode.Uri.joinPath(currentFilesDir, name);
                const dst = vscode.Uri.joinPath(currentPointersDir, name);

                if (type === vscode.FileType.Directory) {
                    await walk(src, dst);
                    continue;
                }

                if (type === vscode.FileType.File) {
                    let pointerExists = false;
                    try {
                        await vscode.workspace.fs.stat(dst);
                        pointerExists = true;
                    } catch {
                        pointerExists = false;
                    }

                    if (!pointerExists) {
                        try {
                            const bytes = await vscode.workspace.fs.readFile(src);
                            await vscode.workspace.fs.writeFile(dst, bytes);
                            restoredCount++;
                            debug(`Restored missing pointer: ${dst.fsPath}`);
                        } catch (err) {
                            console.error(`[AudioAttachmentsMigration] Failed to restore pointer for ${src.fsPath}:`, err);
                        }
                    }
                }
            }
        };

        await walk(filesDir, pointersDir);

        if (restoredCount > 0) {
            debug(`Restored ${restoredCount} missing pointer file(s)`);
        } else {
            debug('No missing pointer files to restore');
        }
    }

    /**
     * Calculate MD5 hash of a file for efficient content comparison
     */
    private async getFileHash(fileUri: vscode.Uri): Promise<string> {
        try {
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            // Fallback hashing without direct Buffer typing
            const hash = crypto.createHash('md5');
            hash.update(fileContent as any);
            return hash.digest('hex');
        } catch (error) {
            console.error(`[AudioAttachmentsMigration] Error calculating hash for ${fileUri.fsPath}:`, error);
            throw error;
        }
    }

    /**
     * Scans all .codex documents and sets/unsets attachment.isMissing based on pointer existence.
     * If a referenced file is not present in pointers/, sets isMissing=true. If present, sets isMissing=false.
     */
    public async updateMissingFlagsForCodexDocuments(): Promise<void> {
        try {
            // Find all codex documents
            const codexPattern = new vscode.RelativePattern(
                this.workspaceFolder.uri,
                "files/target/**/*.codex"
            );
            const codexUris = await vscode.workspace.findFiles(codexPattern);

            for (const codexUri of codexUris) {
                try {
                    const buf = await vscode.workspace.fs.readFile(codexUri);
                    const text = new TextDecoder('utf-8').decode(buf);
                    const data: any = JSON.parse(text);

                    if (!data || !Array.isArray(data.cells)) {
                        continue;
                    }

                    let changed = false;

                    for (const cell of data.cells) {
                        const attachments = cell?.metadata?.attachments;
                        if (!attachments || typeof attachments !== 'object') continue;

                        for (const [attId, attVal] of Object.entries(attachments) as [string, any][]) {
                            // Only process object-style attachments (skip legacy string forms)
                            if (!attVal || typeof attVal !== 'object') continue;
                            const url: string | undefined = attVal.url;
                            if (!url || typeof url !== 'string') continue;

                            // Normalize URL to files/ path then derive pointers/ path
                            const normalizedUrl = normalizeAttachmentUrl(url) || url;
                            const posixUrl = toPosixPath(normalizedUrl);
                            const pointerPosix = posixUrl.includes('/attachments/files/')
                                ? posixUrl.replace('/attachments/files/', '/attachments/pointers/')
                                : posixUrl;

                            const pointerSegments = pointerPosix.split('/').filter(Boolean);
                            const pointerUri = vscode.Uri.joinPath(this.workspaceFolder.uri, ...pointerSegments);

                            let existsInPointers = false;
                            try {
                                await vscode.workspace.fs.stat(pointerUri);
                                existsInPointers = true;
                            } catch {
                                existsInPointers = false;
                            }

                            const desiredMissing = !existsInPointers;
                            if (setMissingFlagOnAttachmentObject(attVal, desiredMissing)) {
                                changed = true;
                            }
                        }
                    }

                    if (changed) {
                        const updated = JSON.stringify(data, null, 2);
                        await vscode.workspace.fs.writeFile(codexUri, new TextEncoder().encode(updated));
                        debug(`Updated missing flags for attachments in ${codexUri.fsPath}`);
                    }
                } catch (err) {
                    console.error(`[AudioAttachmentsMigration] Failed to update missing flags for ${codexUri.fsPath}:`, err);
                }
            }
        } catch (error) {
            console.error('[AudioAttachmentsMigration] Error while updating missing flags in codex documents:', error);
        }
    }

    /**
     * Migrates attachment metadata in all codex documents from old format to new format
     */
    private async migrateAttachmentMetadata(): Promise<void> {
        try {
            debug('Starting attachment metadata migration...');

            // Find all codex documents
            const codexPattern = new vscode.RelativePattern(
                this.workspaceFolder.uri,
                "files/target/**/*.codex"
            );
            const codexUris = await vscode.workspace.findFiles(codexPattern);

            if (codexUris.length === 0) {
                debug('No codex documents found - skipping metadata migration');
                return;
            }

            debug(`Found ${codexUris.length} codex documents to check for metadata migration`);

            let migratedCount = 0;
            for (const codexUri of codexUris) {
                try {
                    const migrated = await this.migrateDocumentAttachmentMetadata(codexUri);
                    if (migrated) {
                        migratedCount++;
                    }
                } catch (error) {
                    console.error(`[AudioAttachmentsMigration] Error migrating metadata for ${codexUri.fsPath}:`, error);
                    // Continue with other documents
                }
            }

            if (migratedCount > 0) {
                debug(`Successfully migrated attachment metadata in ${migratedCount} documents`);
            } else {
                debug('No documents required attachment metadata migration');
            }
        } catch (error) {
            console.error('[AudioAttachmentsMigration] Error during attachment metadata migration:', error);
        }
    }

    /**
     * Migrates attachment metadata for a single document
     * @param documentUri The URI of the codex document to migrate
     * @returns true if the document was modified and saved, false if no changes were needed
     */
    private async migrateDocumentAttachmentMetadata(documentUri: vscode.Uri): Promise<boolean> {
        try {
            // Read the document
            const documentContent = await vscode.workspace.fs.readFile(documentUri);
            const documentText = new TextDecoder('utf-8').decode(documentContent);

            let documentData;
            try {
                documentData = JSON.parse(documentText);
            } catch (error) {
                console.error(`[AudioAttachmentsMigration] Error parsing JSON for ${documentUri.fsPath}:`, error);
                return false;
            }

            if (!documentData.cells || !Array.isArray(documentData.cells)) {
                debug(`Document ${documentUri.fsPath} has no cells - skipping`);
                return false;
            }

            let hasChanges = false;

            // Process each cell
            for (const cell of documentData.cells) {
                if (!cell.metadata || !cell.metadata.attachments) {
                    continue; // Skip cells without attachments
                }

                // Process each attachment in the cell
                for (const [attachmentId, attachment] of Object.entries(cell.metadata.attachments) as [string, any][]) {
                    if (!attachment || typeof attachment !== 'object') {
                        continue;
                    }

                    // We only migrate audio attachments
                    if (attachment.type !== 'audio') {
                        continue;
                    }

                    let localChange = false;

                    // Normalize URL to POSIX and fix legacy folder segments regardless of other fields
                    if (attachment.url && typeof attachment.url === 'string') {
                        const originalUrl = attachment.url;
                        const normalizedUrl = normalizeAttachmentUrl(originalUrl) || originalUrl;

                        if (normalizedUrl !== originalUrl) {
                            attachment.url = normalizedUrl;
                            localChange = true;
                        }
                    }

                    // Ensure required metadata fields exist; if missing, populate with timestamp from ID
                    const missingCreatedAt = typeof attachment.createdAt !== 'number';
                    const missingUpdatedAt = typeof attachment.updatedAt !== 'number';
                    const missingIsDeleted = typeof attachment.isDeleted !== 'boolean';

                    if (missingCreatedAt || missingUpdatedAt || missingIsDeleted) {
                        const timestamp = this.extractTimestampFromAttachmentId(attachmentId);
                        if (missingCreatedAt) attachment.createdAt = timestamp;
                        if (missingUpdatedAt) attachment.updatedAt = timestamp;
                        if (missingIsDeleted) attachment.isDeleted = false;

                        // If this attachment is currently selected, set selectionTimestamp when missing
                        if (cell.metadata?.selectedAudioId === attachmentId && !cell.metadata.selectionTimestamp) {
                            cell.metadata.selectionTimestamp = timestamp;
                        }

                        localChange = true;
                    }

                    if (localChange) {
                        hasChanges = true;
                        debug(`Migrated/normalized attachment ${attachmentId} in document ${documentUri.fsPath}`);
                    }
                }
            }

            // Save the document if changes were made
            if (hasChanges) {
                const updatedContent = JSON.stringify(documentData, null, 2);
                await vscode.workspace.fs.writeFile(documentUri, new TextEncoder().encode(updatedContent));
                debug(`Saved migrated metadata for document ${documentUri.fsPath}`);
                return true;
            }

            return false;
        } catch (error) {
            console.error(`[AudioAttachmentsMigration] Error processing document ${documentUri.fsPath}:`, error);
            return false;
        }
    }

    /**
     * Checks if an attachment needs migration (missing new format fields or old URL structure)
     */
    private attachmentNeedsMigration(attachment: any): boolean {
        if (attachment.type !== 'audio') {
            return false;
        }

        // Check for missing new format fields
        const missingFields = (
            typeof attachment.createdAt !== 'number' ||
            typeof attachment.updatedAt !== 'number' ||
            typeof attachment.isDeleted !== 'boolean'
        );

        // Check for old URL structure that needs updating
        const hasOldUrlStructure = attachment.url && typeof attachment.url === 'string' && (
            // Old direct book folder structure
            (toPosixPath(attachment.url).includes('.project/attachments/') && !toPosixPath(attachment.url).includes('/files/') && !toPosixPath(attachment.url).includes('/pointers/')) ||
            // Intermediate pointers structure
            toPosixPath(attachment.url).includes('/attachments/pointers/')
        );

        return missingFields || hasOldUrlStructure;
    }

    /**
     * Extracts timestamp from attachment ID
     * Expected format: "audio-{timestamp}-{random}"
     * Example: "audio-1755542353492-v0m39plvm" -> 1755542353492
     */
    private extractTimestampFromAttachmentId(attachmentId: string): number {
        try {
            // Match pattern: audio-{timestamp}-{random}
            const match = attachmentId.match(/^audio-(\d+)-/);
            if (match && match[1]) {
                const timestamp = parseInt(match[1], 10);
                if (!isNaN(timestamp) && timestamp > 0) {
                    return timestamp;
                }
            }
        } catch (error) {
            debug(`Error extracting timestamp from attachment ID ${attachmentId}: ${error}`);
        }

        // Fallback to current timestamp if extraction fails
        const currentTime = Date.now();
        debug(`Could not extract timestamp from attachment ID ${attachmentId}, using current time: ${currentTime}`);
        return currentTime;
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

    /**
     * Runs every one-shot audio schema migration needed to bring this machine
     * up to `CURRENT_AUDIO_SCHEMA_VERSION`. Each step is idempotent. The
     * version is bumped on disk only after the full chain succeeds so an
     * interrupted activation resumes from the last unfinished step.
     *
     * The version flag lives in `.project/localProjectSettings.json`, which is
     * gitignored, so every machine processes its own local cells regardless of
     * CRDT sync ordering.
     */
    public async runAudioSchemaMigrations(): Promise<void> {
        try {
            const current = await getAudioSchemaVersion(this.workspaceFolder.uri);
            if (current >= CURRENT_AUDIO_SCHEMA_VERSION) {
                debug(`Audio schema already at version ${current} — skipping`);
                return;
            }

            debug(`Audio schema at v${current}; upgrading to v${CURRENT_AUDIO_SCHEMA_VERSION}`);

            // Track whether any step had per-document failures so we can decide
            // whether to persist the new schema version. We only bump on a fully
            // clean pass — that way failed docs get another shot on the next
            // activation instead of being silently left in legacy state.
            let allStepsClean = true;

            if (current < 1) {
                const { hadFailures } = await this.backfillLegacyAudioSelections();
                if (hadFailures) allStepsClean = false;
            }

            if (allStepsClean) {
                await setAudioSchemaVersion(CURRENT_AUDIO_SCHEMA_VERSION, this.workspaceFolder.uri);
                debug(`Audio schema migration complete; persisted v${CURRENT_AUDIO_SCHEMA_VERSION}`);
            } else {
                debug(
                    `Audio schema migration completed with per-document failures; ` +
                    `leaving version at v${current} so the next activation retries.`
                );
            }
        } catch (error) {
            console.error('[AudioAttachmentsMigration] runAudioSchemaMigrations failed:', error);
        }
    }

    /**
     * v1 migration — backfill `selectedAudioId` + `selectionTimestamp` on legacy
     * cells (pre-Aug-18-2025, before the field existed). For each cell where
     * `selectedAudioId` is undefined and at least one valid (not deleted, not
     * missing) audio attachment exists, pick the latest-by-`createdAt`
     * attachment (lexicographic tie-break on the attachment id for determinism
     * across users) and write both fields.
     *
     * `selectionTimestamp` is set to the chosen attachment's `createdAt`, which
     * is always less than any future real user click (Date.now()), so genuine
     * selections always win the CRDT merge.
     *
     * Idempotent: cells where `selectedAudioId !== undefined` are skipped, so
     * partial completions resume cleanly on the next pass.
     */
    private async backfillLegacyAudioSelections(): Promise<{ hadFailures: boolean; }> {
        debug('Starting legacy audio selection backfill (v1)...');

        const codexPattern = new vscode.RelativePattern(
            this.workspaceFolder.uri,
            "files/target/**/*.codex"
        );
        const codexUris = await vscode.workspace.findFiles(codexPattern);

        if (codexUris.length === 0) {
            debug('No codex documents found — backfill is a no-op');
            return { hadFailures: false };
        }

        let mutatedDocs = 0;
        let mutatedCells = 0;
        let hadFailures = false;
        for (const documentUri of codexUris) {
            try {
                const result = await this.backfillLegacyAudioSelectionsForDocument(documentUri);
                if (result.changed) {
                    mutatedDocs++;
                    mutatedCells += result.cellsBackfilled;
                }
            } catch (error) {
                console.error(
                    `[AudioAttachmentsMigration] Backfill failed for ${documentUri.fsPath}:`,
                    error
                );
                hadFailures = true;
                // Continue — partial progress is fine. The caller will skip
                // bumping the schema version so the next activation retries
                // any docs that failed.
            }
        }

        if (mutatedCells > 0) {
            debug(`Backfilled selectedAudioId on ${mutatedCells} cells across ${mutatedDocs} documents`);
        } else {
            debug('No legacy cells required backfill');
        }

        return { hadFailures };
    }

    /**
     * Backfill `selectedAudioId` + `selectionTimestamp` for a single .codex
     * document. Mutates only cells where `selectedAudioId === undefined` AND
     * at least one valid audio attachment exists.
     */
    private async backfillLegacyAudioSelectionsForDocument(
        documentUri: vscode.Uri
    ): Promise<{ changed: boolean; cellsBackfilled: number; }> {
        const documentContent = await vscode.workspace.fs.readFile(documentUri);
        const documentText = new TextDecoder('utf-8').decode(documentContent);

        if (!documentText.trim().length) {
            return { changed: false, cellsBackfilled: 0 };
        }

        let documentData: any;
        try {
            documentData = JSON.parse(documentText);
        } catch {
            debug(`Skipping non-JSON document ${documentUri.fsPath}`);
            return { changed: false, cellsBackfilled: 0 };
        }

        const cells = Array.isArray(documentData?.cells) ? documentData.cells : [];
        if (cells.length === 0) {
            return { changed: false, cellsBackfilled: 0 };
        }

        let cellsBackfilled = 0;

        for (const cell of cells) {
            const metadata = cell?.metadata;
            if (!metadata || typeof metadata !== 'object') continue;

            // Only touch true legacy cells. `undefined` means "key never written";
            // `""` is the explicit deselection sentinel and must be preserved.
            if (metadata.selectedAudioId !== undefined) continue;

            const attachments = metadata.attachments;
            if (!attachments || typeof attachments !== 'object') continue;

            // Pick the latest-by-createdAt valid audio attachment.
            // "Valid" = audio, not deleted, not missing, with a URL. Ties are
            // broken by lexicographic attachmentId so two users running the
            // migration on the same attachment set arrive at the same choice.
            let bestId: string | null = null;
            let bestCreatedAt = -Infinity;

            for (const [attId, attRaw] of Object.entries(attachments)) {
                const att = attRaw as any;
                if (!att || typeof att !== 'object') continue;
                if (att.type !== 'audio') continue;
                if (att.isDeleted) continue;
                if (att.isMissing) continue;
                if (typeof att.url !== 'string' || att.url.length === 0) continue;

                const created = typeof att.createdAt === 'number' ? att.createdAt : 0;
                if (
                    created > bestCreatedAt ||
                    (created === bestCreatedAt && (bestId === null || attId < bestId))
                ) {
                    bestCreatedAt = created;
                    bestId = attId;
                }
            }

            if (bestId !== null) {
                metadata.selectedAudioId = bestId;
                metadata.selectionTimestamp = bestCreatedAt;
                cellsBackfilled++;
            }
        }

        if (cellsBackfilled === 0) {
            return { changed: false, cellsBackfilled: 0 };
        }

        const updatedContent = JSON.stringify(documentData, null, 2);
        await vscode.workspace.fs.writeFile(
            documentUri,
            new TextEncoder().encode(updatedContent)
        );
        debug(`Backfilled ${cellsBackfilled} cells in ${documentUri.fsPath}`);

        return { changed: true, cellsBackfilled };
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

/**
 * Public function to run the (chained) one-shot audio metadata schema
 * migrations for a workspace, gated by the per-machine `audioSchemaVersion`
 * flag in `localProjectSettings.json`. Intended to be called from extension
 * activation; safe to call on every activation (no-op once the flag matches
 * `CURRENT_AUDIO_SCHEMA_VERSION`).
 */
export async function runAudioSchemaMigrationsForWorkspace(
    workspaceFolder: vscode.WorkspaceFolder
): Promise<void> {
    const migrator = new AudioAttachmentsMigrator(workspaceFolder);
    await migrator.runAudioSchemaMigrations();
}
