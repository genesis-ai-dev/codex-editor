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
                const workspaceMessage = (config.inspect("chatSystemMessage")?.workspaceValue as string) ?? "";
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
                            progress.report({ message: "Loading configuration..." });

                            const allowHtmlPredictions = config.get("allowHtmlPredictions") as boolean ?? false;

                            const llmConfig: CompletionConfig = {
                                apiKey: config.get("openAIKey") || "",
                                model: config.get("model") || "gpt-4o",
                                endpoint: config.get("endpoint") || "https://api.openai.com/v1",
                                temperature: 0.3,
                                customModel: "",
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
                                abTestingVariants: 2,
                                allowHtmlPredictions: allowHtmlPredictions,
                            };

                            progress.report({ message: "Preparing prompt..." });

                            const htmlInstruction = allowHtmlPredictions
                                ? "You may include inline HTML tags when appropriate (e.g., <span>, <i>, <b>) consistent with examples."
                                : "Return plain text only (no XML/HTML).";

                            const prompt = `Generate a concise, one-paragraph set of linguistic instructions critical for a linguistically informed translator to keep in mind at all times when translating from ${sourceLanguage.refName} to ${targetLanguage.refName}. Keep it to a single plaintext paragraph. Note key lexicosemantic, information structuring, register-relevant and other key distinctions necessary for grammatical, natural text in ${targetLanguage.refName} if the starting place is ${sourceLanguage.refName}. ${htmlInstruction} Preserve original line breaks from <currentTask><source> by returning text with the same number of lines separated by newline characters. Do not include XML in your answer.`;

                            progress.report({ message: "Generating instructions with AI..." });
                            const response = await callLLM(
                                [
                                    {
                                        role: "user",
                                        content: prompt,
                                    },
                                ],
                                llmConfig
                            );

                            progress.report({ message: "Updating configuration..." });

                            // Update the message and re-render the view for HTML version
                            await config.update(
                                "chatSystemMessage",
                                response,
                                vscode.ConfigurationTarget.Workspace
                            );

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
