import * as vscode from "vscode";
import { createHash } from "crypto";
import { SQLiteIndexManager } from "./indexes/sqliteIndex";
import { FileData, readSourceAndTargetFiles } from "./indexes/fileReaders";

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
        console.log("[FileSyncManager] Checking sync status...");

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
            console.log(`[FileSyncManager] Sync check completed in ${syncDuration.toFixed(2)}ms`);
            console.log(`[FileSyncManager] Files needing sync: ${syncCheck.needsSync.length}/${filePaths.length}`);

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

        console.log(`[FileSyncManager] Starting optimized file sync (force: ${forceSync})...`);
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

            console.log(`[FileSyncManager] Files to sync: ${filesToSync.length}/${filePaths.length}`);

            if (filesToSync.length === 0) {
                console.log("[FileSyncManager] No files need synchronization");
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

            // Process files in optimized batches
            const BATCH_SIZE = 10; // Process 10 files at a time
            const batches = [];
            for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
                batches.push(filesToProcess.slice(i, i + BATCH_SIZE));
            }

            console.log(`[FileSyncManager] Processing ${filesToProcess.length} files in ${batches.length} batches of ${BATCH_SIZE}`);

            let processedCount = 0;
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                const progress = 20 + (batchIndex / batches.length) * 60; // Reserve 20% for cleanup
                progressCallback?.(`Syncing batch ${batchIndex + 1}/${batches.length} (${batch.length} files)...`, progress);

                // Process batch in parallel for I/O operations, then sync to database
                const batchResults = await Promise.allSettled(
                    batch.map(async (fileData): Promise<{ success: true; file: string; } | { success: false; file: string; error: string; }> => {
                        try {
                            await this.syncSingleFileOptimized(fileData);
                            return { success: true, file: fileData.id };
                        } catch (error) {
                            const errorMsg = error instanceof Error ? error.message : String(error);
                            return { success: false, file: fileData.id, error: errorMsg };
                        }
                    })
                );

                // Process batch results
                for (const result of batchResults) {
                    if (result.status === 'fulfilled') {
                        if (result.value.success) {
                            syncedFiles++;
                            console.log(`[FileSyncManager] Synced file: ${result.value.file}`);
                        } else {
                            errors.push({
                                file: result.value.file,
                                error: result.value.error || 'Unknown error during sync'
                            });
                        }
                    } else {
                        errors.push({ file: 'unknown', error: result.reason });
                    }
                }

                processedCount += batch.length;
            }

            // Cleanup sync metadata for files that no longer exist
            progressCallback?.("Cleaning up obsolete metadata...", 85);
            const removedCount = await this.sqliteIndex.cleanupSyncMetadata(filePaths);
            if (removedCount > 0) {
                console.log(`[FileSyncManager] Cleaned up ${removedCount} obsolete sync records`);
            }

            // Create deferred indexes for optimal performance (only after data insertion)
            if (syncedFiles > 0) {
                progressCallback?.("Optimizing database indexes...", 90);
                try {
                    await this.sqliteIndex.createDeferredIndexes();
                    console.log("[FileSyncManager] Deferred indexes created for optimal performance");
                } catch (error) {
                    console.warn("[FileSyncManager] Error creating deferred indexes:", error);
                    // Don't fail the sync for index creation errors
                }
            }

            // Force save to ensure all changes are persisted
            progressCallback?.("Finalizing sync...", 95);
            await this.sqliteIndex.forceSave();

            const duration = performance.now() - syncStart;
            progressCallback?.("Sync complete", 100);

            console.log(`[FileSyncManager] Optimized sync completed in ${duration.toFixed(2)}ms`);
            console.log(`[FileSyncManager] Results: ${syncedFiles} synced, ${unchangedFiles} unchanged, ${errors.length} errors`);

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
     * Optimized single file sync with reduced I/O operations
     */
    private async syncSingleFileOptimized(fileData: FileData): Promise<void> {
        const filePath = fileData.uri.fsPath;
        const fileType = filePath.includes('.source') ? 'source' : 'codex';

        try {
            // Batch file operations
            const [fileStat, fileContent] = await Promise.all([
                vscode.workspace.fs.stat(fileData.uri),
                vscode.workspace.fs.readFile(fileData.uri)
            ]);

            const contentHash = createHash("sha256").update(fileContent).digest("hex");

            // Use synchronous database operations within a transaction for speed
            await this.sqliteIndex.runInTransaction(() => {
                // Update/insert the file in the main files table
                const fileId = this.sqliteIndex.upsertFileSync(
                    filePath,
                    fileType,
                    fileStat.mtime
                );

                // Process all cells in the file using sync operations
                for (const cell of fileData.cells) {
                    const cellId = cell.metadata?.id || `${fileData.id}_${fileData.cells.indexOf(cell)}`;

                    this.sqliteIndex.upsertCellSync(
                        cellId,
                        fileId,
                        fileType === 'source' ? 'source' : 'target',
                        cell.value,
                        undefined, // line number not available in current metadata
                        cell.metadata,
                        cell.value // raw content same as value for now
                    );
                }

                // Update sync metadata (this could be async but we'll keep it in transaction)
                const stmt = this.sqliteIndex.database?.prepare(`
                    INSERT INTO sync_metadata (file_path, file_type, content_hash, file_size, last_modified_ms, last_synced_ms)
                    VALUES (?, ?, ?, ?, ?, strftime('%s', 'now') * 1000)
                    ON CONFLICT(file_path) DO UPDATE SET
                        content_hash = excluded.content_hash,
                        file_size = excluded.file_size,
                        last_modified_ms = excluded.last_modified_ms,
                        last_synced_ms = strftime('%s', 'now') * 1000,
                        updated_at = strftime('%s', 'now') * 1000
                `);

                if (stmt) {
                    try {
                        stmt.bind([filePath, fileType, contentHash, fileStat.size, fileStat.mtime]);
                        stmt.step();
                    } finally {
                        stmt.free();
                    }
                }
            });

        } catch (error) {
            console.error(`[FileSyncManager] Error in optimized sync for file ${filePath}:`, error);
            throw error;
        }
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
} 