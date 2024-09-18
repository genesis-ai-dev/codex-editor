import * as vscode from "vscode";
import * as fs from "fs";
import { CodexContentSerializer } from "../serializer";
import { getProjectMetadata, getWorkSpaceFolder } from ".";
import { generateFiles as generateFile } from "./fileUtils";
import { getAllBookRefs, getAllBookChapterRefs, getAllVrefs } from ".";
import { vrefData } from "./verseRefUtils/verseData";
import { LanguageProjectStatus } from "codex-types";
import { extractVerseRefFromLine } from "./verseRefUtils";
// import { CodexCellTypes } from "../../types";

export const NOTEBOOK_TYPE = "codex-type";

/**
 * Interface representing a Codex cell with optional metadata.
 *
 * This interface extends the vscode.NotebookCellData with additional metadata that
 * specifies the type of cell and associated data. The metadata includes the type of the cell,
 * which is defined by the CellTypes enum, and data that contains the chapter information.
 *
 * @property {CellTypes} [type] - The type of the cell, as defined by the CellTypes enum.
 * @property {Object} [data] - An object containing additional data for the cell.
 * @property {string} [chapter] - The chapter number or identifier associated with the cell.
 */
export interface CodexCell extends vscode.NotebookCellData {
    metadata?: {
        type: any;
        data: {
            chapter: string;
        };
    };
}

export const createCodexNotebook = async (
    cells: vscode.NotebookCellData[] = [],
) => {
    /**
     * Creates a Codex notebook with the provided cell data.
     *
     * This function takes an array of NotebookCellData objects and uses them to create a new Codex notebook.
     * If no cells are provided, an empty array is used by default. Each cell in the array is transformed into
     * a NotebookCellData object, which is then used to create the notebook data. A new notebook document is
     * opened with this data in the Codex-specific notebook type.
     *
     * @param {vscode.NotebookCellData[]} cells - An array of NotebookCellData objects to populate the notebook.
     * @returns {Promise<vscode.NotebookDocument>} A promise that resolves to the created NotebookDocument.
     */
    const cellData =
        cells.length > 0
            ? cells.map(
                (cell) =>
                    new vscode.NotebookCellData(
                        cell.kind,
                        cell.value,
                        cell.languageId,
                    ),
            )
            : [];
    const data = new vscode.NotebookData(cellData);
    const doc = await vscode.workspace.openNotebookDocument(
        NOTEBOOK_TYPE,
        data,
    );
    return doc;
};

/**
 * Creates a Codex notebook for each book in the Bible.
 *
 * This function generates a Codex notebook for each book in the Bible. If a list of books is provided,
 * notebooks will only be created for those books. Otherwise, notebooks will be created for all books.
 * Each notebook contains a code cell for each chapter in the book. Each chapter cell is preceded by a
 * markdown cell with the chapter number and followed by a markdown cell for notes for the chapter.
 *
 * @param {Object} options - An object containing options for the notebook creation.
 * @param {boolean} options.shouldOverWrite - A boolean indicating whether existing notebooks should be overwritten.
 * @param {string[]} options.books - An array of book names for which to create notebooks. If not provided, notebooks will be created for all books.
 * @returns {Promise<void>} A promise that resolves when all notebooks have been created.
 */
export async function updateProjectNotebooksToUseCellsForVerseContent({
    shouldOverWrite = true,
    books = undefined,
}: {
    shouldOverWrite?: boolean;
    books?: string[] | undefined;
} = {}) {
    const notebookCreationPromises = [];

    const allBooks = books ? books : getAllBookRefs();
    // Loop over all books and createCodexNotebook for each
    for (const book of allBooks) {
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            const file = await vscode.workspace.fs.readFile(
                vscode.Uri.file(`${workspaceRoot}/files/target/${book}.codex`)
            );

            const serializer = new CodexContentSerializer();
            const notebookData = await serializer.deserializeNotebook(
                file,
                new vscode.CancellationTokenSource().token
            );

            const newCells: vscode.NotebookCellData[] = [];
            const chapterHeadingText = `Chapter`;

            for (const cell of notebookData.cells) {
                if (cell.kind === vscode.NotebookCellKind.Markup) {
                    if (cell.metadata?.type === 'chapter-heading') {
                        // This is a chapter heading cell
                        const chapter = cell.metadata.data?.chapter;
                        const book = cell.metadata.data?.book;
                        if (chapter && book) {
                            const newCell = new vscode.NotebookCellData(
                                vscode.NotebookCellKind.Code,
                                `<h1>${chapterHeadingText} ${chapter}</h1>`,
                                "paratext"
                            );
                            newCell.metadata = {
                                type: "paratext",
                                data: {
                                    chapter: chapter,
                                },
                                id: `${book} ${chapter}:1:1`,
                                position: 'precede-parent-cell'
                            };
                            newCells.push(newCell);
                        } else {
                            // If we don't have chapter and book info, keep the original cell - don't want to lose data the user put into a new markdown or json cell randomly
                            newCells.push(cell);
                        }
                    } else if (cell.value.includes('Notes for Chapter')) {
                        // This is a notes cell - we don't need to do anything with it
                        // newCells.push(cell);
                    }
                } else if (cell.kind === vscode.NotebookCellKind.Code && cell.languageId === 'scripture') {
                    // This is a cell containing all verses for a chapter
                    const lines = cell.value.split('\n');
                    for (const line of lines) {
                        const [verseRef, ...contentParts] = line.split(' ');
                        const content = contentParts.join(' ');
                        const verseCell = new vscode.NotebookCellData(
                            vscode.NotebookCellKind.Code,
                            content,
                            'scripture'
                        );
                        verseCell.metadata = {
                            type: 'verse',
                            id: verseRef,
                        };
                        newCells.push(verseCell);
                    }
                }
            }

            const updatedNotebookData = new vscode.NotebookData(newCells);

            const notebookCreationPromise = serializer
                .serializeNotebook(
                    updatedNotebookData,
                    new vscode.CancellationTokenSource().token
                )
                .then((notebookFile) => {
                    const filePath = `files/target/${book}.codex`;
                    return generateFile({
                        filepath: filePath,
                        fileContent: notebookFile,
                        shouldOverWrite,
                    });
                });
            notebookCreationPromises.push(notebookCreationPromise);
        } catch (e) {
            vscode.window.showErrorMessage(`Error encountered while migrating notebook for book ${book}. Please inspect this file and open it with the text editor to see if it is malformed. Error: ${e}`);
        }
    }
    await Promise.all(notebookCreationPromises);
}
export async function createProjectCommentFiles({
    shouldOverWrite = false,
}: {
    shouldOverWrite?: boolean;
} = {}) {
    // Save the notebook using generateFiles
    const commentsFilePath = `comments.json`;
    const notebookCommentsFilePath = `file-comments.json`;
    await generateFile({
        filepath: commentsFilePath,
        fileContent: new TextEncoder().encode("[]"),
        shouldOverWrite,
    });
    await generateFile({
        filepath: notebookCommentsFilePath,
        fileContent: new TextEncoder().encode("[]"),
        shouldOverWrite,
    });
}
