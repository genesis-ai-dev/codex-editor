import * as vscode from "vscode";
import { importTranslations } from "../../projectManager/translationImporter";
import { NotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { importSourceText } from "../../projectManager/sourceTextImporter";
import { registerScmCommands } from "../scm/scmActionHandler";
import {
    CodexNotebookAsJSONData,
    NotebookPreview,
    SourceUploadPostMessages,
    SourceUploadResponseMessages,
    ValidationResult,
} from "../../../types/index";
import path from "path";
import { SourceFileValidator } from "../../validation/sourceFileValidator";
import { SourceImportTransaction } from "../../transactions/SourceImportTransaction";
import { getFileType } from "../../utils/fileTypeUtils";
import { analyzeSourceContent } from "../../utils/contentAnalyzers";
import { TranslationImportTransaction } from "../../transactions/TranslationImportTransaction";
import { DownloadBibleTransaction } from "../../transactions/DownloadBibleTransaction";
import { ProgressManager } from "../../utils/progressManager";
import { ExtendedMetadata } from "../../utils/ebible/ebibleCorpusUtils";

// Add new types for workflow status tracking
interface ProcessingStatus {
    fileValidation: boolean;
    folderCreation: boolean;
    metadataSetup: boolean;
    importComplete: boolean;
}

// Add new interface for source preview
interface SourcePreview {
    fileName: string;
    fileSize: number;
    fileType: string;
    expectedBooks: Array<{
        name: string;
        versesCount: number;
        chaptersCount: number;
    }>;
    validationResults: ValidationResult[];
}

interface ImportProgress {
    stage: string;
    message: string;
    percent: number;
}

// Add new type for combined preview states
type PreviewState =
    | {
          type: "source";
          preview: {
              original: {
                  preview: string;
                  validationResults: ValidationResult[];
              };
              transformed: {
                  sourceNotebooks: Array<NotebookPreview>;
                  codexNotebooks: Array<NotebookPreview>;
                  validationResults: ValidationResult[];
              };
          };
      }
    | {
          type: "translation";
          preview: {
              original: {
                  preview: string;
                  validationResults: ValidationResult[];
              };
              transformed: {
                  sourceNotebook: {
                      name: string;
                      cells: Array<{
                          value: string;
                          metadata: { id: string; type: string };
                      }>;
                  };
                  targetNotebook: {
                      name: string;
                      cells: Array<{
                          value: string;
                          metadata: { id: string; type: string };
                      }>;
                  };
                  matchedCells: number;
                  unmatchedContent: number;
                  paratextItems: number;
                  validationResults: ValidationResult[];
              };
          };
      };

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
    private currentPreview: PreviewState | null = null;
    private currentSourceTransaction: SourceImportTransaction | null = null;
    private currentTranslationTransaction: TranslationImportTransaction | null = null;
    private currentDownloadBibleTransaction: DownloadBibleTransaction | null = null;
    public availableCodexFiles: vscode.Uri[] = [];

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
            try {
                switch (message.command) {
                    case "getMetadata":
                        await this.updateMetadata(webviewPanel);
                        break;
                    case "uploadSourceText": {
                        try {
                            if (Array.isArray(message.files)) {
                                await this.handleMultipleSourceImports(
                                    webviewPanel,
                                    message.files,
                                    _token
                                );
                            } else {
                                // const tempUri = await this.saveUploadedFile(
                                //     message.files[0].content,
                                //     message.files[0].name
                                // );

                                // const transaction = new SourceImportTransaction(
                                //     tempUri,
                                //     this.context
                                // );
                                // this.currentSourceTransaction = transaction;

                                // // Get the raw preview from transaction
                                // const rawPreview = await transaction.prepare();

                                // // Transform it into our PreviewState format
                                // const preview: PreviewState = {
                                //     type: "source",
                                //     preview: {
                                //         original: {
                                //             preview: rawPreview.originalContent.preview,
                                //             validationResults:
                                //                 rawPreview.originalContent.validationResults,
                                //         },
                                //         transformed: {
                                //             sourceNotebooks:
                                //                 rawPreview.transformedContent.sourceNotebooks,
                                //             codexNotebooks:
                                //                 rawPreview.transformedContent.codexNotebooks,
                                //             validationResults:
                                //                 rawPreview.transformedContent.validationResults,
                                //         },
                                //     },
                                // };

                                // // Store the preview
                                // this.currentPreview = preview;

                                // // Send preview to webview
                                // webviewPanel.webview.postMessage({
                                //     command: "sourcePreview",
                                //     preview,
                                // } as SourceUploadResponseMessages);
                                vscode.window.showInformationMessage(
                                    `Received upload request for single file: ${message.files[0]}`
                                );
                            }
                        } catch (error) {
                            console.error("Error preparing source import:", error);
                            webviewPanel.webview.postMessage({
                                command: "error",
                                message:
                                    error instanceof Error
                                        ? error.message
                                        : "Unknown error occurred",
                            } as SourceUploadResponseMessages);
                        }
                        break;
                    }
                    case "uploadTranslation":
                        await this.handleMultipleTranslationImports(
                            webviewPanel,
                            message.files,
                            _token
                        );
                        // try {
                        //     const tempUri = await this.saveUploadedFile(
                        //         message.fileContent,
                        //         message.fileName
                        //     );

                        //     const transaction = new TranslationImportTransaction(
                        //         tempUri,
                        //         message.sourceId,
                        //         this.context
                        //     );
                        //     this.currentTranslationTransaction = transaction; // Ensure this is set

                        //     // Generate preview
                        //     const rawPreview = await transaction.prepare();

                        //     // Transform to PreviewState format
                        //     const preview: PreviewState = {
                        //         type: "translation",
                        //         preview: {
                        //             original: {
                        //                 preview: rawPreview.original.preview,
                        //                 validationResults: rawPreview.original.validationResults,
                        //             },
                        //             transformed: rawPreview.transformed,
                        //         },
                        //     };

                        //     // Store the preview
                        //     this.currentPreview = preview;

                        //     // Send preview to webview
                        //     webviewPanel.webview.postMessage({
                        //         command: "translationPreview",
                        //         preview,
                        //     } as SourceUploadResponseMessages);
                        // } catch (error: any) {
                        //     console.error("Error preparing translation import:", error);
                        //     webviewPanel.webview.postMessage({
                        //         command: "error",
                        //         message: error instanceof Error ? error.message : "Unknown error",
                        //     } as SourceUploadResponseMessages);
                        // }
                        break;
                    case "downloadBible":
                        try {
                            if (!message.ebibleMetadata) {
                                throw new Error("No Bible metadata provided");
                            }
                            // Debug the incoming message
                            console.log("Download Bible message:", {
                                metadata: message.ebibleMetadata,
                                asTranslationOnly: message.asTranslationOnly,
                                fullMessage: message,
                            });

                            // Ensure we're explicitly passing the boolean value
                            const asTranslationOnly = Boolean(message.asTranslationOnly);

                            await this.handleBibleDownload(
                                webviewPanel,
                                message.ebibleMetadata,
                                asTranslationOnly
                            );
                        } catch (error) {
                            console.error("Error downloading Bible:", error);
                            webviewPanel.webview.postMessage({
                                command: "error",
                                message: error instanceof Error ? error.message : "Unknown error",
                            } as SourceUploadResponseMessages);
                        }
                        break;
                    case "confirmBibleDownload":
                        try {
                            if (this.currentDownloadBibleTransaction) {
                                console.log("confirmBibleDownload", {
                                    message,
                                    transaction: this.currentDownloadBibleTransaction,
                                });
                                await this.executeBibleDownload(webviewPanel);
                            }
                        } catch (error) {
                            this.currentDownloadBibleTransaction = null;
                            console.error("Bible download error:", error);
                            webviewPanel.webview.postMessage({
                                command: "error",
                                message: error instanceof Error ? error.message : "Unknown error",
                            } as SourceUploadResponseMessages);
                        }
                        break;
                    case "cancelBibleDownload":
                        try {
                            const transaction = message.transaction as DownloadBibleTransaction;
                            await transaction.rollback();
                            webviewPanel.webview.postMessage({
                                command: "bibleDownloadCancelled",
                            } as SourceUploadResponseMessages);
                        } catch (error) {
                            console.error("Bible download cancellation error:", error);
                            webviewPanel.webview.postMessage({
                                command: "error",
                                message: error instanceof Error ? error.message : "Unknown error",
                            } as SourceUploadResponseMessages);
                        }
                        break;
                    // case "syncAction":
                    //     await vscode.commands.executeCommand(
                    //         "codex.scm.handleSyncAction",
                    //         vscode.Uri.parse(message.fileUri),
                    //         message.status
                    //     );
                    //     await this.updateMetadata(webviewPanel);
                    //     break;
                    // case "openFile":
                    //     console.log("openFile message in provider", { message });
                    //     if (message.fileUri) {
                    //         const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
                    //         if (!workspaceUri) {
                    //             vscode.window.showErrorMessage("No workspace folder found");
                    //             return;
                    //         }

                    //         let fullUri: vscode.Uri;
                    //         if (message.fileUri.startsWith("file://")) {
                    //             fullUri = vscode.Uri.parse(message.fileUri);
                    //         } else {
                    //             fullUri = vscode.Uri.joinPath(workspaceUri, message.fileUri);
                    //         }

                    //         if (
                    //             fullUri.path.endsWith(".source") ||
                    //             fullUri.path.endsWith(".codex")
                    //         ) {
                    //             await vscode.commands.executeCommand(
                    //                 "vscode.openWith",
                    //                 fullUri,
                    //                 "codex.cellEditor"
                    //             );
                    //         } else if (fullUri.path.endsWith(".dictionary")) {
                    //             console.log("Opening dictionary editor", { message });
                    //             await vscode.commands.executeCommand(
                    //                 "vscode.openWith",
                    //                 fullUri,
                    //                 "codex.dictionaryEditor"
                    //             );
                    //         } else {
                    //             vscode.commands.executeCommand("vscode.open", fullUri);
                    //         }
                    //     } else {
                    //         vscode.window.showErrorMessage("File URI is null");
                    //     }
                    //     break;
                    case "createSourceFolder": {
                        if (message.data?.sourcePath) {
                            await this.handleSourceFileSetup(webviewPanel, message.data.sourcePath);
                        }
                        break;
                    }
                    case "selectSourceFile": {
                        try {
                            const fileUri = await vscode.window.showOpenDialog({
                                canSelectFiles: true,
                                canSelectFolders: false,
                                canSelectMany: false,
                                filters: {
                                    "Text Files": ["txt", "usfm", "usx", "xml"],
                                    "All Files": ["*"],
                                },
                            });

                            if (fileUri && fileUri[0]) {
                                webviewPanel.webview.postMessage({
                                    command: "sourceFileSelected",
                                    data: { path: fileUri[0].fsPath },
                                } as SourceUploadResponseMessages);
                            }
                        } catch (error) {
                            console.error("Error selecting source file:", error);
                            webviewPanel.webview.postMessage({
                                command: "error",
                                message: "Failed to select source file",
                            } as SourceUploadResponseMessages);
                        }
                        break;
                    }
                    case "importRemoteTranslation":
                    case "importLocalTranslation": {
                        try {
                            const isRemote = message.command === "importRemoteTranslation";
                            // Handle translation import based on format and location
                            // This will be implemented in the future
                            webviewPanel.webview.postMessage({
                                command: "error",
                                message: `${
                                    isRemote ? "Remote" : "Local"
                                } translation import not yet implemented`,
                            } as SourceUploadResponseMessages);
                        } catch (error: any) {
                            console.error("Error importing translation:", error);
                            webviewPanel.webview.postMessage({
                                command: "error",
                                message: `Failed to import translation: ${error.message}`,
                            } as SourceUploadResponseMessages);
                        }
                        break;
                    }
                    case "closePanel":
                        webviewPanel.dispose();
                        break;
                    case "previewSourceText": {
                        // Create temporary file and start transaction
                        const tempUri = await this.saveUploadedFile(
                            message.fileContent,
                            message.fileName
                        );

                        // Create new import transaction
                        this.currentSourceTransaction = new SourceImportTransaction(
                            tempUri,
                            this.context
                        );

                        // Generate and send preview
                        const preview = await this.generateSourcePreview(tempUri);
                        webviewPanel.webview.postMessage({
                            command: "sourcePreview",
                            preview,
                        });
                        break;
                    }
                    case "confirmSourceImport": {
                        if (!this.currentSourceTransaction) {
                            throw new Error("No active source import transaction");
                        }

                        await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: "Importing source text",
                                cancellable: true,
                            },
                            async (progress, token) => {
                                try {
                                    const progressCallback = (update: {
                                        message?: string;
                                        increment?: number;
                                    }) => {
                                        progress.report(update);
                                        // Send both the stage status and progress update
                                        webviewPanel.webview.postMessage({
                                            command: "updateProcessingStatus",
                                            status: {
                                                [update.message || "processing"]: "active",
                                            },
                                            progress: {
                                                message: update.message || "",
                                                increment: update.increment || 0,
                                            },
                                        } as SourceUploadResponseMessages);
                                    };

                                    token.onCancellationRequested(() => {
                                        if (this.currentSourceTransaction) {
                                            this.currentSourceTransaction.rollback();
                                        }
                                        webviewPanel.webview.postMessage({
                                            command: "error",
                                            message: "Operation cancelled",
                                        } as SourceUploadResponseMessages);
                                    });

                                    if (this.currentSourceTransaction) {
                                        await this.currentSourceTransaction.execute(
                                            { report: progressCallback },
                                            token
                                        );
                                    }

                                    // Mark all stages as complete
                                    webviewPanel.webview.postMessage({
                                        command: "updateProcessingStatus",
                                        status: {
                                            fileValidation: "complete",
                                            transformation: "complete",
                                            sourceNotebook: "complete",
                                            targetNotebook: "complete",
                                            metadataSetup: "complete",
                                        },
                                    } as SourceUploadResponseMessages);

                                    // Send completion message
                                    webviewPanel.webview.postMessage({
                                        command: "importComplete",
                                    } as SourceUploadResponseMessages);

                                    // Update metadata after successful import
                                    await this.updateMetadata(webviewPanel);
                                } catch (error) {
                                    if (this.currentSourceTransaction) {
                                        await this.currentSourceTransaction.rollback();
                                    }
                                    throw error;
                                } finally {
                                    this.currentSourceTransaction = null;
                                }
                            }
                        );
                        break;
                    }
                    case "cancelSourceImport": {
                        if (this.currentSourceTransaction) {
                            await this.currentSourceTransaction.rollback();
                            this.currentSourceTransaction = null;
                            webviewPanel.webview.postMessage({
                                command: "importCancelled",
                            } as SourceUploadResponseMessages);
                        }
                        break;
                    }
                    case "getAvailableCodexFiles": {
                        const metadataManager = new NotebookMetadataManager();
                        await metadataManager.initialize();
                        const codexFiles = metadataManager
                            .getAllMetadata()
                            .filter((meta) => meta.codexFsPath)
                            // .sort((a, b) => a.codexLastModified - b.codexLastModified) // FIXME:
                            .map((meta) => ({
                                id: meta.id,
                                name: meta.originalName || path.basename(meta.codexFsPath!),
                                path: meta.codexFsPath!,
                            }));
                        this.availableCodexFiles = codexFiles.map((f) => vscode.Uri.file(f.path));

                        webviewPanel.webview.postMessage({
                            command: "availableCodexFiles",
                            files: codexFiles,
                        } as SourceUploadResponseMessages);
                        break;
                    }

                    case "confirmTranslationImport":
                        if (!this.currentTranslationTransaction) {
                            throw new Error("No active translation import transaction");
                        }

                        await vscode.window.withProgress(
                            {
                                location: vscode.ProgressLocation.Notification,
                                title: "Importing translation",
                                cancellable: true,
                            },
                            async (progress, token) => {
                                try {
                                    const progressCallback = (update: {
                                        message?: string;
                                        increment?: number;
                                    }) => {
                                        progress.report(update);
                                        webviewPanel.webview.postMessage({
                                            command: "updateProcessingStatus",
                                            status: {
                                                [update.message || "processing"]: "active",
                                            },
                                            progress: {
                                                message: update.message || "",
                                                increment: update.increment || 0,
                                            },
                                        } as SourceUploadResponseMessages);
                                    };

                                    await this.currentTranslationTransaction?.execute(
                                        { report: progressCallback },
                                        token
                                    );

                                    webviewPanel.webview.postMessage({
                                        command: "importComplete",
                                    } as SourceUploadResponseMessages);

                                    await this.updateMetadata(webviewPanel);
                                } catch (error) {
                                    if (this.currentTranslationTransaction) {
                                        await this.currentTranslationTransaction.rollback();
                                    }
                                    throw error;
                                } finally {
                                    this.currentTranslationTransaction = null;
                                }
                            }
                        );
                        break;

                    case "cancelTranslationImport":
                        if (this.currentTranslationTransaction) {
                            await this.currentTranslationTransaction.rollback();
                            this.currentTranslationTransaction = null;
                        }
                        break;

                    case "auth.status":
                    case "auth.login":
                    case "auth.signup":
                        await this.handleAuthenticationMessage(webviewPanel, message);
                        break;

                    default:
                        console.log("Unknown message command", { message });
                        break;
                }
            } catch (error) {
                const errorMessage =
                    error instanceof Error ? error.message : "Unknown error occurred";
                console.error("Error handling message:", error);
                webviewPanel.webview.postMessage({
                    command: "error",
                    message: errorMessage,
                } as SourceUploadResponseMessages);
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

        // // Start polling immediately if the panel is already visible
        if (webviewPanel.visible) {
            startPolling();
        }

        // Clean up when the panel is disposed
        webviewPanel.onDidDispose(() => {
            stopPolling();
        });
    }

    private async updateMetadata(webviewPanel: vscode.WebviewPanel) {
        const metadataManager = new NotebookMetadataManager();
        await metadataManager.initialize();
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
                name: path.basename(uri.fsPath),
                uri: uri.toString(),
            })),
            targetFiles: existingTargetFiles.map((uri) => ({
                name: path.basename(uri.fsPath),
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

    private async handleSourceFileSetup(webviewPanel: vscode.WebviewPanel, sourcePath: string) {
        const validator = new SourceFileValidator();

        try {
            const sendStatus = (
                status: Record<string, "pending" | "active" | "complete" | "error">
            ) => {
                webviewPanel.webview.postMessage({
                    command: "updateProcessingStatus",
                    status,
                } as SourceUploadResponseMessages);
            };

            // Update processing status
            sendStatus({ fileValidation: "active" });

            // Validate file
            const sourceUri = vscode.Uri.parse(sourcePath);
            const validationResult = await validator.validateSourceFile(sourceUri);
            if (!validationResult.isValid) {
                throw new Error(
                    `Validation failed: ${validationResult.errors.map((e) => e.message).join(", ")}`
                );
            }

            sendStatus({
                fileValidation: "complete",
                folderCreation: "active",
            });

            // Import the source text
            await importSourceText(this.context, sourceUri);

            sendStatus({
                fileValidation: "complete",
                folderCreation: "complete",
                metadataSetup: "complete",
                importComplete: "complete",
            });

            // Signal completion
            webviewPanel.webview.postMessage({
                command: "setupComplete",
                data: { path: sourcePath },
            } as SourceUploadResponseMessages);

            // Update metadata after successful import
            await this.updateMetadata(webviewPanel);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
            console.error("Error in source file setup:", error);
            webviewPanel.webview.postMessage({
                command: "error",
                message: `Failed to setup source file: ${errorMessage}`,
            } as SourceUploadResponseMessages);
            throw error;
        }
    }

    // New method to generate preview
    private async generateSourcePreview(fileUri: vscode.Uri): Promise<PreviewState> {
        const validator = new SourceFileValidator();
        const validation = await validator.validateSourceFile(fileUri);

        const fileStat = await vscode.workspace.fs.stat(fileUri);
        const fileType = getFileType(fileUri);
        const content = await vscode.workspace.fs.readFile(fileUri);
        const textContent = new TextDecoder().decode(content);
        const expectedBooks = await analyzeSourceContent(fileUri, textContent);

        this.currentPreview = {
            type: "source",
            preview: {
                original: {
                    preview: textContent,
                    validationResults: [validation],
                },
                transformed: {
                    sourceNotebooks: [],
                    codexNotebooks: [],
                    validationResults: [validation],
                },
            },
        };

        return this.currentPreview;
    }

    // private async handleSourceImport(
    //     webviewPanel: vscode.WebviewPanel,
    //     fileUri: vscode.Uri,
    //     token: vscode.CancellationToken
    // ): Promise<void> {
    //     const transaction = new SourceImportTransaction(fileUri, this.context);

    //     try {
    //         // Prepare and show preview
    //         const preview = await transaction.prepare();
    //         webviewPanel.webview.postMessage({
    //             command: "preview",
    //             preview,
    //         });

    //         // Wait for user confirmation
    //         const confirmed = await this.awaitConfirmation(webviewPanel);
    //         if (!confirmed) {
    //             await transaction.rollback();
    //             return;
    //         }

    //         // Execute with progress
    //         await vscode.window.withProgress(
    //             {
    //                 location: { viewId: "sourceUpload" },
    //                 cancellable: true,
    //             },
    //             async (progress, token) => {
    //                 // Forward progress to webview
    //                 const progressCallback = (p: { message?: string; increment?: number }) => {
    //                     webviewPanel.webview.postMessage({
    //                         command: "progress",
    //                         progress: p,
    //                     });
    //                     progress.report(p);
    //                 };

    //                 token.onCancellationRequested(() => {
    //                     transaction.rollback();
    //                     webviewPanel.webview.postMessage({
    //                         command: "error",
    //                         error: "Operation cancelled",
    //                     });
    //                 });

    //                 await transaction.execute({ report: progressCallback }, token);
    //             }
    //         );

    //         webviewPanel.webview.postMessage({ command: "complete" });
    //     } catch (error) {
    //         await transaction.rollback();
    //         webviewPanel.webview.postMessage({
    //             command: "error",
    //             error: error instanceof Error ? error.message : "Unknown error occurred",
    //         });
    //         throw error;
    //     }
    // }

    private async awaitConfirmation(webviewPanel: vscode.WebviewPanel): Promise<boolean> {
        return new Promise((resolve) => {
            const messageHandler = (message: any) => {
                if (message.command === "confirmSourceSetup") {
                    webviewPanel.webview.onDidReceiveMessage(messageHandler);
                    resolve(message.confirmed);
                }
            };

            webviewPanel.webview.onDidReceiveMessage(messageHandler);

            // Send message to request confirmation
            webviewPanel.webview.postMessage({
                command: "requestConfirmation",
                preview: this.currentPreview,
            });
        });
    }

    private async handleBibleDownload(
        webviewPanel: vscode.WebviewPanel,
        metadata: ExtendedMetadata,
        asTranslationOnly?: boolean
    ) {
        try {
            // Create new transaction
            this.currentDownloadBibleTransaction = new DownloadBibleTransaction(asTranslationOnly);

            // Set the metadata with both language code and translation ID
            this.currentDownloadBibleTransaction.setMetadata({
                languageCode: metadata.languageCode,
                translationId: metadata.translationId || "",
            });

            // Prepare and show preview
            await this.currentDownloadBibleTransaction.prepare();
            const preview = await this.currentDownloadBibleTransaction.getPreview();

            webviewPanel.webview.postMessage({
                command: "biblePreview",
                preview: {
                    type: "bible",
                    original: {
                        preview: (preview as CodexNotebookAsJSONData).cells
                            .slice(0, 10)
                            .map((cell) => `${cell.metadata.id}: ${cell.value}`)
                            .join("\n"),
                        validationResults: [],
                    },
                    transformed: {
                        sourceNotebooks: preview
                            ? [
                                  {
                                      name: preview.metadata.id,
                                      cells: preview.cells,
                                      metadata: preview.metadata,
                                  },
                              ]
                            : [],
                        validationResults: [],
                    },
                },
                transaction: this.currentDownloadBibleTransaction,
            } as SourceUploadResponseMessages);
        } catch (error) {
            if (this.currentDownloadBibleTransaction) {
                await this.currentDownloadBibleTransaction.rollback();
                this.currentDownloadBibleTransaction = null;
            }
            throw error;
        }
    }

    private async executeBibleDownload(webviewPanel: vscode.WebviewPanel) {
        if (!this.currentDownloadBibleTransaction) {
            throw new Error("No transaction in SourceUploadProvider.executeBibleDownload()");
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Finalizing download...",
                    cancellable: true,
                },
                async (progress, token) => {
                    const progressCallback = (update: { message?: string; increment?: number }) => {
                        const { message, increment } = update;
                        progress.report({ message, increment });

                        // Map progress to stages
                        const status: Record<string, "pending" | "active" | "complete" | "error"> =
                            {};
                        if (message?.includes("download")) status.download = "active";
                        if (message?.includes("transform")) status.notebooks = "active";
                        if (message?.includes("commit")) status.commit = "active";

                        webviewPanel.webview.postMessage({
                            command: "bibleDownloadProgress",
                            progress: {
                                message: message || "",
                                increment: increment || 0,
                                status,
                            },
                        } as SourceUploadResponseMessages);
                    };

                    token.onCancellationRequested(() => {
                        this.currentDownloadBibleTransaction?.rollback();
                        webviewPanel.webview.postMessage({
                            command: "error",
                            message: "Operation cancelled",
                        } as SourceUploadResponseMessages);
                    });

                    await this.currentDownloadBibleTransaction?.execute(
                        { report: progressCallback },
                        token
                    );
                }
            );

            webviewPanel.webview.postMessage({
                command: "bibleDownloadComplete",
            } as SourceUploadResponseMessages);
        } catch (error) {
            await this.currentDownloadBibleTransaction?.rollback();
            throw error;
        } finally {
            this.currentDownloadBibleTransaction = null;
        }
    }

    private async handleMultipleSourceImports(
        webviewPanel: vscode.WebviewPanel,
        files: Array<{ content: string; name: string }>,
        token: vscode.CancellationToken
    ): Promise<void> {
        // FIXME: we're not pausing to let the user review and confirm/cancel multiple previews.
        // The download bible transaction *does* currently pause, but the source and translation
        // imports do not.
        const BATCH_SIZE = 5;
        const transactions: SourceImportTransaction[] = [];

        try {
            // Create all transactions first
            const fileUris = await Promise.all(
                files.map((file) => this.saveUploadedFile(file.content, file.name))
            );

            // Initialize transactions
            transactions.push(
                ...fileUris.map((uri) => new SourceImportTransaction(uri, this.context))
            );

            // Process in batches
            for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
                const batch = transactions.slice(i, i + BATCH_SIZE);

                // Prepare previews in parallel
                const previews = await Promise.all(
                    batch.map(async (transaction) => {
                        const rawPreview = await transaction.prepare();
                        return {
                            id: transaction.getId(),
                            fileName: path.basename(transaction.getState().sourceFile.fsPath),
                            fileSize: (
                                await vscode.workspace.fs.stat(transaction.getState().sourceFile)
                            ).size,
                            preview: {
                                type: "source",
                                original: {
                                    preview: rawPreview.originalContent.preview,
                                    validationResults: rawPreview.originalContent.validationResults,
                                },
                                transformed: {
                                    sourceNotebooks: rawPreview.transformedContent.sourceNotebooks,
                                    codexNotebooks: rawPreview.transformedContent.codexNotebooks,
                                    validationResults:
                                        rawPreview.transformedContent.validationResults,
                                },
                            },
                        };
                    })
                );

                // Send previews to webview
                webviewPanel.webview.postMessage({
                    command: "sourcePreview",
                    previews: previews,
                } as SourceUploadResponseMessages);

                // Execute transactions in parallel with progress
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Importing files ${i + 1}-${Math.min(
                            i + BATCH_SIZE,
                            transactions.length
                        )} of ${transactions.length}`,
                        cancellable: true,
                    },
                    async (progress, token) => {
                        const progressCallback = (update: {
                            message?: string;
                            increment?: number;
                        }) => {
                            progress.report(update);
                            webviewPanel.webview.postMessage({
                                command: "updateProcessingStatus",
                                status: {
                                    [update.message || "processing"]: "active",
                                },
                                progress: update,
                            } as SourceUploadResponseMessages);
                        };

                        await Promise.all(
                            batch.map((transaction) =>
                                transaction.execute({ report: progressCallback }, token)
                            )
                        );
                    }
                );
            }

            // Send completion message
            webviewPanel.webview.postMessage({
                command: "importComplete",
            } as SourceUploadResponseMessages);
        } catch (error) {
            // Rollback all transactions on error
            await Promise.all(transactions.map((t) => t.rollback()));
            throw error;
        }
    }

    private async handleMultipleTranslationImports(
        webviewPanel: vscode.WebviewPanel,
        files: Array<{ content: string; name: string; sourceId: string }>,
        token: vscode.CancellationToken
    ): Promise<void> {
        const BATCH_SIZE = 5;
        const transactions: TranslationImportTransaction[] = [];

        try {
            // Create transactions for each file
            for (const file of files) {
                const tempUri = await this.saveUploadedFile(file.content, file.name);
                const transaction = new TranslationImportTransaction(
                    tempUri,
                    file.sourceId,
                    this.context
                );
                transactions.push(transaction);
            }

            // Process transactions in batches
            for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
                const batch = transactions.slice(i, i + BATCH_SIZE);

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Importing translations ${i + 1}-${Math.min(
                            i + BATCH_SIZE,
                            transactions.length
                        )} of ${transactions.length}`,
                        cancellable: true,
                    },
                    async (progress, token) => {
                        // First prepare all transactions in the batch
                        await Promise.all(batch.map((transaction) => transaction.prepare()));

                        const progressCallback = (update: {
                            message?: string;
                            increment?: number;
                        }) => {
                            progress.report(update);
                            webviewPanel.webview.postMessage({
                                command: "updateProcessingStatus",
                                status: {
                                    [update.message || "processing"]: "active",
                                },
                                progress: update,
                            } as SourceUploadResponseMessages);
                        };

                        await Promise.all(
                            batch.map((transaction) =>
                                transaction.execute({ report: progressCallback }, token)
                            )
                        );
                    }
                );
            }

            // Send completion message
            webviewPanel.webview.postMessage({
                command: "importComplete",
            } as SourceUploadResponseMessages);
        } catch (error) {
            // Rollback all transactions on error
            await Promise.all(transactions.map((t) => t.rollback()));

            // Send error message to webview
            webviewPanel.webview.postMessage({
                command: "error",
                message: error instanceof Error ? error.message : "Failed to import translations",
            } as SourceUploadResponseMessages);

            throw error;
        }
    }

    private async handleAuthenticationMessage(
        webviewPanel: vscode.WebviewPanel,
        message: SourceUploadPostMessages
    ) {
        const extension = await vscode.extensions
            .getExtension("frontier-rnd.frontier-authentication")
            ?.activate();

        if (!extension) {
            webviewPanel.webview.postMessage({
                command: "updateAuthState",
                authState: {
                    isAuthExtensionInstalled: false,
                    isAuthenticated: false,
                    isLoading: false,
                },
            } as SourceUploadResponseMessages);
            return;
        }

        switch (message.command) {
            case "auth.status": {
                try {
                    const status = await extension.getAuthStatus();
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: status.isAuthenticated,
                            isLoading: false,
                        },
                    } as SourceUploadResponseMessages);
                } catch (error) {
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : "Failed to get auth status",
                        },
                    } as SourceUploadResponseMessages);
                }
                break;
            }
            case "auth.login": {
                try {
                    await extension.login(message.email, message.password);
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: true,
                            isLoading: false,
                        },
                    } as SourceUploadResponseMessages);
                } catch (error) {
                    webviewPanel.webview.postMessage({
                        command: "updateAuthState",
                        authState: {
                            isAuthExtensionInstalled: true,
                            isAuthenticated: false,
                            isLoading: false,
                            error: error instanceof Error ? error.message : "Login failed",
                        },
                    } as SourceUploadResponseMessages);
                }
                break;
            }
        }
    }
}
