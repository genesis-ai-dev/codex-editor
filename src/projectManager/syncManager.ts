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
import { getFrontierVersionStatus, checkVSCodeVersion } from "./utils/versionChecks";
import { BookCompletionData } from "../progressReporting/progressReportingService";
import { ProgressReportingService, registerProgressReportingCommands } from "../progressReporting/progressReportingService";
import { CommentsMigrator } from "../utils/commentsMigrationUtils";

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

const DEBUG_SYNC_MANAGER = false;

function debug(message: string, ...args: any[]): void {
    if (DEBUG_SYNC_MANAGER) {
        console.log(`[SyncManager] ${message}`, ...args);
    }
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
        bookCompletionMap: Record<string, BookCompletionData>; // Book ID -> completion data
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

/**
 * Check if a specific file has local modifications that would be committed
 */
async function hasLocalModifications(workspaceFolder: string, filePath: string): Promise<boolean> {
    try {
        const status = await git.status({
            fs,
            dir: workspaceFolder,
            filepath: filePath,
        });

        // status can be:
        // - "*modified" (unstaged changes)
        // - "*added" (new file, unstaged)
        // - "*deleted" (deleted, unstaged)
        // - "modified" (staged changes)
        // - "added" (new file, staged)
        // - "deleted" (deleted, staged)
        // - "unmodified" (no changes)

        const hasChanges = status !== "unmodified";
        return hasChanges;
    } catch (error) {
        console.warn(`[SyncManager] Could not check git status for ${filePath}:`, error);
        return false; // If we can't check, assume no changes to be safe
    }
}

// Singleton to manage sync operations across the application
export class SyncManager {
    private static instance: SyncManager;
    private pendingSyncTimeout: NodeJS.Timeout | number | null = null;
    private isSyncInProgress: boolean = false;
    private lastConnectionErrorTime: number = 0;
    private CONNECTION_ERROR_COOLDOWN = 60000; // 1 minute cooldown for connection messages
    private currentSyncStage: string = "";
    private syncStatusListeners: Array<(isSyncInProgress: boolean, syncStage: string) => void> = [];
    private frontierSyncSubscription: vscode.Disposable | undefined;
    private frontierSyncProgressResolver: ((value: void) => void) | undefined;
    private codexInitiatedSyncCount: number = 0;
    // Track changes made during active sync
    private pendingChanges: string[] = [];
    // Track active progress notification
    private activeProgressNotification: Promise<void> | undefined;

    private constructor() {
        // Initialize with configuration values
        this.updateFromConfiguration();
        // Subscribe to Frontier sync events
        this.subscribeFrontierSyncEvents();
    }

    public static getInstance(): SyncManager {
        if (!SyncManager.instance) {
            SyncManager.instance = new SyncManager();
        }
        return SyncManager.instance;
    }

    // (removed) extension context was only used for version checking

    // Register a listener for sync status updates
    public addSyncStatusListener(listener: (isSyncInProgress: boolean, syncStage: string) => void): vscode.Disposable {
        this.syncStatusListeners.push(listener);

        // Return a Disposable that removes the listener when disposed
        return new vscode.Disposable(() => {
            this.removeSyncStatusListener(listener);
        });
    }

    // Remove a sync status listener
    public removeSyncStatusListener(listener: (isSyncInProgress: boolean, syncStage: string) => void): void {
        const index = this.syncStatusListeners.indexOf(listener);
        if (index !== -1) {
            this.syncStatusListeners.splice(index, 1);
        }
    }

    // Notify all listeners of sync status changes
    private notifySyncStatusListeners(): void {
        this.syncStatusListeners.forEach(listener => {
            try {
                listener(this.isSyncInProgress, this.currentSyncStage);
            } catch (error) {
                console.error("Error notifying sync status listener:", error);
            }
        });
    }

    // Subscribe to Frontier sync events to keep UI in sync
    private subscribeFrontierSyncEvents(): void {
        try {
            const authApi = getAuthApi();
            if (!authApi) {
                debug("[SyncManager] Frontier API not available");
                return;
            }

            // Check if onSyncStatusChange is available (for backward compatibility)
            if (!('onSyncStatusChange' in authApi)) {
                debug("[SyncManager] Frontier API doesn't support sync events (older version)");
                return;
            }

            this.frontierSyncSubscription = (authApi as any).onSyncStatusChange((status: {
                status: 'started' | 'completed' | 'error' | 'skipped' | 'progress',
                message?: string;
                progress?: {
                    phase: string;
                    loaded?: number;
                    total?: number;
                    description?: string;
                };
            }) => {
                debug(`[SyncManager] Received Frontier sync event: ${status.status} - ${status.message || ''}`);

                switch (status.status) {
                    case 'started':
                        console.log('[Sync] 🔄 Sync operation started');
                        // Only show Frontier progress if this sync wasn't initiated by Codex
                        if (this.codexInitiatedSyncCount === 0) {
                            this.isSyncInProgress = true;
                            this.currentSyncStage = status.message || 'Synchronizing...';
                            this.notifySyncStatusListeners();
                            // Start showing progress notification for externally-triggered syncs
                            this.showFrontierSyncProgress();
                        }
                        break;

                    case 'progress':
                        // Update sync stage with detailed progress information
                        if (status.progress) {
                            const { phase, loaded, total, description } = status.progress;
                            if (description) {
                                this.currentSyncStage = description;
                            } else if (loaded !== undefined && total !== undefined) {
                                this.currentSyncStage = `${phase}: ${loaded}/${total}`;
                            } else {
                                this.currentSyncStage = phase;
                            }
                            this.notifySyncStatusListeners();

                            // Log with appropriate emoji based on phase
                            const phaseEmoji = phase === 'committing' ? '💾' :
                                phase === 'fetching' ? '⬇️' :
                                    phase === 'pushing' ? '⬆️' :
                                        phase === 'merging' ? '🔀' : '⚙️';
                            console.log(`[Sync] ${phaseEmoji} ${this.currentSyncStage}`);
                            debug(`[SyncManager] Progress update: ${this.currentSyncStage}`);
                        }
                        break;
                    case 'completed':
                        console.log('[Sync] ✅ Sync completed successfully');
                        this.isSyncInProgress = false;
                        this.currentSyncStage = status.message || 'Sync complete';
                        this.notifySyncStatusListeners();
                        // Resolve the progress notification to complete it (if it exists)
                        if (this.frontierSyncProgressResolver) {
                            this.frontierSyncProgressResolver();
                            this.frontierSyncProgressResolver = undefined;
                        }
                        // Decrement counter if we have Codex-initiated syncs
                        if (this.codexInitiatedSyncCount > 0) {
                            this.codexInitiatedSyncCount--;
                        }
                        break;
                    case 'error':
                        console.error(`[Sync] ❌ Sync failed: ${status.message || 'Unknown error'}`);
                        this.isSyncInProgress = false;
                        this.currentSyncStage = status.message || 'Sync failed';
                        this.notifySyncStatusListeners();
                        // Resolve the progress notification to complete it (if it exists)
                        if (this.frontierSyncProgressResolver) {
                            this.frontierSyncProgressResolver();
                            this.frontierSyncProgressResolver = undefined;
                        }
                        // Decrement counter if we have Codex-initiated syncs
                        if (this.codexInitiatedSyncCount > 0) {
                            this.codexInitiatedSyncCount--;
                        }
                        break;
                    case 'skipped':
                        console.warn(`[Sync] ⏭️  Sync skipped: ${status.message || 'Another sync in progress'}`);
                        this.isSyncInProgress = false;
                        this.currentSyncStage = status.message || 'Sync skipped';
                        this.notifySyncStatusListeners();
                        // Resolve the progress notification to complete it (if it exists)
                        if (this.frontierSyncProgressResolver) {
                            this.frontierSyncProgressResolver();
                            this.frontierSyncProgressResolver = undefined;
                        }
                        // Decrement counter if we have Codex-initiated syncs
                        if (this.codexInitiatedSyncCount > 0) {
                            this.codexInitiatedSyncCount--;
                        }
                        break;
                }
            });

            debug("[SyncManager] Successfully subscribed to Frontier sync events");
        } catch (error) {
            console.error("[SyncManager] Failed to subscribe to Frontier sync events:", error);
        }
    }

    // Show progress notification for Frontier-triggered syncs
    private showFrontierSyncProgress(): void {
        // Don't show multiple progress notifications
        if (this.frontierSyncProgressResolver) {
            return;
        }

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Synchronizing Project",
                cancellable: false,
            },
            async (progress) => {
                let progressValue = 0;

                // Initial progress
                progress.report({
                    increment: 0,
                    message: "Checking files are up to date..."
                });

                // Create a promise that we can resolve from outside
                await new Promise<void>((resolve) => {
                    this.frontierSyncProgressResolver = resolve;

                    // Poll for status updates
                    const updateInterval = setInterval(() => {
                        if (!this.isSyncInProgress) {
                            clearInterval(updateInterval);
                            return;
                        }

                        if (this.currentSyncStage) {
                            const increment = Math.min(20, 90 - progressValue);
                            progressValue += increment;

                            progress.report({
                                increment,
                                message: this.currentSyncStage
                            });
                        }
                    }, 500);

                    // Clean up interval when promise resolves
                    this.frontierSyncProgressResolver = () => {
                        clearInterval(updateInterval);
                        resolve();
                    };
                });

                // Final completion message
                progress.report({
                    increment: 100 - progressValue,
                    message: this.currentSyncStage || "Synchronization complete!"
                });

                // Brief delay to show completion before closing
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        );
    }

    // Schedule a sync operation to occur after the configured delay
    public scheduleSyncOperation(commitMessage: string = "Auto-sync changes"): void {
        debug(`scheduleSyncOperation called with message: "${commitMessage}"`);

        // If sync is in progress, just track the change, don't touch timer
        if (this.isSyncInProgress) {
            debug("Sync in progress, tracking pending change (timer will be set after completion)");
            if (!this.pendingChanges.includes(commitMessage)) {
                this.pendingChanges.push(commitMessage);
            }
            return; // DON'T touch the timer
        }

        // Check if there's a workspace folder open first
        const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
        if (!hasWorkspace) {
            debug("No workspace open, not scheduling sync operation");
            return;
        }

        // Get current configuration
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const autoSyncEnabled = config.get<boolean>("autoSyncEnabled", true);
        let syncDelayMinutes = config.get<number>("syncDelayMinutes", 5);

        // Ensure minimum sync delay is 5 minutes
        if (syncDelayMinutes < 5) {
            syncDelayMinutes = 5;
            debug("Sync delay was less than 5 minutes, adjusting to 5 minutes");
        }

        // Clear any pending sync operation
        this.clearPendingSync();

        // If auto-sync is disabled, don't schedule
        if (!autoSyncEnabled) {
            debug("Auto-sync is disabled, not scheduling sync operation");
            return;
        }

        // Convert minutes to milliseconds
        const delayMs = syncDelayMinutes * 60 * 1000;
        debug(`Scheduling sync operation in ${syncDelayMinutes} minutes`);

        // Schedule the new sync
        this.pendingSyncTimeout = setTimeout(() => {
            this.executeSync(commitMessage, true, undefined, false); // Auto-sync
        }, delayMs);
    }

    // Execute the sync operation immediately
    public async executeSync(
        commitMessage: string = "Manual sync",
        showInfoOnConnectionIssues: boolean = false,
        context?: vscode.ExtensionContext,
        isManualSync: boolean = false
    ): Promise<void> {
        // Check if there's a workspace folder open (unless it's a manual sync which user explicitly requested)
        const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
        if (!hasWorkspace && !isManualSync) {
            debug("No workspace open, skipping sync operation");
            return;
        }

        // RACE PREVENTION: Check and set in-memory flag atomically
        if (this.isSyncInProgress) {
            debug("Sync already in progress (in-memory check), tracking as pending");
            if (!this.pendingChanges.includes(commitMessage)) {
                this.pendingChanges.push(commitMessage);
            }
            if (showInfoOnConnectionIssues) {
                // Use withProgress instead of showInformationMessage so it auto-dismisses when sync completes
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Sync in Progress",
                        cancellable: false,
                    },
                    async (progress) => {
                        progress.report({
                            increment: 0,
                            message: "Your changes will sync automatically after completion."
                        });
                        // Wait for sync to complete
                        while (this.isSyncInProgress) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                        // Brief delay before auto-dismissing
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                );
            }
            return;
        }

        // Claim sync immediately (prevents race conditions in same process)
        this.isSyncInProgress = true;

        // Get auth API for checks
        const authApi = getAuthApi();

        try {
            // Check filesystem lock (for crash/restart/multi-window scenarios)

            if (authApi && 'checkSyncLock' in authApi) {
                try {
                    const lockStatus = await (authApi as any).checkSyncLock();

                    if (lockStatus.exists && !lockStatus.isDead && !lockStatus.isStuck) {
                        const ageMinutes = Math.floor((lockStatus.age || 0) / 60000);
                        debug(`Filesystem lock exists (${ageMinutes}m old, PID: ${lockStatus.pid}), releasing claim and queuing`);

                        // Release our in-memory claim
                        this.isSyncInProgress = false;

                        // Track as pending
                        if (!this.pendingChanges.includes(commitMessage)) {
                            this.pendingChanges.push(commitMessage);
                        }

                        if (showInfoOnConnectionIssues) {
                            const progressInfo = lockStatus.progress
                                ? ` - ${lockStatus.progress.description || `${lockStatus.phase} in progress`}`
                                : '';
                            vscode.window.showInformationMessage(
                                `Sync in progress (started ${ageMinutes} minute${ageMinutes !== 1 ? 's' : ''} ago${progressInfo}). Your changes will sync after completion.`
                            );
                        }
                        return;
                    }

                    if (lockStatus.exists && (lockStatus.isDead || lockStatus.isStuck)) {
                        debug("Stale/dead lock detected, will be cleaned up by Frontier");
                    }
                } catch (error) {
                    console.error("Error checking filesystem lock:", error);
                    // Continue with sync attempt
                }
            }

            // Check authentication status
            if (!authApi) {
                this.isSyncInProgress = false;
                debug("Auth API not available, cannot sync");
                if (showInfoOnConnectionIssues) {
                    this.showConnectionIssueMessage(
                        "Unable to sync: Authentication service not available"
                    );
                }
                return;
            }
        } catch (error) {
            // Release claim on error
            this.isSyncInProgress = false;
            console.error("Error in executeSync setup:", error);
            throw error;
        }

        try {
            if (typeof (authApi as any).getAuthStatus !== "function") {
                this.isSyncInProgress = false;
                debug("Auth API missing getAuthStatus, cannot sync");
                if (showInfoOnConnectionIssues) {
                    this.showConnectionIssueMessage(
                        "Unable to sync: Authentication service not available"
                    );
                }
                return;
            }
            const authStatus = authApi.getAuthStatus();
            if (!authStatus.isAuthenticated) {
                this.isSyncInProgress = false;
                debug("User is not authenticated, cannot sync");
                if (showInfoOnConnectionIssues) {
                    this.showConnectionIssueMessage(
                        "Unable to sync: Please log in to sync your changes"
                    );
                }
                return;
            }
        } catch (error) {
            this.isSyncInProgress = false;
            console.error("Error checking authentication status:", error);
            if (showInfoOnConnectionIssues) {
                this.showConnectionIssueMessage(
                    "Unable to sync: Could not verify authentication status"
                );
            }
            return;
        }

        // Enforce Frontier version requirement for sync operations (Git LFS safety gate)
        const versionStatus = await getFrontierVersionStatus();
        if (!versionStatus.ok) {
            this.isSyncInProgress = false;
            debug("Frontier version requirement not met. Blocking sync operation.");
            const details = versionStatus.installedVersion
                ? `Frontier Authentication version ${versionStatus.requiredVersion} or newer is required to sync.`
                : `Frontier Authentication not found. Version ${versionStatus.requiredVersion} or newer is required to sync.`;
            await vscode.window.showWarningMessage(details, { modal: true });
            return;
        }

        // Check VS Code version and show warning modal if needed (non-blocking)
        const vscodeVersionStatus = checkVSCodeVersion();
        if (!vscodeVersionStatus.ok) {
            debug("VS Code version requirement not met. Showing warning modal.");
            const result = await vscode.window.showInformationMessage(
                "Please visit codexeditor.app to update Codex to the latest version.",
                { modal: true },
                "Visit Website"
            );
            if (result === "Visit Website") {
                await vscode.env.openExternal(vscode.Uri.parse("https://codexeditor.app"));
            }
        }

        // Clear any pending scheduled sync (manual sync takes priority)
        this.clearPendingSync();

        // Set sync state and show feedback
        this.currentSyncStage = "Starting sync...";
        this.codexInitiatedSyncCount++;
        this.notifySyncStatusListeners();
        debug("Sync operation in background with message:", commitMessage);

        // Show progress indicator to user instead of simple message
        if (showInfoOnConnectionIssues) {
            this.showSyncProgress(commitMessage);
        }

        // Update splash screen with initial sync status
        updateSplashScreenSync(30, "Checking files are up to date...");

        // Run the actual sync operation in the background (truly async)
        this.executeSyncInBackground(commitMessage, showInfoOnConnectionIssues);

        // Return immediately - don't wait for sync to complete
        debug("🔄 Sync operation started in background, UI is free to continue");
    }

    // Execute the actual sync operation in the background
    private async executeSyncInBackground(
        commitMessage: string,
        showInfoOnConnectionIssues: boolean
    ): Promise<void> {
        try {
            // Log sync timing for performance analysis
            const syncStartTime = performance.now();
            debug("🔄 Starting background sync operation...");

            // Update sync stage and splash screen
            this.currentSyncStage = "Preparing sync...";
            this.notifySyncStatusListeners();
            updateSplashScreenSync(60, this.currentSyncStage);

            // Migrate comments before sync if needed
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceUri = workspaceFolders[0].uri;
                const workspaceFsPath = workspaceUri.fsPath;

                // These checks are independent and can be expensive on large projects; run in parallel.
                const [needsMigration, inSourceControl, commentsHasLocalChanges] = await Promise.all([
                    CommentsMigrator.needsMigration(workspaceUri),
                    CommentsMigrator.areCommentsFilesInSourceControl(workspaceUri),
                    hasLocalModifications(workspaceFsPath, ".project/comments.json"),
                ]);

                if (needsMigration && inSourceControl) {
                    this.currentSyncStage = "Migrating legacy comments...";
                    this.notifySyncStatusListeners();
                    updateSplashScreenSync(65, this.currentSyncStage);

                    try {
                        await CommentsMigrator.migrateProjectComments(workspaceFolders[0].uri);
                        debug("[SyncManager] Pre-sync migration completed");
                    } catch (error) {
                        console.error("[SyncManager] Error during pre-sync migration:", error);
                        // Don't fail sync due to migration errors
                    }
                }

                if (commentsHasLocalChanges) {
                    // Only run pre-sync repair if comments.json has local modifications
                    // This ensures we clean up any local corruption before syncing to other users
                    this.currentSyncStage = "Cleaning up comment data...";
                    this.notifySyncStatusListeners();
                    updateSplashScreenSync(67, this.currentSyncStage);

                    try {
                        const commentsFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".project", "comments.json");
                        await CommentsMigrator.repairExistingCommentsFile(commentsFilePath, true);
                    } catch (error) {
                        console.error("[SyncManager] Error during pre-sync comment repair:", error);
                        // Don't fail sync due to repair errors
                    }
                }
            }

            // Sync all changes in background
            this.currentSyncStage = "Starting sync...";
            this.notifySyncStatusListeners();
            const syncResult = await stageAndCommitAllAndSync(commitMessage, false); // Don't show user messages during background sync
            if (syncResult.offline) {
                this.currentSyncStage = "Synchronization skipped! (offline)";
                this.notifySyncStatusListeners();
                updateSplashScreenSync(100, "Synchronization skipped (offline)");
                return;
            }

            const syncEndTime = performance.now();
            const syncDuration = syncEndTime - syncStartTime;
            debug(`✅ Background sync completed in ${syncDuration.toFixed(2)}ms`);

            // Check if comments.json was affected by the sync - if so, run targeted repair
            const commentsWasChanged = syncResult.changedFiles.includes('.project/comments.json') ||
                syncResult.newFiles.includes('.project/comments.json') ||
                syncResult.deletedFiles.includes('.project/comments.json');

            if (commentsWasChanged && workspaceFolders && workspaceFolders.length > 0) {
                try {
                    const commentsFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".project", "comments.json");
                    await CommentsMigrator.repairExistingCommentsFile(commentsFilePath, true);
                } catch (error) {
                    console.error('[SyncManager] Error during post-sync comment repair:', error);
                }
            }

            // Migrate comments after sync if new legacy files were pulled
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceUri = workspaceFolders[0].uri;
                const [needsPostSyncMigration, inSourceControl] = await Promise.all([
                    CommentsMigrator.needsMigration(workspaceUri),
                    CommentsMigrator.areCommentsFilesInSourceControl(workspaceUri),
                ]);

                if (needsPostSyncMigration && inSourceControl) {
                    this.currentSyncStage = "Cleaning up legacy files...";
                    this.notifySyncStatusListeners();
                    updateSplashScreenSync(95, this.currentSyncStage);

                    try {
                        await CommentsMigrator.migrateProjectComments(workspaceFolders[0].uri);
                        debug("[SyncManager] Post-sync migration completed");
                    } catch (error) {
                        console.error("[SyncManager] Error during post-sync migration:", error);
                        // Don't fail sync completion due to migration errors
                    }
                }
            }

            // Refresh audio attachments in all open codex editors after sync
            try {
                const { GlobalProvider } = await import("../globalProvider");
                const provider = GlobalProvider.getInstance().getProvider("codex-cell-editor") as any;
                if (provider && typeof provider.refreshAudioAttachmentsAfterSync === 'function') {
                    debug("[SyncManager] Refreshing audio attachments after sync");
                    await provider.refreshAudioAttachmentsAfterSync();
                } else {
                    debug("[SyncManager] Codex cell editor provider not available or missing refresh method");
                }
            } catch (error) {
                console.error("[SyncManager] Error refreshing audio attachments after sync:", error);
                // Don't fail sync completion due to audio refresh errors
            }

            // Close webviews for files deleted during sync
            try {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const { closeWebviewsForDeletedFiles, closeWebviewsForNonExistentFiles } = await import("../utils/webviewUtils");

                    // Close webviews for files deleted during this sync
                    if (syncResult.deletedFiles.length > 0) {
                        await closeWebviewsForDeletedFiles(syncResult.deletedFiles, workspaceFolder);
                        debug(`[SyncManager] Closed webviews for ${syncResult.deletedFiles.length} deleted file(s)`);
                    }

                    // Always check for stale webviews (files that don't exist anymore)
                    // This handles cases where webviews were restored but files were deleted before sync
                    await closeWebviewsForNonExistentFiles(workspaceFolder);
                }
            } catch (error) {
                console.error("[SyncManager] Error closing webviews for deleted files:", error);
                // Don't fail sync completion due to webview cleanup errors
            }

            // Post-sync cleanup for media files (stream-only mode)
            try {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const { postSyncCleanup } = await import("../utils/mediaStrategyManager");
                    // Pass the list of uploaded LFS files from the sync result for optimized cleanup
                    await postSyncCleanup(workspaceFolder.uri, syncResult.uploadedLfsFiles);
                    if (syncResult.uploadedLfsFiles && syncResult.uploadedLfsFiles.length > 0) {
                        debug(`[SyncManager] Post-sync media cleanup completed for ${syncResult.uploadedLfsFiles.length} uploaded file(s)`);
                    } else {
                        debug("[SyncManager] Post-sync media cleanup completed (no LFS uploads)");
                    }
                }
            } catch (error) {
                console.error("[SyncManager] Error in post-sync media cleanup:", error);
                // Don't fail sync completion due to cleanup errors
            }

            // Update sync stage and splash screen
            this.currentSyncStage = "Synchronization complete!";
            this.notifySyncStatusListeners();
            updateSplashScreenSync(100, "Synchronization complete");

            // TEMPORARILY DISABLED: progress report after successful sync
            // const progressReportingService = ProgressReportingService.getInstance();
            // progressReportingService.scheduleProgressReport();
            // debug("📊 Progress report scheduled after successful sync");

            // Rebuild indexes in the background after successful sync (truly async)
            // Pass the sync result to optimize database synchronization
            this.rebuildIndexesInBackground(syncResult);

            // Refresh webviews for affected codex files to show newly added cells
            try {
                const affectedCodexFiles = [
                    ...syncResult.changedFiles.filter(f => f.endsWith('.codex')),
                    ...syncResult.newFiles.filter(f => f.endsWith('.codex'))
                ];

                if (affectedCodexFiles.length > 0) {
                    debug(`Refreshing webviews for ${affectedCodexFiles.length} affected codex file(s)`);
                    const { GlobalProvider } = await import("../globalProvider");
                    const provider = GlobalProvider.getInstance().getProvider("codex-cell-editor") as any;
                    if (provider && typeof provider.refreshWebviewsForFiles === 'function') {
                        await provider.refreshWebviewsForFiles(affectedCodexFiles);
                    } else {
                        debug("[SyncManager] Codex cell editor provider not available or missing refreshWebviewsForFiles method");
                    }
                }
            } catch (error) {
                console.error("[SyncManager] Error refreshing webviews after sync:", error);
                // Don't fail sync if webview refresh fails
            }

        } catch (error) {
            console.error("Error during background sync operation:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Update sync stage and splash screen
            this.currentSyncStage = "Sync failed";
            this.notifySyncStatusListeners();
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
            this.notifySyncStatusListeners();

            // Process pending changes from during the sync
            if (this.pendingChanges.length > 0) {
                debug(`Processing ${this.pendingChanges.length} pending change(s) from during sync`);

                // Check if working directory is actually dirty
                const authApi = getAuthApi();
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

                if (authApi && workspaceFolder && 'checkWorkingCopyState' in authApi) {
                    try {
                        // Wait a moment for filesystem to settle
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        const state = await (authApi as any).checkWorkingCopyState(workspaceFolder.uri.fsPath);

                        if (state?.isDirty) {
                            debug("Working directory is dirty, scheduling sync for pending changes");

                            // Generate appropriate commit message
                            const message = this.pendingChanges.length === 1
                                ? this.pendingChanges[0]
                                : `changes to ${this.pendingChanges.length} files`;

                            this.pendingChanges = []; // Clear before scheduling
                            this.scheduleSyncOperation(message); // Respects 5-minute delay
                        } else {
                            debug("Working directory is clean, pending changes were included in sync");
                            this.pendingChanges = [];
                        }
                    } catch (error) {
                        console.error("Error checking working copy state:", error);
                        // Schedule anyway to be safe
                        const message = this.pendingChanges.length === 1
                            ? this.pendingChanges[0]
                            : `changes to ${this.pendingChanges.length} files`;
                        this.pendingChanges = [];
                        this.scheduleSyncOperation(message);
                    }
                } else {
                    // No way to check, schedule anyway
                    const message = this.pendingChanges.length === 1
                        ? this.pendingChanges[0]
                        : `changes to ${this.pendingChanges.length} files`;
                    this.pendingChanges = [];
                    this.scheduleSyncOperation(message);
                }
            }
        }
    }

    // Check if indexes need rebuilding and rebuild only if necessary
    private async rebuildIndexesInBackground(syncResult?: SyncResult): Promise<void> {
        try {
            const indexStartTime = performance.now();
            debug("AI learning from your latest changes...");

            // Log git sync information if available
            if (syncResult && syncResult.totalChanges > 0) {
                debug(`📥 Git sync brought ${syncResult.totalChanges} file changes:`);
                debug(`  📄 ${syncResult.changedFiles.length} modified files`);
                debug(`  ➕ ${syncResult.newFiles.length} new files`);
                debug(`  ➖ ${syncResult.deletedFiles.length} deleted files`);

                // Log specific files for debugging (limit to first 10 for readability)
                if (syncResult.changedFiles.length > 0) {
                    const filesToShow = syncResult.changedFiles.slice(0, 10);
                    debug(`  🔧 Modified: ${filesToShow.join(", ")}${syncResult.changedFiles.length > 10 ? ` and ${syncResult.changedFiles.length - 10} more...` : ""}`);
                }
                if (syncResult.newFiles.length > 0) {
                    const filesToShow = syncResult.newFiles.slice(0, 10);
                    debug(`  ✨ New: ${filesToShow.join(", ")}${syncResult.newFiles.length > 10 ? ` and ${syncResult.newFiles.length - 10} more...` : ""}`);
                }
            } else {
                debug("📭 No git changes detected, checking if AI needs to learn from existing content...");
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
            debug("🔍 Checking which content AI needs to learn from...");
            const syncStatus = await fileSyncManager.checkSyncStatus();

            if (!syncStatus.needsSync) {
                debug("✅ AI is already up to date with all your content");
                const indexEndTime = performance.now();
                const indexDuration = indexEndTime - indexStartTime;
                debug(`✅ Knowledge check completed in ${indexDuration.toFixed(2)}ms`);
                return;
            }

            debug(`🔧 Found ${syncStatus.summary.changedFiles + syncStatus.summary.newFiles} files for AI to learn from`);
            debug(`📊 AI learning summary: ${syncStatus.summary.newFiles} new, ${syncStatus.summary.changedFiles} changed, ${syncStatus.summary.unchangedFiles} unchanged`);

            // Cross-reference with git changes for optimization insights
            if (syncResult && syncResult.totalChanges > 0) {
                const gitChangedFiles = new Set([...syncResult.changedFiles, ...syncResult.newFiles]);
                const dbChangedFiles = syncStatus.summary.changedFiles + syncStatus.summary.newFiles;
                debug(`🔍 Analysis: Git changed ${gitChangedFiles.size} files, AI needs to learn from ${dbChangedFiles} files`);
            }

            // Perform optimized synchronization of only changed files
            const fileSyncResult = await fileSyncManager.syncFiles({
                progressCallback: (message, progress) => {
                    debug(`[AI Learning] ${message} (${progress}%)`);
                }
            });

            const indexEndTime = performance.now();
            const indexDuration = indexEndTime - indexStartTime;

            debug(`✅ AI learning completed in ${indexDuration.toFixed(2)}ms`);
            debug(`📊 Learning results: AI learned from ${fileSyncResult.syncedFiles} files, ${fileSyncResult.unchangedFiles} unchanged, ${fileSyncResult.errors.length} errors`);

            if (fileSyncResult.errors.length > 0) {
                console.warn("⚠️ Some files had AI learning errors:");
                fileSyncResult.errors.forEach(error => {
                    console.warn(`  - ${error.file}: ${error.error}`);
                });
            }

            // Log detailed file changes for debugging
            if (fileSyncResult.details.size > 0) {
                debug("📋 AI learning details:");
                for (const [file, detail] of fileSyncResult.details) {
                    if (detail.reason !== "no changes detected") {
                        debug(`  - ${file}: ${detail.reason}`);
                    }
                }
            }

        } catch (error) {
            console.error("❌ AI learning failed:", error);

            // Fallback to basic index rebuild if file sync fails
            debug("🔄 Falling back to basic knowledge rebuild...");
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
            debug(`[FallbackSync] Current index has ${currentDocCount} documents`);

            if (currentDocCount > 0) {
                debug("✅ Index is already up to date, skipping fallback rebuild");
                return;
            }
        }

        debug("🔧 Running fallback index rebuild...");

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
        debug("✅ Fallback index rebuild completed");
    }

    // Show connection issue message with cooldown
    private showConnectionIssueMessage(message: string): void {
        // Only show one message per minute to avoid spamming
        const now = Date.now();
        if (now - this.lastConnectionErrorTime > this.CONNECTION_ERROR_COOLDOWN) {
            this.lastConnectionErrorTime = now;
            vscode.window.showInformationMessage(message);
        } else {
            debug("Suppressing connection error notification due to cooldown");
        }
    }

    // Cancel any pending sync operations
    public clearPendingSync(): void {
        if (this.pendingSyncTimeout) {
            clearTimeout(this.pendingSyncTimeout);
            this.pendingSyncTimeout = null;
            debug("Cleared pending sync operation");
        }
    }

    // Update the manager settings from configuration
    public updateFromConfiguration(): void {
        // This method will be called when configuration changes
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        let autoSyncEnabled = config.get<boolean>("autoSyncEnabled", true);
        let syncDelayMinutes = config.get<number>("syncDelayMinutes", 5);

        // Check if there's a workspace folder open
        const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;

        if (!hasWorkspace) {
            // Disable autosync when no workspace is open
            autoSyncEnabled = false;
            debug("SyncManager: No workspace open, disabling autosync and clearing pending operations");

            // Clear any pending sync operations
            this.clearPendingSync();
        }

        // Ensure minimum sync delay is 5 minutes
        if (syncDelayMinutes < 5) {
            syncDelayMinutes = 5;
            debug("Sync delay was less than 5 minutes, adjusting to 5 minutes");
        }

        debug(
            `SyncManager configuration updated: autoSyncEnabled=${autoSyncEnabled}, syncDelayMinutes=${syncDelayMinutes}, hasWorkspace=${hasWorkspace}`
        );
    }

    // Force a progress report generation and submission
    public async forceProgressReport(): Promise<boolean> {
        const progressReportingService = ProgressReportingService.getInstance();
        return await progressReportingService.forceProgressReport();
    }

    // Show progress indicator for sync operation
    private async showSyncProgress(commitMessage: string): Promise<void> {
        // Wait for previous notification to close
        if (this.activeProgressNotification) {
            await this.activeProgressNotification;
        }

        // Create new notification and track it
        this.activeProgressNotification = Promise.resolve(vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Synchronizing Project",
                cancellable: false,
            },
            async (progress, token) => {
                let lastStage = '';
                let currentProgress = 0;

                // Map sync stages to progress percentages
                const getProgressForStage = (stage: string): number => {
                    // Handle dynamic Git progress messages with counts
                    if (stage.includes('Receiving objects:')) {
                        const match = stage.match(/(\d+)\/(\d+)/);
                        if (match) {
                            const current = parseInt(match[1]);
                            const total = parseInt(match[2]);
                            // Map receiving to 30-55% range
                            return 30 + Math.floor((current / total) * 25);
                        }
                        return 35;
                    }
                    if (stage.includes('Resolving deltas:')) {
                        const match = stage.match(/(\d+)\/(\d+)/);
                        if (match) {
                            const current = parseInt(match[1]);
                            const total = parseInt(match[2]);
                            // Map resolving to 55-65% range
                            return 55 + Math.floor((current / total) * 10);
                        }
                        return 60;
                    }
                    if (stage.includes('Counting objects:') || stage.includes('Compressing objects:')) {
                        const match = stage.match(/(\d+)\/(\d+)/);
                        if (match) {
                            const current = parseInt(match[1]);
                            const total = parseInt(match[2]);
                            // Map counting/compressing to 75-85% range
                            return 75 + Math.floor((current / total) * 10);
                        }
                        return 80;
                    }
                    if (stage.includes('Writing objects:')) {
                        const match = stage.match(/(\d+)\/(\d+)/);
                        if (match) {
                            const current = parseInt(match[1]);
                            const total = parseInt(match[2]);
                            // Map writing to 85-98% range
                            return 85 + Math.floor((current / total) * 13);
                        }
                        return 90;
                    }

                    // Static stage mappings
                    const staticProgress: Record<string, number> = {
                        'Starting sync': 5,
                        'Preparing sync': 5,
                        'Committing local changes': 10,
                        'Local changes committed': 20,
                        'Checking for remote changes': 25,
                        'Remote check complete': 65,
                        'Merging remote changes': 68,
                        'Merge complete': 72,
                        'Already up to date': 75,
                        'Uploading changes': 75,
                        'Upload complete': 98,
                    };

                    for (const [key, value] of Object.entries(staticProgress)) {
                        if (stage.includes(key) || stage.startsWith(key.split(':')[0])) {
                            return value;
                        }
                    }

                    return 0;
                };

                // Initial progress
                progress.report({
                    increment: 0,
                    message: this.currentSyncStage || "Starting sync..."
                });

                // Wait for sync to complete by polling the sync status
                while (this.isSyncInProgress) {
                    await new Promise(resolve => setTimeout(resolve, 200)); // Check every 200ms for smooth updates

                    // Update progress when stage changes
                    if (this.isSyncInProgress && this.currentSyncStage && this.currentSyncStage !== lastStage) {
                        lastStage = this.currentSyncStage;

                        const targetProgress = getProgressForStage(this.currentSyncStage);

                        // Only increment, never go backwards
                        if (targetProgress > currentProgress) {
                            const increment = targetProgress - currentProgress;
                            currentProgress = targetProgress;

                            progress.report({
                                increment,
                                message: this.currentSyncStage
                            });
                        } else {
                            // Just update message without changing progress
                            progress.report({
                                increment: 0,
                                message: this.currentSyncStage
                            });
                        }
                    }
                }

                // Final completion
                if (currentProgress < 100) {
                    progress.report({
                        increment: 100 - currentProgress,
                        message: this.currentSyncStage || "Synchronization complete!"
                    });
                }

                // Brief delay to show completion before closing
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        )).finally(() => {
            this.activeProgressNotification = undefined;
        });
    }
}

// Register the command to trigger sync
export function registerSyncCommands(context: vscode.ExtensionContext): void {
    // Register progress reporting commands with background service
    registerProgressReportingCommands(context);

    const syncManager = SyncManager.getInstance();

    // Command to trigger immediate sync
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.triggerSync",
            async (message?: string) => {
                await syncManager.executeSync(message || "Manual sync triggered", true, context, true);
            }
        )
    );

    // Command to schedule sync (replacing the manualCommit command)
    context.subscriptions.push(
        vscode.commands.registerCommand("extension.scheduleSync", (message: string) => {
            debug("manualCommit called, scheduling sync operation");
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
                syncManager.updateFromConfiguration();
            }
        })
    );

    // Listen for workspace folder changes to disable autosync when project is closed
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            debug(`SyncManager: Workspace folders changed - added: ${event.added.length}, removed: ${event.removed.length}`);

            // If workspace folders were removed, clear any pending sync operations
            if (event.removed.length > 0) {
                syncManager.clearPendingSync();
                debug("SyncManager: Cleared pending sync operations due to workspace folder removal");
            }

            // Update configuration to handle workspace changes (this will disable autosync if no workspace)
            syncManager.updateFromConfiguration();

            if (event.removed.length > 0 && (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0)) {
                debug("SyncManager: All workspace folders removed, autosync disabled and pending operations cleared");
            }
        })
    );
}
