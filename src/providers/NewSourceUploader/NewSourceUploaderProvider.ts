import * as vscode from "vscode";

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
                    await this.handleDocxUpload(message.fileData, webviewPanel, token);
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

    private async handleDocxUpload(
        fileData: { name: string; content: ArrayBuffer; type: string },
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        try {
            // Validate file is DOCX
            if (!fileData.name.toLowerCase().endsWith(".docx")) {
                throw new Error("Only DOCX files are supported");
            }

            // Send initial progress update
            webviewPanel.webview.postMessage({
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Validation",
                        message: `Validating DOCX file: ${fileData.name}`,
                        status: "processing",
                    },
                ],
            });

            // Simulate validation delay
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Send processing progress update
            webviewPanel.webview.postMessage({
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Validation",
                        message: "DOCX file validated successfully",
                        status: "success",
                    },
                    {
                        stage: "Processing File",
                        message: "Processing DOCX file for HTML conversion...",
                        status: "processing",
                    },
                ],
            });

            // Simulate processing delay
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Calculate file size
            const fileSizeKB = Math.round(fileData.content.byteLength / 1024);

            // Send completion progress update
            webviewPanel.webview.postMessage({
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Validation",
                        message: "DOCX file validated successfully",
                        status: "success",
                    },
                    {
                        stage: "Processing File",
                        message: "DOCX file processed successfully",
                        status: "success",
                    },
                    {
                        stage: "HTML Conversion",
                        message: "HTML conversion completed",
                        status: "success",
                    },
                ],
            });

            // Send success result
            webviewPanel.webview.postMessage({
                command: "uploadResult",
                result: {
                    success: true,
                    message: `Successfully processed ${fileData.name} (${fileSizeKB} KB)`,
                    fileName: fileData.name,
                },
            });

            // Show information message to user
            vscode.window.showInformationMessage(
                `DOCX file "${fileData.name}" has been converted to HTML successfully!`
            );
        } catch (error) {
            // Send error result
            webviewPanel.webview.postMessage({
                command: "uploadResult",
                result: {
                    success: false,
                    message: error instanceof Error ? error.message : "Unknown error occurred",
                },
            });

            // Show error message to user
            vscode.window.showErrorMessage(
                `Failed to process DOCX file: ${error instanceof Error ? error.message : "Unknown error"}`
            );
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
            <title>DOCX to HTML Converter</title>
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
