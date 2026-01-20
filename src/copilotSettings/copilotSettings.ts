import * as vscode from "vscode";
import { callLLM } from "../utils/llmUtils";
import { CompletionConfig } from "@/utils/llmUtils";
import { MetadataManager } from "../utils/metadataManager";
import { trackWebviewPanel } from "../utils/webviewTracker";

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

let currentPanel: vscode.WebviewPanel | undefined;

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
    if (currentPanel) {
        currentPanel.reveal();
        return;
    }
    const panel = vscode.window.createWebviewPanel(
        "systemMessageEditor",
        "Copilot Settings",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );
    trackWebviewPanel(panel, "systemMessageEditor", "openSystemMessageEditor");
    currentPanel = panel;
    panel.onDidDispose(() => {
        currentPanel = undefined;
    });

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
    const workspaceMessage = await MetadataManager.getChatSystemMessage();
    const useOnlyValidatedExamples = config.get("useOnlyValidatedExamples") as boolean ?? false;
    const allowHtmlPredictions = config.get("allowHtmlPredictions") as boolean ?? false;

    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    const sourceLanguage = projectConfig.get("sourceLanguage") as ProjectLanguage;
    const targetLanguage = projectConfig.get("targetLanguage") as ProjectLanguage;

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
                const workspaceMessage = await MetadataManager.getChatSystemMessage();
                const useOnlyValidatedExamples = config.get("useOnlyValidatedExamples") as boolean ?? false;
                const allowHtmlPredictions = config.get("allowHtmlPredictions") as boolean ?? false;
                const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
                const sourceLanguage = projectConfig.get("sourceLanguage") as ProjectLanguage;
                const targetLanguage = projectConfig.get("targetLanguage") as ProjectLanguage;
                panel.webview.postMessage({
                    command: 'init',
                    data: {
                        systemMessage: workspaceMessage,
                        useOnlyValidatedExamples,
                        allowHtmlPredictions,
                        sourceLanguage,
                        targetLanguage,
                    }
                });
                break;
            }
            case "getAsrSettings": {
                try {
                    const config = vscode.workspace.getConfiguration("codex-editor-extension");
                    const settings = {
                        endpoint: config.get<string>("asrEndpoint", "wss://ryderwishart--asr-websocket-transcription-fastapi-asgi.modal.run/ws/transcribe"),
                        provider: config.get<string>("asrProvider", "mms"),
                        model: config.get<string>("asrModel", "facebook/mms-1b-all"),
                        language: config.get<string>("asrLanguage", "eng"),
                        phonetic: config.get<boolean>("asrPhonetic", false),
                    };
                    panel.webview.postMessage({ command: "asrSettings", data: settings });
                } catch (error) {
                    console.error("[CopilotSettings] Failed to get ASR settings:", error);
                    panel.webview.postMessage({ command: "asrSettings", data: {} });
                }
                break;
            }
            case "saveAsrSettings": {
                try {
                    const config = vscode.workspace.getConfiguration("codex-editor-extension");
                    const target = vscode.ConfigurationTarget.Workspace;
                    await config.update("asrEndpoint", message.data?.endpoint, target);
                    await config.update("asrProvider", message.data?.provider, target);
                    await config.update("asrModel", message.data?.model, target);
                    await config.update("asrLanguage", message.data?.language, target);
                    await config.update("asrPhonetic", !!message.data?.phonetic, target);
                    panel.webview.postMessage({ command: "asrSettingsSaved" });
                } catch (error) {
                    console.error("[CopilotSettings] Failed to save ASR settings:", error);
                    panel.webview.postMessage({ command: "asrSettingsSaved" });
                }
                break;
            }
            case "fetchAsrModels": {
                const endpoint: string | undefined = message.data?.endpoint;
                if (!endpoint) {
                    panel.webview.postMessage({ command: "asrModels", data: [] });
                    break;
                }
                try {
                    let baseUrl: URL;
                    try {
                        baseUrl = new URL(endpoint);
                    } catch (err) {
                        throw new Error(`Invalid ASR endpoint: ${endpoint}`);
                    }
                    if (baseUrl.protocol === 'wss:') baseUrl.protocol = 'https:';
                    if (baseUrl.protocol === 'ws:') baseUrl.protocol = 'http:';
                    baseUrl.pathname = '/models';
                    baseUrl.search = '';
                    const urlStr = baseUrl.toString();

                    let resText: string;
                    if (typeof (globalThis as any).fetch === 'function') {
                        const r = await (globalThis as any).fetch(urlStr);
                        resText = await r.text();
                    } else {
                        const lib = urlStr.startsWith('https') ? require('https') : require('http');
                        resText = await new Promise<string>((resolve, reject) => {
                            lib.get(urlStr, (resp: any) => {
                                let data = '';
                                resp.on('data', (chunk: any) => (data += chunk));
                                resp.on('end', () => resolve(data));
                            }).on('error', (err: any) => reject(err));
                        });
                    }
                    let models: any[] = [];
                    try {
                        const parsed = JSON.parse(resText);
                        models = Array.isArray(parsed) ? parsed : parsed?.models || [];
                    } catch {
                        models = [];
                    }
                    panel.webview.postMessage({ command: "asrModels", data: models });
                } catch (e) {
                    console.error("[CopilotSettings] Failed to fetch ASR models:", e);
                    panel.webview.postMessage({ command: "asrModels", data: [] });
                }
                break;
            }
            case "save": {
                const saveResult = await MetadataManager.setChatSystemMessage(message.text);
                if (saveResult.success) {
                    vscode.window.showInformationMessage(
                        "Translation instructions updated successfully"
                    );
                } else {
                    vscode.window.showErrorMessage(
                        `Failed to save translation instructions: ${saveResult.error}`
                    );
                }
                panel.dispose();
                break;
            }
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
                    const saveResult = await MetadataManager.setChatSystemMessage(message.text);
                    if (saveResult.success) {
                        vscode.window.showInformationMessage(
                            "Copilot settings updated successfully"
                        );
                    } else {
                        vscode.window.showErrorMessage(
                            `Failed to save translation instructions: ${saveResult.error}`
                        );
                    }
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
            case "generate": {
                try {
                    const sourceLanguage = await getProjectSourceLanguage();
                    const targetLanguage = await getProjectTargetLanguage();

                    if (!sourceLanguage?.refName || !targetLanguage?.refName) {
                        await vscode.commands.executeCommand(
                            "codex-project-manager.openProjectSettings"
                        );
                        return;
                    }

                    return vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: "Generating AI Translation Instructions",
                            cancellable: false,
                        },
                        async (progress) => {
                            progress.report({ message: "Generating instructions with AI..." });

                            const response = await generateChatSystemMessage(
                                sourceLanguage,
                                targetLanguage
                            );

                            if (!response) {
                                throw new Error("Failed to generate instructions");
                            }

                            progress.report({ message: "Updating configuration..." });

                            // Update the message and re-render the view for HTML version
                            await MetadataManager.setChatSystemMessage(response);

                            // For React webview, send the generated message
                            panel.webview.postMessage({
                                command: 'updateInput',
                                text: response
                            });
                        }
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        "Failed to generate instructions. Please check your API configuration."
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

/**
 * Generate chat system message using LLM based on source and target languages
 * @param sourceLanguage - Source language with refName property
 * @param targetLanguage - Target language with refName property
 * @param workspaceFolder - Optional workspace folder URI
 * @returns Generated system message string, or null if generation fails
 */
export async function generateChatSystemMessage(
    sourceLanguage: { refName: string; },
    targetLanguage: { refName: string; },
    workspaceFolder?: vscode.Uri
): Promise<string | null> {
    try {
        const config = vscode.workspace.getConfiguration("codex-editor-extension");
        const allowHtmlPredictions = config.get("allowHtmlPredictions") as boolean ?? false;

        const llmConfig: CompletionConfig = {
            apiKey: config.get("openAIKey") || "",
            model: "default",
            endpoint: config.get("endpoint") || "https://api.openai.com/v1",
            temperature: 0.3,
            contextSize: "2000",
            additionalResourceDirectory: "",
            contextOmission: false,
            sourceBookWhitelist: "",
            mainChatLanguage: "en",
            chatSystemMessage: "",
            numberOfFewShotExamples: 0,
            debugMode: false,
            useOnlyValidatedExamples: false,
            abTestingEnabled: false,
            allowHtmlPredictions: allowHtmlPredictions,
            fewShotExampleFormat: "source-and-target",
        };

        const htmlInstruction = allowHtmlPredictions
            ? "You may include inline HTML tags when appropriate (e.g., <span>, <i>, <b>) consistent with examples."
            : "Return plain text only (no XML/HTML).";

        const prompt = `Generate a concise, one-paragraph set of linguistic instructions critical for a linguistically informed translator to keep in mind at all times when translating from ${sourceLanguage.refName} to ${targetLanguage.refName}. Keep it to a single plaintext paragraph. Note key lexicosemantic, information structuring, register-relevant and other key distinctions necessary for grammatical, natural text in ${targetLanguage.refName} if the starting place is ${sourceLanguage.refName}. ${htmlInstruction} Preserve original line breaks from <currentTask><source> by returning text with the same number of lines separated by newline characters. Do not include XML in your answer.`;

        const response = await callLLM(
            [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            llmConfig
        );

        return response;
    } catch (error) {
        debug("[generateChatSystemMessage] Error generating message:", error);
        return null;
    }
}

async function getProjectSourceLanguage(): Promise<ProjectLanguage | null> {
    try {
        const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
        const sourceLanguage = projectConfig.get("sourceLanguage") as ProjectLanguage;

        if (!sourceLanguage) return null;

        return sourceLanguage;
    } catch (error) {
        debug("[getProjectSourceLanguage] Error:", error);
        return null;
    }
}

async function getProjectTargetLanguage(): Promise<ProjectLanguage | null> {
    try {
        const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
        const targetLanguage = projectConfig.get("targetLanguage") as ProjectLanguage;

        if (!targetLanguage) return null;

        return targetLanguage;
    } catch (error) {
        debug("[getProjectTargetLanguage] Error:", error);
        return null;
    }
}


function escapeHtml(unsafe: string) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
