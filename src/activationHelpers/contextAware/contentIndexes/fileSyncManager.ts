import * as vscode from "vscode";
import { createHash } from "crypto";
import { SQLiteIndexManager } from "./indexes/sqliteIndex";
import { FileData, readSourceAndTargetFiles } from "./indexes/fileReaders";
import { CodexCellTypes } from "../../../../types/enums";
const DEBUG_MODE = false;
const debug = (message: string, ...args: any[]) => {
    DEBUG_MODE && console.log(`[FileSyncManager] ${message}`, ...args);
};

export interface FileSyncResult {
    totalFiles: number;
    syncedFiles: number;
    unchangedFiles: number;
    errors: Array<{ file: string; error: string; }>;
    duration: number;
    details: Map<string, { reason: string; oldHash?: string; newHash?: string; }>;
}

export interface FileSyncOptions {
    forceSync?: boolean;
    progressCallback?: (message: string, progress: number) => void;
}

/**
 * Manages file-level synchronization between git files and database indexes
 */
export class FileSyncManager {
    constructor(private sqliteIndex: SQLiteIndexManager) { }

    /**
     * Check if any files need synchronization
     */
    async checkSyncStatus(): Promise<{
        needsSync: boolean;
        summary: {
            totalFiles: number;
            changedFiles: number;
            newFiles: number;
            unchangedFiles: number;
        };
        details: Map<string, { reason: string; oldHash?: string; newHash?: string; }>;
    }> {
        const syncStart = performance.now();
        debug("[FileSyncManager] Checking sync status...");

        try {
            // Get all current files
            const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();
            const allFiles = [...sourceFiles, ...targetFiles];
            const filePaths = allFiles.map(f => f.uri.fsPath);

            // Check which files need sync
            const syncCheck = await this.sqliteIndex.checkFilesForSync(filePaths);

            // Analyze the results
            const changedFiles = syncCheck.details.size - syncCheck.unchanged.length;
            const newFiles = Array.from(syncCheck.details.values()).filter(d => d.reason.includes("new file")).length;

            const syncDuration = performance.now() - syncStart;
            debug(`[FileSyncManager] Sync check completed in ${syncDuration.toFixed(2)}ms`);
            debug(`[FileSyncManager] Files needing sync: ${syncCheck.needsSync.length}/${filePaths.length}`);

            return {
                needsSync: syncCheck.needsSync.length > 0,
                summary: {
                    totalFiles: filePaths.length,
                    changedFiles,
                    newFiles,
                    unchangedFiles: syncCheck.unchanged.length
                },
                details: syncCheck.details
            };
        } catch (error) {
            console.error("[FileSyncManager] Error checking sync status:", error);
            throw error;
        }
    }

    /**
     * Perform intelligent file synchronization
     */
    async syncFiles(options: FileSyncOptions = {}): Promise<FileSyncResult> {
        const syncStart = performance.now();
        const { forceSync = false, progressCallback } = options;

        debug(`[FileSyncManager] Starting optimized file sync (force: ${forceSync})...`);
        progressCallback?.("Initializing sync process...", 0);

        const errors: Array<{ file: string; error: string; }> = [];
        let syncedFiles = 0;
        let unchangedFiles = 0;

        try {
            // Get all current files
            const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();
            const allFiles = [...sourceFiles, ...targetFiles];
            const filePaths = allFiles.map(f => f.uri.fsPath);

            progressCallback?.("Analyzing file changes...", 10);

            // Check which files need sync (unless forcing)
            let filesToSync: string[];
            let syncDetails: Map<string, { reason: string; oldHash?: string; newHash?: string; }>;

            if (forceSync) {
                filesToSync = filePaths;
                syncDetails = new Map(filePaths.map(path => [path, { reason: "forced sync" }]));
            } else {
                const syncCheck = await this.sqliteIndex.checkFilesForSync(filePaths);
                filesToSync = syncCheck.needsSync;
                unchangedFiles = syncCheck.unchanged.length;
                syncDetails = syncCheck.details;
            }

            debug(`[FileSyncManager] Files to sync: ${filesToSync.length}/${filePaths.length}`);

            if (filesToSync.length === 0) {
                debug("[FileSyncManager] No files need synchronization");
                progressCallback?.("All files up to date", 100);

                return {
                    totalFiles: allFiles.length,
                    syncedFiles: 0,
                    unchangedFiles: allFiles.length,
                    errors: [],
                    duration: performance.now() - syncStart,
                    details: syncDetails
                };
            }

            // Optimize for batch processing
            progressCallback?.("Preparing batch sync operations...", 15);
            const fileMap = new Map(allFiles.map(f => [f.uri.fsPath, f]));
            const filesToProcess = filesToSync.map(path => fileMap.get(path)).filter(Boolean) as FileData[];

            // Process files in optimized batches:
            //   1. Read file contents from disk in parallel (I/O-bound)
            //   2. Write all DB changes in a single transaction per batch (CPU-bound)
            // This avoids the "cannot start a transaction within a transaction"
            // error that occurred when each parallel file sync opened its own transaction.
            const BATCH_SIZE = 10;
            const batches: FileData[][] = [];
            for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
                batches.push(filesToProcess.slice(i, i + BATCH_SIZE));
            }

            debug(`[FileSyncManager] Processing ${filesToProcess.length} files in ${batches.length} batches of ${BATCH_SIZE}`);

            let processedCount = 0;
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                const progress = 20 + (batchIndex / batches.length) * 60; // Reserve 20% for cleanup
                progressCallback?.(`Syncing batch ${batchIndex + 1}/${batches.length} (${batch.length} files)...`, progress);

                // Phase 1: Read all files in this batch from disk in parallel (I/O)
                const readResults = await Promise.allSettled(
                    batch.map(async (fileData) => {
                        const filePath = fileData.uri.fsPath;
                        const [fileStat, fileContent] = await Promise.all([
                            vscode.workspace.fs.stat(fileData.uri),
                            vscode.workspace.fs.readFile(fileData.uri),
                        ]);
                        const contentHash = createHash("sha256").update(fileContent).digest("hex");
                        return { fileData, filePath, fileStat, contentHash };
                    })
                );

                // Collect successfully-read files; log failures with their actual file paths
                const readyFiles: Array<{
                    fileData: FileData;
                    filePath: string;
                    fileStat: vscode.FileStat;
                    contentHash: string;
                }> = [];

                for (let i = 0; i < readResults.length; i++) {
                    const result = readResults[i];
                    if (result.status === 'fulfilled') {
                        readyFiles.push(result.value);
                    } else {
                        errors.push({ file: batch[i].id, error: String(result.reason) });
                    }
                }

                // Phase 2: Write all read files to the database in a single transaction.
                // Track a local counter so we only credit syncedFiles after the commit
                // succeeds — a rollback means nothing was actually persisted.
                //
                // Per-file errors are caught (not rethrown) so the batch transaction still
                // commits successfully for the files that did work. This is safe because
                // writeSingleFileToDB calls updateSyncMetadata as its *last* step — if a
                // file fails partway through, no sync_metadata row is written for it, so the
                // next sync will re-process it (self-healing). The trade-off is that partial
                // cell data for a failed file may briefly exist in the DB until the next sync
                // overwrites it via INSERT OR REPLACE.
                if (readyFiles.length > 0) {
                    let batchSynced = 0;
                    try {
                        await this.sqliteIndex.runInTransaction(async () => {
                            for (const { fileData, filePath, fileStat, contentHash } of readyFiles) {
                                try {
                                    await this.writeSingleFileToDB(fileData, filePath, fileStat, contentHash);
                                    batchSynced++;
                                    debug(`[FileSyncManager] Synced file: ${fileData.id}`);
                                } catch (error) {
                                    const errorMsg = error instanceof Error ? error.message : String(error);
                                    errors.push({ file: fileData.id, error: errorMsg });
                                }
                            }
                        });
                        // Transaction committed — count these files
                        syncedFiles += batchSynced;
                    } catch (txError) {
                        // Transaction rolled back — none of these files were committed
                        const errorMsg = txError instanceof Error ? txError.message : String(txError);
                        for (const { fileData } of readyFiles) {
                            errors.push({ file: fileData.id, error: errorMsg });
                        }
                    }
                }

                processedCount += batch.length;

                // Periodic WAL checkpoint every 5 batches during large syncs to keep
                // the WAL file bounded and flush data to the main file. This ensures
                // data survives a force-quit even if dispose() never runs.
                if (batches.length >= 5 && (batchIndex + 1) % 5 === 0) {
                    try {
                        await this.sqliteIndex.walCheckpoint();
                    } catch {
                        // Non-critical — WAL will be checkpointed eventually
                    }
                }
            }

            // Cleanup sync metadata for files that no longer exist
            progressCallback?.("Cleaning up obsolete metadata...", 85);
            const removedCount = await this.sqliteIndex.cleanupSyncMetadata(filePaths);
            if (removedCount > 0) {
                debug(`[FileSyncManager] Cleaned up ${removedCount} obsolete sync records`);
            }

            // Create deferred indexes for optimal performance (only after data insertion)
            if (syncedFiles > 0) {
                progressCallback?.("Optimizing database indexes...", 90);
                try {
                    await this.sqliteIndex.createDeferredIndexes();
                    debug("[FileSyncManager] Deferred indexes created for optimal performance");
                } catch (error) {
                    console.warn("[FileSyncManager] Error creating deferred indexes:", error);
                    // Don't fail the sync for index creation errors
                }
            }

            // Force save to ensure all changes are persisted
            progressCallback?.("Finalizing AI learning...", 95);
            await this.sqliteIndex.forceSave();

            const duration = performance.now() - syncStart;
            progressCallback?.("AI learning complete", 100);

            debug(`[FileSyncManager] AI learning completed in ${duration.toFixed(2)}ms`);
            debug(`[FileSyncManager] Results: ${syncedFiles} synced, ${unchangedFiles} unchanged, ${errors.length} errors`);

            return {
                totalFiles: allFiles.length,
                syncedFiles,
                unchangedFiles,
                errors,
                duration,
                details: syncDetails
            };

        } catch (error) {
            console.error("[FileSyncManager] Error during optimized file sync:", error);
            throw error;
        }
    }

    /**
     * Write a single file's data to the database.
     * Must be called within an existing transaction (no BEGIN/COMMIT here).
     */
    private async writeSingleFileToDB(
        fileData: FileData,
        filePath: string,
        fileStat: vscode.FileStat,
        contentHash: string
    ): Promise<void> {
        const fileType = filePath.includes('.source') ? 'source' : 'codex';

        // Update/insert the file in the main files table (pass the real content hash)
        const fileId = await this.sqliteIndex.upsertFileSync(
            filePath,
            fileType,
            fileStat.mtime,
            contentHash
        );

        // Calculate logical line positions for all non-paratext cells (1-indexed)
        let logicalLinePosition = 1;

        // Process all cells in the file using sync operations
        for (const cell of fileData.cells) {
            const cellId = cell.metadata?.id || `${fileData.id}_${fileData.cells.indexOf(cell)}`;
            const isParatext = cell.metadata?.type === "paratext";
            const isMilestone = cell.metadata?.type === CodexCellTypes.MILESTONE;
            const hasContent = cell.value && cell.value.trim() !== "";

            // Check if this is a child cell (has parentId in metadata)
            const isChildCell = cell.metadata?.parentId !== undefined;

            // Calculate line number for database storage
            let lineNumberForDB: number | null = null;

            if (!isParatext && !isMilestone && !isChildCell) {
                if (fileType === 'source') {
                    // Source cells: always store line numbers (they should always have content)
                    lineNumberForDB = logicalLinePosition;
                } else {
                    // Target cells: only store line number if cell has content
                    // But we still calculate the logical position for structural consistency
                    if (hasContent) {
                        lineNumberForDB = logicalLinePosition;
                    }
                    // If no content, lineNumberForDB stays null but logical position still increments
                }

                // Always increment logical position for non-paratext, non-milestone, non-child cells
                // This ensures stable line numbering even as cells get translated
                logicalLinePosition++;
            }
            // Paratext, milestone, and child cells: no line numbers, no position increment

            await this.sqliteIndex.upsertCellSync(
                cellId,
                fileId,
                fileType === 'source' ? 'source' : 'target',
                cell.value,
                lineNumberForDB ?? undefined, // Convert null to undefined for method signature compatibility
                cell.metadata,
                cell.value // raw content same as value for now
            );
        }

        // Update sync metadata via the public API (not direct DB access)
        await this.sqliteIndex.updateSyncMetadata(
            filePath,
            fileType,
            contentHash,
            fileStat.size,
            fileStat.mtime
        );
    }

    /**
     * Get sync statistics
     */
    async getSyncStatistics(): Promise<{
        syncStats: {
            totalFiles: number;
            sourceFiles: number;
            codexFiles: number;
            avgFileSize: number;
            oldestSync: Date | null;
            newestSync: Date | null;
        };
        indexStats: {
            totalCells: number;
            totalWords: number;
            totalFiles: number;
        };
    }> {
        try {
            const [syncStats, fileStatsMap] = await Promise.all([
                this.sqliteIndex.getSyncStats(),
                this.sqliteIndex.getFileStats()
            ]);

            // Calculate index stats
            let totalCells = 0;
            let totalWords = 0;
            for (const stats of fileStatsMap.values()) {
                totalCells += (stats.cell_count as number) || 0;
                totalWords += (stats.total_words as number) || 0;
            }

            return {
                syncStats,
                indexStats: {
                    totalCells,
                    totalWords,
                    totalFiles: fileStatsMap.size
                }
            };
        } catch (error) {
            console.error("[FileSyncManager] Error getting sync statistics:", error);
            throw error;
        }
    }

    /**
     * Sync only specific files (for targeted syncing after git operations)
     */
    async syncSpecificFiles(filePaths: string[], options: FileSyncOptions = {}): Promise<FileSyncResult> {
        const syncStart = performance.now();
        const { forceSync = false, progressCallback } = options;

        debug(`[FileSyncManager] Starting targeted sync of ${filePaths.length} specific files...`);
        progressCallback?.("Initializing targeted sync...", 0);

        const errors: Array<{ file: string; error: string; }> = [];
        let syncedFiles = 0;
        let unchangedFiles = 0;

        try {
            // Get file data for only the specified files
            const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();
            const allFiles = [...sourceFiles, ...targetFiles];

            // Filter to only the requested files
            const requestedFiles = allFiles.filter(f => filePaths.includes(f.uri.fsPath));
            const foundPaths = requestedFiles.map(f => f.uri.fsPath);
            const missingPaths = filePaths.filter(path => !foundPaths.includes(path));

            if (missingPaths.length > 0) {
                console.warn(`[FileSyncManager] Some requested files not found: ${missingPaths.join(", ")}`);
            }

            debug(`[FileSyncManager] Found ${requestedFiles.length} of ${filePaths.length} requested files`);
            progressCallback?.("Analyzing targeted files...", 10);

            if (requestedFiles.length === 0) {
                debug("[FileSyncManager] No files found to sync");
                return {
                    totalFiles: 0,
                    syncedFiles: 0,
                    unchangedFiles: 0,
                    errors: missingPaths.map(path => ({ file: path, error: "File not found" })),
                    duration: performance.now() - syncStart,
                    details: new Map()
                };
            }

            // Check which of these specific files need sync
            let filesToSync: string[];
            let syncDetails: Map<string, { reason: string; oldHash?: string; newHash?: string; }>;

            if (forceSync) {
                filesToSync = foundPaths;
                syncDetails = new Map(foundPaths.map(path => [path, { reason: "forced targeted sync" }]));
            } else {
                const syncCheck = await this.sqliteIndex.checkFilesForSync(foundPaths);
                filesToSync = syncCheck.needsSync;
                unchangedFiles = syncCheck.unchanged.length;
                syncDetails = syncCheck.details;
            }

            debug(`[FileSyncManager] Targeted sync: ${filesToSync.length} need sync, ${unchangedFiles} unchanged`);

            if (filesToSync.length === 0) {
                debug("[FileSyncManager] All targeted files are already synchronized");
                progressCallback?.("All targeted files up to date", 100);

                return {
                    totalFiles: requestedFiles.length,
                    syncedFiles: 0,
                    unchangedFiles: requestedFiles.length,
                    errors: missingPaths.map(path => ({ file: path, error: "File not found" })),
                    duration: performance.now() - syncStart,
                    details: syncDetails
                };
            }

            // Process the targeted files
            progressCallback?.("Processing targeted files...", 20);
            const fileMap = new Map(requestedFiles.map(f => [f.uri.fsPath, f]));
            const filesToProcess = filesToSync.map(path => fileMap.get(path)).filter(Boolean) as FileData[];

            // Process files with progress tracking (sequential — one transaction per file)
            for (let i = 0; i < filesToProcess.length; i++) {
                const fileData = filesToProcess[i];
                const filePath = fileData.uri.fsPath;
                const progress = 30 + (i / filesToProcess.length) * 60; // Reserve 30% start, 10% cleanup
                progressCallback?.(`Syncing ${i + 1}/${filesToProcess.length}: ${fileData.id}`, progress);

                try {
                    // Read file I/O
                    const [fileStat, fileContent] = await Promise.all([
                        vscode.workspace.fs.stat(fileData.uri),
                        vscode.workspace.fs.readFile(fileData.uri),
                    ]);
                    const contentHash = createHash("sha256").update(fileContent).digest("hex");

                    // Write to DB in a transaction
                    await this.sqliteIndex.runInTransaction(async () => {
                        await this.writeSingleFileToDB(fileData, filePath, fileStat, contentHash);
                    });
                    syncedFiles++;
                    debug(`[FileSyncManager] Synced targeted file: ${fileData.id}`);
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    errors.push({ file: fileData.id, error: errorMsg });
                    console.error(`[FileSyncManager] Error syncing targeted file ${fileData.id}:`, error);
                }
            }

            // Cleanup and finalize
            progressCallback?.("Finalizing targeted sync...", 95);
            await this.sqliteIndex.forceSave();

            const duration = performance.now() - syncStart;
            progressCallback?.("Targeted AI learning complete", 100);

            debug(`[FileSyncManager] Targeted AI learning completed in ${duration.toFixed(2)}ms`);
            debug(`[FileSyncManager] Results: ${syncedFiles} synced, ${unchangedFiles} unchanged, ${errors.length} errors`);

            return {
                totalFiles: requestedFiles.length,
                syncedFiles,
                unchangedFiles,
                errors: [...errors, ...missingPaths.map(path => ({ file: path, error: "File not found" }))],
                duration,
                details: syncDetails
            };

        } catch (error) {
            console.error("[FileSyncManager] Error during targeted file sync:", error);
            throw error;
        }
    }
} 