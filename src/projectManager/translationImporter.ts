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
    notebookCell: vscode.NotebookCell;
    importedContent: ImportedContent;
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
    const workspaceEdit = new vscode.WorkspaceEdit();

    const codexNotebookCells = await codexNotebook
        .getCells()
        .then((cells) => cells.filter((cell) => cell.kind === vscode.NotebookCellKind.Code));

    debug("Codex notebook cells found", codexNotebookCells.length);

    const alignedCells = cellAligner(codexNotebookCells, importedContent);
    debug("Aligned cells", alignedCells.length);

    let insertedCount = 0;
    let skippedCount = 0;

    const serializer = new CodexContentSerializer();
    const notebookData = await serializer.deserializeNotebook(
        await vscode.workspace.fs.readFile(codexFile),
        new vscode.CancellationTokenSource().token
    );

    for (const { notebookCell, importedContent } of alignedCells) {
        const cellContent = notebookCell.document.getText().trim();

        if (cellContent === "") {
            debug("Inserting content into empty cell");
            const updatedCellData: CustomNotebookCellData = {
                kind: vscode.NotebookCellKind.Code,
                languageId: "html",
                value: importedContent.content,
                metadata: {
                    ...notebookCell.metadata,
                    type: CodexCellTypes.TEXT,
                    id: notebookCell.metadata.id, // ! PICKING UP !!!!!!!!! [RYDER]
                    data: {
                        ...notebookCell.metadata.data,
                        startTime: importedContent.startTime,
                        endTime: importedContent.endTime,
                    },
                },
            };

            const cellIndex = await codexNotebook
                .getCells()
                .then((cells) => cells.indexOf(notebookCell));
                // FIXME: Is this robust to splitting/merging cells?

            notebookData.cells[cellIndex] = updatedCellData;
            insertedCount++;
        } else {
            debug("Skipping non-empty cell");
            skippedCount++;
        }
    }

    const updatedNotebookContent = await serializer.serializeNotebook(
        notebookData,
        new vscode.CancellationTokenSource().token
    );

    await vscode.workspace.fs.writeFile(codexFile, updatedNotebookContent);

    debug("Insertion summary", { inserted: insertedCount, skipped: skippedCount });
    vscode.window.showInformationMessage(
        `Inserted ${insertedCount} drafts, skipped ${skippedCount} cells.`
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

function alignVTTCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): AlignedCell[] {
    debug("Aligning VTT cells", {
        notebookCellsCount: notebookCells.length,
        importedContentCount: importedContent.length,
    });
    return notebookCells
        .map((cell) => {
            const cellStartTime = cell.metadata?.data?.startTime;
            const cellEndTime = cell.metadata?.data?.endTime;
            const cellId = cell.metadata?.data?.id;

            debug("Cell metadata", { cellStartTime, cellEndTime, cellId });

            const matchedContent = importedContent.find(
                (content) =>
                    (cellStartTime &&
                        cellEndTime &&
                        Math.abs(content.startTime! - cellStartTime) < 0.1 &&
                        Math.abs(content.endTime! - cellEndTime) < 0.1) ||
                    (cellId && cellId === content.id)
            );

            if (matchedContent) {
                debug("Matched content found for cell", {
                    cellId: cell.document.uri.toString(),
                    contentStartTime: matchedContent.startTime,
                    contentEndTime: matchedContent.endTime,
                    contentId: matchedContent.id,
                });
            } else {
                debug("No matched content found for cell", {
                    cellIdBeingMatched: cell.document.uri.toString(),
                    cellStartTime,
                    cellEndTime,
                    cellId,
                });
            }

            return matchedContent ? { notebookCell: cell, importedContent: matchedContent } : null;
        })
        .filter((cell): cell is AlignedCell => cell !== null);
}

function alignPlaintextCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): AlignedCell[] {
    debug("Aligning plaintext cells", {
        notebookCellsCount: notebookCells.length,
        importedContentCount: importedContent.length,
    });
    // Placeholder function for aligning plaintext cells
    // Implement logic for matching plaintext content with notebook cells
    return [];
}

function alignUSFMCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): AlignedCell[] {
    debug("Aligning USFM cells", {
        notebookCellsCount: notebookCells.length,
        importedContentCount: importedContent.length,
    });
    // Placeholder function for aligning USFM cells
    // Implement logic for matching USFM content with notebook cells
    return [];
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
