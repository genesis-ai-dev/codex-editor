import * as vscode from "vscode";
import * as grammar from "usfm-grammar";
import { ParsedUSFM } from "usfm-grammar";
import { ImportTransaction, ImportTransactionState } from "./ImportTransaction";
import { CustomNotebookMetadata, NotebookPreview, RawSourcePreview, ValidationResult } from "../../types";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";
import { ProgressManager, ProgressStep } from "../utils/progressManager";
import { CodexCellTypes } from "../../types/enums";
import path from "path";
import { randomUUID } from "crypto";

interface UsfmContent {
    id: string;
    content: string;
    type: "verse" | "paratext";
}

export class UsfmSourceImportTransaction extends ImportTransaction {
    public id: string;
    private preview: RawSourcePreview | null = null;
    private parsedContent: UsfmContent[] = [];
    private metadataManager: NotebookMetadataManager;
    private readonly context: vscode.ExtensionContext;

    private readonly importSteps: ProgressStep[] = [
        { name: "validation", message: "Validating USFM file...", weight: 1 },
        { name: "preparation", message: "Preparing preview...", weight: 2 },
        { name: "transformation", message: "Transforming content...", weight: 3 },
        { name: "processing", message: "Processing notebooks...", weight: 3 },
        { name: "metadata", message: "Updating metadata...", weight: 1 },
        { name: "commit", message: "Committing changes...", weight: 1 },
    ];

    constructor(sourceFile: vscode.Uri, context: vscode.ExtensionContext) {
        super(sourceFile);
        this.id = randomUUID();
        this.context = context;
        this.metadataManager = new NotebookMetadataManager();
    }

    public getId(): string {
        return this.id;
    }

    public getState(): ImportTransactionState {
        return this.state;
    }

    async prepare(): Promise<RawSourcePreview> {
        try {
            await this.metadataManager.initialize();
            await this.createTempDirectory();

            // Copy original file to temp directory
            const tempSourceFile = vscode.Uri.joinPath(
                this.getTempDir(),
                path.basename(this.state.sourceFile.fsPath)
            );
            await vscode.workspace.fs.copy(this.state.sourceFile, tempSourceFile);
            this.state.tempFiles.push(tempSourceFile);

            // Parse USFM content
            let fileContent: Uint8Array;
            try {
                fileContent = await vscode.workspace.fs.readFile(tempSourceFile);
            } catch (error) {
                throw new Error(`Failed to read USFM file: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            let fileContentString: string;
            try {
                fileContentString = new TextDecoder("utf-8").decode(fileContent);
            } catch (error) {
                throw new Error(`Failed to decode USFM file as UTF-8: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            // Use usfm-grammar in relaxed mode for parsing
            let jsonOutput: ParsedUSFM;
            try {
                const relaxedUsfmParser = new grammar.USFMParser(fileContentString, grammar.LEVEL.RELAXED);
                jsonOutput = relaxedUsfmParser.toJSON() as any as ParsedUSFM;
            } catch (error) {
                throw new Error(`Failed to parse USFM content: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            // Get book ID from USFM
            const bookCode = jsonOutput.book?.bookCode;
            if (!bookCode) {
                throw new Error("No book code found in USFM file. Please ensure the file has a valid \\id tag.");
            }

            // Validate book code format
            if (!/^[A-Z0-9]{3}$/.test(bookCode)) {
                throw new Error(`Invalid book code format: ${bookCode}. Expected a 3-character code like 'GEN' or 'MAT'.`);
            }

            // Use book code for file naming, ensuring it's lowercase for consistency
            const baseName = bookCode.toLowerCase();

            // Parse chapters and verses
            try {
                if (!jsonOutput.chapters || jsonOutput.chapters.length === 0) {
                    throw new Error("No chapters found in USFM file");
                }

                jsonOutput.chapters.forEach((chapter: any) => {
                    if (!chapter.chapterNumber) {
                        throw new Error(`Invalid chapter format: missing chapter number`);
                    }

                    const chapterNumber = chapter.chapterNumber;
                    chapter.contents.forEach((content: any) => {
                        if (content.verseNumber !== undefined && content.verseText !== undefined) {
                            const verseId = `${bookCode} ${chapterNumber}:${content.verseNumber}`;
                            this.parsedContent.push({
                                id: verseId,
                                content: content.verseText.trim(),
                                type: "verse"
                            });
                        } else if (content.text && !content.marker) {
                            // Generate a stable ID for paratext based on content hash
                            const paratextId = `paratext-${Buffer.from(content.text).toString('base64').substring(0, 8)}`;
                            this.parsedContent.push({
                                id: paratextId,
                                content: content.text.trim(),
                                type: "paratext"
                            });
                        }
                    });
                });

                if (this.parsedContent.length === 0) {
                    throw new Error("No verses or paratext found in USFM file");
                }
            } catch (error) {
                throw new Error(`Failed to process USFM content: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            // Create preview with validation results
            const validationResult: ValidationResult = {
                isValid: true,
                errors: []
            };

            this.preview = {
                fileName: path.basename(this.state.sourceFile.fsPath),
                originalContent: {
                    preview: fileContentString,
                    validationResults: [validationResult],
                },
                transformedContent: {
                    sourceNotebooks: [{
                        name: baseName,
                        cells: this.parsedContent.map(content => ({
                            kind: vscode.NotebookCellKind.Code,
                            value: content.content,
                            languageId: "scripture",
                            metadata: {
                                type: content.type === "verse" ? CodexCellTypes.TEXT : CodexCellTypes.PARATEXT,
                                id: content.id,
                                data: {},
                            }
                        })),
                        metadata: {
                            id: baseName,
                            originalName: baseName,
                            sourceFsPath: "",  // Will be set during processing
                            codexFsPath: "",   // Will be set during processing
                            navigation: [],
                            sourceCreatedAt: new Date().toISOString(),
                            codexLastModified: new Date().toISOString(),
                            gitStatus: "untracked" as const,
                            corpusMarker: bookCode,
                        }
                    }],
                    codexNotebooks: [{
                        name: baseName,
                        cells: this.parsedContent.map(content => ({
                            kind: vscode.NotebookCellKind.Code,
                            value: "",  // Empty initial value for target text
                            languageId: "scripture",
                            metadata: {
                                type: content.type === "verse" ? CodexCellTypes.TEXT : CodexCellTypes.PARATEXT,
                                id: content.id,
                                data: {},
                            }
                        })),
                        metadata: {
                            id: baseName,
                            originalName: baseName,
                            sourceFsPath: "",  // Will be set during processing
                            codexFsPath: "",   // Will be set during processing
                            navigation: [],
                            sourceCreatedAt: new Date().toISOString(),
                            codexLastModified: new Date().toISOString(),
                            gitStatus: "untracked" as const,
                            corpusMarker: bookCode,
                        }
                    }],
                    validationResults: [validationResult],
                },
            };

            return this.preview;
        } catch (error) {
            await this.rollback();
            // Rethrow with clear error message
            if (error instanceof Error) {
                throw new Error(`USFM Import Error: ${error.message}`);
            }
            throw error;
        }
    }

    protected async processFiles(): Promise<void> {
        if (!this.preview) {
            throw new Error("Transaction not prepared");
        }
        await this.processNotebooks();
    }

    private async processNotebooks(
        token?: vscode.CancellationToken
    ): Promise<Array<{ sourceUri: vscode.Uri; codexUri: vscode.Uri; notebook: NotebookPreview }>> {
        const { sourceNotebooks, codexNotebooks } = this.preview!.transformedContent;
        const notebookResults: Array<{
            sourceUri: vscode.Uri;
            codexUri: vscode.Uri;
            notebook: NotebookPreview;
        }> = [];
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        for (let i = 0; i < sourceNotebooks.length; i++) {
            this.checkCancellation(token);

            const sourceNotebook = sourceNotebooks[i];
            const codexNotebook = codexNotebooks[i];

            if (!sourceNotebook.name || !codexNotebook.name) {
                throw new Error("Notebook name is required");
            }

            // Create temp URIs for initial file creation
            const sourceUri = vscode.Uri.joinPath(
                this.getTempDir(),
                `${sourceNotebook.name}.source`
            );
            const codexUri = vscode.Uri.joinPath(
                this.getTempDir(),
                `${codexNotebook.name}.codex`
            );

            // Create final URIs for metadata
            const finalSourceUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "sourceTexts",
                `${sourceNotebook.name}.source`
            );
            const finalCodexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                "files",
                "target",
                `${codexNotebook.name}.codex`
            );

            // Update metadata with final paths
            sourceNotebook.metadata.sourceFsPath = finalSourceUri.fsPath;
            sourceNotebook.metadata.codexFsPath = finalCodexUri.fsPath;
            codexNotebook.metadata.sourceFsPath = finalSourceUri.fsPath;
            codexNotebook.metadata.codexFsPath = finalCodexUri.fsPath;

            await this.writeNotebook(sourceUri, sourceNotebook);
            await this.writeNotebook(codexUri, codexNotebook);

            this.state.tempFiles.push(sourceUri, codexUri);
            notebookResults.push({ sourceUri, codexUri, notebook: sourceNotebook });
        }

        return notebookResults;
    }

    private async writeNotebook(uri: vscode.Uri, notebook: NotebookPreview): Promise<void> {
        const cells = notebook.cells.map((cell) => ({
            kind: cell.kind,
            value: cell.value,
            languageId: cell.languageId || "scripture",
            metadata: {
                type: cell.metadata?.type || CodexCellTypes.TEXT,
                id: cell.metadata?.id,
                data: cell.metadata?.data || {},
                edits: cell.metadata?.edits || [],
            },
        }));

        const serializedData = JSON.stringify(
            {
                cells,
                metadata: {
                    ...notebook.metadata,
                    textDirection: notebook.metadata.textDirection || "ltr",
                    navigation: notebook.metadata.navigation || [],
                    videoUrl: notebook.metadata.videoUrl || "",
                },
            },
            null,
            2
        );

        await vscode.workspace.fs.writeFile(uri, Buffer.from(serializedData));
    }

    protected async updateMetadata(): Promise<void> {
        if (!this.preview) {
            throw new Error("Transaction not prepared");
        }

        for (const notebook of this.preview.transformedContent.sourceNotebooks) {
            await this.metadataManager.addOrUpdateMetadata(notebook.metadata);
        }
    }

    protected async commitChanges(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        // Move files from temp to their proper locations and update metadata
        for (const tempFile of this.state.tempFiles) {
            const fileName = path.basename(tempFile.fsPath);
            let targetLocation: vscode.Uri;

            if (fileName.endsWith(".source")) {
                targetLocation = vscode.Uri.joinPath(
                    workspaceFolder.uri,
                    ".project",
                    "sourceTexts",
                    fileName
                );
            } else if (fileName.endsWith(".codex")) {
                targetLocation = vscode.Uri.joinPath(
                    workspaceFolder.uri,
                    "files",
                    "target",
                    fileName
                );
            } else {
                continue;
            }

            // Create directory if it doesn't exist
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(targetLocation, ".."));

            // Copy file to final location
            await vscode.workspace.fs.copy(tempFile, targetLocation, { overwrite: true });

            // Update metadata with final paths
            const baseName = path.parse(fileName).name;
            const metadata = await this.metadataManager.getMetadataById(baseName);
            if (metadata) {
                if (fileName.endsWith(".source")) {
                    metadata.sourceFsPath = targetLocation.fsPath;
                } else if (fileName.endsWith(".codex")) {
                    metadata.codexFsPath = targetLocation.fsPath;
                }
                await this.metadataManager.addOrUpdateMetadata(metadata);
            }
        }

        // Clean up temp files
        try {
            for (const tempFile of this.state.tempFiles) {
                try {
                    await vscode.workspace.fs.delete(tempFile);
                } catch (error) {
                    console.warn(`Failed to delete temp file ${tempFile.fsPath}:`, error);
                }
            }
        } catch (error) {
            console.warn("Error cleaning up temp files:", error);
        }
    }
} 