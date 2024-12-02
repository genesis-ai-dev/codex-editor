import * as vscode from "vscode";
import { SourceCellVersions, TranslationPair } from "../../../types";

// Local type definitions
interface AssistantMessage {
    role: "assistant";
    content: string;
    thinking: string;
    translation: string;
    memoriesUsed: { memory: string }[];
    addMemory: { memory: string };
}

async function simpleOpen(uri: string) {
    try {
        const parsedUri = vscode.Uri.parse(uri);
        if (parsedUri.toString().includes(".codex")) {
            // jumpToCellInNotebook(context, uri.toString(), 0);
            vscode.window.showErrorMessage(
                "Note: you need to pass the cellId to updateWorkspaceState for the cell with the content you want to open"
            );
        }
    } catch (error) {
        console.error(`Failed to open file: ${uri}`, error);
    }
}

async function openFileAtLocation(uri: string, cellId: string) {
    try {
        const parsedUri = vscode.Uri.parse(uri);
        const stringUri = parsedUri.toString();
        // This is a quick fix to open the correct uri.
        if (stringUri.includes(".codex") || stringUri.includes(".source")) {
            await vscode.commands.executeCommand("vscode.openWith", parsedUri, "codex.cellEditor");
            // After opening the file, we need to navigate to the specific cell
            // This might require an additional step or command
            // For example:
            // await vscode.commands.executeCommand("codex.navigateToCell", cellId);
        }
    } catch (error) {
        console.error(`Failed to open file: ${uri}`, error);
        vscode.window.showErrorMessage(`Failed to open file: ${uri}`);
    }
}

async function handleChatStream(
    webviewView: vscode.WebviewView,
    cellIds: string[],
    query: string,
    editIndex?: number
) {
    try {
        const result = await vscode.commands.executeCommand(
            "codex-smart-edits.chatStream",
            cellIds,
            query,
            (chunk: string | object) => {
                let parsedChunk;
                if (typeof chunk === "string") {
                    try {
                        parsedChunk = JSON.parse(chunk);
                    } catch (error) {
                        console.error("Error parsing chunk:", error);
                        parsedChunk = { index: -1, content: chunk, isLast: false };
                    }
                } else if (typeof chunk === "object" && chunk !== null) {
                    parsedChunk = chunk;
                } else {
                    console.error("Unexpected chunk format:", chunk);
                    return;
                }

                // Check if the chunk contains session info
                if (parsedChunk.sessionInfo) {
                    webviewView.webview.postMessage({
                        command: "updateSessionInfo",
                        data: parsedChunk.sessionInfo,
                    });
                } else {
                    webviewView.webview.postMessage({
                        command: "chatResponseStream",
                        data: JSON.stringify(parsedChunk),
                    });
                }

                // No need to handle isLast here as the frontend will process it accordingly
            },
            editIndex
        );

        // Handle the result if needed
        console.log("Chat stream completed:", result);
    } catch (error) {
        console.error("Error in chat stream:", error);
        webviewView.webview.postMessage({
            command: "chatResponseStream",
            data: JSON.stringify({
                index: -1,
                content: `Error: Failed to process chat request. ${
                    error instanceof Error ? error.message : "Unknown error"
                }`,
                isLast: true,
            }),
        });
    }
}

const loadWebviewHtml = (webviewView: vscode.WebviewView, extensionUri: vscode.Uri) => {
    webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [extensionUri],
    };

    const styleResetUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "reset.css")
    );
    const styleVSCodeUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "src", "assets", "vscode.css")
    );
    const codiconsUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css")
    );

    const scriptUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "ParallelView",
            "index.js"
        )
    );
    function getNonce() {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
    const nonce = getNonce();
    // FIXME: the api base url below is hardcoded to localhost:3002. This should probably be dynamic at least.
    const html = /*html*/ `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <!--
      Use a content security policy to only allow loading images from https or from our extension directory,
      and only allow scripts that have a specific nonce.
    -->
    <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${
        webviewView.webview.cspSource
    }; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleResetUri}" rel="stylesheet">
    <link href="${styleVSCodeUri}" rel="stylesheet">
    <link href="${codiconsUri}" rel="stylesheet">
    <script nonce="${nonce}">
    //   const vscode = acquireVsCodeApi();
    const apiBaseUrl = ${JSON.stringify("http://localhost:3002")}
    </script>
    </head>
    <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
  </html>`;

    webviewView.webview.html = html;
};

export class CustomWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(private readonly _context: vscode.ExtensionContext) {}

    public get webviewView(): vscode.WebviewView | undefined {
        return this._view;
    }

    public async pinCellById(cellId: string, retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 300; // milliseconds

        // First, ensure the webview is visible
        console.log("pinCellByIdProvider", cellId);
        await vscode.commands.executeCommand("parallel-passages-sidebar.focus");

        // Wait for the webview to be ready
        if (!this._view && retryCount < maxRetries) {
            console.log(`Webview not ready, retrying (${retryCount + 1}/${maxRetries})...`);
            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve(this.pinCellById(cellId, retryCount + 1));
                }, retryDelay);
            });
        }

        if (this._view) {
            // Get the translation pair for this cell
            let translationPair = await vscode.commands.executeCommand<TranslationPair>(
                "translators-copilot.getTranslationPairFromProject",
                cellId
            );

            if (!translationPair) {
                // If no translation pair is found, get only the source text
                const sourceCell = await vscode.commands.executeCommand(
                    "translators-copilot.getSourceCellByCellIdFromAllSourceCells",
                    cellId
                );

                if (sourceCell) {
                    // Create a new translation pair with empty target text
                    translationPair = {
                        cellId: cellId,
                        sourceCell: sourceCell,
                        targetCell: {
                            cellId: cellId,
                            content: "",
                            // Add any other required properties for targetCell with default values
                        },
                        // Add any other required properties for translationPair with default values
                    };
                } else {
                    console.error(`No source cell found for cell: ${cellId}`);
                    return;
                }
            }

            console.log("translationPair", translationPair);

            this._view.webview.postMessage({
                command: "pinCell",
                data: translationPair,
            });
        } else {
            vscode.window.showErrorMessage("Failed to open parallel passages view");
        }
    }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        loadWebviewHtml(webviewView, this._context.extensionUri);

        webviewView.webview.onDidReceiveMessage(async (message: any) => {
            switch (message.command) {
                case "openFileAtLocation":
                    await openFileAtLocation(message.uri, message.word);
                    break;
                case "chatStream":
                    await handleChatStream(
                        webviewView,
                        message.context,
                        message.query,
                        message.editIndex
                    );
                    break;
                case "applyTranslation":
                    console.log("applyTranslation", message);
                    await vscode.commands.executeCommand(
                        "codex-cell-editor.updateCellContent",
                        message.cellId,
                        message.translation
                    );
                    break;

                case "addedFeedback":
                    console.log("addedFeedback", message.feedback, message.cellId);
                    await vscode.commands.executeCommand(
                        "codex-smart-edits.updateFeedback",
                        message.cellId,
                        message.feedback
                    );
                    break;
                case "search":
                    try {
                        const command = message.completeOnly
                            ? "translators-copilot.searchParallelCells"
                            : "translators-copilot.searchAllCells";

                        const results = await vscode.commands.executeCommand<TranslationPair[]>(
                            command,
                            message.query,
                            15 // k value
                        );
                        if (results) {
                            webviewView.webview.postMessage({
                                command: "searchResults",
                                data: results,
                            });
                        }
                    } catch (error) {
                        console.error("Error searching cells:", error);
                    }
                    break;
                case "deleteChatSession":
                    await vscode.commands.executeCommand(
                        "codex-smart-edits.deleteChatSession",
                        message.sessionId
                    );
                    break;
                case "startNewChatSession":
                    try {
                        const sessionInfo = await vscode.commands.executeCommand(
                            "codex-smart-edits.startNewChatSession"
                        );
                        webviewView.webview.postMessage({
                            command: "updateSessionInfo",
                            data: sessionInfo,
                        });
                    } catch (error) {
                        console.error("Error starting new chat session:", error);
                    }
                    break;

                case "getCurrentChatSessionInfo":
                    try {
                        const sessionInfo = await vscode.commands.executeCommand(
                            "codex-smart-edits.getCurrentChatSessionInfo"
                        );
                        webviewView.webview.postMessage({
                            command: "updateSessionInfo",
                            data: sessionInfo,
                        });
                    } catch (error) {
                        console.error("Error getting current chat session info:", error);
                    }
                    break;

                case "getAllChatSessions":
                    try {
                        const sessions = await vscode.commands.executeCommand(
                            "codex-smart-edits.getAllChatSessions"
                        );
                        webviewView.webview.postMessage({
                            command: "updateAllSessions",
                            data: sessions,
                        });
                    } catch (error) {
                        console.error("Error getting all chat sessions:", error);
                    }
                    break;

                case "loadChatSession":
                    try {
                        const result = await vscode.commands.executeCommand(
                            "codex-smart-edits.loadChatSession",
                            message.sessionId
                        );
                        if (
                            result &&
                            typeof result === "object" &&
                            "sessionInfo" in result &&
                            "messages" in result
                        ) {
                            const { sessionInfo, messages } = result;
                            webviewView.webview.postMessage({
                                command: "loadedSessionData",
                                data: { sessionInfo, messages },
                            });
                        } else {
                            console.error("Unexpected result format from loadChatSession");
                        }
                    } catch (error) {
                        console.error("Error loading chat session:", error);
                    }
                    break;
                default:
                    console.error(`Unknown command: ${message.command}`);
            }
        });
    }
}

export function registerParallelViewWebviewProvider(context: vscode.ExtensionContext) {
    const provider = new CustomWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("parallel-passages-sidebar", provider),
        vscode.commands.registerCommand("parallelPassages.pinCellById", async (cellId: string) => {
            await provider.pinCellById(cellId);
        }),
        vscode.commands.registerCommand(
            "parallelPassages.requestTranslation",
            async (cellId: string, sourceText: string) => {
                if (provider.webviewView) {
                    provider.webviewView.webview.postMessage({
                        command: "requestTranslation",
                        data: { cellId, sourceText },
                    });
                } else {
                    vscode.commands.executeCommand("parallel-passages-sidebar.focus");
                    // Wait for the webview to be ready
                    setTimeout(() => {
                        if (provider.webviewView) {
                            provider.webviewView.webview.postMessage({
                                command: "requestTranslation",
                                data: { cellId, sourceText },
                            });
                        } else {
                            console.error("Webview is not available after retry");
                        }
                    }, 100);
                }
            }
        )
    );
}
