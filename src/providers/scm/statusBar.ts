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

    const syncStatus = async () => {
        if (!(await hasRemote())) {
            scmStatusBar.text = "$(error) No cloud sync found";
            scmStatusBar.tooltip = "Click to add remote";
            scmStatusBar.command = "codex-editor.scm.addRemote";
            scmStatusBar.backgroundColor = new vscode.ThemeColor(
                "statusBarItem.errorBackground",
            );
            return;
        }

        if (await isRemoteDiff()) {
            scmStatusBar.text = "$(warning) Cloud sync pending";
            scmStatusBar.tooltip = "Click to sync to the cloud";
            scmStatusBar.command = "codex-editor.scm.sync";
            scmStatusBar.backgroundColor = new vscode.ThemeColor(
                "statusBarItem.warningBackground",
            );
            return;
        }

        if (await hasPendingChanges()) {
            scmStatusBar.text = "$(warning) local sync pending";
            scmStatusBar.tooltip = "Click to sync locally";
            scmStatusBar.command = "codex-editor.scm.stageAndCommitAll";
            scmStatusBar.backgroundColor = new vscode.ThemeColor(
                "statusBarItem.warningBackground",
            );
            return;
        }

        scmStatusBar.text = "$(check) Synced";
        scmStatusBar.tooltip = "Synced";
        scmStatusBar.command = "codex-editor.scm.syncedNotification";
        scmStatusBar.backgroundColor = undefined;
    };

    syncStatus();
    setInterval(syncStatus, GIT_SYNC_EVERY);

    return [scmStatusBar, syncStatus] as const;
};
