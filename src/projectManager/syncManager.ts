import * as vscode from "vscode";
import { stageAndCommitAllAndSync } from "./utils/merge";
import { getAuthApi } from "../extension";

// Singleton to manage sync operations across the application
export class SyncManager {
    private static instance: SyncManager;
    private pendingSyncTimeout: NodeJS.Timeout | number | null = null;
    private isSyncInProgress: boolean = false;
    private lastConnectionErrorTime: number = 0;
    private CONNECTION_ERROR_COOLDOWN = 60000; // 1 minute cooldown for connection messages

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

        try {
            this.clearPendingSync();
            this.isSyncInProgress = true;
            console.log("Executing sync operation with message:", commitMessage);
            await stageAndCommitAllAndSync(commitMessage);
        } catch (error) {
            console.error("Error during sync operation:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Check if this is a connection-related error
            if (
                errorMessage.includes("No active session") ||
                errorMessage.includes("network") ||
                errorMessage.includes("connect") ||
                errorMessage.includes("offline")
            ) {
                if (showInfoOnConnectionIssues) {
                    this.showConnectionIssueMessage(
                        "Unable to sync: Please check your internet connection or login status"
                    );
                }
            } else {
                // For other errors, show an error message
                vscode.window.showErrorMessage(`Sync failed: ${errorMessage}`);
            }
        } finally {
            this.isSyncInProgress = false;
        }
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
}

// Register the command to trigger sync
export function registerSyncCommands(context: vscode.ExtensionContext): void {
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
