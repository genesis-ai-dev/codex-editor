import * as vscode from "vscode";

export async function openSystemMessageEditor() {
    const panel = vscode.window.createWebviewPanel(
        "systemMessageEditor",
        "Edit System Message",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    // Get both workspace and user configurations
    const config = vscode.workspace.getConfiguration("translators-copilot");
    const workspaceMessage = config.inspect("chatSystemMessage")?.workspaceValue ?? "";
    const userMessage = config.inspect("chatSystemMessage")?.globalValue ?? "";

    console.log("workspaceMessage", workspaceMessage);
    panel.webview.html = getWebviewContent(workspaceMessage, userMessage);

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "save":
                await config.update(
                    "chatSystemMessage",
                    message.text,
                    message.scope === "user"
                        ? vscode.ConfigurationTarget.Global
                        : vscode.ConfigurationTarget.Workspace
                );
                vscode.window.showInformationMessage(
                    `System message updated successfully (${message.scope} settings)`
                );
                panel.dispose();
                break;
            case "cancel":
                panel.dispose();
                break;
        }
    });
}

// Helper function to generate the webview content
function getWebviewContent(workspaceMessage: string, userMessage: string) {
    return `<!DOCTYPE html>
    <html>
        <head>
            <style>
                body {
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    box-sizing: border-box;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                .tabs {
                    display: flex;
                    margin-bottom: 16px;
                    border-bottom: 1px solid var(--vscode-input-border);
                }
                .tab {
                    padding: 8px 16px;
                    cursor: pointer;
                    border: none;
                    background: none;
                    color: var(--vscode-foreground);
                    position: relative;
                }
                .tab.active {
                    color: var(--vscode-button-background);
                }
                .tab.active::after {
                    content: '';
                    position: absolute;
                    bottom: -1px;
                    left: 0;
                    right: 0;
                    height: 2px;
                    background-color: var(--vscode-button-background);
                }
                .tab-content {
                    display: none;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                }
                .tab-content.active {
                    display: flex;
                }
                textarea {
                    flex: 1;
                    margin: 16px 0;
                    padding: 12px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                    resize: none;
                }
                textarea:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                }
                .button-container {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                }
                button {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button.secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                button.secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .description {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 8px;
                }
            </style>
        </head>
        <body>
            <div class="tabs">
                <button class="tab active" onclick="switchTab('workspace')">Workspace Settings</button>
                <button class="tab" onclick="switchTab('user')">User Settings</button>
            </div>

            <div id="workspace-tab" class="tab-content active">
                <div class="description">
                    ✨ Recommended: Configure the system message for this workspace only.
                </div>
                <textarea id="workspace-input" spellcheck="false">${escapeHtml(workspaceMessage)}</textarea>
                <div class="button-container">
                    <button class="secondary" onclick="cancel()">Cancel</button>
                    <button onclick="save('workspace')">Save Workspace Settings</button>
                </div>
            </div>

            <div id="user-tab" class="tab-content">
                <div class="description">
                    Configure the default system message for all workspaces.
                </div>
                <textarea id="user-input" spellcheck="false">${escapeHtml(userMessage)}</textarea>
                <div class="button-container">
                    <button class="secondary" onclick="cancel()">Cancel</button>
                    <button onclick="save('user')">Save User Settings</button>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const workspaceInput = document.getElementById('workspace-input');
                const userInput = document.getElementById('user-input');
                let activeTab = 'workspace';

                function switchTab(tab) {
                    // Update tab buttons
                    document.querySelectorAll('.tab').forEach(t => {
                        t.classList.toggle('active', t.textContent.toLowerCase().includes(tab));
                    });

                    // Update tab content
                    document.querySelectorAll('.tab-content').forEach(content => {
                        content.classList.toggle('active', content.id === \`\${tab}-tab\`);
                    });

                    activeTab = tab;
                }

                function save(scope) {
                    const text = scope === 'user' ? userInput.value : workspaceInput.value;
                    vscode.postMessage({
                        command: 'save',
                        text,
                        scope
                    });
                }

                function cancel() {
                    vscode.postMessage({
                        command: 'cancel'
                    });
                }

                // Handle Ctrl+Enter or Cmd+Enter to save
                document.addEventListener('keydown', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        save(activeTab);
                    }
                });
            </script>
        </body>
    </html>`;
}

// Helper function to escape HTML special characters
function escapeHtml(unsafe: string) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
