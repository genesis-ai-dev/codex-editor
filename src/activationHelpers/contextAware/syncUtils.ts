import * as vscode from "vscode";
import { addRemote, checkConfigRemoteAndUpdateIt, stageAndCommit, sync } from "../../providers/scm/git";

export const syncUtils = {
    registerSyncCommands(context: vscode.ExtensionContext, syncStatus: any) { // FIXME: what type is sync status??
        context.subscriptions.push(
            vscode.commands.registerCommand("codex-editor.scm.stageAndCommitAll", async () => {
                await stageAndCommit();
                await syncStatus();
            }),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand("codex-editor.scm.addRemote", async () => {
                const remoteUrl = await vscode.window.showInputBox({
                    prompt: "Enter the remote URL to add",
                    placeHolder: "Remote URL",
                });

                if (remoteUrl) {
                    await addRemote(remoteUrl);
                }

                await syncStatus();
            }),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand("codex-editor.scm.sync", async () => {
                await sync();
                await syncStatus();
            }),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand("codex-editor.scm.syncedNotification", async () => {
                vscode.window.showInformationMessage("Project is synced");
            }),
        );
    },

    checkConfigRemoteAndUpdateIt,
};

