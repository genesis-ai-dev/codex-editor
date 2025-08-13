import * as vscode from "vscode";
import { callLLM } from "../utils/llmUtils";
import { CompletionConfig } from "@/utils/llmUtils";

interface ProjectLanguage {
    tag: string;
    refName: string;
    projectStatus: string;
}

const DEBUG_COPILOT_SETTINGS = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_COPILOT_SETTINGS) {
        console.log(`[CopilotSettings] ${message}`, ...args);
    }
}

export async function debugValidationSetting() {
    const config = vscode.workspace.getConfiguration("codex-editor-extension");
    const useOnlyValidatedExamples = config.get("useOnlyValidatedExamples");
    const inspectResult = config.inspect("useOnlyValidatedExamples");

    debug("[debugValidationSetting] Raw config value:", useOnlyValidatedExamples);
    debug("[debugValidationSetting] Config inspect result:", inspectResult);

    vscode.window.showInformationMessage(
        `Validation Setting Debug:\n` +
        `Current value: ${useOnlyValidatedExamples}\n` +
        `Global value: ${inspectResult?.globalValue}\n` +
        `Workspace value: ${inspectResult?.workspaceValue}\n` +
        `Workspace folder value: ${inspectResult?.workspaceFolderValue}`
    );
}

export async function openSystemMessageEditor() {
    const panel = vscode.window.createWebviewPanel(
        "systemMessageEditor",
        "Copilot Settings",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            vscode.extensions.getExtension('project-accelerate.codex-editor-extension')!.extensionUri,
            'webviews', 'codex-webviews', 'dist', 'CopilotSettings', 'index.js'
        )
    );
    const codiconsUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            vscode.extensions.getExtension('project-accelerate.codex-editor-extension')!.extensionUri,
            'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'
        )
    );

    const nonce = Math.random().toString(36).slice(2);
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.extensions.getExtension('project-accelerate.codex-editor-extension')!.extensionUri] };
    panel.webview.html = `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
        <link href="${codiconsUri}" rel="stylesheet">
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;

    // Initialize state for the webview React app
    const config = vscode.workspace.getConfiguration("codex-editor-extension");
    const workspaceMessage = (config.inspect("chatSystemMessage")?.workspaceValue as string) ?? "";
    const useOnlyValidatedExamples = config.get("useOnlyValidatedExamples") as boolean ?? false;
    const allowHtmlPredictions = config.get("allowHtmlPredictions") as boolean ?? false;

    const sendInit = () => {
        panel.webview.postMessage({
            command: 'init',
            data: {
                systemMessage: workspaceMessage,
                useOnlyValidatedExamples,
                allowHtmlPredictions,
            }
        });
    };
    // Send once optimistically; will also send upon 'webviewReady'
    sendInit();

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "webviewReady": {
                // Re-send init to ensure webview receives state after it is ready
                const config = vscode.workspace.getConfiguration("codex-editor-extension");
                const workspaceMessage = (config.inspect("chatSystemMessage")?.workspaceValue as string) ?? "";
                const useOnlyValidatedExamples = config.get("useOnlyValidatedExamples") as boolean ?? false;
                const allowHtmlPredictions = config.get("allowHtmlPredictions") as boolean ?? false;
                panel.webview.postMessage({
                    command: 'init',
                    data: {
                        systemMessage: workspaceMessage,
                        useOnlyValidatedExamples,
                        allowHtmlPredictions,
                    }
                });
                break;
            }
            case "save":
                await config.update(
                    "chatSystemMessage",
                    message.text,
                    vscode.ConfigurationTarget.Workspace
                );
                vscode.window.showInformationMessage(
                    "Translation instructions updated successfully"
                );
                panel.dispose();
                break;
            case "saveSettings": {
                debug("[CopilotSettings] Saving validation setting:", message.useOnlyValidatedExamples);
                // Save validation setting
                await config.update(
                    "useOnlyValidatedExamples",
                    message.useOnlyValidatedExamples,
                    vscode.ConfigurationTarget.Workspace
                );
                // Save allow HTML predictions setting (if provided)
                if (typeof message.allowHtmlPredictions === "boolean") {
                    await config.update(
                        "allowHtmlPredictions",
                        message.allowHtmlPredictions,
                        vscode.ConfigurationTarget.Workspace
                    );
                }
                // Verify the setting was saved
                const savedValue = config.get("useOnlyValidatedExamples");
                debug("[CopilotSettings] Setting saved, current value:", savedValue);

                // Save system message if provided
                if (message.text !== undefined) {
                    await config.update(
                        "chatSystemMessage",
                        message.text,
                        vscode.ConfigurationTarget.Workspace
                    );
                    vscode.window.showInformationMessage(
                        "Copilot settings updated successfully"
                    );
                    panel.dispose();
                } else {
                    // Auto-save validation setting - show brief confirmation
                    const allowHtml = typeof message.allowHtmlPredictions === "boolean" ? message.allowHtmlPredictions : allowHtmlPredictions;
                    vscode.window.showInformationMessage(
                        `Few-shot examples will ${message.useOnlyValidatedExamples ? 'only use validated' : 'use all available'} translation pairs. HTML in AI predictions is ${allowHtml ? 'enabled' : 'disabled'}.`
                    );
                }
                break;
            }
            case "cancel":
                panel.dispose();
                break;
        }
    });
}

function getWebviewContent(
    workspaceMessage: string,
    useOnlyValidatedExamples: boolean,
    allowHtmlPredictions: boolean,
    sourceLanguage?: ProjectLanguage,
    targetLanguage?: ProjectLanguage
) {
    const hasLanguages = sourceLanguage?.refName && targetLanguage?.refName;

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
                .container {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                }
                textarea {
                    flex: 1;
                    min-height: 300px;
                    width: 100%;
                    margin: 16px 0;
                    padding: 12px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                    resize: vertical;
                    box-sizing: border-box;
                }
                textarea:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
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
                    border-radius: var(--vscode-button-border-radius, 2px);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    line-height: 1.4;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                    outline-offset: 2px;
                }
                button.secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                button.secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .message {
                    text-align: center;
                    margin: 20px;
                    padding: 20px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: var(--vscode-panel-border-radius, 4px);
                    color: var(--vscode-descriptionForeground);
                }
                .generate-button {
                    margin: 20px auto;
                    font-size: var(--vscode-font-size);
                    padding: 12px 24px;
                }
                .settings-section {
                    margin: 16px 0;
                    padding: 16px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    background-color: var(--vscode-editor-background);
                }
                .setting-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin: 12px 0;
                }
                .setting-label {
                    flex: 1;
                    margin-right: 12px;
                    font-weight: 500;
                }
                .setting-description {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 4px;
                }
                .toggle-switch {
                    position: relative;
                    display: inline-block;
                    width: 50px;
                    height: 24px;
                }
                .toggle-switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }
                .slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    transition: .4s;
                    border-radius: 24px;
                }
                .slider:before {
                    position: absolute;
                    content: "";
                    height: 18px;
                    width: 18px;
                    left: 2px;
                    top: 2px;
                    background-color: var(--vscode-editor-foreground);
                    transition: .4s;
                    border-radius: 50%;
                }
                input:checked + .slider {
                    background-color: var(--vscode-button-background);
                }
                input:checked + .slider:before {
                    transform: translateX(26px);
                }
                .section-title {
                    font-size: 1.1em;
                    font-weight: 600;
                    margin-bottom: 8px;
                    color: var(--vscode-editor-foreground);
                }
            </style>
        </head>
        <body>
            <div class="container">
                ${hasLanguages
            ? `
                    <div class="settings-section">
                        <div class="section-title">Few-Shot Learning Settings</div>
                        <div class="setting-item">
                            <div class="setting-label">
                                Use Only Validated Examples
                                <div class="setting-description">
                                    When enabled, AI will only use translation pairs that have been validated by users as examples for few-shot prompting. This ensures higher quality examples but may reduce the number of available examples.
                                </div>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="useOnlyValidatedExamples" ${useOnlyValidatedExamples ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>

                        <div class="setting-item">
                            <div class="setting-label">
                                Allow HTML in AI Predictions
                                <div class="setting-description">
                                    When enabled, the AI may output HTML (bold, italics, spans, etc.). If disabled, examples and AI outputs will be stripped to plain text before insertion.
                                </div>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="allowHtmlPredictions" ${allowHtmlPredictions ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>

                    </div>

                    <div class="settings-section">
                        <div class="section-title">System Message</div>
                        ${workspaceMessage
                ? `
                            <textarea id="input" spellcheck="false">${escapeHtml(workspaceMessage)}</textarea>
                            <div class="button-container">
                                <button onclick="generate()">✨ Regenerate</button>
                                <button class="secondary" onclick="cancel()">Cancel</button>
                                <button onclick="save()">Save All Settings</button>
                            </div>
                        `
                : `
                            <button class="generate-button" onclick="generate()">✨ Generate AI Instructions</button>
                        `
            }
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
                const input = document.getElementById('input');

                function generate() {
                    vscode.postMessage({ command: 'generate' });
                }

                function save() {
                    const validationToggle = document.getElementById('useOnlyValidatedExamples');
                    const allowHtmlToggle = document.getElementById('allowHtmlPredictions');
                    vscode.postMessage({
                        command: 'saveSettings',
                        text: input ? input.value : undefined,
                        useOnlyValidatedExamples: validationToggle ? validationToggle.checked : false,
                        allowHtmlPredictions: allowHtmlToggle ? allowHtmlToggle.checked : false
                    });
                }

                function saveValidationSetting(checked) {
                    debug('[saveValidationSetting] Auto-saving validation setting:', checked);
                    const allowHtmlToggle = document.getElementById('allowHtmlPredictions');
                    vscode.postMessage({
                        command: 'saveSettings',
                        useOnlyValidatedExamples: checked,
                        allowHtmlPredictions: allowHtmlToggle ? allowHtmlToggle.checked : false
                    });
                }

                function cancel() {
                    vscode.postMessage({ command: 'cancel' });
                }

                function openSettings() {
                    vscode.postMessage({ command: 'generate' });
                }

                // Handle messages from extension host
                window.addEventListener('message', (event) => {
                    const message = event.data;
                    if (message.command === 'updateInput') {
                        if (!input) {
                            location.reload();
                        } else {
                            input.value = message.text;
                        }
                    }
                });

                // Add validation toggle event listener with auto-save
                const validationToggle = document.getElementById('useOnlyValidatedExamples');
                if (validationToggle) {
                    validationToggle.addEventListener('change', function() {
                        console.log('Validation toggle changed:', this.checked);
                        // Auto-save when toggle changes
                        saveValidationSetting(this.checked);
                    });
                }

                const allowHtmlToggle = document.getElementById('allowHtmlPredictions');
                if (allowHtmlToggle) {
                    allowHtmlToggle.addEventListener('change', function() {
                        console.log('Allow HTML toggle changed:', this.checked);
                        // Auto-save both settings together
                        const validation = document.getElementById('useOnlyValidatedExamples');
                        vscode.postMessage({
                            command: 'saveSettings',
                            useOnlyValidatedExamples: validation ? validation.checked : false,
                            allowHtmlPredictions: this.checked
                        });
                    });
                }
            </script>
        </body>
    </html>`;
}

function escapeHtml(unsafe: string) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
