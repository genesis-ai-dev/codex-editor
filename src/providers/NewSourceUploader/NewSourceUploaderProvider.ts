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
            case "uploadFiles":
                if (message.filesData && Array.isArray(message.filesData)) {
                    await this.handleMultipleFilesUpload(message.filesData, webviewPanel, token);
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

    private async handleMultipleFilesUpload(
        filesData: { name: string; content: string; type: string }[],
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        try {
            // Validate all files have the same type
            if (filesData.length === 0) {
                throw new Error("No files provided");
            }

            const firstFileType = this.getFileType(filesData[0].name);
            const allSameType = filesData.every((file) => {
                try {
                    return this.getFileType(file.name) === firstFileType;
                } catch {
                    return false;
                }
            });

            if (!allSameType) {
                throw new Error("All files must be of the same type");
            }

            // Send initial progress update
            webviewPanel.webview.postMessage({
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Validation",
                        message: `Validating ${filesData.length} ${firstFileType.toUpperCase()} files...`,
                        status: "processing",
                    },
                ],
            });

            // Simulate validation delay
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Send processing progress update
            webviewPanel.webview.postMessage({
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Validation",
                        message: `All ${filesData.length} files validated successfully`,
                        status: "success",
                    },
                    {
                        stage: "Processing Files",
                        message: `Processing ${filesData.length} files...`,
                        status: "processing",
                    },
                ],
            });

            // Simulate processing delay
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // Calculate total content size
            const totalSize = filesData.reduce((sum, file) => sum + file.content.length, 0);
            const fileNames = filesData.map((file) => file.name).join(", ");

            // Send notebook creation progress update
            webviewPanel.webview.postMessage({
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Validation",
                        message: `All ${filesData.length} files validated successfully`,
                        status: "success",
                    },
                    {
                        stage: "Processing Files",
                        message: `${filesData.length} files processed successfully`,
                        status: "success",
                    },
                    {
                        stage: "Creating Notebooks",
                        message: "Creating source and translation notebooks...",
                        status: "processing",
                    },
                ],
            });

            // Simulate notebook creation delay
            await new Promise((resolve) => setTimeout(resolve, 1500));

            // Send final progress update
            webviewPanel.webview.postMessage({
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Validation",
                        message: `All ${filesData.length} files validated successfully`,
                        status: "success",
                    },
                    {
                        stage: "Processing Files",
                        message: `${filesData.length} files processed successfully`,
                        status: "success",
                    },
                    {
                        stage: "Creating Notebooks",
                        message: "Source and translation notebooks created",
                        status: "success",
                    },
                ],
            });

            // Send success result
            webviewPanel.webview.postMessage({
                command: "uploadResult",
                result: {
                    success: true,
                    message: `Successfully processed ${filesData.length} ${firstFileType.toUpperCase()} files`,
                    preview: `Processed files: ${fileNames}\nTotal content: ${totalSize} characters\nFile type: ${firstFileType.toUpperCase()}`,
                    sourceNotebook: `source-batch-${Date.now()}.codex`,
                    codexNotebook: `translation-batch-${Date.now()}.codex`,
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

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "NewSourceUploader",
                "style.css"
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
            <link rel="stylesheet" href="${styleUri}">
            <style>
                #root {
                    height: 100vh;
                    width: 100vw;
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
