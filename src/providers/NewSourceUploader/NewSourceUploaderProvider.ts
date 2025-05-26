import * as vscode from "vscode";
import { FileType } from "../../../types/index.d";

export class NewSourceUploaderProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = "newSourceUploaderProvider";

    constructor(private readonly context: vscode.ExtensionContext) {
        // Constructor simplified for now
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        webviewPanel.webview.onDidReceiveMessage(async (message: any) => {
            try {
                await this.handleMessage(message, webviewPanel, token);
            } catch (error) {
                console.error("Error handling message:", error);
                webviewPanel.webview.postMessage({
                    command: "error",
                    error: error instanceof Error ? error.message : "Unknown error occurred",
                });
            }
        });
    }

    private async handleMessage(
        message: any,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        switch (message.command) {
            case "uploadFile":
                if (message.fileData) {
                    await this.handleSingleFileUpload(message.fileData, webviewPanel, token);
                }
                break;
            case "reset":
                // Handle reset command
                webviewPanel.webview.postMessage({
                    command: "uploadResult",
                    result: null,
                });
                break;
            case "getProgress":
                // Handle progress requests
                break;
            default:
                console.warn("Unhandled message command:", message.command);
        }
    }

    private async handleSingleFileUpload(
        fileData: { name: string; content: string; type: string },
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        try {
            // Send progress update
            webviewPanel.webview.postMessage({
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Validation",
                        message: "Checking file format...",
                        status: "processing",
                    },
                ],
            });

            const fileType = this.getFileType(fileData.name);

            // Simulate processing for now
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Send progress update
            webviewPanel.webview.postMessage({
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Validation",
                        message: "File format validated",
                        status: "success",
                    },
                    {
                        stage: "Processing",
                        message: "Processing file content...",
                        status: "processing",
                    },
                ],
            });

            // Simulate processing result
            const result = {
                preview: `Processed ${fileData.name} (${fileType}) with ${fileData.content.length} characters`,
                sourceNotebook: `source-${fileData.name}.codex`,
                codexNotebook: `codex-${fileData.name}.codex`,
            };

            // Send final progress update
            webviewPanel.webview.postMessage({
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Validation",
                        message: "File format validated",
                        status: "success",
                    },
                    {
                        stage: "Processing",
                        message: "File processed successfully",
                        status: "success",
                    },
                    {
                        stage: "Notebooks Created",
                        message: "Source and codex notebooks created",
                        status: "success",
                    },
                ],
            });

            // Send success result
            webviewPanel.webview.postMessage({
                command: "uploadResult",
                result: {
                    success: true,
                    message: `Successfully processed ${fileData.name}`,
                    preview: result.preview || "File processed successfully",
                    sourceNotebook: result.sourceNotebook,
                    codexNotebook: result.codexNotebook,
                },
            });
        } catch (error) {
            // Send error result
            webviewPanel.webview.postMessage({
                command: "uploadResult",
                result: {
                    success: false,
                    message: error instanceof Error ? error.message : "Unknown error occurred",
                },
            });
        }
    }

    private getFileType(fileName: string): FileType {
        const extension = fileName.split(".").pop()?.toLowerCase();
        switch (extension) {
            case "csv":
                return "csv";
            case "tsv":
                return "tsv";
            case "txt":
                return "plaintext";
            case "vtt":
                return "subtitles";
            case "usfm":
            case "sfm":
                return "usfm";
            case "usx":
                return "usx";
            case "codex":
                return "codex";
            default:
                throw new Error(`Unsupported file extension: ${extension}`);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        // Get path to the NewSourceUploader webview built files
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "NewSourceUploader",
                "index.js"
            )
        );

        // Use a nonce to only allow specific scripts to be run
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>New Source Uploader</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    height: 100vh;
                    width: 100vw;
                    overflow: hidden;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-font-family);
                }
                
                #root {
                    height: 100%;
                    width: 100%;
                    overflow-y: auto;
                }
            </style>
        </head>
        <body>
            <div id="root"></div>
            <script nonce="${nonce}">
                // Setup communication with extension - acquire API once and make it global
                window.vscodeApi = acquireVsCodeApi();
            </script>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }

    private getNonce(): string {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
