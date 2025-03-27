import * as vscode from "vscode";
import { callLLM } from "../utils/llmUtils";
import { CompletionConfig } from "../providers/translationSuggestions/inlineCompletionsProvider";

interface ProjectLanguage {
    tag: string;
    refName: string;
    projectStatus: string;
}

export async function openSystemMessageEditor() {
    const panel = vscode.window.createWebviewPanel(
        "systemMessageEditor",
        "AI Translation Instructions",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    // Get configurations
    const config = vscode.workspace.getConfiguration("translators-copilot");
    const workspaceMessage = (config.inspect("chatSystemMessage")?.workspaceValue as string) ?? "";

    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    const sourceLanguage = projectConfig.get("sourceLanguage") as ProjectLanguage;
    const targetLanguage = projectConfig.get("targetLanguage") as ProjectLanguage;

    panel.webview.html = getWebviewContent(workspaceMessage, sourceLanguage, targetLanguage);

    // Create message handler function that we can remove later
    const handleMessage = async (event: MessageEvent) => {
        const message = event.data;
        if (message.command === "updateInput") {
            const input = document.getElementById("input") as HTMLTextAreaElement;
            if (!input) {
                location.reload();
            } else {
                input.value = message.text;
            }
        }
    };

    // Add cleanup when panel is disposed
    panel.onDidDispose(() => {
        window.removeEventListener("message", handleMessage);
    });

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "generate":
                try {
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
                            const llmConfig: CompletionConfig = {
                                apiKey: config.get("openAIKey") || "",
                                model: config.get("model") || "gpt-4",
                                endpoint: config.get("endpoint") || "https://api.openai.com/v1",
                                maxTokens: 500,
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
                            };

                            progress.report({ message: "Preparing prompt..." });
                            const prompt = `Generate a concise, one-paragraph set of linguistic instructions critical for a linguistically informed translator to keep in mind at all times when translating from ${sourceLanguage.refName} to ${targetLanguage.refName}. Keep it to a single plaintext paragraph. Note key lexicosemantic, information structuring, register-relevant and other key distinctions necessary for grammatical, natural text in ${targetLanguage.refName} if the starting place is ${sourceLanguage.refName}`;

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
                            // Update the message and re-render the view
                            await config.update(
                                "chatSystemMessage",
                                response,
                                vscode.ConfigurationTarget.Workspace
                            );
                            panel.webview.html = getWebviewContent(
                                response,
                                sourceLanguage,
                                targetLanguage
                            );
                        }
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        "Failed to generate instructions. Please check your API configuration."
                    );
                }
                break;
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
            case "cancel":
                panel.dispose();
                break;
        }
    });
}

function getWebviewContent(
    workspaceMessage: string,
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
            </style>
        </head>
        <body>
            <div class="container">
                ${
                    hasLanguages
                        ? `
                    ${
                        workspaceMessage
                            ? `
                        <textarea id="input" spellcheck="false">${escapeHtml(workspaceMessage)}</textarea>
                        <div class="button-container">
                            <button onclick="generate()">✨ Regenerate</button>
                            <button class="secondary" onclick="cancel()">Cancel</button>
                            <button onclick="save()">Save</button>
                        </div>
                    `
                            : `
                        <button class="generate-button" onclick="generate()">✨ Generate AI Instructions</button>
                    `
                    }
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
                    vscode.postMessage({
                        command: 'save',
                        text: input.value
                    });
                }

                function cancel() {
                    vscode.postMessage({ command: 'cancel' });
                }

                function openSettings() {
                    vscode.postMessage({ command: 'generate' });
                }

                // Create message handler function that we can remove later
                const handleMessage = (event) => {
                    const message = event.data;
                    if (message.command === 'updateInput') {
                        if (!input) {
                            location.reload();
                        } else {
                            input.value = message.text;
                        }
                    }
                };

                // Add event listener
                window.addEventListener('message', handleMessage);
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
