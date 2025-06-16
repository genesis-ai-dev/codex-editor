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

        console.log(`[FileSyncManager] Starting file sync (force: ${forceSync})...`);
        progressCallback?.("Checking files for changes...", 0);

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

            // Process files that need sync
            const fileMap = new Map(allFiles.map(f => [f.uri.fsPath, f]));
            let processedCount = 0;

            for (const filePath of filesToSync) {
                const fileData = fileMap.get(filePath);
                if (!fileData) {
                    errors.push({ file: filePath, error: "File data not found" });
                    continue;
                }

                try {
                    const progress = 20 + (processedCount / filesToSync.length) * 70;
                    progressCallback?.(`Syncing ${fileData.id}...`, progress);

                    await this.syncSingleFile(fileData);
                    syncedFiles++;

                    console.log(`[FileSyncManager] Synced file: ${fileData.id}`);
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    errors.push({ file: filePath, error: errorMsg });
                    console.error(`[FileSyncManager] Error syncing file ${filePath}:`, error);
                }

                processedCount++;
            }

            // Cleanup sync metadata for files that no longer exist
            progressCallback?.("Cleaning up obsolete metadata...", 95);
            const removedCount = await this.sqliteIndex.cleanupSyncMetadata(filePaths);
            if (removedCount > 0) {
                console.log(`[FileSyncManager] Cleaned up ${removedCount} obsolete sync records`);
            }

            const duration = performance.now() - syncStart;
            progressCallback?.("Sync complete", 100);

            console.log(`[FileSyncManager] Sync completed in ${duration.toFixed(2)}ms`);
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
            console.error("[FileSyncManager] Error during file sync:", error);
            throw error;
        }
    }

    /**
     * Sync a single file
     */
    private async syncSingleFile(fileData: FileData): Promise<void> {
        const filePath = fileData.uri.fsPath;
        const fileType = filePath.includes('.source') ? 'source' : 'codex';

        try {
            // Get file stats and compute hash
            const fileStat = await vscode.workspace.fs.stat(fileData.uri);
            const fileContent = await vscode.workspace.fs.readFile(fileData.uri);
            const contentHash = createHash("sha256").update(fileContent).digest("hex");

            // Update/insert the file in the main files table
            const fileId = await this.sqliteIndex.upsertFile(
                filePath,
                fileType,
                fileStat.mtime
            );

            // Process all cells in the file
            for (const cell of fileData.cells) {
                const cellId = cell.metadata?.id || `${fileData.id}_${fileData.cells.indexOf(cell)}`;

                await this.sqliteIndex.upsertCell(
                    cellId,
                    fileId,
                    fileType === 'source' ? 'source' : 'target',
                    cell.value,
                    undefined, // line number not available in current metadata
                    cell.metadata,
                    cell.value // raw content same as value for now
                );
            }

            // Update sync metadata
            await this.sqliteIndex.updateSyncMetadata(
                filePath,
                fileType,
                contentHash,
                fileStat.size,
                fileStat.mtime
            );

        } catch (error) {
            console.error(`[FileSyncManager] Error syncing file ${filePath}:`, error);
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