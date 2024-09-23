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
        try {
            this.initializeAutoCommit();
        } catch (error) {
            console.error("Failed to initialize auto-commit:", error);
        }
    }

    static register(context: vscode.ExtensionContext): SourceControlProvider {
        if (!this.instance) {
            this.instance = new SourceControlProvider(context);
        }
        return this.instance;
    }

    startSyncLoop() {
        try {
            console.log("autoCommit sync loop timer refreshed", {
                autoCommitEnabled: this.autoCommitEnabled,
            });
            const syncIntervalTime = 1000 * 60 * 15; // 15 minutes

            if (this.autoCommitEnabled) {
                this.startInterval();
            }

            const configChangeDisposable =
                vscode.workspace.onDidChangeConfiguration((e) => {
                    if (
                        e.affectsConfiguration(
                            "codex-editor-extension.scm.remoteUrl",
                        )
                    ) {
                        syncUtils.checkConfigRemoteAndUpdateIt();
                    }
                });

            this.disposables.push(configChangeDisposable);
            setTimeout(() => {
                syncUtils.checkConfigRemoteAndUpdateIt();
            }, 3000);
        } catch (error) {
            console.error("Failed to start sync loop:", error);
        }
    }

    private initializeAutoCommit() {
        try {
            const configuration = vscode.workspace.getConfiguration(
                "codex-editor-extension.scm",
            );

            const autoCommit = configuration.get<boolean>(
                "autoCommit",
                this.autoCommitEnabled,
            );
            console.log("autoCommit", { autoCommit });
            this.autoCommitEnabled = autoCommit;

            const configChangeDisposable =
                vscode.workspace.onDidChangeConfiguration((e) => {
                    if (
                        e.affectsConfiguration(
                            "codex-editor-extension.scm.autoCommit",
                        )
                    ) {
                        try {
                            const updatedConfiguration =
                                vscode.workspace.getConfiguration(
                                    "codex-editor-extension.scm",
                                );
                            const updatedAutoCommit =
                                updatedConfiguration.get<boolean>(
                                    "autoCommit",
                                    this.autoCommitEnabled,
                                );

                            console.log("autoCommit", { updatedAutoCommit });
                            this.autoCommitEnabled = updatedAutoCommit;
                            vscode.window.showInformationMessage(
                                `Auto-commit is now ${
                                    this.autoCommitEnabled
                                        ? "enabled"
                                        : "disabled"
                                }.`,
                            );

                            if (this.autoCommitEnabled) {
                                this.startInterval();
                            } else {
                                this.stopInterval();
                            }
                        } catch (error) {
                            console.error(
                                "Failed to update auto-commit configuration:",
                                error,
                            );
                        }
                    }
                });

            this.disposables.push(configChangeDisposable);
        } catch (error) {
            console.error(
                "Failed to initialize auto-commit configuration:",
                error,
            );
        }
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
        this.disposables.forEach((d) => d.dispose());
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
