import * as vscode from "vscode";
import { promptForLocalSync } from "../scm/git";
import { registerScmStatusBar } from "../scm/statusBar";
import { syncUtils } from "../../activationHelpers/contextAware/syncUtils";

export class SourceControlProvider {
    private static scmInterval: NodeJS.Timeout | null = null;
    private static autoCommitEnabled: boolean;

    static register(context: vscode.ExtensionContext) {
        const [, syncStatus] = registerScmStatusBar(context);
        syncUtils.registerSyncCommands(context, syncStatus);

        this.initializeAutoCommit(context);

        return {
            providerRegistration: new SourceControlProvider(),
            startSyncLoop: () => this.startSyncLoop(context),
        };
    }

    private static initializeAutoCommit(context: vscode.ExtensionContext) {
        const configuration = vscode.workspace.getConfiguration(
            "codex-editor-extension.scm"
        );
        this.autoCommitEnabled = configuration.get<boolean>("autoCommit", true);

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration("codex-editor-extension.scm.autoCommit")) {
                    const updatedConfiguration = vscode.workspace.getConfiguration(
                        "codex-editor-extension.scm"
                    );
                    this.autoCommitEnabled = updatedConfiguration.get<boolean>("autoCommit", true);
                    vscode.window.showInformationMessage(
                        `Auto-commit is now ${this.autoCommitEnabled ? "enabled" : "disabled"}.`
                    );

                    if (this.autoCommitEnabled) {
                        this.startInterval();
                    } else {
                        this.stopInterval();
                    }
                }
            })
        );
    }

    private static startSyncLoop(context: vscode.ExtensionContext) {
        console.log("sync loop timer refreshed");
        const syncIntervalTime = 1000 * 60 * 15; // 15 minutes

        if (this.autoCommitEnabled) {
            this.startInterval();
        }

        const configChangeSubscription = vscode.workspace.onDidChangeConfiguration(
            (e) => {
                if (e.affectsConfiguration("codex-editor-extension.scm.remoteUrl")) {
                    syncUtils.checkConfigRemoteAndUpdateIt();
                }
            }
        );

        context.subscriptions.push(configChangeSubscription);
        setTimeout(() => {
            syncUtils.checkConfigRemoteAndUpdateIt();
        }, 3000);
    }

    private static startInterval() {
        if (!this.scmInterval) {
            this.scmInterval = setInterval(promptForLocalSync, 1000 * 60 * 15); // 15 minutes
        }
    }

    private static stopInterval() {
        if (this.scmInterval) {
            clearInterval(this.scmInterval);
            this.scmInterval = null;
        }
    }
}