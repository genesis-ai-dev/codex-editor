import * as vscode from "vscode";
import { importTranslations } from "../../projectManager/translationImporter";
import { importSourceText } from "../../projectManager/sourceTextImporter";
import { NotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { downloadBible } from "../../projectManager/projectInitializers";
import { processDownloadedBible } from "../../projectManager/sourceTextImporter";
import { initProject } from "../scm/git";
import { registerScmCommands } from "../scm/scmActionHandler";
import { SourceUploadPostMessages } from "../../../types";

function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export class SourceUploadProvider
    implements vscode.TextDocumentContentProvider, vscode.CustomTextEditorProvider
{
    public static readonly viewType = "sourceUploadProvider";
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        registerScmCommands(context);
    }

    public async resolveCustomDocument(
        document: vscode.CustomDocument,
        cancellationToken: vscode.CancellationToken
    ): Promise<void> {}

    provideTextDocumentContent(uri: vscode.Uri): string {
        return "Source Upload Provider Content";
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
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Initial load of metadata
        await this.updateMetadata(webviewPanel);

        webviewPanel.webview.onDidReceiveMessage(async (message: SourceUploadPostMessages) => {
            switch (message.command) {
                case "getMetadata":
                    await this.updateMetadata(webviewPanel);
                    break;
                case "uploadSourceText":
                    try {
                        const fileUri = await this.saveUploadedFile(
                            message.fileContent,
                            message.fileName
                        );
                        await importSourceText(this.context, fileUri);
                        vscode.window.showInformationMessage("Source text uploaded successfully.");
                        await this.updateMetadata(webviewPanel);
                    } catch (error) {
                        console.error(`Error uploading source text: ${error}`);
                        vscode.window.showErrorMessage(`Error uploading source text: ${error}`);
                    }
                    break;
                case "uploadTranslation":
                    console.log("uploadTranslation message in provider", message);
                    try {
                        const fileUri = await this.saveUploadedFile(
                            message.fileContent,
                            message.fileName
                        );
                        const metadataManager = NotebookMetadataManager.getInstance();
                        await metadataManager.loadMetadata();
                        const sourceMetadata = metadataManager.getMetadataBySourceFileName(
                            message.sourceFileName
                        );
                        if (!sourceMetadata) {
                            throw new Error("Source notebook metadata not found");
                        }
                        await importTranslations(this.context, fileUri, sourceMetadata.id);
                        vscode.window.showInformationMessage("Translation uploaded successfully.");
                        await this.updateMetadata(webviewPanel);
                    } catch (error) {
                        console.error(`Error uploading translation: ${error}`);
                        vscode.window.showErrorMessage(`Error uploading translation: ${error}`);
                    }
                    break;
                case "downloadBible":
                    try {
                        const downloadedBibleFile = await downloadBible("source");
                        if (downloadedBibleFile) {
                            await processDownloadedBible(downloadedBibleFile);
                            await this.updateCodexFiles(webviewPanel);
                            vscode.window.showInformationMessage(
                                "Bible downloaded and processed successfully."
                            );
                        }
                    } catch (error) {
                        console.error(`Error downloading Bible: ${error}`);
                        vscode.window.showErrorMessage(`Error downloading Bible: ${error}`);
                    }
                    break;
                case "syncAction":
                    await vscode.commands.executeCommand(
                        "codex.scm.handleSyncAction",
                        vscode.Uri.parse(message.fileUri),
                        message.status
                    );
                    await this.updateMetadata(webviewPanel);
                    break;
                case "openFile":
                    console.log("openFile message in provider", { message });
                    if (message.fileUri) {
                        if (
                            message.fileUri.endsWith(".source") ||
                            message.fileUri.endsWith(".codex")
                        ) {
                            await vscode.commands.executeCommand(
                                "vscode.openWith",
                                vscode.Uri.parse(message.fileUri),
                                "codex.cellEditor"
                            );
                        } else if (message.fileUri.endsWith(".dictionary")) {
                            console.log("Opening dictionary editor", { message });
                            await vscode.commands.executeCommand(
                                "vscode.openWith",
                                vscode.Uri.parse(message.fileUri),
                                "codex.dictionaryEditor"
                            );
                        } else {
                            vscode.commands.executeCommand(
                                "vscode.open",
                                vscode.Uri.parse(message.fileUri)
                            );
                        }
                    } else {
                        vscode.window.showErrorMessage("File URI is null");
                    }
                    break;
                default:
                    console.log("Unknown message command", { message });
                    break;
            }
            await this.updateMetadata(webviewPanel);
        });

        // Set up polling for metadata updates when the panel is active
        let pollingInterval: NodeJS.Timeout | undefined;

        const startPolling = () => {
            if (!pollingInterval) {
                pollingInterval = setInterval(async () => {
                    await this.updateMetadata(webviewPanel);
                }, 10000) as unknown as NodeJS.Timeout; // Poll every 10 seconds
            }
        };

        const stopPolling = () => {
            if (pollingInterval) {
                clearInterval(pollingInterval);
                pollingInterval = undefined;
            }
        };

        // Start or stop polling based on the panel's visibility
        webviewPanel.onDidChangeViewState((e) => {
            if (webviewPanel.visible) {
                startPolling();
            } else {
                stopPolling();
            }
        });

        // Start polling immediately if the panel is already visible
        if (webviewPanel.visible) {
            startPolling();
        }

        // Clean up when the panel is disposed
        webviewPanel.onDidDispose(() => {
            stopPolling();
        });
    }

    private async updateMetadata(webviewPanel: vscode.WebviewPanel) {
        const metadataManager = NotebookMetadataManager.getInstance();
        await metadataManager.loadMetadata();
        const allMetadata = metadataManager.getAllMetadata();

        const aggregatedMetadata = allMetadata.map((metadata) => ({
            id: metadata.id,
            originalName: metadata.originalName,
            sourceFsPath: metadata.sourceFsPath,
            codexFsPath: metadata.codexFsPath,
            videoUrl: metadata.videoUrl,
            lastModified: metadata.codexLastModified,
            gitStatus: metadata?.gitStatus,
        }));

        webviewPanel.webview.postMessage({
            command: "updateMetadata",
            metadata: aggregatedMetadata,
        });
    }

    private async updateCodexFiles(webviewPanel: vscode.WebviewPanel) {
        const sourceFiles = await vscode.workspace.findFiles("**/*.source");
        const targetFiles = await vscode.workspace.findFiles("**/*.codex");

        const existingSourceFiles = await this.filterExistingFiles(sourceFiles);
        const existingTargetFiles = await this.filterExistingFiles(targetFiles);

        webviewPanel.webview.postMessage({
            command: "updateCodexFiles",
            sourceFiles: existingSourceFiles.map((uri) => ({
                name: uri.fsPath.split("/").pop(),
                uri: uri.toString(),
            })),
            targetFiles: existingTargetFiles.map((uri) => ({
                name: uri.fsPath.split("/").pop(),
                uri: uri.toString(),
            })),
        });
    }

    private async filterExistingFiles(files: vscode.Uri[]): Promise<vscode.Uri[]> {
        const existingFiles: vscode.Uri[] = [];
        for (const file of files) {
            try {
                await vscode.workspace.fs.stat(file);
                existingFiles.push(file);
            } catch (error) {
                // File doesn't exist, skip it
            }
        }
        return existingFiles;
    }

    private async saveUploadedFile(content: string, fileName: string): Promise<vscode.Uri> {
        const tempDirUri = vscode.Uri.joinPath(this.context.globalStorageUri, "temp");
        await vscode.workspace.fs.createDirectory(tempDirUri);
        const fileUri = vscode.Uri.joinPath(tempDirUri, fileName);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));
        return fileUri;
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "reset.css")
        );
        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "vscode.css")
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css"
            )
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "SourceUpload",
                "index.js"
            )
        );

        const nonce = getNonce();
        return /*html*/ `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; worker-src ${webview.cspSource}; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};">
                <link href="${styleResetUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${styleVSCodeUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${codiconsUri}" rel="stylesheet" nonce="${nonce}" />
                <title>Codex Uploader</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
