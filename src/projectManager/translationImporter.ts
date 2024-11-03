import * as vscode from "vscode";
import { WebVTTParser } from "webvtt-parser";
import { CodexContentSerializer, CodexNotebookReader } from "../serializer";
import {
    SupportedFileExtension,
    FileType,
    FileTypeMap,
    CustomNotebookCellData,
    ImportedContent,
} from "../../types";
import { CodexCellTypes } from "../../types/enums";
import * as fs from "fs/promises"; // Add this import if not already present
import * as path from "path";
import * as grammar from "usfm-grammar";
import { ParsedUSFM } from "usfm-grammar";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";

const DEBUG_MODE = true; // Set this to false to disable debug logging

function debug(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[TranslationImporter]", ...args);
    }
}

type CellAligner = (
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
) => Promise<AlignedCell[]>;

export const fileTypeMap: FileTypeMap = {
    vtt: "subtitles",
    txt: "plaintext",
    usfm: "usfm",
    usx: "usx",
    sfm: "usfm",
    SFM: "usfm",
    USFM: "usfm",
};

interface AlignedCell {
    notebookCell: vscode.NotebookCell | null;
    importedContent: ImportedContent;
    isParatext?: boolean;
    // Added: Indicates if this cell is an additional overlap
    isAdditionalOverlap?: boolean;
}

export async function importTranslations(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
    sourceNotebookId: string
): Promise<void> {
    debug("Starting importTranslations", { fileUri: fileUri.toString(), sourceNotebookId });

    const fileExtension = fileUri.fsPath.split(".").pop()?.toLowerCase() as SupportedFileExtension;

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

        const parseVtt = (rawFileContent: string) => {
            debug("Parsing VTT content");
            debug("VTT content (first 100 characters):", rawFileContent.substring(0, 100));
            const vttData = new WebVTTParser().parse(rawFileContent);
            debug("Parsed VTT data", vttData);
            return vttData;
        };

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

        const metadataManager = new NotebookMetadataManager();
        await metadataManager.initialize();
        await metadataManager.loadMetadata();

        const sourceMetadata = metadataManager.getMetadataById(sourceNotebookId);

        if (!sourceMetadata) {
            debug("No matching metadata found for the source notebook");
            vscode.window.showErrorMessage("No matching metadata found for the source notebook.");
            return;
        }

        if (!sourceMetadata.codexFsPath) {
            debug("No .codex file found. Creating a new one.");
            const baseName = sourceMetadata.originalName;
            const codexUri = vscode.Uri.joinPath(
                vscode.workspace.workspaceFolders![0].uri,
                "files",
                "target",
                `${baseName}.codex`
            );
            sourceMetadata.codexFsPath = codexUri.fsPath;

            // Create an empty notebook data
            const serializer = new CodexContentSerializer();
            const emptyNotebookData = new vscode.NotebookData([]);
            emptyNotebookData.metadata = {}; // Add any required metadata here
            const emptyNotebookBytes = await serializer.serializeNotebook(
                emptyNotebookData,
                new vscode.CancellationTokenSource().token
            );
            await vscode.workspace.fs.writeFile(codexUri, emptyNotebookBytes);

            await metadataManager.addOrUpdateMetadata(sourceMetadata);
        }

        const codexFile = sourceMetadata.codexFsPath;
        debug("Matching .codex file found or created", codexFile);

        await insertZeroDrafts(importedContent, cellAligner, codexFile);

        // Update metadata after insertion
        metadataManager.addOrUpdateMetadata({
            ...sourceMetadata,
            codexFsPath: codexFile,
        });

        vscode.window.showInformationMessage("Translation imported successfully.");
        debug("Translation import completed successfully");
    } catch (error: any) {
        debug("Error during import:", error);
        vscode.window.showErrorMessage(`Error during import: ${error.message}`);
        return;
    }
}

async function insertZeroDrafts(
    importedContent: ImportedContent[],
    cellAligner: CellAligner,
    codexFile: string
): Promise<void> {
    debug("Starting insertZeroDrafts");
    const codexNotebook = new CodexNotebookReader(vscode.Uri.file(codexFile));

    const codexNotebookCells = await codexNotebook
        .getCells()
        .then((cells) => cells.filter((cell) => cell.kind === vscode.NotebookCellKind.Code));

    debug("Codex notebook cells found", codexNotebookCells.length);

    const alignedCells = await cellAligner(codexNotebookCells, importedContent);
    debug("Aligned cells", alignedCells.length);

    let insertedCount = 0;
    let skippedCount = 0;
    let paratextCount = 0;
    let currentBook: string = ""; // To track the current book
    let currentChapter: string | number = 0; // To track the current chapter, default to 0 for leading paratext

    const codexFileUri = vscode.Uri.file(codexFile);
    const serializer = new CodexContentSerializer();
    const notebookData = await serializer.deserializeNotebook(
        await vscode.workspace.fs.readFile(codexFileUri),
        new vscode.CancellationTokenSource().token
    );

    const newCells: CustomNotebookCellData[] = [];

    for (const alignedCell of alignedCells) {
        if (alignedCell.notebookCell && !alignedCell.isParatext) {
            // Update currentBook and currentChapter based on non-paratext cells
            const cellIdParts = alignedCell.notebookCell.metadata.id.split(" ");
            currentBook = cellIdParts[0] || path.basename(codexFileUri.path).split(".")[0] || "";
            currentChapter = cellIdParts[1]?.split(":")[0] || "1";
        }

        if (alignedCell.isParatext) {
            // Determine the section for the paratext cell
            const section = currentChapter || "1";
            const paratextId = `${currentBook} ${section}:${alignedCell.importedContent.id}`;

            // Handle paratext cells
            const newCellData: CustomNotebookCellData = {
                kind: vscode.NotebookCellKind.Code,
                languageId: "html",
                value: alignedCell.importedContent.content,
                metadata: {
                    type: CodexCellTypes.PARATEXT,
                    id: paratextId, // Ensure the ID starts with [book] [section]
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
                        id: alignedCell.importedContent.id, // Use the potentially nested ID
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

    await vscode.workspace.fs.writeFile(codexFileUri, updatedNotebookContent);

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

async function alignVTTCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> {
    debug("Aligning VTT cells with improved overlap strategy and order preservation", {
        notebookCellsCount: notebookCells.length,
        importedContentCount: importedContent.length,
    });

    const alignedCells: AlignedCell[] = [];
    let totalOverlaps = 0;

    // Map to track how many overlaps each source cell has
    const sourceCellOverlapCount: { [key: string]: number } = {};

    importedContent.forEach((importedItem) => {
        if (!importedItem.content.trim()) {
            // Skip empty lines
            return;
        }

        const sourceCell = notebookCells.find((cell) => {
            const sourceStart = cell.metadata?.data?.startTime;
            const sourceEnd = cell.metadata?.data?.endTime;
            if (
                sourceStart === undefined ||
                sourceEnd === undefined ||
                importedItem.startTime === undefined ||
                importedItem.endTime === undefined
            ) {
                return false;
            }
            const overlap = calculateOverlap(
                sourceStart,
                sourceEnd,
                importedItem.startTime,
                importedItem.endTime
            );
            return overlap > 0;
        });

        if (sourceCell) {
            const sourceId = sourceCell.metadata.id;
            if (!sourceCellOverlapCount[sourceId]) {
                sourceCellOverlapCount[sourceId] = 1;
                alignedCells.push({
                    notebookCell: sourceCell,
                    importedContent: {
                        ...importedItem,
                        id: sourceId, // Use the source cell's ID for the first overlap
                    },
                });
            } else {
                sourceCellOverlapCount[sourceId]++;
                const nestedId = `${sourceId}:${Date.now()}-${Math.random()
                    .toString(36)
                    .substr(2, 9)}`;
                alignedCells.push({
                    notebookCell: sourceCell,
                    isAdditionalOverlap: true,
                    importedContent: {
                        ...importedItem,
                        id: nestedId,
                    },
                });
            }
            totalOverlaps++;
        } else {
            // If no matching cell, mark as paratext
            const paratextId = `paratext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            alignedCells.push({
                notebookCell: null,
                importedContent: { ...importedItem, id: paratextId },
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

async function alignPlaintextCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> {
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
    });

    if (totalMatches === 0 && importedContent.length > 0) {
        vscode.window.showErrorMessage(
            "No matching cell IDs found in plaintext. Please check the file format."
        );
        throw new Error("No matching cell IDs found in plaintext.");
    }

    return alignedCells;
}

async function alignUSFMCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> {
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

    const importedContent: ImportedContent[] = [];

    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const fileContentString = new TextDecoder("utf-8").decode(fileContent);
        const lines = fileContentString.split(/\r?\n/);

        const cellIdRegex = /^(\w+)\s+(\w+:\w+)(?::\w+)*\s+(.*)$/;

        for (const line of lines) {
            if (!line.trim()) {
                // Skip empty lines
                continue;
            }

            const match = line.match(cellIdRegex);
            if (match) {
                const [, file, cellId, content] = match;
                importedContent.push({
                    id: cellId,
                    content: content.trim(),
                });
            } else {
                // If line doesn't match the pattern, treat it as paratext
                importedContent.push({
                    id: `paratext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    content: line.trim(),
                });
            }
        }

        debug("Parsed plaintext content", importedContent);
    } catch (error: any) {
        debug("Error parsing plaintext file:", error);
        vscode.window.showErrorMessage(`Error parsing plaintext file: ${error.message}`);
    }

    return importedContent;
}

async function parseUSFM(fileUri: vscode.Uri): Promise<ImportedContent[]> {
    debug("Parsing USFM file", fileUri.toString());

    const importedContent: ImportedContent[] = [];

    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const fileContentString = new TextDecoder("utf-8").decode(fileContent);

        // Use usfm-grammar in relaxed mode for parsing
        const relaxedUsfmParser = new grammar.USFMParser(fileContentString, grammar.LEVEL.RELAXED);
        const jsonOutput = relaxedUsfmParser.toJSON() as any as ParsedUSFM;

        const bookCode = jsonOutput.book.bookCode;
        jsonOutput.chapters.forEach((chapter: any) => {
            const chapterNumber = chapter.chapterNumber;
            chapter.contents.forEach((content: any) => {
                if (content.verseNumber !== undefined && content.verseText !== undefined) {
                    const verseId = `${bookCode} ${chapterNumber}:${content.verseNumber}`;
                    importedContent.push({
                        id: verseId,
                        content: content.verseText.trim(),
                    });
                } else if (content.text && !content.marker) {
                    // Treat lines without a marker as paratext
                    importedContent.push({
                        id: `paratext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        content: content.text.trim(),
                    });
                }
            });
        });

        debug("Parsed USFM content", importedContent);
    } catch (error: any) {
        debug("Error parsing USFM file:", error);
        vscode.window.showErrorMessage(`Error parsing USFM file: ${error.message}`);
    }

    return importedContent;
}
