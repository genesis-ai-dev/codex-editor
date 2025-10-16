import * as vscode from "vscode";

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
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
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
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Publish Project</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 24px;
                    line-height: 1.6;
                    margin: 0;
                }
                .container { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
                .title { font-size: 24px; font-weight: 700; margin: 0; }
                .field { display: flex; flex-direction: column; gap: 6px; }
                .label { font-size: 13px; color: var(--vscode-descriptionForeground); }
                .input, select, textarea {
                    background-color: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 6px; padding: 8px 12px; font-size: 14px; color: var(--vscode-input-foreground);
                }
                .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
                .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
                button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
                button.secondary { background-color: var(--vscode-editor-background); color: var(--vscode-foreground); border: 1px solid var(--vscode-button-border); }
                button:disabled { opacity: 0.6; cursor: not-allowed; }
                .error { color: var(--vscode-errorForeground); padding: 10px; background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 6px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1 class="title">Publish Project</h1>
                <div id="error" class="error" style="display:none;"></div>

                <div class="field">
                    <label class="label" for="name">Project name</label>
                    <input id="name" class="input" type="text" placeholder="my-project" />
                </div>

                <div class="field">
                    <label class="label" for="description">Description (optional)</label>
                    <textarea id="description" rows="3" placeholder="Short description..."></textarea>
                </div>

                <div class="row">
                    <div class="field" style="min-width: 200px; flex: 1;">
                        <label class="label" for="visibility">Visibility</label>
                        <select id="visibility">
                            <option value="private">private</option>
                            <option value="internal">internal</option>
                            <option value="public">public</option>
                        </select>
                    </div>
                </div>

                <div class="field">
                    <span class="label">Project type</span>
                    <div class="row">
                        <label><input type="radio" name="ptype" value="personal" checked /> Personal</label>
                        <label><input type="radio" name="ptype" value="group" /> Group</label>
                    </div>
                </div>

                <div class="row" id="groupRow" style="display:none;">
                    <div class="field" style="min-width: 260px; flex: 1;">
                        <label class="label" for="group">Group</label>
                        <select id="group" disabled></select>
                    </div>
                    <button id="loadGroups" class="secondary">Load Groups</button>
                </div>

                <div class="actions">
                    <button id="cancel" class="secondary">Cancel</button>
                    <button id="create" disabled>Create</button>
                </div>
            </div>

            <script>
            (function(){
                const vscode = acquireVsCodeApi();
                const nameEl = document.getElementById('name');
                const descEl = document.getElementById('description');
                const visEl = document.getElementById('visibility');
                const createEl = document.getElementById('create');
                const cancelEl = document.getElementById('cancel');
                const errEl = document.getElementById('error');
                const groupRow = document.getElementById('groupRow');
                const groupEl = document.getElementById('group');
                const loadGroupsBtn = document.getElementById('loadGroups');

                function setBusy(b){ createEl.disabled = !!b; loadGroupsBtn.disabled = !!b; }
                function setError(msg){ if(!msg){ errEl.style.display='none'; errEl.textContent=''; } else { errEl.style.display='block'; errEl.textContent = msg; } }
                function validate(){ const ok = !!nameEl.value && /^[\w.-]+$/.test(nameEl.value); createEl.disabled = !ok; }

                document.querySelectorAll('input[name="ptype"]').forEach(r => {
                    r.addEventListener('change', () => {
                        const val = document.querySelector('input[name="ptype"]:checked').value;
                        if (val === 'group') { groupRow.style.display = 'flex'; } else { groupRow.style.display = 'none'; }
                    });
                });

                loadGroupsBtn.addEventListener('click', () => {
                    vscode.postMessage({ command: 'fetchGroups' });
                });

                nameEl.addEventListener('input', validate);
                validate();

                createEl.addEventListener('click', () => {
                    setError('');
                    const type = document.querySelector('input[name="ptype"]:checked').value;
                    const gid = type === 'group' ? Number(groupEl.value) || undefined : undefined;
                    vscode.postMessage({ command: 'createProject', payload: { name: nameEl.value, description: descEl.value || undefined, visibility: visEl.value, projectType: type, groupId: gid } });
                });

                cancelEl.addEventListener('click', () => { vscode.postMessage({ command: 'cancel' }); });

                window.addEventListener('message', (event) => {
                    const m = event.data;
                    if (m.type === 'init') {
                        if (m.defaults?.name) nameEl.value = m.defaults.name;
                        if (m.defaults?.visibility) visEl.value = m.defaults.visibility;
                        validate();
                    } else if (m.type === 'busy') {
                        setBusy(m.value);
                    } else if (m.type === 'error') {
                        setError(m.message || 'An error occurred');
                    } else if (m.type === 'groups') {
                        groupEl.innerHTML = '';
                        (m.groups || []).forEach(g => {
                            const opt = document.createElement('option');
                            opt.value = String(g.id);
                            opt.textContent = g.name + ' (' + g.path + ')';
                            groupEl.appendChild(opt);
                        });
                        groupEl.disabled = !(m.groups && m.groups.length);
                    }
                });

                vscode.postMessage({ command: 'init' });
            })();
            </script>
        </body>
        </html>`;
    }
}


