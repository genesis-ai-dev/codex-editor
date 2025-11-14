import * as vscode from "vscode";
import { getWebviewHtml } from "../../utils/webviewTemplate";
import { safePostMessageToPanel } from "../../utils/webviewUtils";
import { GlobalProvider } from "../../globalProvider";

export interface GroupList {
    id: number;
    name: string;
    path: string;
}

export class PublishProjectView {
    public static currentPanel: PublishProjectView | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly context: vscode.ExtensionContext,
    ) {
        this._panel = panel;

        this._updateWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible) {
                    this._updateWebview();
                }
            },
            null,
            this._disposables
        );

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case "init": {
                        const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || "";
                        safePostMessageToPanel(this._panel, {
                            type: "init",
                            defaults: {
                                name: workspaceName,
                                visibility: "private",
                            },
                        }, "PublishProject");
                        break;
                    }
                    case "fetchGroups": {
                        try {
                            safePostMessageToPanel(this._panel, { type: "busy", value: true }, "PublishProject");
                            const groups = (await vscode.commands.executeCommand(
                                "frontier.listGroupsUserIsAtLeastMemberOf"
                            )) as GroupList[];
                            safePostMessageToPanel(this._panel, { type: "groups", groups }, "PublishProject");
                        } catch (error) {
                            safePostMessageToPanel(this._panel, {
                                type: "error",
                                message:
                                    error instanceof Error ? error.message : String(error),
                            }, "PublishProject");
                        } finally {
                            // In case the panel was disposed during the async work, this will no-op safely
                            safePostMessageToPanel(this._panel, { type: "busy", value: false }, "PublishProject");
                        }
                        break;
                    }
                    case "createProject": {
                        await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: "Publishing Project",
                                cancellable: false,
                            },
                            async (progress) => {
                                try {
                                    // Initial progress message
                                    progress.report({
                                        increment: 0,
                                        message: "Publishing in progress. Please wait...",
                                    });

                                    safePostMessageToPanel(this._panel, { type: "busy", value: true }, "PublishProject");
                                    const payload = message.payload as {
                                        name: string;
                                        description?: string;
                                        visibility: "private" | "internal" | "public";
                                        projectType: "personal" | "group";
                                        groupId?: number;
                                    };

                                    const result = await vscode.commands.executeCommand(
                                        "frontier.publishWorkspace",
                                        {
                                            name: payload.name,
                                            description: payload.description,
                                            visibility: payload.visibility,
                                            groupId:
                                                payload.projectType === "group"
                                                    ? payload.groupId
                                                    : undefined,
                                            force: true,
                                        }
                                    );

                                    if (result !== false) {
                                        // Notify Main Menu to refresh state so repoHasRemote updates immediately
                                        try {
                                            const mainMenuProvider = GlobalProvider.getInstance().getProvider("codex-editor.mainMenu");
                                            await (mainMenuProvider as any)?.receiveMessage({ command: "refreshState" });
                                        } catch (e) {
                                            console.debug("[PublishProject] Failed to request Main Menu refresh:", e);
                                        }

                                        // Final completion message
                                        progress.report({
                                            increment: 100,
                                            message: "Project published successfully",
                                        });

                                        // Brief delay to show completion before closing
                                        await new Promise(resolve => setTimeout(resolve, 1500));

                                        vscode.window.showInformationMessage(
                                            "Project published successfully"
                                        );
                                        this.dispose();
                                    }
                                } catch (error) {
                                    safePostMessageToPanel(this._panel, {
                                        type: "error",
                                        message:
                                            error instanceof Error ? error.message : String(error),
                                    }, "PublishProject");
                                } finally {
                                    // If the panel has been disposed (e.g., after success), this will safely no-op
                                    safePostMessageToPanel(this._panel, { type: "busy", value: false }, "PublishProject");
                                }
                            }
                        );
                        break;
                    }
                    case "cancel": {
                        this.dispose();
                        break;
                    }
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(
        context: vscode.ExtensionContext,
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (PublishProjectView.currentPanel) {
            PublishProjectView.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            "frontierPublishProject",
            "Publish Project",
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, "media"),
                    context.extensionUri,
                    vscode.Uri.joinPath(context.extensionUri, "webviews", "codex-webviews", "dist"),
                ],
            }
        );

        PublishProjectView.currentPanel = new PublishProjectView(
            panel,
            context,
        );
    }

    public dispose() {
        PublishProjectView.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }

    private _updateWebview() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        return getWebviewHtml(this._panel.webview, this.context, {
            title: "Publish Project",
            scriptPath: ["PublishProject", "index.js"],
        });
    }
}


