// scm/statusbar.ts
import * as vscode from "vscode";
import { hasPendingChanges, hasRemote, isRemoteDiff } from "./git";

export const registerScmStatusBar = (ctx: vscode.ExtensionContext) => {
    const scmStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

    scmStatusBar.show();
    ctx.subscriptions.push(scmStatusBar);

    let syncInterval: NodeJS.Timeout | null = null;

    const syncStatus = async () => {
        const config = vscode.workspace.getConfiguration("codex-editor-extension.scm");
        const autoSyncInterval = config.get<string>("autoSyncInterval", "Do not auto sync");

        if (autoSyncInterval === "Do not auto sync") {
            scmStatusBar.text = "$(sync) Manual Sync";
            scmStatusBar.tooltip = "Click to sync manually";
            scmStatusBar.command = "codex-editor-extension.scm.commitAllWorkspaceChanges";
            scmStatusBar.backgroundColor = undefined;
            return;
        }

        if (!(await hasRemote())) {
            scmStatusBar.text = "$(error) No cloud sync found";
            scmStatusBar.tooltip = "Click to add remote";
            scmStatusBar.command = "codex-editor-extension.scm.addRemote";
            scmStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
            return;
        }

        if (await isRemoteDiff()) {
            scmStatusBar.text = "$(warning) Cloud sync pending";
            scmStatusBar.tooltip = "Click to sync to the cloud";
            scmStatusBar.command = "codex-editor-extension.scm.sync";
            scmStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
            return;
        }

        if (await hasPendingChanges()) {
            scmStatusBar.text = "$(warning) Local changes pending";
            scmStatusBar.tooltip = "Click to commit changes";
            scmStatusBar.command = "codex-editor-extension.scm.commitAllWorkspaceChanges";
            scmStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
            return;
        }

        scmStatusBar.text = "$(check) Synced";
        scmStatusBar.tooltip = `Auto-sync: ${autoSyncInterval}`;
        scmStatusBar.command = "codex-editor-extension.scm.syncedNotification";
        scmStatusBar.backgroundColor = undefined;
    };

    const getIntervalMs = (interval: string): number => {
        switch (interval) {
            case "Every 1 minute":
                return 60 * 1000;
            case "Every 5 minutes":
                return 5 * 60 * 1000;
            case "Every 15 minutes":
                return 15 * 60 * 1000;
            case "Every hour":
                return 60 * 60 * 1000;
            case "Every day":
                return 24 * 60 * 60 * 1000;
            default:
                return 0;
        }
    };

    const startSyncInterval = () => {
        if (syncInterval) {
            clearInterval(syncInterval);
        }
        const config = vscode.workspace.getConfiguration("codex-editor-extension.scm");
        const autoSyncInterval = config.get<string>("autoSyncInterval", "Do not auto sync");
        const intervalMs = getIntervalMs(autoSyncInterval);

        if (intervalMs > 0) {
            syncInterval = setInterval(async () => {
                await vscode.commands.executeCommand(
                    "codex-editor-extension.scm.commitAllWorkspaceChanges"
                );
                syncStatus();
            }, intervalMs) as unknown as NodeJS.Timeout;
        }
    };

    const stopSyncInterval = () => {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
    };

    const handleConfigChange = (e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration("codex-editor-extension.scm.autoSyncInterval")) {
            stopSyncInterval();
            startSyncInterval();
            syncStatus();
        }
    };

    syncStatus();
    startSyncInterval();

    const configChangeSubscription = vscode.workspace.onDidChangeConfiguration(handleConfigChange);
    ctx.subscriptions.push(configChangeSubscription);

    return [scmStatusBar, syncStatus] as const;
};

// Add these command registrations in your extension's activate function
export function registerScmCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.scm.commitCurrentEditorChanges",
            async () => {
                // Implement logic to commit changes in the current editor
                // You may need to use the Git extension API or your own implementation
                await vscode.window.showInformationMessage(
                    "Committing changes in the current editor"
                );
            }
        ),
        vscode.commands.registerCommand(
            "codex-editor-extension.scm.commitAllWorkspaceChanges",
            async () => {
                // Implement logic to commit all changes in the workspace
                // You may need to use the Git extension API or your own implementation
                await vscode.window.showInformationMessage(
                    "Committing all changes in the workspace"
                );
            }
        )
    );
}
