import * as vscode from "vscode";
import { getWebviewHtml } from "../../utils/webviewTemplate";

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
                        this._panel.webview.postMessage({
                            type: "init",
                            defaults: {
                                name: workspaceName,
                                visibility: "private",
                            },
                        });
                        break;
                    }
                    case "fetchGroups": {
                        try {
                            this._panel.webview.postMessage({ type: "busy", value: true });
                            const groups = (await vscode.commands.executeCommand(
                                "frontier.listGroupsUserIsAtLeastMemberOf"
                            )) as GroupList[];
                            this._panel.webview.postMessage({ type: "groups", groups });
                        } catch (error) {
                            this._panel.webview.postMessage({
                                type: "error",
                                message:
                                    error instanceof Error ? error.message : String(error),
                            });
                        } finally {
                            this._panel.webview.postMessage({ type: "busy", value: false });
                        }
                        break;
                    }
                    case "createProject": {
                        try {
                            this._panel.webview.postMessage({ type: "busy", value: true });
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
                                    nonInteractive: true,
                                }
                            );

                            if (result !== false) {
                                vscode.window.showInformationMessage(
                                    "Project published successfully"
                                );
                                this.dispose();
                            }
                        } catch (error) {
                            this._panel.webview.postMessage({
                                type: "error",
                                message:
                                    error instanceof Error ? error.message : String(error),
                            });
                        } finally {
                            this._panel.webview.postMessage({ type: "busy", value: false });
                        }
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


