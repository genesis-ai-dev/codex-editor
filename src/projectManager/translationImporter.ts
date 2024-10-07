import * as vscode from "vscode";
import * as path from "path";
import { WebVTTParser } from "webvtt-parser";
import { CodexNotebookReader } from "../serializer";
import { SupportedFileExtension, FileType, FileTypeMap } from "../../types";

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
    content: string;
    startTime?: number;
    endTime?: number;
}

interface AlignedCell {
    notebookCell: vscode.NotebookCell;
    importedContent: ImportedContent;
}

export async function importTranslations(context: vscode.ExtensionContext): Promise<void> {
    const supportedExtensions: SupportedFileExtension[] = [
        "vtt",
        "txt",
        "usfm",
        "SFM",
        "USFM",
        "sfm",
    ];

    const fileUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            "Supported Files": supportedExtensions,
        },
    });

    if (!fileUri || fileUri.length === 0) {
        vscode.window.showInformationMessage("No file selected.");
        return;
    }

    const selectedFile = fileUri[0];
    const fileExtension = path.extname(selectedFile.fsPath).toLowerCase();

    let importedContent: ImportedContent[] = [];
    let cellAligner: CellAligner;
    // FIXME why not ImportedContent type?
    let importedVttData: { cues: { text: string; startTime: number; endTime: number }[] } = {
        cues: [],
    };

    const fileContent = new TextDecoder().decode(await vscode.workspace.fs.readFile(selectedFile));
    switch (fileExtension) {
        case ".vtt":
            importedVttData = parseVtt(fileContent);
            cellAligner = alignVTTCells;
            break;
        case ".txt":
            importedContent = await parsePlaintext(selectedFile);
            cellAligner = alignPlaintextCells;
            break;
        default:
            if (fileTypeMap[fileExtension as keyof FileTypeMap] === "usfm") {
                importedContent = await parseUSFM(selectedFile);
                cellAligner = alignUSFMCells;
            } else {
                vscode.window.showErrorMessage("Unsupported file type.");
                return;
            }
    }

    if (importedVttData.cues.length > 0) {
        importedContent = importedVttData.cues.map((cue) => ({
            content: cue.text,
            startTime: cue.startTime,
            endTime: cue.endTime,
        }));
    }

    if (Array.isArray(importedContent) && importedContent.length === 0) {
        vscode.window.showErrorMessage("No content to import.");
        return;
    }

    await insertZeroDrafts(importedContent, cellAligner);
}

const parseVtt = (rawFileContent: string) => {
    const vttData = new WebVTTParser().parse(JSON.stringify(rawFileContent));
    return vttData;
};

async function insertZeroDrafts(
    importedContent: ImportedContent[],
    cellAligner: CellAligner
): Promise<void> {
    const notebookFiles = await vscode.workspace.findFiles("**/*.codex");

    let insertedCount = 0;
    let skippedCount = 0;

    for (const notebookFile of notebookFiles) {
        const codexNotebook = new CodexNotebookReader(notebookFile);
        const workspaceEdit = new vscode.WorkspaceEdit();

        const scriptureCells = await codexNotebook
            .getCells()
            .then((cells) =>
                cells.filter(
                    (cell) =>
                        cell.kind === vscode.NotebookCellKind.Code &&
                        cell.metadata?.type === "scripture"
                )
            );

        const alignedCells = cellAligner(scriptureCells, importedContent);

        for (const { notebookCell, importedContent } of alignedCells) {
            const cellContent = notebookCell.document.getText().trim();

            if (cellContent === "") {
                const updatedCell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Code,
                    importedContent.content,
                    "scripture"
                );
                updatedCell.metadata = { ...notebookCell.metadata };

                const cellIndex = await codexNotebook
                    .getCells()
                    .then((cells) => cells.indexOf(notebookCell));

                const notebookEdit = vscode.NotebookEdit.replaceCells(
                    new vscode.NotebookRange(cellIndex, cellIndex),
                    [updatedCell]
                );
                workspaceEdit.set(notebookFile, [notebookEdit]);
                insertedCount++;
            } else {
                skippedCount++;
            }
        }

        if (workspaceEdit.size > 0) {
            await vscode.workspace.applyEdit(workspaceEdit);
        }
    }

    vscode.window.showInformationMessage(
        `Inserted ${insertedCount} drafts, skipped ${skippedCount} cells.`
    );
}

function timestampMismatchResolver(
    notebookCell: vscode.NotebookCell,
    importedContent: ImportedContent
): boolean {
    // Placeholder function for resolving timestamp mismatches
    // Implement more sophisticated logic here
    return true;
}

function alignVTTCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): AlignedCell[] {
    return notebookCells
        .map((cell) => {
            const cellStartTime = cell.metadata?.data?.startTime;
            const cellEndTime = cell.metadata?.data?.endTime;

            const matchedContent =
                importedContent.find(
                    (content) =>
                        content.startTime === cellStartTime && content.endTime === cellEndTime
                ) || importedContent.find((content) => timestampMismatchResolver(cell, content));

            return matchedContent ? { notebookCell: cell, importedContent: matchedContent } : null;
        })
        .filter((cell): cell is AlignedCell => cell !== null);
}

function alignPlaintextCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): AlignedCell[] {
    // Placeholder function for aligning plaintext cells
    // Implement logic for matching plaintext content with notebook cells
    return [];
}

function alignUSFMCells(
    notebookCells: vscode.NotebookCell[],
    importedContent: ImportedContent[]
): AlignedCell[] {
    // Placeholder function for aligning USFM cells
    // Implement logic for matching USFM content with notebook cells
    return [];
}

async function parsePlaintext(fileUri: vscode.Uri): Promise<ImportedContent[]> {
    // Placeholder function for parsing plaintext files
    // Implement logic for reading and parsing plaintext content
    return [];
}

async function parseUSFM(fileUri: vscode.Uri): Promise<ImportedContent[]> {
    // Placeholder function for parsing USFM files
    // Implement logic for reading and parsing USFM content
    return [];
}
