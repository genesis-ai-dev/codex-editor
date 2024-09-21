import * as vscode from "vscode";
import { promptForLocalSync } from "../scm/git";
import { registerScmStatusBar } from "../scm/statusBar";
import { syncUtils } from "../../activationHelpers/contextAware/syncUtils";

export class SourceControlProvider implements vscode.Disposable {
    private static instance: SourceControlProvider | null = null;
    private scmInterval: NodeJS.Timeout | null = null;
    private autoCommitEnabled: boolean = true;
    private disposables: vscode.Disposable[] = [];

    private constructor(private context: vscode.ExtensionContext) {
        this.initializeAutoCommit();
    }

    static register(context: vscode.ExtensionContext): SourceControlProvider {
        if (!this.instance) {
            this.instance = new SourceControlProvider(context);
        }
        return this.instance;
    }

    startSyncLoop() {
        console.log("sync loop timer refreshed");
        const syncIntervalTime = 1000 * 60 * 15; // 15 minutes

        if (this.autoCommitEnabled) {
            this.startInterval();
        }

        const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(
            (e) => {
                if (e.affectsConfiguration("codex-editor-extension.scm.remoteUrl")) {
                    syncUtils.checkConfigRemoteAndUpdateIt();
                }
            }
        );

        this.disposables.push(configChangeDisposable);
        setTimeout(() => {
            syncUtils.checkConfigRemoteAndUpdateIt();
        }, 3000);
    }

    private initializeAutoCommit() {
        const configuration = vscode.workspace.getConfiguration(
            "codex-editor-extension.scm"
        );
        this.autoCommitEnabled = configuration.get<boolean>("autoCommit", this.autoCommitEnabled);

        const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration("codex-editor-extension.scm.autoCommit")) {
                const updatedConfiguration = vscode.workspace.getConfiguration(
                    "codex-editor-extension.scm"
                );
                this.autoCommitEnabled = updatedConfiguration.get<boolean>("autoCommit", this.autoCommitEnabled);
                vscode.window.showInformationMessage(
                    `Auto-commit is now ${this.autoCommitEnabled ? "enabled" : "disabled"}.`
                );

                if (this.autoCommitEnabled) {
                    this.startInterval();
                } else {
                    this.stopInterval();
                }
            }
        });

        this.disposables.push(configChangeDisposable);
    }

    private startInterval() {
        if (!this.scmInterval) {
            this.scmInterval = setInterval(promptForLocalSync, 1000 * 60 * 15); // 15 minutes
        }
    }

    private stopInterval() {
        if (this.scmInterval) {
            clearInterval(this.scmInterval);
            this.scmInterval = null;
        }
    }

    dispose() {
        this.stopInterval();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}

// Helper function to register SCM-related functionality
export function registerSourceControl(context: vscode.ExtensionContext) {
    const [statusBarDisposable, syncStatus] = registerScmStatusBar(context);
    syncUtils.registerSyncCommands(context, syncStatus);

    const sourceControlProvider = SourceControlProvider.register(context);
    sourceControlProvider.startSyncLoop();

    context.subscriptions.push(statusBarDisposable, sourceControlProvider);

    return sourceControlProvider;
}