import * as vscode from "vscode";

/**
 * A notification-based progress indicator for showing startup progress.
 * Shows a notification with a loading bar that auto-dismisses when complete.
 */
export class StartupStatusBar {
    private progressResolver: (() => void) | undefined;
    private currentProgress: vscode.Progress<{ message?: string; increment?: number }> | undefined;

    constructor(_context: vscode.ExtensionContext) {
        // No setup needed for notification-based progress
    }

    /**
     * Show the progress notification with initial message
     */
    show(message: string): void {
        // Start the progress notification
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Codex Editor",
                cancellable: false,
            },
            async (progress) => {
                this.currentProgress = progress;
                progress.report({ message });

                // Wait until complete() or hide() is called
                return new Promise<void>((resolve) => {
                    this.progressResolver = resolve;
                });
            }
        );
    }

    /**
     * Update the progress message
     */
    update(message: string): void {
        if (this.currentProgress) {
            this.currentProgress.report({ message });
        }
    }

    /**
     * Mark initialization as complete (notification will auto-dismiss)
     */
    complete(_message: string): void {
        // Resolve the promise to dismiss the notification
        if (this.progressResolver) {
            this.progressResolver();
            this.progressResolver = undefined;
            this.currentProgress = undefined;
        }
    }

    /**
     * Hide the progress notification
     */
    hide(): void {
        // Same as complete - resolve to dismiss
        if (this.progressResolver) {
            this.progressResolver();
            this.progressResolver = undefined;
            this.currentProgress = undefined;
        }
    }

    /**
     * Dispose (no-op for notification-based progress)
     */
    dispose(): void {
        this.hide();
    }
}

/**
 * Create a startup progress indicator instance
 */
export function createStartupStatusBar(context: vscode.ExtensionContext): StartupStatusBar {
    return new StartupStatusBar(context);
}
