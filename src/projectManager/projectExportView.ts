import * as vscode from "vscode";

export async function openProjectExportView(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        "projectExportView",
        "Export Project",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    // Get project configuration
    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    const sourceLanguage = projectConfig.get("sourceLanguage");
    const targetLanguage = projectConfig.get("targetLanguage");

    // Get codicon CSS URI
    const codiconsUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            context.extensionUri,
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css"
        )
    );

    panel.webview.html = getWebviewContent(sourceLanguage, targetLanguage, codiconsUri);

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "export":
                try {
                    await vscode.commands.executeCommand(
                        `codex-editor-extension.exportCodexContent`,
                        { format: message.format, options: message.options }
                    );
                    panel.dispose();
                } catch (error) {
                    vscode.window.showErrorMessage(
                        "Failed to export project. Please check your configuration."
                    );
                }
                break;
            case "cancel":
                panel.dispose();
                break;
        }
    });
}

function getWebviewContent(sourceLanguage?: any, targetLanguage?: any, codiconsUri?: vscode.Uri) {
    const hasLanguages = sourceLanguage?.refName && targetLanguage?.refName;

    return `<!DOCTYPE html>
    <html>
        <head>
            <link href="${codiconsUri}" rel="stylesheet" />
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
                .container {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }
                .format-option {
                    padding: 16px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .format-option:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .format-option.selected {
                    border-color: var(--vscode-focusBorder);
                    background-color: var(--vscode-list-activeSelectionBackground);
                }
                .button-container {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    margin-top: 16px;
                }
                button {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: 1px solid transparent;
                    border-radius: 2px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                button.secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                .message {
                    text-align: center;
                    margin: 20px;
                    padding: 20px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div class="container">
                ${
                    hasLanguages
                        ? `
                    <h3>Select Export Format</h3>
                    <div class="format-option" data-format="plaintext">
                        <i class="codicon codicon-file-text"></i>
                        <div>
                            <strong>Plaintext</strong>
                            <p>Export as plain text files with minimal formatting</p>
                        </div>
                    </div>
                    <div class="format-option" data-format="usfm">
                        <i class="codicon codicon-file-code"></i>
                        <div>
                            <strong>USFM</strong>
                            <p>Export in Universal Standard Format Markers</p>
                        </div>
                    </div>
                    <div class="button-container">
                        <button class="secondary" onclick="cancel()">Cancel</button>
                        <button id="exportButton" disabled onclick="exportProject()">Export</button>
                    </div>
                    `
                        : `
                    <div class="message">
                        Please set source and target languages first
                        <div class="button-container" style="justify-content: center">
                            <button onclick="openSettings()">Open Project Settings</button>
                        </div>
                    </div>
                    `
                }
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let selectedFormat = null;

                // Add click handlers to format options
                document.querySelectorAll('.format-option').forEach(option => {
                    option.addEventListener('click', () => {
                        document.querySelectorAll('.format-option').forEach(opt => opt.classList.remove('selected'));
                        option.classList.add('selected');
                        selectedFormat = option.dataset.format;
                        document.getElementById('exportButton').disabled = !selectedFormat;
                    });
                });

                function exportProject() {
                    if (!selectedFormat) return;
                    vscode.postMessage({
                        command: 'export',
                        format: selectedFormat,
                        options: {} // Add any additional options here
                    });
                }

                function cancel() {
                    vscode.postMessage({ command: 'cancel' });
                }

                function openSettings() {
                    vscode.postMessage({ command: 'generate' });
                }
            </script>
        </body>
    </html>`;
}
