import * as vscode from "vscode";
import * as fs from "fs";
import { CodexContentSerializer } from "../serializer";
import { getProjectMetadata, getWorkSpaceFolder } from ".";
import { generateFiles as generateFile } from "./fileUtils";
import { getAllBookRefs, getAllBookChapterRefs, getAllVrefs } from ".";
import { vrefData } from "./verseRefUtils/verseData";
import { LanguageProjectStatus } from "codex-types";
import { extractVerseRefFromLine, verseRefRegex } from "./verseRefUtils";
import { NotebookCell } from "vscode-languageclient";
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
        type: "text" | "paratext";
        id: string;
        data: {
            [key: string]: any | undefined;
        }
    };
}

interface deprecated_CodexCell extends vscode.NotebookCellData {
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

export interface NotebookMetadata {
    data: {
        corpusMarker?: string;
        [key: string]: any | undefined;
    };
    navigation: NavigationCell[];
}

export interface NavigationCell {
    cellId: string;
    children: NavigationCell[];
    label: string;
}

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

            const canonicalOrder = Object.keys(vrefData);
            const corpora = {
                "Old Testament": canonicalOrder.slice(0, 39),
                "New Testament": canonicalOrder.slice(39)
            };

            let corpusMarker;
            if (corpora["Old Testament"].includes(book)) {
                corpusMarker = "Old Testament";
            } else if (corpora["New Testament"].includes(book)) {
                corpusMarker = "New Testament";
            } else {
                corpusMarker = "Other";
            }

            const navigationCells: NavigationCell[] = [];

            for (const cell of notebookData.cells) {
                if (cell.kind === vscode.NotebookCellKind.Markup) {
                    if (cell.metadata?.type === 'chapter-heading') {
                        // This is a chapter heading cell
                        const chapter = cell.metadata.data?.chapter;
                        if (chapter && book) {
                            const h1Content = `${chapterHeadingText} ${chapter}`;
                            const newCell = new vscode.NotebookCellData(
                                vscode.NotebookCellKind.Code,
                                `<h1>${h1Content}</h1>`,
                                "paratext"
                            );
                            const randomId = Math.random().toString(36).substring(2, 15);
                            const cellId = `${book} ${chapter}:1:${randomId}`;
                            newCell.metadata = {
                                type: "paratext",
                                id: cellId,
                            };
                            navigationCells.push({
                                cellId: cellId,
                                children: [],
                                label: `${chapterHeadingText} ${chapter}`,
                            });
                            newCells.push(newCell);
                        } else {
                            console.warn(`Skipping chapter heading cell for ${book} ${chapter} because it is apparently malformed:`, cell);
                        }
                    } else if (cell.value.includes('Notes')) {
                        // This is a notes cell - we don't need to do anything with it
                        // newCells.push(cell);
                    }
                } else if (cell.kind === vscode.NotebookCellKind.Code && cell.languageId === 'scripture') {
                    // This is a cell containing all verses for a chapter
                    const lines = cell.value.split('\n');
                    for (const line of lines) {
                        const verseRef = extractVerseRefFromLine(line);
                        const content = line.replace(verseRefRegex, '');
                        const verseCell = new vscode.NotebookCellData(
                            vscode.NotebookCellKind.Code,
                            content,
                            'scripture',
                        );
                        if (!verseRef) {
                            console.warn(`Skipping verse cell for ${book} because it is apparently malformed:`, cell);
                            continue;
                        }
                        verseCell.metadata = {
                            type: 'text',
                            id: verseRef,
                            data: {},
                        };
                        newCells.push(verseCell as CodexCell);
                    }
                }
            }

            const updatedNotebookData = new vscode.NotebookData(newCells);

            const notebookMetadata = {
                data: {
                    corpusMarker: corpusMarker,
                },
                navigation: navigationCells,
            };

            updatedNotebookData.metadata = notebookMetadata;
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
