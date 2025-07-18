import * as vscode from "vscode";
import { getWebviewHtml } from "../../utils/webviewTemplate";
import { createNoteBookPair } from "./codexFIleCreateUtils";
import { WriteNotebooksMessage, WriteTranslationMessage } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/plugin";
import { ProcessedNotebook } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/common";
import { NotebookPreview, CustomNotebookMetadata } from "../../../types";
import { CodexCell } from "../../utils/codexNotebookUtils";
import { CodexCellTypes } from "../../../types/enums";
import { importBookNamesFromXmlContent } from "../../bookNameSettings/bookNameSettings";
import { TranslationImportTransaction } from "../../transactions/TranslationImportTransaction";

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
                if (message.command === "webviewReady") {
                    // Webview is ready, send current project inventory
                    console.log("Webview ready, sending project inventory...");
                    const inventory = await this.fetchProjectInventory();

                    webviewPanel.webview.postMessage({
                        command: "projectInventory",
                        inventory: inventory,
                    });
                } else if (message.command === "writeNotebooks") {
                    await this.handleWriteNotebooks(message as WriteNotebooksMessage, token);

                    // Send success notification
                    webviewPanel.webview.postMessage({
                        command: "notification",
                        type: "success",
                        message: "Notebooks created successfully!"
                    });

                    // Send updated inventory after successful import
                    const inventory = await this.fetchProjectInventory();
                    webviewPanel.webview.postMessage({
                        command: "projectInventory",
                        inventory: inventory,
                    });
                } else if (message.command === "writeTranslation") {
                    await this.handleWriteTranslation(message as WriteTranslationMessage, token);

                    // Send success notification
                    webviewPanel.webview.postMessage({
                        command: "notification",
                        type: "success",
                        message: "Translation imported successfully!"
                    });

                    // Send updated inventory after successful translation import
                    const inventory = await this.fetchProjectInventory();
                    webviewPanel.webview.postMessage({
                        command: "projectInventory",
                        inventory: inventory,
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
                } else if (message.command === "fetchProjectInventory") {
                    // Legacy support - fetch complete project inventory
                    const inventory = await this.fetchProjectInventory();

                    webviewPanel.webview.postMessage({
                        command: "projectInventory",
                        inventory: inventory,
                    });
                } else if (message.command === "fetchFileDetails") {
                    // Fetch detailed information about a specific file
                    const { filePath } = message;
                    console.log(`[NEW SOURCE UPLOADER] Fetching details for file: ${filePath}`);

                    try {
                        const fileDetails = await this.fetchFileDetails(filePath);
                        webviewPanel.webview.postMessage({
                            command: "fileDetails",
                            filePath: filePath,
                            details: fileDetails,
                        });
                    } catch (error) {
                        console.error(`[NEW SOURCE UPLOADER] Error fetching file details for ${filePath}:`, error);
                        webviewPanel.webview.postMessage({
                            command: "fileDetailsError",
                            filePath: filePath,
                            error: error instanceof Error ? error.message : "Unknown error",
                        });
                    }
                } else if (message.command === "fetchTargetFile") {
                    // Fetch target file content for translation imports
                    const { sourceFilePath } = message;
                    console.log(`[NEW SOURCE UPLOADER] Fetching target file for source: ${sourceFilePath}`);

                    try {
                        const targetFilePath = sourceFilePath
                            .replace(/\.source$/, ".codex")
                            .replace(/\/\.project\/sourceTexts\//, "/files/target/");

                        const targetUri = vscode.Uri.file(targetFilePath);
                        const targetContent = await vscode.workspace.fs.readFile(targetUri);
                        const targetNotebook = JSON.parse(new TextDecoder().decode(targetContent));

                        webviewPanel.webview.postMessage({
                            command: "targetFileContent",
                            sourceFilePath: sourceFilePath,
                            targetFilePath: targetFilePath,
                            targetCells: targetNotebook.cells || [],
                        });
                    } catch (error) {
                        console.error(`[NEW SOURCE UPLOADER] Error fetching target file for ${sourceFilePath}:`, error);
                        webviewPanel.webview.postMessage({
                            command: "targetFileError",
                            sourceFilePath: sourceFilePath,
                            error: error instanceof Error ? error.message : "Unknown error",
                        });
                    }
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
        const createdFiles = await createNoteBookPair({
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

        // Use incremental indexing for just the newly created files
        if (createdFiles && createdFiles.length > 0) {
            // Extract file paths from the created URIs
            const filePaths: string[] = [];
            for (const result of createdFiles) {
                filePaths.push(result.sourceUri.fsPath);
                filePaths.push(result.codexUri.fsPath);
            }

            // Index only these specific files
            await vscode.commands.executeCommand("codex-editor-extension.indexSpecificFiles", filePaths);
        }
    }

    private async handleWriteTranslation(
        message: WriteTranslationMessage,
        token: vscode.CancellationToken
    ): Promise<void> {
        console.log("Handling translation import:", message);

        try {
            // The aligned content is already provided by the plugin's custom alignment algorithm
            // We just need to merge it into the existing target notebook

            // Load the existing target notebook
            const targetFileUri = vscode.Uri.file(message.targetFilePath);
            const existingContent = await vscode.workspace.fs.readFile(targetFileUri);
            const existingNotebook = JSON.parse(new TextDecoder().decode(existingContent));

            // Create a map of existing cells for quick lookup
            const existingCellsMap = new Map<string, any>();
            existingNotebook.cells.forEach((cell: any) => {
                if (cell.metadata?.id) {
                    existingCellsMap.set(cell.metadata.id, cell);
                }
            });

            // Track statistics
            let insertedCount = 0;
            let skippedCount = 0;
            let paratextCount = 0;
            let childCellCount = 0;

            // Process aligned cells and update the notebook
            const processedCells = new Map<string, any>();
            const processedSourceCells = new Set<string>();

            for (const alignedCell of message.alignedContent) {
                if (alignedCell.isParatext) {
                    // Add paratext cells
                    const paratextId = alignedCell.importedContent.id;
                    const paratextCell = {
                        kind: 1, // vscode.NotebookCellKind.Code
                        languageId: "html",
                        value: alignedCell.importedContent.content,
                        metadata: {
                            type: CodexCellTypes.PARATEXT,
                            id: paratextId,
                            data: {
                                startTime: alignedCell.importedContent.startTime,
                                endTime: alignedCell.importedContent.endTime,
                            },
                        },
                    };
                    processedCells.set(paratextId, paratextCell);
                    paratextCount++;
                } else if (alignedCell.notebookCell) {
                    const targetId = alignedCell.importedContent.id;
                    const existingCell = existingCellsMap.get(targetId);

                    if (existingCell && existingCell.value && existingCell.value.trim() !== "") {
                        // Keep existing content if cell already has content
                        processedCells.set(targetId, existingCell);
                        skippedCount++;
                    } else {
                        // Update empty cell with new content
                        const updatedCell = {
                            kind: 1, // vscode.NotebookCellKind.Code
                            languageId: "html",
                            value: alignedCell.importedContent.content,
                            metadata: {
                                ...alignedCell.notebookCell.metadata,
                                type: CodexCellTypes.TEXT,
                                id: targetId,
                                data: {
                                    ...alignedCell.notebookCell.metadata.data,
                                    startTime: alignedCell.importedContent.startTime,
                                    endTime: alignedCell.importedContent.endTime,
                                },
                            },
                        };
                        processedCells.set(targetId, updatedCell);

                        if (alignedCell.isAdditionalOverlap) {
                            childCellCount++;
                        } else {
                            insertedCount++;
                        }
                    }
                }
            }

            // Build the final cell array, preserving the temporal order from alignedContent
            const newCells: any[] = [];
            const usedExistingCellIds = new Set<string>();

            // Process cells in the order they appear in alignedContent (temporal order)
            for (const alignedCell of message.alignedContent) {
                if (alignedCell.isParatext) {
                    // Add paratext cell
                    const paratextId = alignedCell.importedContent.id;
                    const paratextCell = processedCells.get(paratextId);
                    if (paratextCell) {
                        newCells.push(paratextCell);
                    }
                } else if (alignedCell.notebookCell) {
                    const targetId = alignedCell.importedContent.id;
                    const processedCell = processedCells.get(targetId);

                    if (processedCell) {
                        newCells.push(processedCell);
                        usedExistingCellIds.add(targetId);
                    }
                }
            }

            // Add any existing cells that weren't in the aligned content (shouldn't happen normally)
            for (const cell of existingNotebook.cells) {
                const cellId = cell.metadata?.id;
                if (cellId && !usedExistingCellIds.has(cellId)) {
                    console.warn(`Cell ${cellId} was not in aligned content, appending at end`);
                    newCells.push(cell);
                }
            }

            // Update the notebook
            const updatedNotebook = {
                ...existingNotebook,
                cells: newCells,
            };

            // Write the updated notebook back to disk
            await vscode.workspace.fs.writeFile(
                targetFileUri,
                Buffer.from(JSON.stringify(updatedNotebook, null, 2))
            );

            // Show success message with statistics
            vscode.window.showInformationMessage(
                `Translation imported: ${insertedCount} translations, ${paratextCount} paratext cells, ${childCellCount} child cells, ${skippedCount} skipped.`
            );

            console.log("Translation import completed successfully");

        } catch (error) {
            console.error("Error in translation import:", error);
            throw error;
        }
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

    private async fetchProjectInventory(): Promise<{
        sourceFiles: Array<{
            name: string;
            path: string;
        }>;
        targetFiles: Array<{
            name: string;
            path: string;
        }>;
        translationPairs: Array<{
            sourceFile: any;
            targetFile: any;
        }>;
    }> {
        const sourceFiles: any[] = [];
        const targetFiles: any[] = [];
        const translationPairs: any[] = [];

        try {
            // Find all .source and .codex files in the workspace
            const [sourceFileUris, codexFileUris] = await Promise.all([
                vscode.workspace.findFiles(".project/sourceTexts/*.source"),
                vscode.workspace.findFiles("files/target/*.codex")
            ]);

            console.log("[NEW SOURCE UPLOADER] Found source files:", sourceFileUris.length);
            console.log("[NEW SOURCE UPLOADER] Found codex files:", codexFileUris.length);

            // Process source files (basic metadata only)
            for (const file of sourceFileUris) {
                const fileName = file.path.split('/').pop()?.replace('.source', '') || 'Unknown';
                sourceFiles.push({
                    name: fileName,
                    path: file.path,
                });
            }

            // Process codex (target) files (basic metadata only)
            for (const file of codexFileUris) {
                const fileName = file.path.split('/').pop()?.replace('.codex', '') || 'Unknown';
                const targetFile = {
                    name: fileName,
                    path: file.path,
                };
                targetFiles.push(targetFile);

                // Create translation pairs based on matching base names
                const matchingSource = sourceFiles.find(source => source.name === fileName);
                if (matchingSource) {
                    translationPairs.push({
                        sourceFile: matchingSource,
                        targetFile: targetFile,
                    });
                }
            }

            const result = {
                sourceFiles,
                targetFiles,
                translationPairs,
            };
            console.log("[NEW SOURCE UPLOADER] Final inventory result:", result);
            return result;

        } catch (error) {
            console.error("Error fetching project inventory:", error);
            return {
                sourceFiles: [],
                targetFiles: [],
                translationPairs: [],
            };
        }
    }

    private async fetchFileDetails(filePath: string): Promise<{
        name: string;
        path: string;
        type: string;
        cellCount: number;
        metadata?: any;
    }> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openNotebookDocument(uri);
            const metadata = document.metadata as CustomNotebookMetadata | undefined;

            const fileName = filePath.split('/').pop()?.replace(/\.(source|codex)$/, '') || 'Unknown';
            const cellCount = document.cellCount;

            // Determine file type based on metadata or content
            let fileType = 'unknown';
            if (metadata?.corpusMarker) {
                fileType = metadata.corpusMarker;
            } else if (this.checkIfBibleContent(document)) {
                fileType = 'bible';
            }

            return {
                name: fileName,
                path: filePath,
                type: fileType,
                cellCount: cellCount,
                metadata: {
                    id: metadata?.id,
                    originalName: metadata?.originalName,
                    corpusMarker: metadata?.corpusMarker,
                    sourceCreatedAt: metadata?.sourceCreatedAt,
                }
            };
        } catch (error) {
            console.error(`Error fetching details for file ${filePath}:`, error);
            throw error;
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
