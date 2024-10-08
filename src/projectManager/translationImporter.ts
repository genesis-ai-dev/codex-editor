import * as vscode from "vscode";
import { WebVTTParser } from "webvtt-parser";
import { CodexContentSerializer, CodexNotebookReader } from "../serializer";
import { SupportedFileExtension, FileType, FileTypeMap, CustomNotebookCellData } from "../../types";
import { CodexCellTypes } from "../../types/enums";

const DEBUG_MODE = true; // Set this to false to disable debug logging

function debug(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[TranslationImporter]", ...args);
    }
}

type CellAligner = (
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
) => AlignedCell[];

export const fileTypeMap: FileTypeMap = {
    vtt: "subtitles",
    txt: "plaintext",
    usfm: "usfm",
    sfm: "usfm",
    SFM: "usfm",
    USFM: "usfm",
};

interface ImportedContent {
    id: string;
    content: string;
    startTime?: number;
    endTime?: number;
}

interface AlignedCell {
    notebookCell: vscode.NotebookCell | null;
    importedContent: ImportedContent;
    isParatext?: boolean;
}

export async function importTranslations(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
    sourceFileName: string
): Promise<void> {
    debug("Starting importTranslations", { fileUri: fileUri.toString(), sourceFileName });

    const fileExtension = vscode.workspace
        .asRelativePath(fileUri)
        .split(".")
        .pop()
        ?.toLowerCase() as SupportedFileExtension;

    debug("File extension", fileExtension);

    let importedContent: ImportedContent[] = [];
    let cellAligner: CellAligner;
    let importedVttData: {
        cues: { text: string; startTime: number; endTime: number; id: string }[];
    } = {
        cues: [],
    };

    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const fileContentString = new TextDecoder().decode(fileContent);

        debug("File content (first 100 characters):", fileContentString.substring(0, 100));
        debug("File content length:", fileContentString.length);

        const fileType = fileTypeMap[fileExtension] || "plaintext";

        debug("File type", fileType);

        switch (fileType) {
            case "subtitles":
                importedVttData = parseVtt(fileContentString);
                cellAligner = alignVTTCells;
                break;
            case "plaintext":
                importedContent = await parsePlaintext(fileUri);
                cellAligner = alignPlaintextCells;
                break;
            case "usfm":
                importedContent = await parseUSFM(fileUri);
                cellAligner = alignUSFMCells;
                break;
            default:
                debug("Unsupported file type", fileType);
                vscode.window.showErrorMessage("Unsupported file type.");
                return;
        }

        if (importedVttData.cues.length > 0) {
            debug("Imported VTT data", importedVttData);
            importedContent = importedVttData.cues.map((cue) => ({
                id: cue.id,
                content: cue.text,
                startTime: cue.startTime,
                endTime: cue.endTime,
            }));
        }

        if (importedContent.length === 0) {
            debug("No content to import");
            vscode.window.showErrorMessage("No content to import.");
            return;
        }

        debug("Imported content length", importedContent.length);

        // Find the corresponding .codex file based on the sourceFileName
        const codexFileName = sourceFileName?.replace(/\.[^.]+$/, ".codex");
        debug("Searching for .codex file", codexFileName);
        const codexFiles = await vscode.workspace.findFiles(`**/${codexFileName}`);
        debug("Codex files found", codexFiles);

        if (codexFiles.length === 0) {
            debug("No matching .codex file found");
            vscode.window.showErrorMessage("No matching .codex file found.");
            return;
        }

        const codexFile = codexFiles[0];
        debug("Matching .codex file found", codexFile.toString());

        await insertZeroDrafts(importedContent, cellAligner, codexFile);
        vscode.window.showInformationMessage("Translation imported successfully.");
        debug("Translation import completed successfully");
    } catch (error: any) {
        debug("Error during import:", error);
        vscode.window.showErrorMessage(`Error during import: ${error.message}`);
        return;
    }
}

const parseVtt = (rawFileContent: string) => {
    debug("Parsing VTT content");
    debug("VTT content (first 100 characters):", rawFileContent.substring(0, 100));
    const vttData = new WebVTTParser().parse(rawFileContent);
    debug("Parsed VTT data", vttData);
    return vttData;
};

async function insertZeroDrafts(
    importedContent: ImportedContent[],
    cellAligner: CellAligner,
    codexFile: vscode.Uri
): Promise<void> {
    debug("Starting insertZeroDrafts");
    const codexNotebook = new CodexNotebookReader(codexFile);

    const codexNotebookCells = await codexNotebook
        .getCells()
        .then((cells) => cells.filter((cell) => cell.kind === vscode.NotebookCellKind.Code));

    debug("Codex notebook cells found", codexNotebookCells.length);

    const alignedCells = cellAligner(codexNotebookCells, importedContent);
    debug("Aligned cells", alignedCells.length);

    let insertedCount = 0;
    let skippedCount = 0;
    let paratextCount = 0;

    const serializer = new CodexContentSerializer();
    const notebookData = await serializer.deserializeNotebook(
        await vscode.workspace.fs.readFile(codexFile),
        new vscode.CancellationTokenSource().token
    );

    const newCells: CustomNotebookCellData[] = [];

    for (const alignedCell of alignedCells) {
        if (alignedCell.isParatext) {
            // Handle paratext cells
            const newCellData: CustomNotebookCellData = {
                kind: vscode.NotebookCellKind.Code,
                languageId: "html",
                value: alignedCell.importedContent.content,
                metadata: {
                    type: CodexCellTypes.PARATEXT, // Changed from TEXT to PARATEXT
                    id: `paratext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    data: {
                        startTime: alignedCell.importedContent.startTime,
                        endTime: alignedCell.importedContent.endTime,
                    },
                },
            };
            newCells.push(newCellData);
            paratextCount++;
        } else if (alignedCell.notebookCell) {
            const cellContent = alignedCell.notebookCell.document.getText().trim();
            if (cellContent === "") {
                // Insert content into empty cell
                const updatedCellData: CustomNotebookCellData = {
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    value: alignedCell.importedContent.content,
                    metadata: {
                        ...alignedCell.notebookCell.metadata,
                        type: CodexCellTypes.TEXT,
                        id: alignedCell.notebookCell.metadata.id,
                        data: {
                            ...alignedCell.notebookCell.metadata.data,
                            startTime: alignedCell.importedContent.startTime,
                            endTime: alignedCell.importedContent.endTime,
                        },
                    },
                };
                newCells.push(updatedCellData);
                insertedCount++;
            } else {
                // Keep the existing cell
                const existingCellData = notebookData.cells.find(
                    (cell) => cell.metadata.id === alignedCell.notebookCell?.metadata.id
                );
                if (existingCellData) {
                    newCells.push(existingCellData);
                }
                skippedCount++;
            }
        }
    }

    // Replace the cells in the notebook with the new order
    notebookData.cells = newCells;

    const updatedNotebookContent = await serializer.serializeNotebook(
        notebookData,
        new vscode.CancellationTokenSource().token
    );

    await vscode.workspace.fs.writeFile(codexFile, updatedNotebookContent);

    debug("Insertion summary", {
        inserted: insertedCount,
        skipped: skippedCount,
        paratext: paratextCount,
    });
    vscode.window.showInformationMessage(
        `Inserted ${insertedCount} drafts, added ${paratextCount} paratext cells, skipped ${skippedCount} cells.`
    );
}

function timestampMismatchResolver(
    notebookCell: vscode.NotebookCell,
    importedContent: ImportedContent
): boolean {
    debug("Resolving timestamp mismatch", {
        cellMetadata: notebookCell.metadata,
        importedContent,
    });
    // Placeholder function for resolving timestamp mismatches
    // Implement more sophisticated logic here
    return true;
}

function calculateOverlap(
    sourceStart: number,
    sourceEnd: number,
    targetStart: number,
    targetEnd: number
): number {
    const overlapStart = Math.max(sourceStart, targetStart);
    const overlapEnd = Math.min(sourceEnd, targetEnd);
    return Math.max(0, overlapEnd - overlapStart);
}

function alignVTTCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): AlignedCell[] {
    debug("Aligning VTT cells with improved overlap strategy and order preservation", {
        notebookCellsCount: notebookCells.length,
        importedContentCount: importedContent.length,
    });

    const alignedCells: AlignedCell[] = [];
    let totalOverlaps = 0;

    importedContent.forEach((importedItem, index) => {
        const sourceCell = notebookCells.find((cell) => {
            const sourceStart = cell.metadata?.data?.startTime;
            const sourceEnd = cell.metadata?.data?.endTime;
            if (sourceStart === undefined || sourceEnd === undefined || importedItem.startTime === undefined || importedItem.endTime === undefined) {
                return false;
            }
            const overlap = calculateOverlap(sourceStart, sourceEnd, importedItem.startTime, importedItem.endTime);
            return overlap > 0;
        });

        if (sourceCell) {
            alignedCells.push({ notebookCell: sourceCell, importedContent: importedItem });
            totalOverlaps += calculateOverlap(
                sourceCell.metadata?.data?.startTime,
                sourceCell.metadata?.data?.endTime,
                importedItem.startTime!,
                importedItem.endTime!
            );
        } else {
            alignedCells.push({
                notebookCell: null,
                importedContent: importedItem,
                isParatext: true,
            });
        }
    });

    if (totalOverlaps === 0 && importedContent.length > 0) {
        vscode.window.showErrorMessage(
            "No overlapping subtitles found. Please check the selected file."
        );
        throw new Error("No overlapping subtitles found.");
    }

    return alignedCells;
}

function alignPlaintextCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): AlignedCell[] {
    debug("Aligning plaintext cells by matching cell IDs", {
        notebookCellsCount: notebookCells.length,
        importedContentCount: importedContent.length,
    });

    const alignedCells: AlignedCell[] = [];
    let totalMatches = 0;

    const cellIdRegex = /^(\w+)\s+(\w+:\w+)(?::\w+)*\s+(.*)$/;

    importedContent.forEach((importedItem, index) => {
        if (!importedItem.content.trim()) {
            // Skip empty lines
            return;
        }

        const match = importedItem.content.match(cellIdRegex);
        if (match) {
            const [, file, cellId, content] = match;
            const notebookCell = notebookCells.find(
                (cell) => cell.metadata.id === cellId
            );

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
    });

    if (totalMatches === 0 && importedContent.length > 0) {
        vscode.window.showErrorMessage(
            "No matching cell IDs found in plaintext. Please check the file format."
        );
        throw new Error("No matching cell IDs found in plaintext.");
    }

    return alignedCells;
}

function alignUSFMCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): AlignedCell[] {
    debug("Aligning USFM cells by matching verse identifiers", {
        notebookCellsCount: notebookCells.length,
        importedContentCount: importedContent.length,
    });

    const alignedCells: AlignedCell[] = [];
    let totalMatches = 0;

    importedContent.forEach((importedItem) => {
        if (!importedItem.content.trim()) {
            // Skip empty lines
            return;
        }

        const verseId = importedItem.id; // Assuming 'id' is in the format 'BOOK CHAPTER:VERSE'

        const notebookCell = notebookCells.find(
            (cell) => cell.metadata.id === verseId
        );

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
    });

    if (totalMatches === 0 && importedContent.length > 0) {
        vscode.window.showErrorMessage(
            "No matching verse identifiers found in USFM. Please check the file format."
        );
        throw new Error("No matching verse identifiers found in USFM.");
    }

    return alignedCells;
}

async function parsePlaintext(fileUri: vscode.Uri): Promise<ImportedContent[]> {
    debug("Parsing plaintext file", fileUri.toString());
    // Placeholder function for parsing plaintext files
    // Implement logic for reading and parsing plaintext content
    return [];
}

async function parseUSFM(fileUri: vscode.Uri): Promise<ImportedContent[]> {
    debug("Parsing USFM file", fileUri.toString());
    // Placeholder function for parsing USFM files
    // Implement logic for reading and parsing USFM content
    return [];
}