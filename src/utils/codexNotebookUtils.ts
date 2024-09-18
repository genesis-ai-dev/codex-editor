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
        /**
         * One notebook for each book of the Bible. Each notebook has a code cell for each chapter.
         * Each chapter cell has a preceding markdown cell with the chapter number, and a following
         * markdown cell that says '### Notes for Chapter {chapter number}'
         */
        const cells: vscode.NotebookCellData[] = [];
        const chapterHeadingText = `Chapter`;

        // Iterate over all chapters in the current book
        for (const chapter of getAllBookChapterRefs(book)) {
            // Generate a markdown cell with the chapter number
            const cell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                `<h1>${chapterHeadingText} ${chapter}</h1>`,
                "paratext",
            );
            cell.metadata = {
                type: "paratext",
                data: {
                    chapter: chapter,
                },
                id: `${book} ${chapter}:001`,
            };

            cells.push(cell);

            // Generate a code cell for the chapter
            const numberOfVrefsForChapter =
                vrefData[book].chapterVerseCountPairings[chapter];
            // const vrefsString = getAllVrefs(
            //     book,
            //     chapter,
            //     numberOfVrefsForChapter,
            // );

            // get file for book using vscode api
            const workspaceRoot =
                vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            const file = await vscode.workspace.fs.readFile(
                vscode.Uri.file(`${workspaceRoot}/files/target/${book}.codex`),
            );

            const serializerNew = new CodexContentSerializer();
            const notebookData = await serializerNew.deserializeNotebook(
                file,
                new vscode.CancellationTokenSource().token,
            );

            const chapterCell = notebookData.cells.filter((cell) =>
                cell.value.includes(`${book} ${chapter}:`),
            )[0];

            const cellContent = chapterCell.value;

            const verseWithContent: {
                verseRef: string;
                content: string;
            }[] = [];
            cellContent.split("\n").forEach((line) => {
                const verseRef = extractVerseRefFromLine(line);
                if (verseRef) {
                    const verseContent = line.substring(verseRef.length).trim();
                    verseWithContent.push({
                        verseRef,
                        content: verseContent,
                    });
                }
            });
            for (const verse of verseWithContent) {
                const verseCell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Code,
                    verse.content,
                    "scripture",
                );
                verseCell.metadata = {
                    type: "verse",
                    id: verse.verseRef,
                };
                cells.push(verseCell);
            }

            // Generate a markdown cell for notes for the chapter
            // cells.push(
            //     new vscode.NotebookCellData(
            //         vscode.NotebookCellKind.Markup,
            //         `### Notes for Chapter ${chapter}`,
            //         "markdown",
            //     ),
            // );
        }
        // Create a notebook for the current book
        const serializer = new CodexContentSerializer();
        const notebookData = new vscode.NotebookData(cells);

        const notebookCreationPromise = serializer
            .serializeNotebook(
                notebookData,
                new vscode.CancellationTokenSource().token,
            )
            .then((notebookFile) => {
                // Save the notebook using generateFiles
                const filePath = `files/target/${book}.codex`;
                return generateFile({
                    filepath: filePath,
                    fileContent: notebookFile,
                    shouldOverWrite,
                });
            });
        notebookCreationPromises.push(notebookCreationPromise);
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
