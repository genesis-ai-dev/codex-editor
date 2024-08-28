// scm/statusbar.ts
import * as vscode from "vscode";
import { hasPendingChanges, hasRemote, isRemoteDiff } from "./git";

const GIT_SYNC_EVERY = 1000 * 10;

export const registerScmStatusBar = (ctx: vscode.ExtensionContext) => {
    const scmStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
    );

    scmStatusBar.show();
    ctx.subscriptions.push(scmStatusBar);

    let syncInterval: NodeJS.Timeout | null = null;

    const syncStatus = async () => {
        const config = vscode.workspace.getConfiguration('codex-editor-extension.scm');
        const autoCommit = config.get<boolean>('autoCommit', true);

        if (!autoCommit) {
            scmStatusBar.text = "$(stop) Auto-commit disabled";
            scmStatusBar.tooltip = "Auto-commit is disabled in settings";
            scmStatusBar.command = undefined;
            scmStatusBar.backgroundColor = new vscode.ThemeColor(
                "statusBarItem.warningBackground",
            );
            return;
        }

        if (!(await hasRemote())) {
            scmStatusBar.text = "$(error) No cloud sync found";
            scmStatusBar.tooltip = "Click to add remote";
            scmStatusBar.command = "codex-editor-extension.scm.addRemote";
            scmStatusBar.backgroundColor = new vscode.ThemeColor(
                "statusBarItem.errorBackground",
            );
            return;
        }

        if (await isRemoteDiff()) {
            scmStatusBar.text = "$(warning) Cloud sync pending";
            scmStatusBar.tooltip = "Click to sync to the cloud";
            scmStatusBar.command = "codex-editor-extension.scm.sync";
            scmStatusBar.backgroundColor = new vscode.ThemeColor(
                "statusBarItem.warningBackground",
            );
            return;
        }

        if (await hasPendingChanges()) {
            scmStatusBar.text = "$(warning) local sync pending";
            scmStatusBar.tooltip = "Click to sync locally";
            scmStatusBar.command = "codex-editor-extension.scm.stageAndCommitAll";
            scmStatusBar.backgroundColor = new vscode.ThemeColor(
                "statusBarItem.warningBackground",
            );
            return;
        }

        scmStatusBar.text = "$(check) Synced";
        scmStatusBar.tooltip = "Synced";
        scmStatusBar.command = "codex-editor-extension.scm.syncedNotification";
        scmStatusBar.backgroundColor = undefined;
    };

    const startSyncInterval = () => {
        if (syncInterval) {
            clearInterval(syncInterval);
        }
        syncInterval = setInterval(syncStatus, GIT_SYNC_EVERY);
    };

    const stopSyncInterval = () => {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
    };

    const handleConfigChange = (e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration("codex-editor-extension.scm.autoCommit")) {
            const config = vscode.workspace.getConfiguration('codex-editor-extension.scm');
            const autoCommit = config.get<boolean>('autoCommit', true);
            if (autoCommit) {
                startSyncInterval();
            } else {
                stopSyncInterval();
                syncStatus(); // Update status bar immediately
            }
        }
    };

    syncStatus();
    startSyncInterval();

    const configChangeSubscription = vscode.workspace.onDidChangeConfiguration(handleConfigChange);
    ctx.subscriptions.push(configChangeSubscription);

    return [scmStatusBar, syncStatus] as const;
};
