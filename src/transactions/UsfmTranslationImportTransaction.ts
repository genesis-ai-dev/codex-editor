import * as vscode from "vscode";
import { ImportTransaction } from "./ImportTransaction";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";
import { ProgressManager, ProgressStep } from "../utils/progressManager";
import { CodexContentSerializer } from "../serializer";
import {
    ImportedContent,
    CustomNotebookCellData,
    CustomCellMetaData,
    ValidationResult,
} from "../../types";
import { CodexCellTypes } from "../../types/enums";
import * as path from "path";
import * as grammar from "usfm-grammar";
import { ParsedUSFM } from "usfm-grammar";
import { generateChildCellId } from "../providers/codexCellEditorProvider/utils/cellUtils";

interface AlignedCell {
    notebookCell: CustomNotebookCellData | null;
    importedContent: ImportedContent;
    isParatext?: boolean;
    isAdditionalOverlap?: boolean;
}

export class UsfmTranslationImportTransaction extends ImportTransaction {
    private metadataManager: NotebookMetadataManager;
    private readonly context: vscode.ExtensionContext;
    private readonly sourceNotebookId: string;
    private importedContent: ImportedContent[] = [];

    private readonly importSteps: ProgressStep[] = [
        { name: "validation", message: "Validating USFM translation file...", weight: 1 },
        { name: "preparation", message: "Reading USFM content...", weight: 2 },
        { name: "processing", message: "Processing translations...", weight: 3 },
        { name: "merging", message: "Merging translations...", weight: 3 },
        { name: "metadata", message: "Updating metadata...", weight: 1 },
        { name: "commit", message: "Committing changes...", weight: 1 },
    ];

    constructor(
        translationFile: vscode.Uri,
        sourceNotebookId: string,
        context: vscode.ExtensionContext
    ) {
        super(translationFile);
        this.sourceNotebookId = sourceNotebookId;
        this.context = context;
        this.metadataManager = new NotebookMetadataManager();
    }

    async prepare(): Promise<{
        original: {
            preview: string;
            validationResults: ValidationResult[];
        };
        transformed: {
            sourceNotebook: {
                name: string;
                cells: Array<{
                    value: string;
                    metadata: {
                        id: string;
                        type: string;
                    };
                }>;
            };
            targetNotebook: {
                name: string;
                cells: Array<{
                    value: string;
                    metadata: {
                        id: string;
                        type: string;
                    };
                }>;
            };
            matchedCells: number;
            unmatchedContent: number;
            paratextItems: number;
            validationResults: ValidationResult[];
        };
        importType: "translation";
    }> {
        try {
            await this.metadataManager.initialize();

            // Create temp directory
            await this.createTempDirectory();

            // Copy original file to temp directory
            const tempTranslationFile = vscode.Uri.joinPath(
                this.getTempDir(),
                path.basename(this.state.sourceFile.fsPath)
            );
            await vscode.workspace.fs.copy(this.state.sourceFile, tempTranslationFile);
            this.state.tempFiles.push(tempTranslationFile);

            // Parse the USFM content
            const fileContent = await vscode.workspace.fs.readFile(tempTranslationFile);
            const fileContentString = new TextDecoder().decode(fileContent);

            // Parse USFM using relaxed mode
            const relaxedUsfmParser = new grammar.USFMParser(fileContentString, grammar.LEVEL.RELAXED);
            const jsonOutput = relaxedUsfmParser.toJSON() as any as ParsedUSFM;

            // Convert USFM content to ImportedContent array
            const bookCode = jsonOutput.book.bookCode;
            jsonOutput.chapters.forEach((chapter: any) => {
                const chapterNumber = chapter.chapterNumber;
                chapter.contents.forEach((content: any) => {
                    if (content.verseNumber !== undefined && content.verseText !== undefined) {
                        const verseId = `${bookCode} ${chapterNumber}:${content.verseNumber}`;
                        this.importedContent.push({
                            id: verseId,
                            content: content.verseText.trim(),
                        });
                    } else if (content.text && !content.marker) {
                        this.importedContent.push({
                            id: `paratext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            content: content.text.trim(),
                        });
                    }
                });
            });

            // Get source notebook content
            const sourceMetadata = await this.metadataManager.getMetadataById(
                this.sourceNotebookId
            );
            if (!sourceMetadata?.sourceFsPath) {
                throw new Error("Source notebook not found");
            }

            const sourceUri = vscode.Uri.file(sourceMetadata.sourceFsPath);
            const codexUri = vscode.Uri.file(sourceMetadata.codexFsPath!);

            const serializer = new CodexContentSerializer();
            const sourceContent = await vscode.workspace.fs.readFile(sourceUri);
            const sourceNotebook = await serializer.deserializeNotebook(
                sourceContent,
                new vscode.CancellationTokenSource().token
            );

            // Align cells
            const alignedCells = await this.alignUSFMCells(sourceNotebook.cells, this.importedContent);

            const matchedCells = alignedCells.filter(
                (cell) => cell.notebookCell && !cell.isParatext
            ).length;
            const paratextItems = alignedCells.filter((cell) => cell.isParatext).length;
            const unmatchedContent = alignedCells.filter(
                (cell) => !cell.notebookCell && !cell.isParatext
            ).length;

            // Return preview data
            return {
                original: {
                    preview: fileContentString,
                    validationResults: [{ isValid: true, errors: [] }],
                },
                transformed: {
                    sourceNotebook: {
                        name: path.basename(sourceUri.fsPath),
                        cells: sourceNotebook.cells.map((cell) => ({
                            value: cell.value,
                            metadata: cell.metadata,
                        })),
                    },
                    targetNotebook: {
                        name: path.basename(codexUri.fsPath),
                        cells: alignedCells.map((cell) => ({
                            value: cell.importedContent.content,
                            metadata: cell.notebookCell?.metadata || {
                                id: cell.importedContent.id,
                                type: cell.isParatext ? CodexCellTypes.PARATEXT : CodexCellTypes.TEXT,
                            },
                        })),
                    },
                    matchedCells,
                    unmatchedContent,
                    paratextItems,
                    validationResults: [{ isValid: true, errors: [] }],
                },
                importType: "translation" as const,
            };
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    async execute(
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
        token?: vscode.CancellationToken
    ): Promise<void> {
        if (this.importedContent.length === 0) {
            throw new Error("Transaction not prepared");
        }

        try {
            const progressManager = progress
                ? new ProgressManager(progress, this.importSteps)
                : undefined;

            // Validation step
            await progressManager?.nextStep(token);
            const sourceMetadata = await this.metadataManager.getMetadataById(
                this.sourceNotebookId
            );
            if (!sourceMetadata) {
                throw new Error("Source notebook metadata not found");
            }

            // Preparation step
            await progressManager?.nextStep(token);
            const codexUri = vscode.Uri.file(sourceMetadata.codexFsPath!);
            const serializer = new CodexContentSerializer();

            // Processing step
            await progressManager?.nextStep(token);
            const existingNotebook = await serializer.deserializeNotebook(
                await vscode.workspace.fs.readFile(codexUri),
                token || new vscode.CancellationTokenSource().token
            );

            // Merging step
            await progressManager?.nextStep(token);
            const updatedNotebook = await this.mergeTranslations(
                existingNotebook,
                this.importedContent,
                token
            );

            // Create temp file for the updated notebook
            const tempCodexFile = vscode.Uri.joinPath(
                this.getTempDir(),
                path.basename(codexUri.fsPath)
            );
            const serializedContent = await serializer.serializeNotebook(
                updatedNotebook,
                token || new vscode.CancellationTokenSource().token
            );
            await vscode.workspace.fs.writeFile(tempCodexFile, serializedContent);
            this.state.tempFiles.push(tempCodexFile);

            // Metadata step
            await progressManager?.nextStep(token);
            sourceMetadata.codexLastModified = new Date().toISOString();
            await this.metadataManager.addOrUpdateMetadata(sourceMetadata);

            // Commit step
            await progressManager?.nextStep(token);
            await this.commitChanges();

            this.state.status = "committed";
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    protected async processFiles(): Promise<void> {
        // Implementation handled in execute()
    }

    protected async updateMetadata(): Promise<void> {
        // Implementation handled in execute()
    }

    protected async commitChanges(): Promise<void> {
        const sourceMetadata = await this.metadataManager.getMetadataById(this.sourceNotebookId);
        if (!sourceMetadata?.codexFsPath) {
            throw new Error("Source notebook metadata not found");
        }

        const codexUri = vscode.Uri.file(sourceMetadata.codexFsPath);
        const tempCodexFile = this.state.tempFiles.find((uri) =>
            uri.fsPath.endsWith(path.basename(codexUri.fsPath))
        );

        if (!tempCodexFile) {
            throw new Error("Updated notebook file not found");
        }

        // Copy the updated notebook to its final location
        await vscode.workspace.fs.copy(tempCodexFile, codexUri, { overwrite: true });

        // Clean up temp files
        await this.cleanupTempFiles();
    }

    private async cleanupTempFiles(): Promise<void> {
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

    private async alignUSFMCells(
        notebookCells: CustomNotebookCellData[],
        importedContent: ImportedContent[]
    ): Promise<AlignedCell[]> {
        const alignedCells: AlignedCell[] = [];
        let totalMatches = 0;

        for (const importedItem of importedContent) {
            if (!importedItem.content.trim()) continue;

            const verseId = importedItem.id;
            const notebookCell = notebookCells.find((cell) => cell.metadata.id === verseId);

            if (notebookCell) {
                alignedCells.push({
                    notebookCell,
                    importedContent: importedItem,
                });
                totalMatches++;
            } else {
                // If no matching cell, mark as paratext
                alignedCells.push({
                    notebookCell: null,
                    importedContent: importedItem,
                    isParatext: true,
                });
            }
        }

        if (totalMatches === 0 && importedContent.length > 0) {
            throw new Error(
                "No matching verse identifiers found in USFM. Please check the file format."
            );
        }

        return alignedCells;
    }

    private async mergeTranslations(
        existingNotebook: any,
        importedContent: ImportedContent[],
        token?: vscode.CancellationToken
    ): Promise<any> {
        const existingCells = existingNotebook.cells;
        const alignedCells = await this.alignUSFMCells(existingCells, importedContent);

        let insertedCount = 0;
        let skippedCount = 0;
        let paratextCount = 0;
        let childCellCount = 0;

        let currentBook = "";
        let currentChapter: string | number = 0;

        const newCells: CustomNotebookCellData[] = [];
        const processedSourceCells = new Set<string>();

        for (const alignedCell of alignedCells) {
            this.checkCancellation(token);

            if (alignedCell.notebookCell && !alignedCell.isParatext) {
                const cellIdParts = alignedCell.notebookCell.metadata.id.split(" ");
                currentBook = cellIdParts[0] || currentBook;
                currentChapter = cellIdParts[1]?.split(":")[0] || currentChapter;
            }

            if (alignedCell.isParatext) {
                const section = currentChapter || "1";
                const paratextId = `${currentBook} ${section}:${alignedCell.importedContent.id}`;

                newCells.push({
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    value: alignedCell.importedContent.content,
                    metadata: {
                        type: CodexCellTypes.PARATEXT,
                        id: paratextId,
                        data: {},
                    },
                });
                paratextCount++;
            } else if (alignedCell.notebookCell) {
                const sourceId = alignedCell.notebookCell.metadata.id;
                const cellContent = alignedCell.notebookCell.value.trim();

                if (cellContent === "") {
                    const cellId = processedSourceCells.has(sourceId)
                        ? generateChildCellId(sourceId)
                        : sourceId;

                    newCells.push({
                        kind: vscode.NotebookCellKind.Code,
                        languageId: "html",
                        value: alignedCell.importedContent.content,
                        metadata: {
                            ...alignedCell.notebookCell.metadata,
                            type: CodexCellTypes.TEXT,
                            id: cellId,
                            data: {},
                        },
                    });

                    if (processedSourceCells.has(sourceId)) {
                        childCellCount++;
                    } else {
                        insertedCount++;
                        processedSourceCells.add(sourceId);
                    }
                } else {
                    newCells.push({
                        kind: alignedCell.notebookCell.kind,
                        languageId: alignedCell.notebookCell.metadata.languageId,
                        value: cellContent,
                        metadata: alignedCell.notebookCell.metadata as CustomCellMetaData,
                    } as CustomNotebookCellData);
                    skippedCount++;
                }
            }
        }

        const updatedNotebook = {
            ...existingNotebook,
            cells: newCells,
        };

        vscode.window.showInformationMessage(
            `Merged ${insertedCount} translations, added ${paratextCount} paratext cells, created ${childCellCount} child cells, skipped ${skippedCount} cells.`
        );

        return updatedNotebook;
    }
} 