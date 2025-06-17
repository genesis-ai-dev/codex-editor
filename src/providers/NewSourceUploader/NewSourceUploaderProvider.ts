import * as vscode from "vscode";
import { NewSourceUploaderPostMessages } from "@newSourceUploaderTypes";
import { getWebviewHtml } from "../../utils/webviewTemplate";
import { safePostMessageToPanel } from "../../utils/webviewUtils";
import { createNoteBookPair } from "./codexFIleCreateUtils";
import { CodexCellTypes } from "../../../types/enums";
import { NotebookPreview } from "@types";

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
        return { uri, dispose: () => { } };
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
                safePostMessageToPanel(webviewPanel, {
                    command: "error",
                    error: error instanceof Error ? error.message : "Unknown error occurred",
                });
            }
        });
    }

    private async handleMessage(
        message: NewSourceUploaderPostMessages,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        switch (message.command) {
            case "uploadFile":
                if (message.fileData) {
                    await this.handlePluginUpload(message.fileData, webviewPanel, token);
                }
                break;
            case "reset":
                // Handle reset command
                safePostMessageToPanel(webviewPanel, {
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

    private async handlePluginUpload(
        fileData: NewSourceUploaderPostMessages["fileData"],
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        try {
            if (!fileData) {
                throw new Error("No file data provided");
            }

            // Send initial progress update
            safePostMessageToPanel(webviewPanel, {
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Processing",
                        message: `Processing ${fileData.name} with ${fileData.importerType}`,
                        status: "processing",
                    },
                ],
            });

            const fileName = fileData.name.split(".")[0].replace(/\s+/g, "-");

            // Check if this is a repository download with multiple notebooks
            const isRepositoryDownload = fileData.metadata?.allSourceNotebooks && fileData.metadata?.allCodexNotebooks;

            if (isRepositoryDownload) {
                // Handle multiple notebooks for repository downloads
                const sourceNotebooks: NotebookPreview[] = fileData.metadata.allSourceNotebooks.map((notebook: any) => ({
                    name: notebook.name,
                    cells: notebook.cells.map((cell: any) => ({
                        kind: vscode.NotebookCellKind.Code,
                        value: cell.content,
                        languageId: cell.language || "html",
                        metadata: {
                            id: cell.id,
                            type: CodexCellTypes.TEXT,
                            data: cell.metadata,
                        },
                    })),
                    metadata: {
                        id: notebook.metadata.id || notebook.name.toLowerCase().replace(/\s+/g, "-"),
                        textDirection: "ltr",
                        navigation: [],
                        videoUrl: "",
                        originalName: notebook.name,
                        sourceFsPath: "",
                        codexFsPath: "",
                        sourceCreatedAt: new Date().toISOString(),
                        corpusMarker: fileData.importerType,
                        ...notebook.metadata,
                    },
                }));

                const codexNotebooks: NotebookPreview[] = fileData.metadata.allCodexNotebooks.map((notebook: any) => ({
                    name: notebook.name,
                    cells: notebook.cells.map((cell: any) => ({
                        kind: vscode.NotebookCellKind.Code,
                        value: cell.content,
                        languageId: cell.language || "html",
                        metadata: {
                            id: cell.id,
                            type: CodexCellTypes.TEXT,
                            data: cell.metadata,
                        },
                    })),
                    metadata: {
                        id: notebook.metadata.id || notebook.name.toLowerCase().replace(/\s+/g, "-"),
                        textDirection: "ltr",
                        navigation: [],
                        videoUrl: "",
                        originalName: notebook.name,
                        sourceFsPath: "",
                        codexFsPath: "",
                        sourceCreatedAt: new Date().toISOString(),
                        corpusMarker: fileData.importerType,
                        ...notebook.metadata,
                    },
                }));

                // Create multiple notebook pairs
                await createNoteBookPair({
                    token,
                    sourceNotebooks: sourceNotebooks,
                    codexNotebooks: codexNotebooks,
                });
            } else {
                // Handle single notebook upload
                const sourceNotebook: NotebookPreview = {
                    name: fileName,
                    cells: fileData.notebookPair.source.cells.map((cell: any) => ({
                        kind: vscode.NotebookCellKind.Code,
                        value: cell.content,
                        languageId: cell.language || "html",
                        metadata: {
                            id: cell.id,
                            type: CodexCellTypes.TEXT,
                            data: cell.metadata,
                        },
                    })),
                    metadata: {
                        id: fileName,
                        textDirection: "ltr",
                        navigation: [],
                        videoUrl: "",
                        originalName: fileData.name,
                        sourceFsPath: "",
                        codexFsPath: "",
                        sourceCreatedAt: new Date().toISOString(),
                        corpusMarker: fileData.importerType,
                        ...fileData.notebookPair.source.metadata,
                    },
                };

                const codexNotebook: NotebookPreview = {
                    name: fileName,
                    cells: fileData.notebookPair.codex.cells.map((cell: any) => ({
                        kind: vscode.NotebookCellKind.Code,
                        value: cell.content,
                        languageId: cell.language || "html",
                        metadata: {
                            id: cell.id,
                            type: CodexCellTypes.TEXT,
                            data: cell.metadata,
                        },
                    })),
                    metadata: {
                        id: fileName,
                        textDirection: "ltr",
                        navigation: [],
                        videoUrl: "",
                        originalName: fileData.name,
                        sourceFsPath: "",
                        codexFsPath: "",
                        sourceCreatedAt: new Date().toISOString(),
                        corpusMarker: fileData.importerType,
                        ...fileData.notebookPair.codex.metadata,
                    },
                };

                // Create single notebook pair
                await createNoteBookPair({
                    token,
                    sourceNotebooks: [sourceNotebook],
                    codexNotebooks: [codexNotebook],
                });
            }

            // Send processing progress update
            safePostMessageToPanel(webviewPanel, {
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Processing",
                        message: "Creating notebook files...",
                        status: "processing",
                    },
                ],
            });

            // Force reindex to ensure new files are recognized
            await vscode.commands.executeCommand("codex-editor-extension.forceReindex");

            // Send completion progress update
            safePostMessageToPanel(webviewPanel, {
                command: "progressUpdate",
                progress: [
                    {
                        stage: "File Processing",
                        message: "Notebook files created successfully",
                        status: "success",
                    },
                    {
                        stage: "Indexing",
                        message: "Reindexing workspace...",
                        status: "success",
                    },
                ],
            });

            // Send success result
            const notebookCount = isRepositoryDownload ?
                fileData.metadata?.allSourceNotebooks?.length || 1 : 1;

            safePostMessageToPanel(webviewPanel, {
                command: "uploadResult",
                result: {
                    success: true,
                    message: `Successfully imported ${fileData.name} using ${fileData.importerType}${isRepositoryDownload ? ` (${notebookCount} stories)` : ''}`,
                    fileName: fileData.name,
                },
            });

            // Show information message to user
            vscode.window.showInformationMessage(
                `File "${fileData.name}" has been imported successfully using ${fileData.importerType}!${isRepositoryDownload ? ` Created ${notebookCount} story notebooks.` : ''
                }`
            );
        } catch (error) {
            // Send error result
            safePostMessageToPanel(webviewPanel, {
                command: "uploadResult",
                result: {
                    success: false,
                    message: error instanceof Error ? error.message : "Unknown error occurred",
                },
            });

            // Show error message to user
            vscode.window.showErrorMessage(
                `Failed to import file: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        return getWebviewHtml(webview, this.context, {
            title: "Source File Importer",
            scriptPath: ["NewSourceUploader", "index.js"],
            csp: `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-\${nonce}'; img-src data: https:; connect-src https: http:;`,
            inlineStyles: "#root { height: 100vh; width: 100vw; overflow-y: auto; }",
            customScript: "window.vscodeApi = acquireVsCodeApi();"
        });
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
