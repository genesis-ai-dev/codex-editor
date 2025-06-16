import * as vscode from "vscode";
import { stageAndCommitAllAndSync, SyncResult } from "./utils/merge";
import { getAuthApi } from "../extension";
import { createIndexWithContext } from "../activationHelpers/contextAware/contentIndexes/indexes";
import { getNotebookMetadataManager } from "../utils/notebookMetadataManager";
import * as path from "path";
import { updateSplashScreenSync } from "../providers/SplashScreen/register";
import git from "isomorphic-git";
import fs from "fs";
import http from "isomorphic-git/http/web";
import { ProgressReportingService, registerProgressReportingCommands } from "../progressReporting/progressReportingService";

// Define TranslationProgress interface locally since it's not exported from types
interface BookProgress {
    bookId: string;
    totalVerses: number;
    translatedVerses: number;
    validatedVerses?: number;
}

interface TranslationProgress {
    totalVerses: number;
    translatedVerses: number;
    validatedVerses?: number;
    bookProgress?: BookProgress[];
}

// Progress report interface - moved to progressReportingService.ts
// Keeping this for backward compatibility
export interface ProjectProgressReport {
    projectId: string; // Unique project identifier
    projectName: string; // Human-readable project name
    timestamp: string; // ISO timestamp of report generation
    reportId: string; // Unique report identifier

    // Translation metrics
    translationProgress: {
        bookCompletionMap: Record<string, number>; // Book ID -> percentage complete
        totalVerseCount: number; // Total verses in project
        translatedVerseCount: number; // Verses with translations
        validatedVerseCount: number; // Verses passing validation
        wordsTranslated: number; // Total words translated
    };

    // Validation metrics
    validationStatus: {
        stage: "none" | "initial" | "community" | "expert" | "finished";
        versesPerStage: Record<string, number>; // Stage -> verse count
        lastValidationTimestamp: string; // ISO timestamp
    };

    // Activity metrics
    activityMetrics: {
        lastEditTimestamp: string; // ISO timestamp
        editCountLast24Hours: number; // Edit count
        editCountLastWeek: number; // Edit count
        averageDailyEdits: number; // Avg edits per active day
    };

    // Quality indicators
    qualityMetrics: {
        spellcheckIssueCount: number; // Spelling issues
        flaggedSegmentsCount: number; // Segments needing review
        consistencyScore: number; // 0-100 score
    };
}

// Singleton to manage sync operations across the application
export class SyncManager {
    private static instance: SyncManager;
    private pendingSyncTimeout: NodeJS.Timeout | number | null = null;
    private isSyncInProgress: boolean = false;
    private lastConnectionErrorTime: number = 0;
    private CONNECTION_ERROR_COOLDOWN = 60000; // 1 minute cooldown for connection messages
    private currentSyncStage: string = "";

    private constructor() {
        // Initialize with configuration values
        this.updateFromConfiguration();
    }

    public static getInstance(): SyncManager {
        if (!SyncManager.instance) {
            SyncManager.instance = new SyncManager();
        }
        return SyncManager.instance;
    }

    // Schedule a sync operation to occur after the configured delay
    public scheduleSyncOperation(commitMessage: string = "Auto-sync changes"): void {
        // Get current configuration
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const autoSyncEnabled = config.get<boolean>("autoSyncEnabled", true);
        const syncDelayMinutes = config.get<number>("syncDelayMinutes", 5);

        // Clear any pending sync operation
        this.clearPendingSync();

        // If auto-sync is disabled, don't schedule
        if (!autoSyncEnabled) {
            console.log("Auto-sync is disabled, not scheduling sync operation");
            return;
        }

        // Convert minutes to milliseconds
        const delayMs = syncDelayMinutes * 60 * 1000;
        console.log(`Scheduling sync operation in ${syncDelayMinutes} minutes`);

        // Schedule the new sync
        this.pendingSyncTimeout = setTimeout(() => {
            this.executeSync(commitMessage);
        }, delayMs);
    }

    // Execute the sync operation immediately
    public async executeSync(
        commitMessage: string = "Manual sync",
        showInfoOnConnectionIssues: boolean = true
    ): Promise<void> {
        if (this.isSyncInProgress) {
            console.log("Sync already in progress, skipping");
            if (showInfoOnConnectionIssues) {
                vscode.window.showInformationMessage(
                    "Sync already in progress. Please wait for the current synchronization to complete."
                );
            }
            return;
        }

        // Check authentication status first
        const authApi = getAuthApi();
        if (!authApi) {
            console.log("Auth API not available, cannot sync");
            if (showInfoOnConnectionIssues) {
                this.showConnectionIssueMessage(
                    "Unable to sync: Authentication service not available"
                );
            }
            return;
        }

        try {
            const authStatus = authApi.getAuthStatus();
            if (!authStatus.isAuthenticated) {
                console.log("User is not authenticated, cannot sync");
                if (showInfoOnConnectionIssues) {
                    this.showConnectionIssueMessage(
                        "Unable to sync: Please log in to sync your changes"
                    );
                }
                return;
            }
        } catch (error) {
            console.error("Error checking authentication status:", error);
            if (showInfoOnConnectionIssues) {
                this.showConnectionIssueMessage(
                    "Unable to sync: Could not verify authentication status"
                );
            }
            return;
        }

        // Set sync in progress flag and show immediate feedback
        this.clearPendingSync();
        this.isSyncInProgress = true;
        console.log("   nc operation in background with message:", commitMessage);

        // Show progress indicator to user instead of simple message
        if (showInfoOnConnectionIssues) {
            this.showSyncProgress(commitMessage);
        }

        // Update splash screen with initial sync status
        updateSplashScreenSync(30, "Checking files are up to date...");

        // Run the actual sync operation in the background (truly async)
        this.executeSyncInBackground(commitMessage, showInfoOnConnectionIssues);

        // Return immediately - don't wait for sync to complete
        console.log("🔄 Sync operation started in background, UI is free to continue");
    }

    // Execute the actual sync operation in the background
    private async executeSyncInBackground(
        commitMessage: string,
        showInfoOnConnectionIssues: boolean
    ): Promise<void> {
        try {
            // Log sync timing for performance analysis
            const syncStartTime = performance.now();
            console.log("🔄 Starting background sync operation...");

            // Update sync stage and splash screen
            this.currentSyncStage = "Preparing synchronization...";
            updateSplashScreenSync(60, this.currentSyncStage);

            // Sync all changes in background
            this.currentSyncStage = "Synchronizing changes...";
            const syncResult = await stageAndCommitAllAndSync(commitMessage, false); // Don't show user messages during background sync

            const syncEndTime = performance.now();
            const syncDuration = syncEndTime - syncStartTime;
            console.log(`✅ Background sync completed in ${syncDuration.toFixed(2)}ms`);

            // Update sync stage and splash screen
            this.currentSyncStage = "Synchronization complete!";
            updateSplashScreenSync(100, "Synchronization complete");

            // Schedule progress report after successful sync (when there are actual changes)
            const progressReportingService = ProgressReportingService.getInstance();
            progressReportingService.scheduleProgressReport();
            console.log("📊 Progress report scheduled after successful sync");

            // Rebuild indexes in the background after successful sync (truly async)
            // Pass the sync result to optimize database synchronization
            this.rebuildIndexesInBackground(syncResult);

        } catch (error) {
            console.error("Error during background sync operation:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Update sync stage and splash screen
            this.currentSyncStage = "Sync failed";
            updateSplashScreenSync(100, `Sync failed: ${errorMessage}`);

            // Show error messages to user
            if (
                errorMessage.includes("No active session") ||
                errorMessage.includes("network") ||
                errorMessage.includes("connect") ||
                errorMessage.includes("offline")
            ) {
                if (showInfoOnConnectionIssues) {
                    this.showConnectionIssueMessage(
                        "Sync failed: Please check your internet connection or login status"
                    );
                }
            } else {
                // For other errors, show an error message
                vscode.window.showErrorMessage(`Sync failed: ${errorMessage}`);
            }
        } finally {
            this.currentSyncStage = "";
            this.isSyncInProgress = false;
        }
    }

    // Check if indexes need rebuilding and rebuild only if necessary
    private async rebuildIndexesInBackground(syncResult?: SyncResult): Promise<void> {
        try {
            const indexStartTime = performance.now();
            console.log("🔧 Starting optimized database synchronization after git sync...");

            // Log git sync information if available
            if (syncResult && syncResult.totalChanges > 0) {
                console.log(`📥 Git sync brought ${syncResult.totalChanges} file changes:`);
                console.log(`  📄 ${syncResult.changedFiles.length} modified files`);
                console.log(`  ➕ ${syncResult.newFiles.length} new files`);
                console.log(`  ➖ ${syncResult.deletedFiles.length} deleted files`);

                // Log specific files for debugging (limit to first 10 for readability)
                if (syncResult.changedFiles.length > 0) {
                    const filesToShow = syncResult.changedFiles.slice(0, 10);
                    console.log(`  🔧 Modified: ${filesToShow.join(", ")}${syncResult.changedFiles.length > 10 ? ` and ${syncResult.changedFiles.length - 10} more...` : ""}`);
                }
                if (syncResult.newFiles.length > 0) {
                    const filesToShow = syncResult.newFiles.slice(0, 10);
                    console.log(`  ✨ New: ${filesToShow.join(", ")}${syncResult.newFiles.length > 10 ? ` and ${syncResult.newFiles.length - 10} more...` : ""}`);
                }
            } else {
                console.log("📭 No git changes detected, checking database sync status...");
            }

            // Use the new FileSyncManager for efficient file-level synchronization
            const { getSQLiteIndexManager } = await import("../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager");
            const { FileSyncManager } = await import("../activationHelpers/contextAware/contentIndexes/fileSyncManager");

            const sqliteIndex = getSQLiteIndexManager();
            if (!sqliteIndex) {
                console.error("❌ SQLite index manager not available");
                return;
            }

            const fileSyncManager = new FileSyncManager(sqliteIndex);

            // If we have specific files from git sync, we could potentially optimize further
            // by checking only those files, but for now we'll check all files since
            // git changes might affect relationships between files
            console.log("🔍 Checking which files need database synchronization...");
            const syncStatus = await fileSyncManager.checkSyncStatus();

            if (!syncStatus.needsSync) {
                console.log("✅ Database is already synchronized with file system");
                const indexEndTime = performance.now();
                const indexDuration = indexEndTime - indexStartTime;
                console.log(`✅ Sync check completed in ${indexDuration.toFixed(2)}ms`);
                return;
            }

            console.log(`🔧 Found ${syncStatus.summary.changedFiles + syncStatus.summary.newFiles} files needing database synchronization`);
            console.log(`📊 Sync summary: ${syncStatus.summary.newFiles} new, ${syncStatus.summary.changedFiles} changed, ${syncStatus.summary.unchangedFiles} unchanged`);

            // Cross-reference with git changes for optimization insights
            if (syncResult && syncResult.totalChanges > 0) {
                const gitChangedFiles = new Set([...syncResult.changedFiles, ...syncResult.newFiles]);
                const dbChangedFiles = syncStatus.summary.changedFiles + syncStatus.summary.newFiles;
                console.log(`🔍 Analysis: Git changed ${gitChangedFiles.size} files, database needs to sync ${dbChangedFiles} files`);
            }

            // Perform optimized synchronization of only changed files
            const fileSyncResult = await fileSyncManager.syncFiles({
                progressCallback: (message, progress) => {
                    console.log(`[DatabaseSync] ${message} (${progress}%)`);
                }
            });

            const indexEndTime = performance.now();
            const indexDuration = indexEndTime - indexStartTime;

            console.log(`✅ Optimized database sync completed in ${indexDuration.toFixed(2)}ms`);
            console.log(`📊 Sync results: ${fileSyncResult.syncedFiles} files synced, ${fileSyncResult.unchangedFiles} unchanged, ${fileSyncResult.errors.length} errors`);

            if (fileSyncResult.errors.length > 0) {
                console.warn("⚠️ Some files had sync errors:");
                fileSyncResult.errors.forEach(error => {
                    console.warn(`  - ${error.file}: ${error.error}`);
                });
            }

            // Log detailed file changes for debugging
            if (fileSyncResult.details.size > 0) {
                console.log("📋 File sync details:");
                for (const [file, detail] of fileSyncResult.details) {
                    if (detail.reason !== "no changes detected") {
                        console.log(`  - ${file}: ${detail.reason}`);
                    }
                }
            }

        } catch (error) {
            console.error("❌ Optimized database sync failed:", error);

            // Fallback to basic index rebuild if file sync fails
            console.log("🔄 Falling back to basic index rebuild...");
            try {
                await this.fallbackIndexRebuild();
            } catch (fallbackError) {
                console.error("❌ Fallback index rebuild also failed:", fallbackError);
            }
        }
    }

    // Fallback method for basic index rebuild (original logic as backup)
    private async fallbackIndexRebuild(): Promise<void> {
        const { getSQLiteIndexManager } = await import("../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager");
        const indexManager = getSQLiteIndexManager();

        if (indexManager) {
            const currentDocCount = indexManager.documentCount;
            console.log(`[FallbackSync] Current index has ${currentDocCount} documents`);

            if (currentDocCount > 0) {
                console.log("✅ Index is already up to date, skipping fallback rebuild");
                return;
            }
        }

        console.log("🔧 Running fallback index rebuild...");

        // Create a minimal mock context for the fallback
        const mockContext = {
            subscriptions: [],
            workspaceState: { get: () => undefined, update: async () => false, keys: () => [] },
            globalState: { get: () => undefined, update: async () => false, setKeysForSync: () => { }, keys: () => [] },
            secrets: { get: async () => undefined, store: async () => { }, delete: async () => { } },
            extensionUri: vscode.Uri.parse(""),
            extensionPath: "",
            globalStoragePath: "",
            logPath: "",
            storagePath: undefined,
            extensionMode: vscode.ExtensionMode.Production,
            environmentVariableCollection: {} as vscode.EnvironmentVariableCollection,
            asAbsolutePath: (relativePath: string) => relativePath,
            storageUri: null,
            globalStorageUri: vscode.Uri.parse(""),
            logUri: vscode.Uri.parse(""),
            extension: {
                id: "codex-editor",
                extensionUri: vscode.Uri.parse(""),
                extensionPath: "",
                isActive: true,
                packageJSON: {},
                exports: undefined,
                activate: async () => mockContext,
                extensionKind: vscode.ExtensionKind.Workspace,
            },
            languageModelAccessInformation: undefined,
        };

        await createIndexWithContext(mockContext as unknown as vscode.ExtensionContext);
        console.log("✅ Fallback index rebuild completed");
    }

    // Show connection issue message with cooldown
    private showConnectionIssueMessage(message: string): void {
        // Only show one message per minute to avoid spamming
        const now = Date.now();
        if (now - this.lastConnectionErrorTime > this.CONNECTION_ERROR_COOLDOWN) {
            this.lastConnectionErrorTime = now;
            vscode.window.showInformationMessage(message);
        } else {
            console.log("Suppressing connection error notification due to cooldown");
        }
    }

    // Cancel any pending sync operations
    public clearPendingSync(): void {
        if (this.pendingSyncTimeout) {
            clearTimeout(this.pendingSyncTimeout);
            this.pendingSyncTimeout = null;
            console.log("Cleared pending sync operation");
        }
    }

    // Update the manager settings from configuration
    public updateFromConfiguration(): void {
        // This method will be called when configuration changes
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const autoSyncEnabled = config.get<boolean>("autoSyncEnabled", true);
        const syncDelayMinutes = config.get<number>("syncDelayMinutes", 5);

        console.log(
            `SyncManager configuration updated: autoSyncEnabled=${autoSyncEnabled}, syncDelayMinutes=${syncDelayMinutes}`
        );
    }

    // Force a progress report generation and submission
    public async forceProgressReport(): Promise<boolean> {
        const progressReportingService = ProgressReportingService.getInstance();
        return await progressReportingService.forceProgressReport();
    }

    // Show progress indicator for sync operation
    private showSyncProgress(commitMessage: string): void {
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Synchronizing Project",
                cancellable: false,
            },
            async (progress, token) => {
                let progressValue = 0;

                // Initial progress
                progress.report({
                    increment: 0,
                    message: "Checking files are up to date..."
                });

                // Wait for sync to complete by polling the sync status
                while (this.isSyncInProgress) {
                    await new Promise(resolve => setTimeout(resolve, 500)); // Check every 500ms

                    // Update progress message based on current sync stage
                    if (this.isSyncInProgress && this.currentSyncStage) {
                        const increment = Math.min(20, 90 - progressValue); // Gradual progress up to 90%
                        progressValue += increment;

                        progress.report({
                            increment,
                            message: this.currentSyncStage
                        });
                    }
                }

                // Final completion
                progress.report({
                    increment: 100 - progressValue,
                    message: this.currentSyncStage || "Synchronization complete!"
                });

                // Brief delay to show completion before closing
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        );
    }
}

// Register the command to trigger sync
export function registerSyncCommands(context: vscode.ExtensionContext): void {
    // Register progress reporting commands with background service
    registerProgressReportingCommands(context);

    // Command to trigger immediate sync
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.triggerSync",
            async (message?: string) => {
                const syncManager = SyncManager.getInstance();
                await syncManager.executeSync(message || "Manual sync triggered");
            }
        )
    );

    // Command to schedule sync (replacing the manualCommit command)
    context.subscriptions.push(
        vscode.commands.registerCommand("extension.scheduleSync", (message: string) => {
            console.log("manualCommit called, scheduling sync operation");
            const syncManager = SyncManager.getInstance();
            syncManager.scheduleSyncOperation(message);
        })
    );

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration("codex-project-manager.autoSyncEnabled") ||
                event.affectsConfiguration("codex-project-manager.syncDelayMinutes")
            ) {
                SyncManager.getInstance().updateFromConfiguration();
            }
        })
    );
}
