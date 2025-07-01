"use strict";
import * as vscode from "vscode";
import { getWorkSpaceFolder, getWorkSpaceUri } from "../../../../utils";
import { IndexingStatusBarHandler } from "../statusBarHandler";

const DEBUG_MODE = false;
const debug = (message: string, ...args: any[]) => {
    DEBUG_MODE && console.log(`[Index] ${message}`, ...args);
};

import {
    searchTargetCellsByQuery,
    getTranslationPairsFromSourceCellQuery,
    getSourceCellByCellIdFromAllSourceCells,
    getTargetCellByCellId,
    getTranslationPairFromProject,
    handleTextSelection,
    searchParallelCells,
    searchSimilarCellIds,
    findNextUntranslatedSourceCell,
    searchAllCells,
    searchTranslationPairs,
} from "./search";
import { SQLiteIndexManager, CURRENT_SCHEMA_VERSION } from "./sqliteIndex";

import {
    initializeWordsIndex,
    getWordFrequencies,
    getWordsAboveThreshold,
    WordOccurrence,
} from "./wordsIndex";
import { initializeFilesIndex, getFilePairs, getWordCountStats, FileInfo } from "./filesIndex";
import { updateCompleteDrafts } from "../indexingUtils";
import { readSourceAndTargetFiles } from "./fileReaders";
import { debounce } from "lodash";
import { MinimalCellResult, TranslationPair } from "../../../../../types";
import { getNotebookMetadataManager } from "../../../../utils/notebookMetadataManager";
import { updateSplashScreenTimings } from "../../../../providers/SplashScreen/register";
import { FileSyncManager, FileSyncResult } from "../fileSyncManager";
import { registerBackgroundValidation } from "../../../../validation/backgroundValidationService";

type WordFrequencyMap = Map<string, WordOccurrence[]>;

/**
 * Show AI learning progress notification - the core UX for index rebuilds
 * @param cancellable Whether the operation can be cancelled
 * @returns Promise that resolves when the notification is dismissed or operation completes
 */
async function showAILearningProgress<T>(
    operation: (progress: vscode.Progress<{ message?: string; increment?: number; }>) => Promise<T>,
    cancellable: boolean = false
): Promise<T | undefined> {
    // Create a new promise that wraps the progress notification
    return new Promise<T | undefined>((resolve, reject) => {
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "AI learning from your latest changes...",
                cancellable
            },
            async (progress, token) => {
                if (cancellable && token) {
                    token.onCancellationRequested(() => {
                        debug("AI learning cancelled by user");
                        resolve(undefined);
                    });
                }

                try {
                    const result = await operation(progress);

                    progress.report({ message: undefined }); // Clear any existing message
                    // Update the existing notification to show completion
                    progress.report({
                        message: "✨ Learning complete!"
                    });

                    // Keep the completion message visible for 1 second
                    await new Promise(res => setTimeout(res, 1000));

                    resolve(result);
                } catch (error) {
                    debug(`AI learning error: ${error}`);
                    reject(error);
                }
            }
        );
    });
}

async function isDocumentAlreadyOpen(uri: vscode.Uri): Promise<boolean> {
    const openTextDocuments = vscode.workspace.textDocuments;
    return openTextDocuments.some((doc) => doc.uri.toString() === uri.toString());
}

// Track if the index context has been initialized to prevent duplicate command registrations
let isIndexContextInitialized = false;

// Add rebuild state tracking to prevent excessive rebuilds
interface IndexRebuildState {
    lastRebuildTime: number;
    lastRebuildReason: string;
    rebuildInProgress: boolean;
    consecutiveRebuilds: number;
}

let rebuildState: IndexRebuildState = {
    lastRebuildTime: 0,
    lastRebuildReason: '',
    rebuildInProgress: false,
    consecutiveRebuilds: 0
};

// Cooldown periods (in milliseconds)
const REBUILD_COOLDOWN_MS = 30000; // 30 seconds minimum between rebuilds
const MAX_CONSECUTIVE_REBUILDS = 3; // Maximum rebuilds in a session

export async function createIndexWithContext(context: vscode.ExtensionContext) {
    const metadataManager = getNotebookMetadataManager();
    const workspaceUri = getWorkSpaceUri();
    if (!workspaceUri) {
        console.error("No workspace folder found. Aborting index creation.");
        return;
    }

    const statusBarHandler = IndexingStatusBarHandler.getInstance();

    // Only register status bar handler once
    if (!isIndexContextInitialized) {
        context.subscriptions.push(statusBarHandler);

        // Load rebuild state from extension storage
        const savedRebuildState = context.globalState.get<IndexRebuildState>('indexRebuildState');
        if (savedRebuildState) {
            rebuildState = { ...rebuildState, ...savedRebuildState };
            // Reset rebuild progress flag on startup
            rebuildState.rebuildInProgress = false;
        }
    }

    // Initialize SQLite index manager
    const indexManager = new SQLiteIndexManager();

    await indexManager.initialize(context);

    // Register the index manager globally for immediate access
    const { setSQLiteIndexManager } = await import("./sqliteIndexManager");
    setSQLiteIndexManager(indexManager);

    // Create separate instances for translation pairs and source text
    const translationPairsIndex = indexManager;
    // Use the same SQLite index for both translation pairs and source text
    // since FileSyncManager indexes all content into the main database
    const sourceTextIndex = indexManager;

    let wordsIndex: WordFrequencyMap = new Map<string, WordOccurrence[]>();
    let filesIndex: Map<string, FileInfo> = new Map<string, FileInfo>();

    await metadataManager.initialize();
    await metadataManager.loadMetadata();

    /**
     * Check if rebuild is allowed based on cooldown and consecutive rebuild limits
     */
    function isRebuildAllowed(reason: string, isForced: boolean = false): { allowed: boolean; reason?: string; } {
        const now = Date.now();
        const timeSinceLastRebuild = now - rebuildState.lastRebuildTime;

        if (rebuildState.rebuildInProgress) {
            return { allowed: false, reason: "rebuild already in progress" };
        }

        if (isForced) {
            debug(`[Index] Forced rebuild allowed: ${reason}`);
            return { allowed: true };
        }

        if (timeSinceLastRebuild < REBUILD_COOLDOWN_MS) {
            const remainingCooldown = Math.ceil((REBUILD_COOLDOWN_MS - timeSinceLastRebuild) / 1000);
            return {
                allowed: false,
                reason: `rebuild cooldown active (${remainingCooldown}s remaining)`
            };
        }

        if (rebuildState.consecutiveRebuilds >= MAX_CONSECUTIVE_REBUILDS) {
            return {
                allowed: false,
                reason: `maximum consecutive rebuilds reached (${MAX_CONSECUTIVE_REBUILDS})`
            };
        }

        return { allowed: true };
    }

    /**
     * Update rebuild state and persist to storage
     */
    function updateRebuildState(updates: Partial<IndexRebuildState>) {
        rebuildState = { ...rebuildState, ...updates };
        context.globalState.update('indexRebuildState', rebuildState);
    }

    /**
     * Check if rebuild is needed using intelligent file-level sync
     */
    async function checkIfRebuildNeeded(): Promise<{ needsRebuild: boolean; reason: string; }> {
        try {
            debug("[Index] Checking if rebuild needed using file-level sync...");

            // Create sync manager
            const fileSyncManager = new FileSyncManager(translationPairsIndex);

            // Check sync status
            const syncStatus = await fileSyncManager.checkSyncStatus();

            if (syncStatus.needsSync) {
                const { summary } = syncStatus;
                let reason = `${summary.changedFiles + summary.newFiles} files need synchronization`;

                if (summary.newFiles > 0) {
                    reason += ` (${summary.newFiles} new files)`;
                }
                if (summary.changedFiles > 0) {
                    reason += ` (${summary.changedFiles} changed files)`;
                }

                debug(`[Index] Rebuild needed: ${reason}`);
                return { needsRebuild: true, reason };
            }

            debug(`[Index] No rebuild needed - all ${syncStatus.summary.totalFiles} files are up to date`);
            return { needsRebuild: false, reason: "all files synchronized" };

        } catch (error) {
            console.error("[Index] Error checking rebuild status:", error);
            // Fallback to rebuild on error
            return { needsRebuild: true, reason: `sync check failed: ${error instanceof Error ? error.message : 'unknown error'}` };
        }
    }

    /**
     * Smart rebuild using file-level synchronization
     */
    async function smartRebuildIndexes(reason: string, isForced: boolean = false): Promise<void> {
        debug(`[Index] Starting smart rebuild: ${reason} (forced: ${isForced})`);

        // Check consecutive rebuilds protection
        const rebuildCheck = isRebuildAllowed(reason, isForced);
        if (!rebuildCheck.allowed) {
            console.warn(`[Index] Skipping rebuild: ${rebuildCheck.reason}`);
            return;
        }

        updateRebuildState({
            lastRebuildTime: Date.now(),
            lastRebuildReason: reason,
            rebuildInProgress: true,
            consecutiveRebuilds: rebuildState.consecutiveRebuilds + 1
        });

        try {
            statusBarHandler.setIndexingActive();

            // Create sync manager
            const fileSyncManager = new FileSyncManager(translationPairsIndex);

            // For forced rebuilds, clear everything first
            if (isForced) {
                debug("[Index] Forced rebuild - clearing existing indexes...");
                await translationPairsIndex.removeAll();
                await sourceTextIndex.removeAll();
                wordsIndex.clear();
                filesIndex.clear();
            }

            // Perform intelligent file synchronization
            debug("[Index] Starting file-level synchronization...");

            const syncResult: FileSyncResult = await fileSyncManager.syncFiles({
                forceSync: isForced,
                progressCallback: (message, progress) => {
                    debug(`[Index] Sync progress: ${message} (${progress}%)`);
                    // Use existing status bar methods for progress tracking
                }
            });

            debug(`[Index] Sync completed: ${syncResult.syncedFiles}/${syncResult.totalFiles} files processed in ${syncResult.duration.toFixed(2)}ms`);

            if (syncResult.errors.length > 0) {
                console.warn(`[Index] Sync completed with ${syncResult.errors.length} errors:`);
                syncResult.errors.forEach(error => {
                    console.warn(`[Index] - ${error.file}: ${error.error}`);
                });
            }

            // Update other indexes that depend on the file data
            debug("[Index] Updating complementary indexes...");

            try {
                // Update words and files indexes
                const { targetFiles } = await readSourceAndTargetFiles();
                wordsIndex = await initializeWordsIndex(wordsIndex, targetFiles);
                filesIndex = await initializeFilesIndex();

                // Update complete drafts
                await updateCompleteDrafts(targetFiles);

                debug("[Index] Complementary indexes updated successfully");
            } catch (error) {
                console.warn("[Index] Error updating complementary indexes:", error);
                // Don't fail the entire rebuild for complementary index errors
            }

            const finalDocCount = translationPairsIndex.documentCount;
            debug(`[Index] Smart sync rebuild complete - indexed ${finalDocCount} documents`);

            statusBarHandler.updateIndexCounts(
                finalDocCount,
                sourceTextIndex.documentCount
            );

            // Reset consecutive rebuilds on successful completion
            updateRebuildState({
                rebuildInProgress: false,
                consecutiveRebuilds: 0
            });

            // Show sync statistics
            try {
                const stats = await fileSyncManager.getSyncStatistics();
                debug(`[Index] Sync Statistics:`);
                debug(`  - Total files: ${stats.syncStats.totalFiles} (${stats.syncStats.sourceFiles} source, ${stats.syncStats.codexFiles} codex)`);
                debug(`  - Index stats: ${stats.indexStats.totalCells} cells, ${stats.indexStats.totalWords} words`);
            } catch (error) {
                console.warn("[Index] Error getting sync statistics:", error);
            }

        } catch (error) {
            console.error("Error in smart sync rebuild:", error);
            updateRebuildState({
                rebuildInProgress: false
            });
            throw error;
        } finally {
            statusBarHandler.setIndexingComplete();
        }
    }

    /**
     * Conservative validation that only rebuilds for critical issues
     */
    async function validateIndexHealthConservatively(): Promise<{ isHealthy: boolean; criticalIssue?: string; }> {
        const documentCount = translationPairsIndex.documentCount;

        // Check if database is empty - regardless of schema, recreation is faster than sync
        if (documentCount === 0) {
            debug("[Index] Database is empty - recreation is faster than sync (20s vs 30+s)");
            return { isHealthy: false, criticalIssue: "empty database - recreation faster than sync" };
        }

        // Check if we have some files but almost no cells (extremely broken)
        try {
            const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();
            const totalFiles = sourceFiles.length + targetFiles.length;

            if (totalFiles > 50 && documentCount < 10) {
                return { isHealthy: false, criticalIssue: `severely broken index: only ${documentCount} cells for ${totalFiles} files` };
            }

            // For SQLite, check for critical data corruption only
            if (translationPairsIndex instanceof SQLiteIndexManager) {
                try {
                    const stats = await translationPairsIndex.getContentStats();

                    // Only fail if almost all cells are missing source content (target cells can be legitimately blank)
                    if (stats.totalCells > 0) {
                        const missingSourceContentRatio = stats.cellsWithMissingContent / stats.totalCells;
                        if (missingSourceContentRatio > 0.9) { // 90%+ missing source content
                            return { isHealthy: false, criticalIssue: `critical data corruption: ${Math.round(missingSourceContentRatio * 100)}% of cells missing source content` };
                        }
                    }
                } catch (error) {
                    // Database errors are critical
                    return { isHealthy: false, criticalIssue: `database error: ${error}` };
                }
            }
        } catch (error) {
            console.warn("[Index] Error during health check:", error);
            // Don't fail health check on file reading errors
        }

        return { isHealthy: true };
    }

    // Check database health and determine if rebuild is needed
    const currentDocCount = translationPairsIndex.documentCount;
    const healthCheck = await validateIndexHealthConservatively();

    debug(`[Index] Health check: ${healthCheck.isHealthy ? 'HEALTHY' : 'CRITICAL ISSUE'} - ${healthCheck.criticalIssue || 'OK'} (${currentDocCount} documents)`);

    let needsRebuild = false;
    let rebuildReason = '';

    if (!healthCheck.isHealthy) {
        needsRebuild = true;
        rebuildReason = healthCheck.criticalIssue || 'health check failed';
    } else {
        // Health check passed - database is structurally sound
        // Check for file changes to determine if sync is needed
        const changeCheck = await checkIfRebuildNeeded();
        if (changeCheck.needsRebuild) {
            needsRebuild = true;
            rebuildReason = changeCheck.reason;
        }
    }

    if (needsRebuild) {
        debug(`[Index] Rebuild needed: ${rebuildReason}`);

        // Check if this is a critical issue that should rebuild automatically
        const isCritical = !healthCheck.isHealthy;

        // Perform rebuild synchronously during extension activation to ensure splash screen waits
        debug(`[Index] Starting ${isCritical ? 'critical' : 'normal'} rebuild...`);
        try {
            await showAILearningProgress(async (progress) => {
                await smartRebuildIndexes(rebuildReason, isCritical);
                const finalCount = translationPairsIndex.documentCount;
                debug(`[Index] Rebuild completed with ${finalCount} documents`);

                // No need for completion messages - the progress notification handles it
                if (finalCount === 0) {
                    debug("[Index] Warning: No documents were indexed. Check .codex and .source files.");
                }
            });
        } catch (error) {
            console.error("[Index] Error during rebuild:", error);
            // Don't show technical error messages to users
            debug(`[Index] Failed to rebuild: ${error instanceof Error ? error.message : String(error)}`);
        }
    } else {
        // Database is healthy and up to date
        debug(`[Index] Index is healthy and up to date with ${currentDocCount} documents`);
        statusBarHandler.updateIndexCounts(
            translationPairsIndex.documentCount,
            sourceTextIndex.documentCount
        );

        // Reset consecutive rebuilds since we didn't need to rebuild
        updateRebuildState({
            consecutiveRebuilds: 0
        });
    }

    // Only register commands and event listeners once
    if (!isIndexContextInitialized) {
        // NOTE: File change watchers removed in favor of startup-time content checking
        // The new robust system checks for changes when the extension starts up,
        // which is more reliable than real-time file watching and prevents excessive rebuilds

        const searchTargetCellsByQueryCommand = vscode.commands.registerCommand(
            "codex-editor-extension.searchTargetCellsByQuery",
            async (query?: string, showInfo: boolean = false) => {
                if (!query) {
                    query = await vscode.window.showInputBox({
                        prompt: "Enter a query to search target cells",
                        placeHolder: "e.g. love, faith, hope",
                    });
                    if (!query) return; // User cancelled the input
                    showInfo = true;
                }
                try {
                    const results = await searchTargetCellsByQuery(translationPairsIndex, query);
                    if (showInfo) {
                        const resultsString = results
                            .map((r: any) => `${r.id}: ${r.sourceContent || r.targetContent}`)
                            .join("\n");
                        vscode.window.showInformationMessage(
                            `Found ${results.length} results for query: ${query}\n${resultsString}`
                        );
                    }
                    return results;
                } catch (error) {
                    console.error("Error searching target cells:", error);
                    vscode.window.showErrorMessage(
                        "Failed to search target cells. Check the logs for details."
                    );
                    return [];
                }
            }
        );

        const getTranslationPairsFromSourceCellQueryCommand = vscode.commands.registerCommand(
            "codex-editor-extension.getTranslationPairsFromSourceCellQuery",
            async (query?: string, k: number = 10, onlyValidated: boolean = false, showInfo: boolean = false) => {
                if (!query) {
                    query = await vscode.window.showInputBox({
                        prompt: "Enter a query to search source cells",
                        placeHolder: "e.g. love, faith, hope",
                    });
                    if (!query) return []; // User cancelled the input
                    showInfo = true;
                }
                console.log({ query, k, onlyValidated });
                const results = await getTranslationPairsFromSourceCellQuery(
                    translationPairsIndex,
                    query,
                    k,
                    onlyValidated
                );
                console.log({ results });
                if (showInfo) {
                    const resultsString = results
                        .map((r: TranslationPair) => `${r.cellId}: ${r.sourceCell.content}`)
                        .join("\n");
                    vscode.window.showInformationMessage(
                        `Found ${results.length} ${onlyValidated ? 'validated' : 'all'} results for query: ${query}\n${resultsString}`
                    );
                }
                return results;
            }
        );

        const getSourceCellByCellIdFromAllSourceCellsCommand = vscode.commands.registerCommand(
            "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
            async (cellId?: string, showInfo: boolean = false) => {
                if (!cellId) {
                    cellId = await vscode.window.showInputBox({
                        prompt: "Enter a cell ID",
                        placeHolder: "e.g. GEN 1:1",
                    });
                    if (!cellId) return null; // User cancelled the input
                    showInfo = true;
                }
                debug(
                    `Executing getSourceCellByCellIdFromAllSourceCells for cellId: ${cellId}`
                );
                const results = await getSourceCellByCellIdFromAllSourceCells(
                    sourceTextIndex,
                    cellId
                );
                debug("getSourceCellByCellIdFromAllSourceCells results:", results);
                if (showInfo && results) {
                    vscode.window.showInformationMessage(
                        `Source cell for ${cellId}: ${results.content}`
                    );
                }
                return results;
            }
        );

        const getTargetCellByCellIdCommand = vscode.commands.registerCommand(
            "codex-editor-extension.getTargetCellByCellId",
            async (cellId?: string, showInfo: boolean = false) => {
                if (!cellId) {
                    cellId = await vscode.window.showInputBox({
                        prompt: "Enter a cell ID",
                        placeHolder: "e.g. GEN 1:1",
                    });
                    if (!cellId) return; // User cancelled the input
                    showInfo = true;
                }
                const results = await getTargetCellByCellId(translationPairsIndex, cellId);
                if (showInfo && results) {
                    vscode.window.showInformationMessage(
                        `Target cell for ${cellId}: ${JSON.stringify(results)}`
                    );
                }
                return results;
            }
        );

        const forceReindexCommand = vscode.commands.registerCommand(
            "codex-editor-extension.forceReindex",
            async () => {
                await showAILearningProgress(async (progress) => {
                    await smartRebuildIndexes("manual force reindex command", true);
                });
            }
        );

        const showIndexOptionsCommand = vscode.commands.registerCommand(
            "codex-editor-extension.showIndexOptions",
            async () => {
                const option = await vscode.window.showQuickPick(["Force Reindex"], {
                    placeHolder: "Select an indexing option",
                });

                if (option === "Force Reindex") {
                    await smartRebuildIndexes("manual force reindex from options", true);
                }
            }
        );

        const getWordFrequenciesCommand = vscode.commands.registerCommand(
            "codex-editor-extension.getWordFrequencies",
            async (): Promise<Array<{ word: string; frequency: number; }>> => {
                return getWordFrequencies(wordsIndex);
            }
        );

        const refreshWordIndexCommand = vscode.commands.registerCommand(
            "codex-editor-extension.refreshWordIndex",
            async () => {
                const { targetFiles } = await readSourceAndTargetFiles();
                wordsIndex = await initializeWordsIndex(new Map(), targetFiles);
                debug("Word index refreshed");
            }
        );

        const getWordsAboveThresholdCommand = vscode.commands.registerCommand(
            "codex-editor-extension.getWordsAboveThreshold",
            async () => {
                const config = vscode.workspace.getConfiguration("codex-editor-extension");
                const threshold = config.get<number>("wordFrequencyThreshold", 50);
                if (wordsIndex.size === 0) {
                    const { targetFiles } = await readSourceAndTargetFiles();
                    wordsIndex = await initializeWordsIndex(wordsIndex, targetFiles);
                }
                const wordsAboveThreshold = await getWordsAboveThreshold(wordsIndex, threshold);
                debug(`Words above threshold: ${wordsAboveThreshold}`);
                return wordsAboveThreshold;
            }
        );

        const searchParallelCellsCommand = vscode.commands.registerCommand(
            "codex-editor-extension.searchParallelCells",
            async (query?: string, k: number = 15, showInfo: boolean = false, options?: any) => {
                if (!query) {
                    query = await vscode.window.showInputBox({
                        prompt: "Enter a query to search parallel cells",
                        placeHolder: "e.g. love, faith, hope",
                    });
                    if (!query) return []; // User cancelled the input
                    showInfo = true;
                }

                // Search translation pairs with boosted weights for complete pairs and target content
                const results = await searchAllCells(
                    translationPairsIndex,
                    sourceTextIndex,
                    query,
                    k,
                    false,
                    options // Pass through options including isParallelPassagesWebview
                );

                // Remove duplicates based on cellId
                const uniqueResults = results.filter(
                    (v, i, a) => a.findIndex((t) => t.cellId === v.cellId) === i
                );

                // If we have fewer unique results than requested, try to get more
                if (uniqueResults.length < k) {
                    const additionalResults = await searchTranslationPairs(
                        translationPairsIndex,
                        query,
                        false, // includeIncomplete set to false
                        k * 2,
                        { completeBoost: 1.5, targetContentBoost: 1.2, ...options }
                    );
                    const allResults = [...uniqueResults, ...additionalResults];
                    uniqueResults.splice(
                        0,
                        uniqueResults.length,
                        ...allResults
                            .filter((v, i, a) => a.findIndex((t) => t.cellId === v.cellId) === i)
                            .slice(0, k)
                    );
                }

                if (showInfo) {
                    const resultsString = uniqueResults
                        .map(
                            (r: TranslationPair) =>
                                `${r.cellId}: Source: ${r.sourceCell.content}, Target: ${r.targetCell.content}`
                        )
                        .join("\n");
                    vscode.window.showInformationMessage(
                        `Found ${uniqueResults.length} unique parallel cells for query: ${query}\n${resultsString}`
                    );
                }
                return uniqueResults;
            }
        );
        const searchSimilarCellIdsCommand = vscode.commands.registerCommand(
            "codex-editor-extension.searchSimilarCellIds",
            async (cellId: string) => {
                return searchSimilarCellIds(translationPairsIndex, cellId);
            }
        );
        const getTranslationPairFromProjectCommand = vscode.commands.registerCommand(
            "codex-editor-extension.getTranslationPairFromProject",
            async (cellId?: string, options?: { isParallelPassagesWebview?: boolean; }, showInfo: boolean = false) => {
                if (!cellId) {
                    cellId = await vscode.window.showInputBox({
                        prompt: "Enter a cell ID",
                        placeHolder: "e.g. GEN 1:1",
                    });
                    if (!cellId) return; // User cancelled the input
                    showInfo = true;
                }
                const result = await getTranslationPairFromProject(
                    translationPairsIndex,
                    sourceTextIndex,
                    cellId,
                    options
                );
                if (showInfo) {
                    if (result) {
                        vscode.window.showInformationMessage(
                            `Translation pair for ${cellId}: Source: ${result.sourceCell.content}, Target: ${result.targetCell.content}`
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            `No translation pair found for ${cellId}`
                        );
                    }
                }
                return result;
            }
        );

        const findNextUntranslatedSourceCellCommand = vscode.commands.registerCommand(
            "codex-editor-extension.findNextUntranslatedSourceCell",
            async (query?: string, cellId?: string, showInfo: boolean = false) => {
                if (!query) {
                    query = await vscode.window.showInputBox({
                        prompt: "Enter a query to search for the next untranslated source cell",
                        placeHolder: "e.g. love, faith, hope",
                    });
                    if (!query) return null; // User cancelled the input
                    showInfo = true;
                }
                if (!cellId) {
                    cellId = await vscode.window.showInputBox({
                        prompt: "Enter the current cell ID to exclude from results",
                        placeHolder: "e.g. GEN 1:1",
                    });
                    if (!cellId) return null; // User cancelled the input
                }
                const result = await findNextUntranslatedSourceCell(
                    sourceTextIndex,
                    translationPairsIndex,
                    query,
                    cellId
                );
                if (showInfo) {
                    if (result) {
                        vscode.window.showInformationMessage(
                            `Next untranslated source cell: ${result.cellId}\nContent: ${result.content}`
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            "No untranslated source cell found matching the query."
                        );
                    }
                }
                return result;
            }
        );

        const searchAllCellsCommand = vscode.commands.registerCommand(
            "codex-editor-extension.searchAllCells",
            async (
                query?: string,
                k: number = 15,
                includeIncomplete: boolean = true,
                showInfo: boolean = false,
                options?: any
            ) => {
                if (!query) {
                    query = await vscode.window.showInputBox({
                        prompt: "Enter a query to search all cells",
                        placeHolder: "e.g. love, faith, hope",
                    });
                    if (!query) return []; // User cancelled the input
                    showInfo = true;
                }
                const results = await searchAllCells(
                    translationPairsIndex,
                    sourceTextIndex,
                    query,
                    k,
                    includeIncomplete,
                    options // Pass through options including isParallelPassagesWebview
                );

                debug(`Search results for "${query}":`, results);

                if (showInfo) {
                    const resultsString = results
                        .map((r) => {
                            const targetContent = r.targetCell.content || "(No target text)";
                            return `${r.cellId}: Source: ${r.sourceCell.content}, Target: ${targetContent}`;
                        })
                        .join("\n");
                    vscode.window.showInformationMessage(
                        `Found ${results.length} cells for query: ${query}\n${resultsString}`
                    );
                }
                return results;
            }
        );

        // Add command to get file stats
        const getFileStatsCommand = vscode.commands.registerCommand(
            "codex-editor-extension.getFileStats",
            async () => {
                try {
                    const stats = getWordCountStats(filesIndex);
                    const message = `File Stats:\n- Total Files: ${stats.totalFiles}\n- Total Source Words: ${stats.totalSourceWords}\n- Total Codex Words: ${stats.totalCodexWords}`;
                    vscode.window.showInformationMessage(message);
                    return stats;
                } catch (error) {
                    console.error("Error getting file stats:", error);
                    vscode.window.showErrorMessage(
                        "Failed to get file stats. Check the logs for details."
                    );
                    return null;
                }
            }
        );

        // Add command to get detailed file info
        const getFileInfoCommand = vscode.commands.registerCommand(
            "codex-editor-extension.getFileInfo",
            async () => {
                try {
                    const filePairs = getFilePairs(filesIndex);

                    // Create QuickPick items for each file pair
                    const items = filePairs.map((filePair) => ({
                        label: filePair.codexFile.fileName,
                        description: `Source: ${filePair.sourceFile.fileName}`,
                        detail: `Cells: ${filePair.codexFile.totalCells} | Words: ${filePair.codexFile.totalWords}`,
                        fileId: filePair.codexFile.id,
                    }));

                    // Show QuickPick to select a file
                    const selection = await vscode.window.showQuickPick(items, {
                        placeHolder: "Select a file to view details",
                        matchOnDescription: true,
                        matchOnDetail: true,
                    });

                    if (!selection) return null; // User cancelled

                    // Get the selected file info
                    const fileInfo = filesIndex.get(selection.fileId);
                    if (!fileInfo) return null;

                    // Create a virtual document to display the file info
                    const panel = vscode.window.createWebviewPanel(
                        "fileInfo",
                        `File Info: ${fileInfo.codexFile.fileName}`,
                        vscode.ViewColumn.One,
                        {}
                    );

                    // Generate HTML content
                    panel.webview.html = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <style>
                                body { font-family: Arial, sans-serif; margin: 20px; }
                                .file-info { margin-bottom: 20px; }
                                .cell { margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; }
                                .cell-header { font-weight: bold; margin-bottom: 5px; }
                                .cell-content { white-space: pre-wrap; }
                                .stats { color: #666; }
                            </style>
                        </head>
                        <body>
                            <h1>File Information</h1>
                            
                            <div class="file-info">
                                <h2>Codex File</h2>
                                <p>Name: ${fileInfo.codexFile.fileName}</p>
                                <p>ID: ${fileInfo.codexFile.id}</p>
                                <p>Total Cells: ${fileInfo.codexFile.totalCells}</p>
                                <p>Total Words: ${fileInfo.codexFile.totalWords}</p>
                            </div>
                            
                            <div class="file-info">
                                <h2>Source File</h2>
                                <p>Name: ${fileInfo.sourceFile.fileName}</p>
                                <p>ID: ${fileInfo.sourceFile.id}</p>
                                <p>Total Cells: ${fileInfo.sourceFile.totalCells}</p>
                                <p>Total Words: ${fileInfo.sourceFile.totalWords}</p>
                            </div>
                            
                            <h2>Cells</h2>
                            <div>
                                ${fileInfo.codexFile.cells
                            .map(
                                (cell, index) => `
                                    <div class="cell">
                                        <div class="cell-header">Cell ${index + 1} - ID: ${cell.id || "N/A"} - Type: ${cell.type || "N/A"}</div>
                                        <div class="stats">Word Count: ${cell.wordCount}</div>
                                        <div class="cell-content">${cell.value}</div>
                                    </div>
                                `
                            )
                            .join("")}
                            </div>
                        </body>
                        </html>
                    `;

                    return fileInfo;
                } catch (error) {
                    console.error("Error getting file info:", error);
                    vscode.window.showErrorMessage(
                        "Failed to get file info. Check the logs for details."
                    );
                    return null;
                }
            }
        );

        const verifyDataIntegrityCommand = vscode.commands.registerCommand(
            "codex-editor-extension.verifyDataIntegrity",
            async () => {
                try {
                    if (translationPairsIndex instanceof SQLiteIndexManager) {
                        const integrityResult = await translationPairsIndex.verifyDataIntegrity();
                        const stats = await translationPairsIndex.getContentStats();

                        let message = `Data Integrity Check:\n`;
                        message += `Total cells: ${integrityResult.totalCells}\n`;
                        message += `Cells with missing source content: ${stats.cellsWithMissingContent}\n`;
                        message += `Cells with missing source raw_content: ${stats.cellsWithMissingRawContent}\n`;
                        message += `Cells with different content: ${stats.cellsWithDifferentContent}\n`;
                        message += `Status: ${integrityResult.isValid ? '✅ VALID' : '❌ ISSUES FOUND'}\n`;

                        if (!integrityResult.isValid) {
                            message += `\nIssues found:\n${integrityResult.issues.slice(0, 10).join('\n')}`;
                            if (integrityResult.issues.length > 10) {
                                message += `\n... and ${integrityResult.issues.length - 10} more issues`;
                            }
                        }

                        const action = integrityResult.isValid ? "View Stats" : "View Issues";
                        const choice = await vscode.window.showInformationMessage(message, action, "OK");

                        if (choice === action) {
                            debug('Full integrity check results:', integrityResult);
                            debug('Full content stats:', stats);
                        }
                    } else {
                        vscode.window.showErrorMessage("Data integrity check only available for SQLite index");
                    }
                } catch (error) {
                    console.error("Error verifying data integrity:", error);
                    // Don't show technical errors to users
                    debug("Failed to verify data integrity");
                }
            }
        );

        const deleteDatabaseAndReindexCommand = vscode.commands.registerCommand(
            "codex-editor-extension.deleteDatabaseAndReindex",
            async () => {
                try {
                    if (translationPairsIndex instanceof SQLiteIndexManager) {
                        await translationPairsIndex.deleteDatabaseAndTriggerReindex();
                    } else {
                        vscode.window.showErrorMessage("Database deletion only available for SQLite index");
                    }
                } catch (error) {
                    console.error("Error during database deletion:", error);
                    // Don't show technical errors to users
                    debug("Failed to delete database. Check the logs for details.");
                }
            }
        );

        const forceCompleteRebuildCommand = vscode.commands.registerCommand(
            "codex-editor-extension.forceCompleteRebuild",
            async () => {
                try {
                    const choice = await vscode.window.showWarningMessage(
                        "This will refresh the AI's understanding of your codebase. This may take a few moments. Continue?",
                        { modal: true },
                        "Yes, Let AI Learn"
                    );

                    if (choice === "Yes, Let AI Learn") {
                        await showAILearningProgress(async (progress) => {
                            // Force a complete rebuild
                            await smartRebuildIndexes("manual complete rebuild command", true);

                            const finalCount = translationPairsIndex.documentCount;
                            debug(`[Index] Rebuild completed with ${finalCount} documents`);
                        });
                    }
                } catch (error) {
                    console.error("Error during complete rebuild:", error);
                    // Don't show technical errors to users
                    debug(`[Index] Failed to rebuild: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        );

        const checkIndexStatusCommand = vscode.commands.registerCommand(
            "codex-editor-extension.checkIndexStatus",
            async () => {
                try {
                    const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();
                    const currentDocCount = translationPairsIndex.documentCount;

                    let statusMessage = `Index Status:\n`;
                    statusMessage += `• Documents in index: ${currentDocCount}\n`;
                    statusMessage += `• Source files found: ${sourceFiles.length}\n`;
                    statusMessage += `• Target files found: ${targetFiles.length}\n`;

                    if (translationPairsIndex instanceof SQLiteIndexManager) {
                        const stats = await translationPairsIndex.getContentStats();
                        const pairStats = await translationPairsIndex.getTranslationPairStats();

                        statusMessage += `\nCell Statistics:\n`;
                        statusMessage += `• Total cells: ${stats.totalCells}\n`;
                        statusMessage += `• Cells with source content: ${stats.totalCells - stats.cellsWithMissingContent}\n`;
                        statusMessage += `• Cells with raw content: ${stats.cellsWithRawContent}\n`;

                        statusMessage += `\nTranslation Pairs:\n`;
                        statusMessage += `• Total pairs: ${pairStats.totalPairs}\n`;
                        statusMessage += `• Complete pairs: ${pairStats.completePairs}\n`;
                        statusMessage += `• Incomplete pairs: ${pairStats.incompletePairs}\n`;
                        statusMessage += `• Orphaned source cells: ${pairStats.orphanedSourceCells}\n`;
                        statusMessage += `• Orphaned target cells: ${pairStats.orphanedTargetCells}\n`;

                        // Run validation with fresh document count
                        const freshDocCount = translationPairsIndex.documentCount;
                        const validationResult = await validateIndexHealthConservatively();
                        statusMessage += `\nValidation: ${validationResult.isHealthy ? '✅ COMPLETE' : '❌ INCOMPLETE'}`;
                        if (!validationResult.isHealthy) {
                            statusMessage += `\nReason: ${validationResult.criticalIssue}`;
                        }
                    }

                    const actions = ["View Full Diagnostics"];
                    const freshValidation = await validateIndexHealthConservatively();
                    if (currentDocCount === 0 || !freshValidation.isHealthy) {
                        actions.unshift("Rebuild Index");
                    }

                    const choice = await vscode.window.showInformationMessage(statusMessage, ...actions, "OK");

                    if (choice === "Rebuild Index") {
                        vscode.commands.executeCommand("codex-editor-extension.forceCompleteRebuild");
                    } else if (choice === "View Full Diagnostics") {
                        debug("=== Full Index Diagnostics ===");
                        debug(`Documents in index: ${currentDocCount}`);
                        debug(`Source files: ${sourceFiles.length}`);
                        debug(`Target files: ${targetFiles.length}`);

                        if (translationPairsIndex instanceof SQLiteIndexManager) {
                            const stats = await translationPairsIndex.getContentStats();
                            const pairStats = await translationPairsIndex.getTranslationPairStats();
                            const integrityCheck = await translationPairsIndex.verifyDataIntegrity();

                            debug("\nContent Statistics:", stats);
                            debug("\nTranslation Pair Statistics:", pairStats);
                            debug("\nData Integrity Check:", integrityCheck);

                            // Sample some cells to see what's in the database
                            debug("\nSample cells from database:");
                            const sampleCells = await translationPairsIndex.searchCells("", undefined, 5);
                            sampleCells.forEach((cell: any, i: number) => {
                                debug(`Sample ${i + 1}: ${cell.cell_id} (${cell.cell_type}) - Content: ${cell.content?.substring(0, 50)}...`);
                            });
                        }
                    }
                } catch (error) {
                    console.error("Error checking index status:", error);
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    // Don't show technical errors to users
                    debug(`[Index] Failed to check index status. Error: ${errorMessage}`);
                }
            }
        );

        const forceSchemaResetCommand = vscode.commands.registerCommand(
            "codex-editor-extension.forceSchemaReset",
            async () => {
                try {
                    if (translationPairsIndex instanceof SQLiteIndexManager) {
                        const choice = await vscode.window.showWarningMessage(
                            "This will reset the AI configuration. You'll need to reload the extension. Continue?",
                            "Yes, Reset",
                            "Cancel"
                        );

                        if (choice === "Yes, Reset") {
                            // Reset schema version to force migration
                            await (translationPairsIndex as any).setSchemaVersion(2);
                            vscode.window.showInformationMessage("AI configuration reset. Please reload the extension to continue.");
                        }
                    } else {
                        vscode.window.showErrorMessage("Schema reset only available for SQLite index");
                    }
                } catch (error) {
                    console.error("Error resetting schema:", error);
                    // Don't show technical errors to users
                    debug("Failed to reset schema. Check the logs for details.");
                }
            }
        );

        const debugSchemaCommand = vscode.commands.registerCommand(
            "codex-editor-extension.debugSchema",
            async () => {
                try {
                    if (translationPairsIndex instanceof SQLiteIndexManager) {
                        const schemaInfo = await (translationPairsIndex as any).getDetailedSchemaInfo();

                        let message = `Schema Version: ${schemaInfo.currentVersion}\n`;
                        message += `Cells Table Exists: ${schemaInfo.cellsTableExists}\n`;
                        message += `Has New Structure: ${schemaInfo.hasNewStructure}\n`;
                        message += `Schema Info Rows: ${schemaInfo.schemaInfoRows.length}\n`;

                        if (schemaInfo.schemaInfoRows.length > 1) {
                            message += `⚠️ Multiple schema_info rows detected!\n`;
                            schemaInfo.schemaInfoRows.forEach((row: any, i: number) => {
                                message += `  Row ${i + 1}: ${JSON.stringify(row)}\n`;
                            });
                        }

                        message += `\nCells Columns (${schemaInfo.cellsColumns.length}): ${schemaInfo.cellsColumns.slice(0, 10).join(', ')}`;
                        if (schemaInfo.cellsColumns.length > 10) {
                            message += '...';
                        }

                        const actions = ["OK"];
                        if (schemaInfo.currentVersion !== 8 || !schemaInfo.hasNewStructure) {
                            actions.unshift("Force Migration to v8");
                        }
                        if (schemaInfo.schemaInfoRows.length > 1) {
                            actions.unshift("Clean Schema Info");
                        }

                        const choice = await vscode.window.showInformationMessage(message, ...actions);

                        if (choice === "Force Migration to v8") {
                            const confirm = await vscode.window.showWarningMessage(
                                "This will update the AI configuration to the latest version. Continue?",
                                "Yes, Update",
                                "Cancel"
                            );

                            if (confirm === "Yes, Update") {
                                await (translationPairsIndex as any).forceRecreateDatabase();
                                vscode.window.showInformationMessage("AI configuration updated. Please reload the extension.");
                            }
                        } else if (choice === "Clean Schema Info") {
                            await (translationPairsIndex as any).setSchemaVersion(schemaInfo.currentVersion);
                            vscode.window.showInformationMessage("AI configuration optimized.");
                        }

                    } else {
                        vscode.window.showErrorMessage("Schema debugging only available for SQLite index");
                    }
                } catch (error) {
                    console.error("Error debugging schema:", error);
                    // Don't show technical errors to users
                    debug("Failed to debug schema. Check the logs for details.");
                }
            }
        );

        const refreshIndexCommand = vscode.commands.registerCommand(
            "codex-editor-extension.refreshIndex",
            async () => {
                try {
                    debug("[Index] Manual refresh requested");
                    await showAILearningProgress(async (progress) => {
                        await smartRebuildIndexes("manual refresh", true);
                        debug(`[Index] Refresh completed with ${translationPairsIndex.documentCount} documents`);
                    });
                } catch (error) {
                    console.error("Error refreshing index:", error);
                    // Don't show technical errors to users
                    debug(`[Index] Failed to refresh: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        );

        const syncStatusCommand = vscode.commands.registerCommand(
            "codex-editor-extension.checkSyncStatus",
            async () => {
                try {
                    debug("[Index] Checking sync status...");
                    const fileSyncManager = new FileSyncManager(translationPairsIndex);

                    const [syncStatus, stats] = await Promise.all([
                        fileSyncManager.checkSyncStatus(),
                        fileSyncManager.getSyncStatistics()
                    ]);

                    const { summary } = syncStatus;
                    const statusMessage = syncStatus.needsSync
                        ? `AI has ${summary.newFiles + summary.changedFiles} files to learn from`
                        : `AI is up to date with all ${summary.totalFiles} files`;

                    vscode.window.showInformationMessage(statusMessage);

                    // Log detailed information
                    debug("[Index] Sync Status Details:");
                    for (const [file, detail] of syncStatus.details) {
                        debug(`  - ${file}: ${detail.reason}`);
                    }
                } catch (error) {
                    console.error("Error checking sync status:", error);
                    // Don't show technical errors to users
                    debug(`[Index] Failed to check sync status: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        );

        // Add command to index specific files incrementally
        const incrementalIndexCommand = vscode.commands.registerCommand(
            "codex-editor-extension.indexSpecificFiles",
            async (filePaths?: string[]) => {
                if (!filePaths || filePaths.length === 0) {
                    debug("[Index] No files specified for incremental indexing");
                    return;
                }

                debug(`[Index] Incremental indexing requested for ${filePaths.length} files`);

                try {
                    // Show progress notification for incremental update
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `AI learning from ${filePaths.length / 2} new file pair${filePaths.length > 1 ? 's' : ''}...`,
                            cancellable: false
                        },
                        async (progress) => {
                            statusBarHandler.setIndexingActive();

                            const fileSyncManager = new FileSyncManager(translationPairsIndex);

                            // Sync only the specified files
                            const syncResult = await fileSyncManager.syncSpecificFiles(filePaths, {
                                progressCallback: (message, percent) => {
                                    progress.report({ message, increment: percent });
                                }
                            });

                            // Update complementary indexes for the new files only
                            const { targetFiles } = await readSourceAndTargetFiles();
                            const relevantTargetFiles = targetFiles.filter(f =>
                                filePaths.some(fp => f.uri.fsPath.includes(fp))
                            );

                            if (relevantTargetFiles.length > 0) {
                                wordsIndex = await initializeWordsIndex(wordsIndex, relevantTargetFiles);
                                await updateCompleteDrafts(relevantTargetFiles);
                            }

                            debug(`[Index] Incremental sync completed: ${syncResult.syncedFiles} files processed`);

                            statusBarHandler.updateIndexCounts(
                                translationPairsIndex.documentCount,
                                sourceTextIndex.documentCount
                            );

                            progress.report({ message: "✨ AI learning complete!" });
                            await new Promise(res => setTimeout(res, 1000));
                        }
                    );
                } catch (error) {
                    console.error("[Index] Error during incremental indexing:", error);
                    vscode.window.showErrorMessage(`Failed to index files: ${error instanceof Error ? error.message : 'Unknown error'}`);
                } finally {
                    statusBarHandler.setIndexingComplete();
                }
            }
        );

        // Make sure to close the database when extension deactivates
        context.subscriptions.push({
            dispose: async () => {
                await indexManager.close();
            },
        });

        // Update the subscriptions
        context.subscriptions.push(
            ...[
                searchTargetCellsByQueryCommand,
                getTranslationPairsFromSourceCellQueryCommand,
                getSourceCellByCellIdFromAllSourceCellsCommand,
                getTargetCellByCellIdCommand,
                getTranslationPairFromProjectCommand,
                forceReindexCommand,
                showIndexOptionsCommand,
                getWordFrequenciesCommand,
                refreshWordIndexCommand,
                getWordsAboveThresholdCommand,
                searchParallelCellsCommand,
                searchSimilarCellIdsCommand,
                findNextUntranslatedSourceCellCommand,
                searchAllCellsCommand,
                getFileStatsCommand,
                getFileInfoCommand,
                verifyDataIntegrityCommand,
                deleteDatabaseAndReindexCommand,
                forceCompleteRebuildCommand,
                checkIndexStatusCommand,
                forceSchemaResetCommand,
                debugSchemaCommand,
                refreshIndexCommand,
                syncStatusCommand,
                incrementalIndexCommand
            ]
        );

        // Mark as initialized to prevent duplicate registrations
        isIndexContextInitialized = true;

        // Initialize Background Validation Service for automatic integrity checking
        // This will catch database corruption that file-level sync might miss
        try {
            const fileSyncManager = new FileSyncManager(translationPairsIndex);
            registerBackgroundValidation(context, translationPairsIndex, fileSyncManager);
            debug("🔍 Background Validation Service registered successfully");
        } catch (error) {
            console.error("🔍 Failed to register Background Validation Service:", error);
        }
    }

    const functionsToExpose = {
        handleTextSelection,
        searchAllCells,
        searchParallelCells,
        searchTranslationPairs,
    };

    return functionsToExpose;
}
