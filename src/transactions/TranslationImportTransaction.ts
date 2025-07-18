import * as vscode from "vscode";
import { ImportTransaction } from "./ImportTransaction";
import {
    NotebookMetadataManager,
    getNotebookMetadataManager,
} from "../utils/notebookMetadataManager";
import { ProgressManager, ProgressStep } from "../utils/progressManager";
import { CodexContentSerializer } from "../serializer";
import {
    ImportedContent,
    CustomNotebookCellData,
    CustomCellMetaData,
    ValidationResult,
    CodexNotebookAsJSONData,
} from "../../types";
import { CodexCellTypes } from "../../types/enums";
import { fileTypeMap } from "../projectManager/fileTypeMap_deprecated";
import { WebVTTParser } from "webvtt-parser";
import * as path from "path";
import { generateChildCellId } from "../providers/codexCellEditorProvider/utils/cellUtils";
import { resolveCodexCustomMerge } from "@/projectManager/utils/merge/resolvers";

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

const DEBUG = false;
const debug = function (...args: any[]) {
    if (DEBUG) {
        console.log("[TranslationImportTransaction]", ...args);
    }
};

export class TranslationImportTransaction extends ImportTransaction {
    protected metadataManager: NotebookMetadataManager;
    private readonly context: vscode.ExtensionContext;
    private readonly sourceNotebookId: string;
    private importedContent: ImportedContent[] = [];
    private rawImportedContent: CodexNotebookAsJSONData | undefined;

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
            const serializer = new CodexContentSerializer();

            // Only try to deserialize as notebook if it's a codex file
            const fileExtension = this.state.sourceFile.fsPath
                .split(".")
                .pop()
                ?.toLowerCase() as keyof typeof fileTypeMap;

            if (fileTypeMap[fileExtension] === "codex") {
                this.rawImportedContent = await serializer.deserializeNotebook(
                    await vscode.workspace.fs.readFile(tempTranslationFile),
                    new vscode.CancellationTokenSource().token
                );
            }

            // Get source notebook content
            const sourceMetadata = await this.metadataManager.getMetadataById(
                this.sourceNotebookId
            );
            if (!sourceMetadata?.originalName) {
                throw new Error("Source notebook not found");
            }

            // Find the source and codex files in the workspace
            console.log("Source metadata original name:", sourceMetadata.originalName);

            const sourceFile = await this.findFileInWorkspace(sourceMetadata.originalName);
            const codexFileName = sourceMetadata.originalName
                .replace(/\.source\b/g, ".codex") // Replace .source with .codex
                .replace(/\.source\./g, ".codex.") // Replace .source. with .codex.
                .replace(/^(.+?)(?:\..*)?$/, "$1.codex"); // Add .codex if no extension

            console.log("Looking for codex file with name:", codexFileName);
            const codexFile = await this.findFileInWorkspace(codexFileName);

            if (!sourceFile || !codexFile) {
                console.log("Source file found:", sourceFile?.fsPath);
                console.log("Codex file found:", codexFile?.fsPath);
                throw new Error("Could not locate source or codex files in workspace");
            }

            const sourceContent = await vscode.workspace.fs.readFile(sourceFile);
            console.log("Source content:", sourceContent);
            const sourceNotebook = await serializer.deserializeNotebook(
                sourceContent,
                new vscode.CancellationTokenSource().token
            );

            // Create preview of alignment
            const cellAligner = this.getAlignerForFileType(this.state.sourceFile);
            const alignedCells = await cellAligner(sourceNotebook.cells, this.importedContent);
            debug("Aligned cells:", alignedCells);
            const matchedCells = alignedCells.filter(
                (cell) => cell.notebookCell && !cell.isParatext
            ).length;
            debug("Matched cells:", matchedCells);
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
                        name: path.basename(sourceFile.fsPath),
                        cells: sourceNotebook.cells.map((cell) => ({
                            value: cell.value,
                            metadata: cell.metadata,
                        })),
                    },
                    targetNotebook: {
                        name: path.basename(codexFile.fsPath),
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
            if (!sourceMetadata?.originalName) {
                throw new Error("Source notebook metadata not found");
            }

            // Preparation step
            await progressManager?.nextStep(token);
            const codexFile = await this.findFileInWorkspace(
                sourceMetadata.originalName
                    .replace(/\.source\b/g, ".codex") // Replace .source with .codex
                    .replace(/\.source\./g, ".codex.") // Replace .source. with .codex.
                    .replace(/^(.+?)(?:\..*)?$/, "$1.codex") // Add .codex if no extension
            );
            if (!codexFile) {
                throw new Error("Could not locate codex file in workspace");
            }

            const serializer = new CodexContentSerializer();

            // Processing step
            await progressManager?.nextStep(token);
            const existingNotebook = await serializer.deserializeNotebook(
                await vscode.workspace.fs.readFile(codexFile),
                token || new vscode.CancellationTokenSource().token
            );

            // Merging step
            await progressManager?.nextStep(token);
            const updatedNotebook = await this.mergeTranslations(
                existingNotebook,
                this.importedContent,
                token,
                existingNotebook,
                this.rawImportedContent
            );

            console.log("Updated notebook:", updatedNotebook);

            // Create temp file for the updated notebook
            const tempCodexFile = vscode.Uri.joinPath(
                this.getTempDir(),
                path.basename(codexFile.fsPath)
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
        if (!sourceMetadata?.originalName) {
            throw new Error("Source notebook metadata not found");
        }

        const codexFile = await this.findFileInWorkspace(
            sourceMetadata.originalName
                .replace(/\.source\b/g, ".codex") // Replace .source with .codex
                .replace(/\.source\./g, ".codex.") // Replace .source. with .codex.
                .replace(/^(.+?)(?:\..*)?$/, "$1.codex") // Add .codex if no extension
        );
        if (!codexFile) {
            throw new Error("Could not locate codex file in workspace");
        }

        const tempCodexFile = this.state.tempFiles.find((uri) =>
            uri.fsPath.endsWith(path.basename(codexFile.fsPath))
        );

        if (!tempCodexFile) {
            throw new Error("Updated notebook file not found");
        }

        // Copy the updated notebook to its final location
        await vscode.workspace.fs.copy(tempCodexFile, codexFile, { overwrite: true });

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
            case "codex":
                return this.parseCodex(fileContentString);
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

    private async parseCodex(fileContentString: string): Promise<ImportedContent[]> {
        debug("Parsing Codex file content");
        const importedContent: ImportedContent[] = [];

        try {
            const serializer = new CodexContentSerializer();
            const notebookData = await serializer.deserializeNotebook(
                Buffer.from(fileContentString),
                new vscode.CancellationTokenSource().token
            );

            // Process each cell in the notebook
            for (const cell of notebookData.cells) {
                if (cell.metadata?.id && cell.value) {
                    debug(`Processing cell with ID: ${cell.metadata.id}`);
                    importedContent.push({
                        id: cell.metadata.id,
                        content: cell.value.trim(),
                        edits: cell.metadata.edits,
                        // Include any additional metadata if needed
                        startTime: cell.metadata.data?.startTime,
                        endTime: cell.metadata.data?.endTime,
                    });
                } else {
                    debug(`Skipping cell without ID or value:`, cell);
                }
            }

            debug("Parsed Codex content", {
                totalCells: notebookData.cells.length,
                importedCells: importedContent.length,
            });

            if (importedContent.length === 0) {
                throw new Error("No valid cells found in codex file");
            }
        } catch (error: any) {
            debug("Error parsing Codex file:", error);
            vscode.window.showErrorMessage(`Error parsing Codex file: ${error.message}`);
            throw error; // Re-throw to ensure the transaction fails properly
        }

        return importedContent;
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
        token?: vscode.CancellationToken,
        rawExistingNotebook?: CodexNotebookAsJSONData,
        rawImportedContent?: CodexNotebookAsJSONData
    ): Promise<CodexNotebookAsJSONData> {
        debug("Starting mergeTranslations", {
            importedContentLength: importedContent.length,
            hasRawExisting: !!rawExistingNotebook,
            hasRawImported: !!rawImportedContent,
        });

        if (rawExistingNotebook && rawImportedContent) {
            debug("Using codex merge strategy");
            const resolvedContent = await resolveCodexCustomMerge(
                JSON.stringify(rawExistingNotebook),
                JSON.stringify(rawImportedContent)
            );
            return JSON.parse(resolvedContent) as CodexNotebookAsJSONData;
        }

        debug("Using standard cell alignment strategy");
        const cellAligner = this.getAlignerForFileType(this.state.sourceFile);
        const existingCells = existingNotebook.cells;

        // Get aligned cells using the appropriate aligner
        const alignedCells = await cellAligner(existingCells, importedContent);
        debug("Aligned cells", {
            total: alignedCells.length,
            withNotebookCell: alignedCells.filter((c) => c.notebookCell).length,
            paratext: alignedCells.filter((c) => c.isParatext).length,
        });

        // Track statistics for reporting
        let insertedCount = 0;
        let skippedCount = 0;
        let paratextCount = 0;
        let childCellCount = 0;

        // Track current context for paratext
        let currentBook = "";
        let currentChapter: string | number = 0;

        // Create a map of existing cells for quick lookup
        const existingCellsMap = new Map<string, CustomNotebookCellData>();
        existingCells.forEach((cell: CustomNotebookCellData) => {
            if (cell.metadata?.id) {
                existingCellsMap.set(cell.metadata.id, cell);
            }
        });

        // Store processed cells that should be updated or added to the notebook
        const processedCells = new Map<string, CustomNotebookCellData>();

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

                const paratextCell = {
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
                        edits: [],
                    },
                };
                processedCells.set(paratextId, paratextCell);
                paratextCount++;
            } else if (alignedCell.notebookCell) {
                const sourceId = alignedCell.notebookCell.metadata.id;
                const cellContent = alignedCell.notebookCell.value.trim();

                if (cellContent === "") {
                    // For empty cells, use the source cell's ID directly
                    const cellId = processedSourceCells.has(sourceId)
                        ? generateChildCellId(sourceId)
                        : sourceId;

                    const updatedCell = {
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
                    };
                    processedCells.set(cellId, updatedCell);

                    if (processedSourceCells.has(sourceId)) {
                        childCellCount++;
                    } else {
                        insertedCount++;
                        processedSourceCells.add(sourceId);
                    }
                } else {
                    // Keep existing cell content
                    processedCells.set(sourceId, alignedCell.notebookCell);
                    skippedCount++;
                }
            }
        }

        // Now build the final cell array, preserving order of original cells when possible
        const newCells: CustomNotebookCellData[] = [];

        // First add all existing cells, updating those that were processed
        for (const cell of existingCells) {
            const cellId = cell.metadata?.id;
            if (cellId && processedCells.has(cellId)) {
                // This cell was processed, use the updated version
                newCells.push(processedCells.get(cellId)!);
                processedCells.delete(cellId); // Remove from map to track what's been added
            } else {
                // This cell wasn't in the imported content, keep it unchanged
                newCells.push(cell);
            }
        }

        // Then add any remaining processed cells (new paratext, etc.) that weren't in the original
        for (const [, cell] of processedCells) {
            newCells.push(cell);
        }

        // Update notebook with combined cells
        const updatedNotebook: CodexNotebookAsJSONData = {
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
            case "codex":
                return alignCodexCells.bind(this);
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
                const [, book, verse, content] = match;
                // Combine book and verse to match cell metadata.id format
                const fullCellId = `${book} ${verse}`;
                console.log(`Looking for cell with ID: ${fullCellId}`);
                const notebookCell = notebookCells.find((cell) => cell.metadata.id === fullCellId);

                if (notebookCell) {
                    alignedCells.push({
                        notebookCell,
                        importedContent: { ...importedItem, content },
                    });
                    totalMatches++;
                    console.log(`Match found for cell ID: ${fullCellId}`);
                } else {
                    console.log(`No match found for cell ID: ${fullCellId}`);
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
            console.log(
                "Available cell IDs in notebook:",
                notebookCells.map((cell) => cell.metadata.id).join(", ")
            );
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

    private async findFileInWorkspace(fileName: string): Promise<vscode.Uri | undefined> {
        console.log("Searching for file:", fileName);

        // Add .source extension if it's missing and we're looking for a source file
        const sourceFileName = fileName.endsWith(".source") ? fileName : `${fileName}.source`;

        // Try to find source file in .project/sourceTexts/
        const sourcePattern = `**/.project/sourceTexts/${sourceFileName}`;
        console.log("Searching for source file with pattern:", sourcePattern);
        const sourceFiles = await vscode.workspace.findFiles(sourcePattern);
        console.log(
            "Source files found:",
            sourceFiles.map((f) => f.fsPath)
        );
        if (sourceFiles.length > 0) {
            return sourceFiles[0];
        }

        // Try to find codex file in files/target/
        const codexFileName = fileName.endsWith(".codex") ? fileName : `${fileName}.codex`;
        const codexPattern = `**/files/target/${codexFileName}`;
        console.log("Searching for codex file with pattern:", codexPattern);
        const codexFiles = await vscode.workspace.findFiles(codexPattern);
        console.log(
            "Codex files found:",
            codexFiles.map((f) => f.fsPath)
        );
        if (codexFiles.length > 0) {
            return codexFiles[0];
        }

        // Fallback to searching anywhere in the workspace with both extensions
        console.log("Falling back to workspace-wide search for:", fileName);
        const files = await vscode.workspace.findFiles(`**/${fileName}*`);
        console.log(
            "Files found in workspace:",
            files.map((f) => f.fsPath)
        );
        return files[0];
    }
}

async function alignCodexCells(
    notebookCells: CustomNotebookCellData[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> {
    debug("Aligning Codex cells", {
        notebookCellsCount: notebookCells.length,
        importedContentCount: importedContent.length,
    });

    const alignedCells: AlignedCell[] = [];
    let totalMatches = 0;

    // First pass: Match exact IDs
    for (const importedItem of importedContent) {
        if (!importedItem.content.trim()) {
            debug("Skipping empty imported content");
            continue;
        }

        debug(`Looking for match for imported item with ID: ${importedItem.id}`);
        const notebookCell = notebookCells.find((cell) => cell.metadata?.id === importedItem.id);

        if (notebookCell) {
            debug(`Found matching cell for ID: ${importedItem.id}`);
            alignedCells.push({
                notebookCell,
                importedContent: importedItem,
            });
            totalMatches++;
        } else {
            debug(`No match found for ID: ${importedItem.id}, treating as paratext`);
            // If no match found, treat as paratext
            alignedCells.push({
                notebookCell: null,
                importedContent: importedItem,
                isParatext: true,
            });
        }
    }

    debug("Alignment complete", {
        totalMatches,
        totalAlignedCells: alignedCells.length,
        paratextCells: alignedCells.filter((c) => c.isParatext).length,
    });

    // Don't throw an error if we have no matches - we'll treat unmatched content as paratext
    return alignedCells;
}
