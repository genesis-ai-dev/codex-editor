import * as vscode from "vscode";
import { ImportTransaction } from "./ImportTransaction";
import { NotebookMetadataManager, getNotebookMetadataManager } from "../utils/notebookMetadataManager";
import { ProgressManager, ProgressStep } from "../utils/progressManager";
import { CodexContentSerializer } from "../serializer";
import {
    ImportedContent,
    CustomNotebookCellData,
    CustomCellMetaData,
    ValidationResult,
} from "../../types";
import { CodexCellTypes } from "../../types/enums";
import { fileTypeMap } from "../projectManager/translationImporter";
import { WebVTTParser } from "webvtt-parser";
import * as path from "path";
import { generateChildCellId } from "../providers/codexCellEditorProvider/utils/cellUtils";

// Add the interfaces at the top of the file
interface AlignedCell {
    notebookCell: CustomNotebookCellData | null;
    importedContent: ImportedContent;
    isParatext?: boolean;
    isAdditionalOverlap?: boolean;
}

type CellAligner = (
    notebookCells: CustomNotebookCellData[],
    importedContent: ImportedContent[]
) => Promise<AlignedCell[]>;

export class TranslationImportTransaction extends ImportTransaction {
    protected metadataManager: NotebookMetadataManager;
    private readonly context: vscode.ExtensionContext;
    private readonly sourceNotebookId: string;
    private importedContent: ImportedContent[] = [];

    private readonly importSteps: ProgressStep[] = [
        { name: "validation", message: "Validating translation file...", weight: 1 },
        { name: "preparation", message: "Reading translation content...", weight: 2 },
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
        this.metadataManager = getNotebookMetadataManager();
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

            // Parse the content
            this.importedContent = await this.parseFileContent(tempTranslationFile);

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

            // Create preview of alignment
            const cellAligner = this.getAlignerForFileType(this.state.sourceFile);
            const alignedCells = await cellAligner(sourceNotebook.cells, this.importedContent);

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
                    preview: new TextDecoder().decode(
                        await vscode.workspace.fs.readFile(tempTranslationFile)
                    ),
                    validationResults: [{ isValid: true, errors: [] }], // Add proper validation
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
                                type: cell.isParatext ? "paratext" : "text",
                            },
                        })),
                    },
                    matchedCells,
                    unmatchedContent,
                    paratextItems,
                    validationResults: [{ isValid: true, errors: [] }], // Add proper validation
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

    private async parseFileContent(fileUri: vscode.Uri): Promise<ImportedContent[]> {
        const fileExtension = fileUri.fsPath
            .split(".")
            .pop()
            ?.toLowerCase() as keyof typeof fileTypeMap;
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const fileContentString = new TextDecoder().decode(fileContent);

        switch (fileTypeMap[fileExtension]) {
            case "subtitles":
                return this.parseVTT(fileContentString);
            case "plaintext":
                return this.parsePlaintext(fileContentString);
            case "usfm":
                return this.parseUSFM(fileContentString);
            default:
                throw new Error("Unsupported file type.");
        }
    }

    private parseVTT(content: string): ImportedContent[] {
        const parser = new WebVTTParser();
        const vttData = parser.parse(content);

        // Keep track of used timestamps to handle duplicates
        const usedTimestamps = new Set<string>();

        return vttData.cues.map((cue) => {
            // Create a base timestamp ID
            let timestampId = `cue-${cue.startTime}-${cue.endTime}`;

            // If this timestamp is already used, generate a unique child ID
            if (usedTimestamps.has(timestampId)) {
                timestampId = generateChildCellId(timestampId);
            } else {
                usedTimestamps.add(timestampId);
            }

            return {
                id: timestampId,
                content: cue.text,
                startTime: cue.startTime,
                endTime: cue.endTime,
            };
        });
    }

    private parsePlaintext(content: string): ImportedContent[] {
        const lines = content.split(/\r?\n/);
        return lines
            .filter((line) => line.trim())
            .map((line) => ({
                id: `plaintext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                content: line.trim(),
            }));
    }

    private parseUSFM(content: string): ImportedContent[] {
        // Implement USFM parsing logic
        return [];
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

    private async mergeTranslations(
        existingNotebook: any,
        importedContent: ImportedContent[],
        token?: vscode.CancellationToken
    ): Promise<any> {
        const cellAligner = this.getAlignerForFileType(this.state.sourceFile);
        const existingCells = existingNotebook.cells;

        // Get aligned cells using the appropriate aligner
        const alignedCells = await cellAligner(existingCells, importedContent);

        // Track statistics for reporting
        let insertedCount = 0;
        let skippedCount = 0;
        let paratextCount = 0;
        let childCellCount = 0;

        // Track current context for paratext
        let currentBook = "";
        let currentChapter: string | number = 0;

        const newCells: CustomNotebookCellData[] = [];

        // Keep track of cells that have been processed to handle multiple alignments
        const processedSourceCells = new Set<string>();

        for (const alignedCell of alignedCells) {
            this.checkCancellation(token);

            if (alignedCell.notebookCell && !alignedCell.isParatext) {
                // Update context based on non-paratext cells
                const cellIdParts = alignedCell.notebookCell.metadata.id.split(" ");
                currentBook = cellIdParts[0] || currentBook;
                currentChapter = cellIdParts[1]?.split(":")[0] || currentChapter;
            }

            if (alignedCell.isParatext) {
                // Handle paratext cells
                const section = currentChapter || "1";
                const paratextId = `${currentBook} ${section}:${alignedCell.importedContent.id}`;

                newCells.push({
                    kind: vscode.NotebookCellKind.Code,
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
                });
                paratextCount++;
            } else if (alignedCell.notebookCell) {
                const sourceId = alignedCell.notebookCell.metadata.id;
                const cellContent = alignedCell.notebookCell.value.trim();

                if (cellContent === "") {
                    // For empty cells, use the source cell's ID directly
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
                            data: {
                                ...alignedCell.notebookCell.metadata.data,
                                startTime: alignedCell.importedContent.startTime,
                                endTime: alignedCell.importedContent.endTime,
                            },
                        },
                    });

                    if (processedSourceCells.has(sourceId)) {
                        childCellCount++;
                    } else {
                        insertedCount++;
                        processedSourceCells.add(sourceId);
                    }
                } else {
                    // Keep existing cell content
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

        // Update notebook with new cells
        const updatedNotebook = {
            ...existingNotebook,
            cells: newCells,
        };

        // Report statistics
        vscode.window.showInformationMessage(
            `Merged ${insertedCount} translations, added ${paratextCount} paratext cells, created ${childCellCount} child cells, skipped ${skippedCount} cells.`
        );

        return updatedNotebook;
    }

    private getAlignerForFileType(fileUri: vscode.Uri): CellAligner {
        const fileExtension = fileUri.fsPath
            .split(".")
            .pop()
            ?.toLowerCase() as keyof typeof fileTypeMap;

        switch (fileTypeMap[fileExtension]) {
            case "subtitles":
                return this.alignVTTCells.bind(this); // Bind the method to this instance
            case "plaintext":
                return this.alignPlaintextCells.bind(this);
            case "usfm":
                return this.alignUSFMCells.bind(this);
            default:
                throw new Error("Unsupported file type.");
        }
    }

    // Add this helper function
    private convertVTTTimeToSeconds(timestamp: string | number | undefined): number {
        if (!timestamp) return 0;

        // If timestamp is already a number, return it
        if (typeof timestamp === "number") {
            return timestamp;
        }

        // Handle VTT timestamp format (HH:MM:SS.mmm)
        const [time, milliseconds] = timestamp.split(".");
        const [hours, minutes, seconds] = time.split(":").map(Number);
        return hours * 3600 + minutes * 60 + seconds + Number(milliseconds) / 1000;
    }

    private normalizeTimestamps(
        sourceStart: number,
        sourceEnd: number,
        targetStart: number,
        targetEnd: number
    ): { sourceStart: number; sourceEnd: number; targetStart: number; targetEnd: number } {
        // If there's a large gap (e.g., hour difference), normalize by subtracting the difference
        const hourInSeconds = 3600;
        const sourceMidpoint = (sourceStart + sourceEnd) / 2;
        const targetMidpoint = (targetStart + targetEnd) / 2;
        const difference = Math.abs(sourceMidpoint - targetMidpoint);

        // If the difference is close to an hour multiple
        if (difference > hourInSeconds / 2) {
            const hourOffset = Math.round(difference / hourInSeconds) * hourInSeconds;

            // Determine which timestamps need adjustment
            if (sourceMidpoint > targetMidpoint) {
                return {
                    sourceStart: sourceStart - hourOffset,
                    sourceEnd: sourceEnd - hourOffset,
                    targetStart,
                    targetEnd,
                };
            } else {
                return {
                    sourceStart,
                    sourceEnd,
                    targetStart: targetStart - hourOffset,
                    targetEnd: targetEnd - hourOffset,
                };
            }
        }

        return { sourceStart, sourceEnd, targetStart, targetEnd };
    }

    private async alignVTTCells(
        notebookCells: CustomNotebookCellData[],
        importedContent: ImportedContent[]
    ): Promise<AlignedCell[]> {
        const alignedCells: AlignedCell[] = [];
        let totalOverlaps = 0;
        const sourceCellOverlapCount: { [key: string]: number } = {};

        for (const importedItem of importedContent) {
            if (!importedItem.content.trim()) continue;

            const importStart = this.convertVTTTimeToSeconds(importedItem.startTime);
            const importEnd = this.convertVTTTimeToSeconds(importedItem.endTime);
            let foundOverlap = false;

            // Try to find an overlapping cell
            const sourceCell = notebookCells.find((cell) => {
                // Convert string timestamps to numbers if needed
                const sourceStart =
                    typeof cell.metadata?.data?.startTime === "string"
                        ? parseFloat(cell.metadata.data.startTime)
                        : cell.metadata?.data?.startTime;
                const sourceEnd =
                    typeof cell.metadata?.data?.endTime === "string"
                        ? parseFloat(cell.metadata.data.endTime)
                        : cell.metadata?.data?.endTime;

                if (!sourceStart || !sourceEnd || isNaN(importStart) || isNaN(importEnd)) {
                    return false;
                }

                // Normalize timestamps before checking overlap
                const normalized = this.normalizeTimestamps(
                    sourceStart,
                    sourceEnd,
                    importStart,
                    importEnd
                );

                const overlap = this.calculateOverlap(
                    normalized.sourceStart,
                    normalized.sourceEnd,
                    normalized.targetStart,
                    normalized.targetEnd
                );

                if (overlap > 0) {
                    foundOverlap = true;
                    return true;
                }
                return false;
            });

            if (sourceCell) {
                // Handle overlapping content
                const sourceId = sourceCell.metadata.id;
                if (!sourceCellOverlapCount[sourceId]) {
                    sourceCellOverlapCount[sourceId] = 1;
                    alignedCells.push({
                        notebookCell: sourceCell,
                        importedContent: { ...importedItem, id: sourceId },
                    });
                } else {
                    sourceCellOverlapCount[sourceId]++;
                    alignedCells.push({
                        notebookCell: sourceCell,
                        importedContent: {
                            ...importedItem,
                            id: generateChildCellId(sourceId),
                        },
                        isAdditionalOverlap: true,
                    });
                }
                totalOverlaps++;
            } else {
                // Create paratext for non-overlapping content
                alignedCells.push({
                    notebookCell: null,
                    importedContent: {
                        ...importedItem,
                        id: `paratext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    },
                    isParatext: true,
                });
            }
        }

        // Only throw if we found no overlaps at all
        if (totalOverlaps === 0 && importedContent.length > 0) {
            throw new Error("No overlapping content found. Please check the selected file.");
        }

        return alignedCells;
    }

    private calculateOverlap(
        sourceStart: number,
        sourceEnd: number,
        targetStart: number,
        targetEnd: number
    ): number {
        const overlapStart = Math.max(sourceStart, targetStart);
        const overlapEnd = Math.min(sourceEnd, targetEnd);
        return Math.max(0, overlapEnd - overlapStart);
    }

    private async alignPlaintextCells(
        notebookCells: CustomNotebookCellData[],
        importedContent: ImportedContent[]
    ): Promise<AlignedCell[]> {
        const alignedCells: AlignedCell[] = [];
        let totalMatches = 0;

        const cellIdRegex = /^(\w+)\s+(\w+:\w+)(?::\w+)*\s+(.*)$/;

        for (const importedItem of importedContent) {
            if (!importedItem.content.trim()) continue;

            const match = importedItem.content.match(cellIdRegex);
            if (match) {
                const [, file, cellId, content] = match;
                const notebookCell = notebookCells.find((cell) => cell.metadata.id === cellId);

                if (notebookCell) {
                    alignedCells.push({
                        notebookCell,
                        importedContent: { ...importedItem, content },
                    });
                    totalMatches++;
                } else {
                    // If no matching cell, mark as paratext
                    alignedCells.push({
                        notebookCell: null,
                        importedContent: { ...importedItem, content },
                        isParatext: true,
                    });
                }
            } else {
                // If line doesn't match the pattern, treat it as paratext
                alignedCells.push({
                    notebookCell: null,
                    importedContent: importedItem,
                    isParatext: true,
                });
            }
        }

        if (totalMatches === 0 && importedContent.length > 0) {
            throw new Error(
                "No matching cell IDs found in plaintext. Please check the file format."
            );
        }

        return alignedCells;
    }

    private async alignUSFMCells(
        notebookCells: CustomNotebookCellData[],
        importedContent: ImportedContent[]
    ): Promise<AlignedCell[]> {
        const alignedCells: AlignedCell[] = [];
        let totalMatches = 0;

        for (const importedItem of importedContent) {
            if (!importedItem.content.trim()) continue;

            const verseId = importedItem.id; // Assuming 'id' is in the format 'BOOK CHAPTER:VERSE'
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
}
