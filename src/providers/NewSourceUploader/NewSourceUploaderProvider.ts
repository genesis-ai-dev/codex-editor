import * as vscode from "vscode";
import { getWebviewHtml } from "../../utils/webviewTemplate";
import { createNoteBookPair } from "./codexFIleCreateUtils";
import { WriteNotebooksMessage } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/plugin";
import { ProcessedNotebook } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/common";
import { NotebookPreview, CustomNotebookMetadata } from "../../../types";
import { CodexCell } from "../../utils/codexNotebookUtils";
import { CodexCellTypes } from "../../../types/enums";
import { importBookNamesFromXmlContent } from "../../bookNameSettings/bookNameSettings";

export class NewSourceUploaderProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = "newSourceUploaderProvider";

    constructor(private readonly context: vscode.ExtensionContext) { }

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
                if (message.command === "writeNotebooks") {
                    await this.handleWriteNotebooks(message as WriteNotebooksMessage, token);

                    // Send success notification
                    webviewPanel.webview.postMessage({
                        command: "notification",
                        type: "success",
                        message: "Notebooks created successfully!"
                    });
                } else if (message.command === "importBookNames") {
                    // Handle book names import
                    const { xmlContent, nameType } = message;
                    if (xmlContent) {
                        const success = await importBookNamesFromXmlContent(xmlContent, nameType || 'long');
                        if (success) {
                            webviewPanel.webview.postMessage({
                                command: "notification",
                                type: "success",
                                message: "Book names imported successfully!"
                            });
                        } else {
                            webviewPanel.webview.postMessage({
                                command: "notification",
                                type: "warning",
                                message: "Failed to import some book names"
                            });
                        }
                    }
                } else if (message.command === "checkExistingFiles") {
                    // Check for existing source files in the project
                    const existingFiles = await this.checkForExistingFiles();

                    webviewPanel.webview.postMessage({
                        command: "existingFilesFound",
                        files: existingFiles,
                    });
                }
            } catch (error) {
                console.error("Error handling message:", error);

                // Send error notification
                webviewPanel.webview.postMessage({
                    command: "notification",
                    type: "error",
                    message: error instanceof Error ? error.message : "Unknown error occurred"
                });
            }
        });
    }

    /**
 * Converts a ProcessedNotebook to NotebookPreview format
 */
    private convertToNotebookPreview(processedNotebook: ProcessedNotebook): NotebookPreview {
        const cells: CodexCell[] = processedNotebook.cells.map(processedCell => ({
            kind: vscode.NotebookCellKind.Code,
            value: processedCell.content,
            languageId: "html",
            metadata: {
                id: processedCell.id,
                type: CodexCellTypes.TEXT,
                data: processedCell.metadata || {},
            }
        }));

        const metadata: CustomNotebookMetadata = {
            id: processedNotebook.metadata.id,
            originalName: processedNotebook.metadata.originalFileName,
            sourceFsPath: "",
            codexFsPath: "",
            navigation: [],
            sourceCreatedAt: processedNotebook.metadata.createdAt,
            corpusMarker: processedNotebook.metadata.importerType,
            textDirection: "ltr",
        };

        return {
            name: processedNotebook.name,
            cells,
            metadata,
        };
    }

    private async handleWriteNotebooks(
        message: WriteNotebooksMessage,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Debug logging
        console.log("Received notebook pairs:", message.notebookPairs.length);
        console.log("First pair source cells:", message.notebookPairs[0]?.source.cells.length);
        console.log("First pair source cells preview:", message.notebookPairs[0]?.source.cells.slice(0, 2));

        // Convert ProcessedNotebooks to NotebookPreview format
        const sourceNotebooks = message.notebookPairs.map(pair =>
            this.convertToNotebookPreview(pair.source)
        );
        const codexNotebooks = message.notebookPairs.map(pair =>
            this.convertToNotebookPreview(pair.codex)
        );

        // Debug logging after conversion
        console.log("Converted source notebooks cells:", sourceNotebooks[0]?.cells.length);
        console.log("Converted source cells preview:", sourceNotebooks[0]?.cells.slice(0, 2));

        // Create the notebook pairs
        await createNoteBookPair({
            token,
            sourceNotebooks,
            codexNotebooks,
        });

        // Show success message
        const count = message.notebookPairs.length;
        const notebooksText = count === 1 ? "notebook" : "notebooks";
        const firstNotebookName = message.notebookPairs[0]?.source.name || "unknown";

        vscode.window.showInformationMessage(
            count === 1
                ? `Successfully imported "${firstNotebookName}"!`
                : `Successfully imported ${count} ${notebooksText}!`
        );

        // Force reindex to ensure new files are recognized
        await vscode.commands.executeCommand("codex-editor-extension.forceReindex");
    }

    private async checkForExistingFiles(): Promise<Array<{
        name: string;
        path: string;
        type: string;
        cellCount: number;
        metadata?: any;
    }>> {
        const files: Array<{
            name: string;
            path: string;
            type: string;
            cellCount: number;
            metadata?: any;
        }> = [];

        try {
            // Find all .source files in the workspace
            const sourceFiles = await vscode.workspace.findFiles("**/*.source", "**/node_modules/**");

            for (const file of sourceFiles) {
                try {
                    const document = await vscode.workspace.openNotebookDocument(file);
                    const metadata = document.metadata as CustomNotebookMetadata | undefined;

                    const fileName = file.path.split('/').pop()?.replace('.source', '') || 'Unknown';
                    const cellCount = document.cellCount;

                    // Determine file type based on metadata or content
                    let fileType = 'unknown';
                    if (metadata?.corpusMarker) {
                        fileType = metadata.corpusMarker;
                    } else if (this.checkIfBibleContent(document)) {
                        fileType = 'bible';
                    }

                    files.push({
                        name: fileName,
                        path: file.path,
                        type: fileType,
                        cellCount: cellCount,
                        metadata: {
                            id: metadata?.id,
                            originalName: metadata?.originalName,
                            corpusMarker: metadata?.corpusMarker,
                            sourceCreatedAt: metadata?.sourceCreatedAt,
                        }
                    });
                } catch (err) {
                    console.error(`Error checking file ${file.path}:`, err);
                }
            }

            return files;

        } catch (error) {
            console.error("Error checking for existing Bibles:", error);
            return [];
        }
    }

    private checkIfBibleContent(document: vscode.NotebookDocument): boolean {
        // Check first few cells to see if they contain Bible verse references
        const cellsToCheck = Math.min(5, document.cellCount);
        let bibleRefCount = 0;

        for (let i = 0; i < cellsToCheck; i++) {
            const cell = document.cellAt(i);
            const cellId = cell.metadata?.id || '';

            // Check if cell ID matches Bible verse pattern (e.g., "GEN 1:1", "MAT 1:1")
            if (/^[A-Z1-9]{3}\s+\d+:\d+/.test(cellId)) {
                bibleRefCount++;
            }
        }

        // If most cells have Bible verse references, it's likely a Bible
        return bibleRefCount >= cellsToCheck * 0.6;
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
}
