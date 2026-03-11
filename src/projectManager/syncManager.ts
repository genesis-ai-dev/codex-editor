import * as vscode from "vscode";
import { stageAndCommitAllAndSync, SyncResult } from "./utils/merge";
import { getAuthApi } from "../extension";
import { createIndexWithContext } from "../activationHelpers/contextAware/contentIndexes/indexes";
import { getNotebookMetadataManager } from "../utils/notebookMetadataManager";
import * as path from "path";
import { updateSplashScreenSync } from "../providers/SplashScreen/register";
import * as dugiteGit from "../utils/dugiteGit";
import { getFrontierVersionStatus, checkVSCodeVersion } from "./utils/versionChecks";
import { CommentsMigrator } from "../utils/commentsMigrationUtils";
import { checkRemoteUpdatingRequired } from "../utils/remoteUpdatingManager";
import { markPendingUpdateRequired } from "../utils/localProjectSettings";
import { isNativeSqliteReady } from "../utils/nativeSqlite";
import { isOnline } from "../utils/connectivityChecker";

const DEBUG_SYNC_MANAGER = false;

function debug(message: string, ...args: any[]): void {
    if (DEBUG_SYNC_MANAGER) {
        console.log(`[SyncManager] ${message}`, ...args);
    }
}

/**
 * Check if a specific file has local modifications that would be committed
 */
async function hasLocalModifications(workspaceFolder: string, filePath: string): Promise<boolean> {
    try {
        const statusOutput = await dugiteGit.status(workspaceFolder, filePath);

        // dugiteGit.status returns undefined for unmodified files,
        // or porcelain v2 output if there are changes
        const hasChanges = statusOutput !== undefined;
        return hasChanges;
    } catch (error) {
        console.warn(`[SyncManager] Could not check git status for ${filePath}:`, error);
        return true; // If we can't check, assume changes exist so repair/sync paths are not skipped
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
    private updatingCheckInterval: NodeJS.Timeout | null = null;
    // Track if user has been notified about update (swap) (keyed by swapInitiatedAt to allow new notifications)
    private swapNotificationShownFor: number | null = null;
    // Track when NewSourceUploader is importing files - sync must be disabled during import
    private importInProgressCount: number = 0;

    private constructor() {
        // Initialize with configuration values
        this.updateFromConfiguration();
        // Subscribe to Frontier sync events
        this.subscribeFrontierSyncEvents();

        // Start monitoring for updating requirements
        this.startUpdatingMonitor();
    }

    // Start monitoring for updating and update (swap) requirements
    private startUpdatingMonitor() {
        if (this.updatingCheckInterval) {
            clearInterval(this.updatingCheckInterval);
        }

        // Check periodically (every hour) if updating or update (swap) is required
        // This handles cases where the user is constantly working (resetting sync timer)
        // or leaving the editor open without syncing
        this.updatingCheckInterval = setInterval(async () => {
            const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
            if (hasWorkspace) {
                const projectPath = vscode.workspace.workspaceFolders![0].uri.fsPath;
                // Check for both updating and update (swap) requirements
                const isUpdatingRequired = await this.checkUpdating(projectPath);
                if (!isUpdatingRequired) {
                    // Only check update (swap) if updating isn't required (updating takes priority)
                    await this.checkProjectSwap(projectPath);
                }
            }
        }, 60 * 60 * 1000); // 1 hour
    }

    // Check if updating is required and notify/block if so
    private async checkUpdating(projectPath: string): Promise<boolean> {
        try {
            // Check if updating is required
            // We force bypass cache to ensure we get the latest state from server
            const result = await checkRemoteUpdatingRequired(projectPath, undefined, true);

            if (result.required) {
                debug("Updating required for user, blocking sync and notifying");

                // Persist pending update flag so the projects list can surface it after close
                try {
                    await markPendingUpdateRequired(vscode.Uri.file(projectPath), result.reason ?? "Remote update required");
                } catch (e) {
                    console.warn("Failed to persist pending update flag:", e);
                }

                // Show modal dialog that cannot be missed (even if notifications are disabled)
                const selection = await vscode.window.showWarningMessage(
                    "Project Update Required\n\nAn administrator has made changes that require updating your project. Syncing is paused until the update is applied.\n\nThe project needs to be closed to complete the update.",
                    { modal: true },  // Modal dialog - appears in center, cannot be missed
                    "Update Project"
                );

                // Close and update if user chooses to, otherwise abort and return to project
                if (selection === "Update Project") {
                    await vscode.commands.executeCommand("workbench.action.closeFolder");
                }
                // If user clicks Cancel (default button) or Escape, selection will be undefined - stay in project

                return true;
            }
        } catch (error) {
            console.error("Error checking updating requirement:", error);
        }
        return false;
    }

    // Check if project update (swap) is required and notify/block if so
    // isManualSync: when true, always show the dialog (user explicitly clicked sync)
    // when false (hourly timer), only show once per update (swap) entry to prevent infinite popups
    private async checkProjectSwap(projectPath: string, isManualSync: boolean = false): Promise<boolean> {
        try {
            const { checkProjectSwapRequired } = await import("../utils/projectSwapManager");
            // Force bypass cache to ensure we get the latest state from server
            const result = await checkProjectSwapRequired(projectPath, undefined, true);

            if (result.required && result.activeEntry && !result.remoteUnreachable) {
                debug("Project update (swap) required for user, blocking sync");

                // Check if there are pending downloads for the update (swap)
                // If so, DON'T show the update (swap) modal - let downloads complete first
                const { getSwapPendingState } = await import("../providers/StartupFlow/performProjectSwap");
                const pendingState = await getSwapPendingState(projectPath);

                if (pendingState && pendingState.swapState === "pending_downloads") {
                    debug("Update (swap) has pending downloads - suppressing modal, allowing media downloads");
                    // Return false to allow media operations to proceed
                    // The update (swap) modal will show after downloads complete via checkPendingSwapDownloads
                    return false;
                }

                const activeEntry = result.activeEntry;
                const swapTimestamp = activeEntry.swapInitiatedAt;

                // For manual sync: always show the dialog so user knows why sync is blocked
                // For automatic sync (hourly timer): only show once per update (swap) entry to prevent infinite popups
                const shouldShowDialog = isManualSync || this.swapNotificationShownFor !== swapTimestamp;

                if (shouldShowDialog) {
                    // Track that we've shown for this update (swap) entry (for automatic checks)
                    this.swapNotificationShownFor = swapTimestamp;

                    const newProjectName = activeEntry.newProjectName;

                    // Show modal dialog that cannot be missed
                    const selection = await vscode.window.showWarningMessage(
                        `📦 Project Update Required\n\n` +
                        `This project has been moved to a new version:\n${newProjectName}\n\n` +
                        `Reason: ${activeEntry.swapReason || "Project update"}\n` +
                        `Started by: ${activeEntry.swapInitiatedBy}\n\n` +
                        `Syncing is paused until you update.\n\n` +
                        `Your work will be saved and backed up.`,
                        { modal: true },
                        "Update Now"
                    );

                    if (selection === "Update Now") {
                        // Close folder - StartupFlowProvider will handle the update (swap) on next open
                        await vscode.commands.executeCommand("workbench.action.closeFolder");
                    }
                } else {
                    debug("Update (swap) notification already shown for this entry (automatic check), silently blocking sync");
                }

                return true;
            }
        } catch (error) {
            console.error("Error checking project swap requirement:", error);
        }
        return false;
    }

    /**
     * Post-sync update (swap) check: after sync completes, check if an update (swap) is required and show notification.
     * This handles:
     * 1. Admin initiates update (swap) → syncs with bypass → should see update notification after sync
     * 2. User syncs → pulls new update (swap) info from remote → should see update notification
     * 
     * This is async and non-blocking - we don't want to hold up the sync completion flow.
     */
    private async checkProjectSwapAfterSync(): Promise<void> {
        try {
            const projectPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!projectPath) {
                return;
            }

            const { checkProjectSwapRequired } = await import("../utils/projectSwapManager");
            // Force bypass cache to get the latest state (just synced, so remote might have new info)
            const result = await checkProjectSwapRequired(projectPath, undefined, true);

            if (result.required && result.activeEntry && !result.remoteUnreachable) {
                // Check if there are pending downloads for the update (swap)
                // If so, DON'T show the update modal - let downloads complete first
                const { getSwapPendingState } = await import("../providers/StartupFlow/performProjectSwap");
                const pendingState = await getSwapPendingState(projectPath);

                if (pendingState && pendingState.swapState === "pending_downloads") {
                    debug("[SyncManager] Post-sync: Update (swap) has pending downloads - suppressing modal");
                    return;
                }

                const activeEntry = result.activeEntry;
                const swapTimestamp = activeEntry.swapInitiatedAt;

                // Only show if we haven't shown for this update (swap) entry yet (prevent double-notification)
                if (this.swapNotificationShownFor !== swapTimestamp) {
                    this.swapNotificationShownFor = swapTimestamp;

                    debug("[SyncManager] Post-sync: Project update (swap) required, showing notification");

                    const newProjectName = activeEntry.newProjectName;

                    // Show modal dialog
                    const selection = await vscode.window.showWarningMessage(
                        `📦 Project Update Required\n\n` +
                        `This project has moved to a new folder:\n${newProjectName}\n\n` +
                        `Reason: ${activeEntry.swapReason || "Project update"}\n` +
                        `Started by: ${activeEntry.swapInitiatedBy}\n\n` +
                        `Your local changes will be preserved and backed up.`,
                        { modal: true },
                        "Update Now"
                    );

                    if (selection === "Update Now") {
                        // Close folder - StartupFlowProvider will handle the update (swap) on next open
                        await vscode.commands.executeCommand("workbench.action.closeFolder");
                    }
                } else {
                    debug("[SyncManager] Post-sync: Update (swap) notification already shown for this entry");
                }
            }
        } catch (error) {
            // Non-fatal - don't disrupt the user if this check fails
            debug("[SyncManager] Post-sync update (swap) check error (non-fatal):", error);
        }
    }

    public static getInstance(): SyncManager {
        if (!SyncManager.instance) {
            SyncManager.instance = new SyncManager();
        }
        return SyncManager.instance;
    }

    /**
     * Clean up all timers and subscriptions. Call on extension deactivation.
     */
    public dispose(): void {
        if (this.updatingCheckInterval) {
            clearInterval(this.updatingCheckInterval);
            this.updatingCheckInterval = null;
        }
        if (this.pendingSyncTimeout) {
            clearTimeout(this.pendingSyncTimeout as NodeJS.Timeout);
            this.pendingSyncTimeout = null;
        }
        this.frontierSyncSubscription?.dispose();
        this.frontierSyncSubscription = undefined;
    }

    /**
     * Call when NewSourceUploader starts importing files. Sync is disabled until
     * the matching endImportInProgress() is called. Supports nested calls.
     */
    public beginImportInProgress(): void {
        this.importInProgressCount++;
        debug("Import in progress started (count=%d), sync disabled", this.importInProgressCount);
        this.notifyImportInProgressListeners();
    }

    /**
     * Call when NewSourceUploader finishes importing files. Must match beginImportInProgress().
     */
    public endImportInProgress(): void {
        if (this.importInProgressCount > 0) {
            this.importInProgressCount--;
            debug("Import in progress ended (count=%d)", this.importInProgressCount);
            this.notifyImportInProgressListeners();
        }
    }

    private isImportInProgress(): boolean {
        return this.importInProgressCount > 0;
    }

    private importInProgressListeners: Array<(isImportInProgress: boolean) => void> = [];

    public addImportInProgressListener(listener: (isImportInProgress: boolean) => void): vscode.Disposable {
        this.importInProgressListeners.push(listener);
        return new vscode.Disposable(() => {
            const index = this.importInProgressListeners.indexOf(listener);
            if (index !== -1) {
                this.importInProgressListeners.splice(index, 1);
            }
        });
    }

    private notifyImportInProgressListeners(): void {
        const inProgress = this.isImportInProgress();
        this.importInProgressListeners.forEach((listener) => {
            try {
                listener(inProgress);
            } catch (error) {
                console.error("Error notifying import in progress listener:", error);
            }
        });
    }

    public getSyncStatus(): { isSyncInProgress: boolean; syncStage: string; isImportInProgress: boolean; } {
        return {
            isSyncInProgress: this.isSyncInProgress,
            syncStage: this.currentSyncStage,
            isImportInProgress: this.isImportInProgress(),
        };
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

    /**
     * Schedule any queued pending changes for sync.
     * Called when an external sync (e.g. publish) completes so that
     * changes made during that sync are eventually synced.
     */
    private drainPendingChanges(): void {
        if (this.pendingChanges.length === 0) {
            return;
        }
        debug(`Draining ${this.pendingChanges.length} pending change(s) after external sync`);
        const message = this.pendingChanges.length === 1
            ? this.pendingChanges[0]
            : `changes to ${this.pendingChanges.length} files`;
        this.pendingChanges = [];
        this.scheduleSyncOperation(message);
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
                        debug('[Sync] 🔄 Sync operation started');
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
                            debug(`[Sync] ${phaseEmoji} ${this.currentSyncStage}`);
                            debug(`[SyncManager] Progress update: ${this.currentSyncStage}`);
                        }
                        break;
                    case 'completed':
                        debug('[Sync] ✅ Sync completed successfully');
                        if (this.codexInitiatedSyncCount > 0) {
                            this.codexInitiatedSyncCount--;
                            // Let executeSyncInBackground own the final state
                            break;
                        }
                        this.isSyncInProgress = false;
                        this.currentSyncStage = status.message || 'Sync complete';
                        this.notifySyncStatusListeners();
                        if (this.frontierSyncProgressResolver) {
                            this.frontierSyncProgressResolver();
                            this.frontierSyncProgressResolver = undefined;
                        }
                        this.checkProjectSwapAfterSync();
                        this.drainPendingChanges();
                        break;
                    case 'error':
                        console.error(`[Sync] ❌ Sync failed: ${status.message || 'Unknown error'}`);
                        if (this.codexInitiatedSyncCount > 0) {
                            this.codexInitiatedSyncCount--;
                            break;
                        }
                        this.isSyncInProgress = false;
                        this.currentSyncStage = status.message || 'Sync failed';
                        this.notifySyncStatusListeners();
                        if (this.frontierSyncProgressResolver) {
                            this.frontierSyncProgressResolver();
                            this.frontierSyncProgressResolver = undefined;
                        }
                        this.drainPendingChanges();
                        break;
                    case 'skipped':
                        console.warn(`[Sync] ⏭️  Sync skipped: ${status.message || 'Another sync in progress'}`);
                        if (this.codexInitiatedSyncCount > 0) {
                            this.codexInitiatedSyncCount--;
                            break;
                        }
                        this.isSyncInProgress = false;
                        this.currentSyncStage = status.message || 'Sync skipped';
                        this.notifySyncStatusListeners();
                        if (this.frontierSyncProgressResolver) {
                            this.frontierSyncProgressResolver();
                            this.frontierSyncProgressResolver = undefined;
                        }
                        this.drainPendingChanges();
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
                    message: "Checking for updates..."
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
    public async scheduleSyncOperation(commitMessage: string = "Auto-sync changes"): Promise<void> {
        debug(`scheduleSyncOperation called with message: "${commitMessage}"`);

        // Don't schedule sync while NewSourceUploader is importing files
        if (this.isImportInProgress()) {
            debug("Import in progress, not scheduling sync operation");
            return;
        }

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

        // Get current configuration from local project settings
        const { getSyncSettings } = await import("../utils/localProjectSettings");
        const { autoSyncEnabled, syncDelayMinutes } = await getSyncSettings();

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

        // Schedule the new sync (check connectivity before firing)
        this.pendingSyncTimeout = setTimeout(async () => {
            if (!(await isOnline())) {
                debug("Auto-sync timer fired but device is offline, rescheduling in 60s");
                this.pendingSyncTimeout = setTimeout(() => {
                    this.scheduleSyncOperation(commitMessage);
                }, 60_000);
                return;
            }
            this.executeSync(commitMessage, true, undefined, false); // Auto-sync
        }, delayMs);
    }

    // Execute the sync operation immediately
    public async executeSync(
        commitMessage: string = "Manual sync",
        showInfoOnConnectionIssues: boolean = false,
        context?: vscode.ExtensionContext,
        isManualSync: boolean = false,
        bypassUpdatingCheck: boolean = false
    ): Promise<void> {
        // Don't sync while NewSourceUploader is importing files
        if (this.isImportInProgress()) {
            debug("Import in progress, skipping sync operation");
            return;
        }

        // Check if there's a workspace folder open (unless it's a manual sync which user explicitly requested)
        const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
        if (!hasWorkspace && !isManualSync) {
            debug("No workspace open, skipping sync operation");
            return;
        }

        const projectPath = hasWorkspace ? vscode.workspace.workspaceFolders![0].uri.fsPath : undefined;

        // Skip sync if the project has no git remote (not published yet)
        if (projectPath) {
            try {
                const remotes = await dugiteGit.listRemotes(projectPath);
                if (remotes.length === 0) {
                    debug("Project has no git remote (not published), skipping sync");
                    if (isManualSync) {
                        vscode.window.showInformationMessage(
                            "This project hasn't been published yet. Please publish your project before syncing."
                        );
                    }
                    return;
                }
            } catch {
                debug("Could not check git remotes, skipping sync");
                return;
            }
        }

        // Fast-fail if offline to avoid unnecessary local work
        if (!(await isOnline())) {
            debug("Device is offline, skipping sync");
            if (showInfoOnConnectionIssues) {
                this.showConnectionIssueMessage(
                    "Sync skipped: No internet connection. Will retry when back online."
                );
            }
            return;
        }

        // Check for updating requirement before proceeding (unless explicitly bypassed)
        if (projectPath && !bypassUpdatingCheck) {
            const isUpdatingRequired = await this.checkUpdating(projectPath);
            if (isUpdatingRequired) {
                debug("Sync blocked due to updating requirement");
                return;
            }
        }

        // Check for project swap requirement before proceeding (only when not bypassing)
        if (projectPath && !bypassUpdatingCheck) {
            const isSwapRequired = await this.checkProjectSwap(projectPath, isManualSync);
            if (isSwapRequired) {
                debug("Sync blocked due to project swap requirement");
                return;
            }
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
                        title: "Sync Already in Progress",
                        cancellable: false,
                    },
                    async (progress) => {
                        progress.report({
                            increment: 0,
                            message: "Your changes will be included when the current sync finishes."
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

            if (authApi?.checkSyncLock) {
                try {
                    const lockStatus = await authApi.checkSyncLock();

                    if (lockStatus.exists && !lockStatus.isDead && !lockStatus.isStuck) {
                        const ageMinutes = Math.floor((lockStatus.age || 0) / 60000);
                        debug(`Filesystem lock exists (${ageMinutes}m old, PID: ${lockStatus.pid}), releasing claim and queuing`);

                        // Track as pending
                        if (!this.pendingChanges.includes(commitMessage)) {
                            this.pendingChanges.push(commitMessage);
                        }

                        // Show syncing state in the UI (greyed button, spinning icon).
                        // The onSyncStatusChange subscription will push progress updates
                        // and clear this state when the external sync completes.
                        const initialStage = lockStatus.progress?.description
                            || (lockStatus.phase ? `${lockStatus.phase} in progress` : 'Syncing...');
                        this.currentSyncStage = initialStage;
                        this.notifySyncStatusListeners();

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
                    "Unable to sync: Could not verify your login status"
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
                ? `Frontier Authentication ${versionStatus.installedVersion} is installed, but version ${versionStatus.requiredVersion} or newer is needed to sync. Please update the extension.`
                : `Frontier Authentication is not installed. Version ${versionStatus.requiredVersion} or newer is required to sync.`;
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
        updateSplashScreenSync(30, "Preparing to sync...");

        // Run the actual sync operation in the background (truly async)
        this.executeSyncInBackground(commitMessage, showInfoOnConnectionIssues, isManualSync);

        // Return immediately - don't wait for sync to complete
        debug("🔄 Sync operation started in background, UI is free to continue");
    }

    private async executeSyncInBackground(
        commitMessage: string,
        showInfoOnConnectionIssues: boolean,
        isManualSync: boolean = false
    ): Promise<void> {
        try {
            // Pre-check extension version compatibility with project metadata.
            // Runs in the background to avoid blocking extension activation
            // (the frontier command may call back into codex-editor, creating
            // a circular dependency if awaited during activation).
            try {
                const metadataVersionOk = await vscode.commands.executeCommand<boolean>(
                    "frontier.checkMetadataVersionsForSync",
                    { isManualSync }
                );
                if (metadataVersionOk === false) {
                    this.currentSyncStage = "Sync blocked";
                    this.notifySyncStatusListeners();
                    debug("Sync blocked: extension version requirements not met (metadata pre-check)");
                    return;
                }
            } catch {
                debug("Could not run metadata version pre-check; will check during sync");
            }

            // Log sync timing for performance analysis
            const syncStartTime = performance.now();
            debug("🔄 Starting background sync operation...");

            // Update sync stage and splash screen
            this.currentSyncStage = "Preparing sync...";
            this.notifySyncStatusListeners();
            updateSplashScreenSync(60, "Preparing sync...");

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
                    this.currentSyncStage = "Updating comments...";
                    this.notifySyncStatusListeners();
                    updateSplashScreenSync(65, "Updating comments...");

                    try {
                        await CommentsMigrator.migrateProjectComments(workspaceFolders[0].uri);
                        debug("[SyncManager] Pre-sync migration completed");
                    } catch (error) {
                        console.error("[SyncManager] Error during pre-sync migration:", error);
                        vscode.window.showWarningMessage(
                            "Some older comments couldn't be updated. They may not appear correctly."
                        );
                    }
                }

                if (commentsHasLocalChanges) {
                    // Only run pre-sync repair if comments.json has local modifications
                    // This ensures we clean up any local corruption before syncing to other users
                    this.currentSyncStage = "Preparing comments...";
                    this.notifySyncStatusListeners();
                    updateSplashScreenSync(67, "Preparing comments...");

                    try {
                        const commentsFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".project", "comments.json");
                        await CommentsMigrator.repairExistingCommentsFile(commentsFilePath, true);
                    } catch (error) {
                        console.error("[SyncManager] Error during pre-sync comment repair:", error);
                        vscode.window.showWarningMessage(
                            "Some comments couldn't be cleaned up. They may have minor formatting issues."
                        );
                    }
                }
            }

            // Sync all changes in background
            this.currentSyncStage = "Starting sync...";
            this.notifySyncStatusListeners();
            const syncResult = await stageAndCommitAllAndSync(commitMessage, false); // Don't show user messages during background sync
            if (syncResult.offline) {
                this.currentSyncStage = "Sync skipped (offline)";
                this.notifySyncStatusListeners();
                updateSplashScreenSync(100, "Sync skipped (offline)");
                return;
            }
            if (!syncResult.success && syncResult.totalChanges === 0) {
                this.currentSyncStage = "Sync blocked";
                this.notifySyncStatusListeners();
                updateSplashScreenSync(100, "Sync blocked");
                return;
            }

            const syncEndTime = performance.now();
            const syncDuration = syncEndTime - syncStartTime;
            debug(`✅ Background sync completed in ${syncDuration.toFixed(2)}ms`);

            this.currentSyncStage = "Finishing up...";
            this.notifySyncStatusListeners();

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
                    vscode.window.showWarningMessage(
                        "Some synced comments may have minor formatting issues."
                    );
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
                    this.currentSyncStage = "Cleaning up...";
                    this.notifySyncStatusListeners();
                    updateSplashScreenSync(95, "Cleaning up...");

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
        this.currentSyncStage = "Sync complete!";
        this.notifySyncStatusListeners();
        updateSplashScreenSync(100, "Sync complete!");

            // Post-sync swap check (handled here instead of Frontier callback for Codex-initiated syncs)
            this.checkProjectSwapAfterSync();

            // Clear local update completion flag now that sync has pushed changes to remote
            try {
                const { clearUpdateCompletedLocally } = await import("../utils/localProjectSettings");
                await clearUpdateCompletedLocally(workspaceFolders?.[0]?.uri);
            } catch (clearErr) {
                // Non-fatal error
            }

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
            updateSplashScreenSync(100, "Sync failed");

            // Show error messages to user
            if (
                errorMessage.includes("No active session") ||
                errorMessage.includes("network") ||
                errorMessage.includes("connect") ||
                errorMessage.includes("offline")
            ) {
                if (showInfoOnConnectionIssues) {
                    this.showConnectionIssueMessage(
                        "Sync failed. Please check your internet connection and try again."
                    );
                }
            } else {
                // For other errors, show an error message
                vscode.window.showErrorMessage(`Sync failed. Please try again or contact support if the problem persists.`);
            }
        } finally {
            // Don't clear currentSyncStage here — let the progress poller read
            // the value set by the try ("Synchronization complete!") or catch ("Sync failed") block.
            // The next sync cycle will overwrite it when it starts.
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
                console.debug("SQLite index manager not available");
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
        if (!isNativeSqliteReady()) {
            console.warn("[SyncManager] Skipping index rebuild — SQLite not available");
            return;
        }

        const { getSQLiteIndexManager } = await import("../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager");
        const indexManager = getSQLiteIndexManager();

        if (indexManager) {
            const currentDocCount = await indexManager.getDocumentCount();
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
    public async updateFromConfiguration(): Promise<void> {
        const { getSyncSettings } = await import("../utils/localProjectSettings");
        const syncSettings = await getSyncSettings();
        let autoSyncEnabled = syncSettings.autoSyncEnabled;
        const syncDelayMinutes = syncSettings.syncDelayMinutes;

        // Check if there's a workspace folder open
        const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;

        if (!hasWorkspace) {
            autoSyncEnabled = false;
            debug("SyncManager: No workspace open, disabling autosync and clearing pending operations");
            this.clearPendingSync();
        }

        debug(
            `SyncManager configuration updated: autoSyncEnabled=${autoSyncEnabled}, syncDelayMinutes=${syncDelayMinutes}, hasWorkspace=${hasWorkspace}`
        );
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

                    // Map sync stages to progress percentages and user-friendly labels
                const friendlyStageLabel = (stage: string): string => {
                    if (stage.includes('Receiving objects:') || stage.includes('Resolving deltas:')) {
                        const match = stage.match(/(\d+)\/(\d+)/);
                        if (match) {
                            const percent = Math.round((parseInt(match[1]) / parseInt(match[2])) * 100);
                            return `Downloading changes... ${percent}%`;
                        }
                        return 'Downloading changes...';
                    }
                    if (stage.includes('Counting objects:') || stage.includes('Compressing objects:')) {
                        const match = stage.match(/(\d+)\/(\d+)/);
                        if (match) {
                            const percent = Math.round((parseInt(match[1]) / parseInt(match[2])) * 100);
                            return `Preparing upload... ${percent}%`;
                        }
                        return 'Preparing upload...';
                    }
                    if (stage.includes('Writing objects:')) {
                        const match = stage.match(/(\d+)\/(\d+)/);
                        if (match) {
                            const percent = Math.round((parseInt(match[1]) / parseInt(match[2])) * 100);
                            return `Uploading changes... ${percent}%`;
                        }
                        return 'Uploading changes...';
                    }
                    if (stage.includes('Uploading media')) {
                        const pctMatch = stage.match(/(\d+)%/);
                        if (pctMatch) {
                            return `Uploading media... ${pctMatch[1]}%`;
                        }
                        return 'Uploading media...';
                    }

                    const phaseMap: Record<string, string> = {
                        'committing': 'Saving your changes...',
                        'fetching': 'Downloading updates...',
                        'pushing': 'Uploading changes...',
                        'merging': 'Combining changes...',
                        'Committing local changes': 'Saving your changes...',
                        'Local changes committed': 'Changes saved',
                        'Checking for remote changes': 'Checking for updates...',
                        'Remote check complete': 'Up to date',
                        'Merging remote changes': 'Merging updates...',
                        'Uploading changes': 'Uploading changes...',
                        'Finishing upload': 'Almost done...',
                        'Upload complete': 'Upload complete',
                        'Finishing up': 'Finishing up...',
                        'Cleaning up legacy files': 'Cleaning up...',
                        'Synchronization complete': 'Sync complete!',
                        'Synchronization complete!': 'Sync complete!',
                    };

                    for (const [key, label] of Object.entries(phaseMap)) {
                        if (stage === key || stage.startsWith(`${key}:`)) {
                            const countMatch = stage.match(/(\d+)\/(\d+)/);
                            if (countMatch) {
                                const percent = Math.round((parseInt(countMatch[1]) / parseInt(countMatch[2])) * 100);
                                return `${label.replace('...', '')}... ${percent}%`;
                            }
                            return label;
                        }
                    }

                    return stage;
                };

                const getProgressForStage = (stage: string): number => {
                    if (stage.includes('Receiving objects:') || stage.includes('Downloading changes')) {
                        const match = stage.match(/(\d+)\/(\d+)/);
                        if (match) {
                            return 30 + Math.floor((parseInt(match[1]) / parseInt(match[2])) * 25);
                        }
                        return 35;
                    }
                    if (stage.includes('Resolving deltas:')) {
                        const match = stage.match(/(\d+)\/(\d+)/);
                        if (match) {
                            return 55 + Math.floor((parseInt(match[1]) / parseInt(match[2])) * 10);
                        }
                        return 60;
                    }
                    if (stage.includes('Counting objects:') || stage.includes('Compressing objects:') || stage.includes('Preparing upload')) {
                        const match = stage.match(/(\d+)\/(\d+)/);
                        if (match) {
                            return 75 + Math.floor((parseInt(match[1]) / parseInt(match[2])) * 10);
                        }
                        return 80;
                    }
                    if (stage.includes('Writing objects:') || stage.includes('Uploading changes')) {
                        const match = stage.match(/(\d+)\/(\d+)/);
                        if (match) {
                            return 85 + Math.floor((parseInt(match[1]) / parseInt(match[2])) * 13);
                        }
                        return 90;
                    }
                    if (stage.includes('Uploading media')) {
                        const pctMatch = stage.match(/(\d+)%/);
                        if (pctMatch) {
                            return 10 + Math.floor((parseInt(pctMatch[1]) / 100) * 10);
                        }
                        return 10;
                    }

                    const staticProgress: Record<string, number> = {
                        'Starting sync': 5,
                        'Preparing sync': 5,
                        'Saving your changes': 10,
                        'Changes saved': 20,
                        'Checking for updates': 25,
                        'Up to date': 65,
                        'Merging updates': 68,
                        'Merge complete': 72,
                        'Already up to date': 75,
                        'Uploading changes': 75,
                        'Almost done': 92,
                        'Upload complete': 93,
                        'Finishing up': 95,
                        'Cleaning up': 96,
                        'Sync complete!': 100,
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
                    await new Promise(resolve => setTimeout(resolve, 200));

                    if (this.isSyncInProgress && this.currentSyncStage && this.currentSyncStage !== lastStage) {
                        lastStage = this.currentSyncStage;

                        const displayMessage = friendlyStageLabel(this.currentSyncStage);
                        const targetProgress = getProgressForStage(this.currentSyncStage);

                        if (targetProgress > currentProgress) {
                            const increment = targetProgress - currentProgress;
                            currentProgress = targetProgress;

                            progress.report({
                                increment,
                                message: displayMessage
                            });
                        } else {
                            progress.report({
                                increment: 0,
                                message: displayMessage
                            });
                        }
                    }
                }

                // Final completion
                if (currentProgress < 100) {
                    progress.report({
                        increment: 100 - currentProgress,
                        message: this.currentSyncStage || "Sync complete!"
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
    const syncManager = SyncManager.getInstance();

    // Ensure cleanup on extension deactivation
    context.subscriptions.push(new vscode.Disposable(() => syncManager.dispose()));

    // Command to trigger immediate sync
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.triggerSync",
            async (message?: string, options?: { bypassUpdatingCheck?: boolean; }) => {
                await syncManager.executeSync(
                    message || "Manual sync triggered",
                    true,
                    context,
                    true,
                    options?.bypassUpdatingCheck
                );
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
