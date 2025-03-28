import * as vscode from "vscode";
import { stageAndCommitAllAndSync } from "./utils/merge";

// Singleton to manage sync operations across the application
export class SyncManager {
    private static instance: SyncManager;
    private pendingSyncTimeout: NodeJS.Timeout | null = null;
    private isSyncInProgress: boolean = false;

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
    public async executeSync(commitMessage: string = "Manual sync"): Promise<void> {
        if (this.isSyncInProgress) {
            console.log("Sync already in progress, skipping");
            return;
        }

        try {
            this.clearPendingSync();
            this.isSyncInProgress = true;
            console.log("Executing sync operation with message:", commitMessage);
            await stageAndCommitAllAndSync(commitMessage);
        } catch (error) {
            console.error("Error during sync operation:", error);
            vscode.window.showErrorMessage(
                `Sync failed: ${error instanceof Error ? error.message : String(error)}`
            );
        } finally {
            this.isSyncInProgress = false;
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
