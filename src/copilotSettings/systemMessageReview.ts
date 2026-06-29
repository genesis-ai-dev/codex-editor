import * as vscode from "vscode";
import { MetadataManager } from "../utils/metadataManager";
import { generateChatSystemMessage } from "./copilotSettings";

type ReviewReason = "sourceLanguageChanged" | "targetLanguageChanged" | "both";

interface ProjectLanguage {
    tag?: string;
    refName?: string;
    projectStatus?: string;
}

// Track a single open panel so repeated language changes (e.g. user picks
// source then target back-to-back) don't spawn duplicate review windows.
let currentPanel: vscode.WebviewPanel | undefined;
let currentReason: ReviewReason | undefined;

function escapeRefName(name: string | undefined): string {
    return name ?? "your project";
}

async function readLanguagesFromMetadata(
    workspaceFolder: vscode.Uri
): Promise<{ source?: ProjectLanguage; target?: ProjectLanguage; }> {
    try {
        const metadataUri = vscode.Uri.joinPath(workspaceFolder, "metadata.json");
        const content = await vscode.workspace.fs.readFile(metadataUri);
        const metadata = JSON.parse(content.toString());
        const source = metadata.languages?.find(
            (l: any) => l?.projectStatus === "source"
        ) as ProjectLanguage | undefined;
        const target = metadata.languages?.find(
            (l: any) => l?.projectStatus === "target"
        ) as ProjectLanguage | undefined;
        return { source, target };
    } catch {
        return {};
    }
}

async function autoRegenerateAfterClose(
    workspaceFolder: vscode.Uri,
    reason: ReviewReason
): Promise<void> {
    const { source, target } = await readLanguagesFromMetadata(workspaceFolder);
    if (!source?.refName || !target?.refName) {
        vscode.window.showWarningMessage(
            "You changed your project's language. Please review your AI translation instructions to make sure they match."
        );
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Regenerating AI translation instructions",
            cancellable: false,
        },
        async () => {
            const generated = await generateChatSystemMessage(
                { refName: source.refName! },
                { refName: target.refName! },
                workspaceFolder
            );
            if (!generated) {
                vscode.window.showWarningMessage(
                    `You changed your project's language to ${escapeRefName(
                        reason === "sourceLanguageChanged" ? source.refName : target.refName
                    )}, but the AI translation instructions could not be regenerated automatically. Please update them in Copilot Settings.`
                );
                return;
            }
            const saveResult = await MetadataManager.setChatSystemMessage(
                generated,
                workspaceFolder
            );
            if (saveResult.success) {
                vscode.window.showInformationMessage(
                    "Your AI translation instructions were regenerated to match the new language."
                );
            } else {
                vscode.window.showWarningMessage(
                    `Generated new AI translation instructions but could not save them: ${saveResult.error}`
                );
            }
        }
    );
}

function buildWebviewHtml(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): string {
    const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "SystemMessageReview",
            "index.js"
        )
    );
    const codiconsUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "out",
            "node_modules",
            "@vscode",
            "codicons",
            "dist",
            "codicon.css"
        )
    );
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
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
}

/**
 * Opens the system-message review panel after a project source/target language change.
 *
 * The user must either save (after editing or regenerating), explicitly dismiss
 * with "I don't need to change this", or close the panel. If the panel is closed
 * without the user addressing the prompt, the AI translation instructions are
 * regenerated automatically so they don't get left in a stale state.
 */
export async function openSystemMessageReview(reason: ReviewReason): Promise<void> {
    const extension = vscode.extensions.getExtension(
        "project-accelerate.codex-editor-extension"
    );
    if (!extension) {
        console.warn("[SystemMessageReview] Codex extension not found; cannot open panel.");
        return;
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }
    const workspaceFolder = workspaceFolders[0].uri;

    // If a review panel is already open, just reveal it and update the reason
    // to "both" if it's a different category than before.
    if (currentPanel) {
        if (currentReason && currentReason !== reason) {
            currentReason = "both";
            currentPanel.webview.postMessage({
                command: "init",
                data: await buildInitData(workspaceFolder, currentReason),
            });
        }
        currentPanel.reveal(vscode.ViewColumn.One);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        "systemMessageReview",
        "Review AI Translation Instructions",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [extension.extensionUri],
        }
    );
    currentPanel = panel;
    currentReason = reason;

    panel.webview.html = buildWebviewHtml(panel, extension.extensionUri);

    let addressed = false;

    const sendInit = async () => {
        panel.webview.postMessage({
            command: "init",
            data: await buildInitData(workspaceFolder, currentReason ?? reason),
        });
    };

    // Send optimistically; also resend on webviewReady.
    sendInit();

    const messageSub = panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "webviewReady": {
                await sendInit();
                break;
            }
            case "systemMessage.generate": {
                try {
                    const { source, target } = await readLanguagesFromMetadata(workspaceFolder);
                    if (!source?.refName || !target?.refName) {
                        panel.webview.postMessage({
                            command: "systemMessage.generateError",
                            error: "Source and target languages must be set before generating system message",
                        });
                        break;
                    }
                    const generated = await generateChatSystemMessage(
                        { refName: source.refName },
                        { refName: target.refName },
                        workspaceFolder
                    );
                    if (!generated) {
                        panel.webview.postMessage({
                            command: "systemMessage.generateError",
                            error: "Failed to generate system message. Please check your API configuration.",
                        });
                        break;
                    }
                    const saveResult = await MetadataManager.setChatSystemMessage(
                        generated,
                        workspaceFolder
                    );
                    if (!saveResult.success) {
                        console.warn(
                            "[SystemMessageReview] Generated system message but failed to save:",
                            saveResult.error
                        );
                    }
                    addressed = true;
                    panel.webview.postMessage({
                        command: "systemMessage.generated",
                        message: generated,
                    });
                } catch (error) {
                    console.error("[SystemMessageReview] Error generating system message:", error);
                    panel.webview.postMessage({
                        command: "systemMessage.generateError",
                        error:
                            error instanceof Error
                                ? error.message
                                : "Failed to generate system message",
                    });
                }
                break;
            }
            case "systemMessage.save": {
                try {
                    if (typeof message.message !== "string") {
                        panel.webview.postMessage({
                            command: "systemMessage.saveError",
                            error: "Invalid message format",
                        });
                        break;
                    }
                    const saveResult = await MetadataManager.setChatSystemMessage(
                        message.message,
                        workspaceFolder
                    );
                    if (saveResult.success) {
                        addressed = true;
                        panel.webview.postMessage({ command: "systemMessage.saved" });
                        panel.dispose();
                    } else {
                        panel.webview.postMessage({
                            command: "systemMessage.saveError",
                            error: saveResult.error || "Failed to save system message",
                        });
                    }
                } catch (error) {
                    console.error("[SystemMessageReview] Error saving system message:", error);
                    panel.webview.postMessage({
                        command: "systemMessage.saveError",
                        error:
                            error instanceof Error
                                ? error.message
                                : "Failed to save system message",
                    });
                }
                break;
            }
            case "systemMessage.dismiss": {
                addressed = true;
                vscode.window.showWarningMessage(
                    "You have changed your project's language. Please make sure that the translation instructions match!"
                );
                panel.dispose();
                break;
            }
            default:
                break;
        }
    });

    panel.onDidDispose(async () => {
        messageSub.dispose();
        const wasAddressed = addressed;
        const reasonAtClose = currentReason ?? reason;
        currentPanel = undefined;
        currentReason = undefined;
        if (!wasAddressed) {
            // User closed the panel without addressing the prompt — auto-regenerate.
            await autoRegenerateAfterClose(workspaceFolder, reasonAtClose);
        }
    });
}

async function buildInitData(
    workspaceFolder: vscode.Uri,
    reason: ReviewReason
): Promise<{
    systemMessage: string;
    sourceLanguage: ProjectLanguage | undefined;
    targetLanguage: ProjectLanguage | undefined;
    reason: ReviewReason;
}> {
    const systemMessage = await MetadataManager.getChatSystemMessage(workspaceFolder);
    const { source, target } = await readLanguagesFromMetadata(workspaceFolder);
    return {
        systemMessage,
        sourceLanguage: source,
        targetLanguage: target,
        reason,
    };
}
