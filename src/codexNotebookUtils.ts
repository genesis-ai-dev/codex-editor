import * as vscode from "vscode";
import * as fs from "fs";
import { CodexContentSerializer } from "./serializer";
import { getProjectMetadata, getWorkSpaceFolder } from "./utils";
import { generateFiles as generateFile } from "./fileUtils";
import { getAllBookRefs, getAllBookChapterRefs, getAllVrefs } from "./utils";
import { vrefData } from "./assets/vref";
import { LanguageProjectStatus } from "./types";

export const NOTEBOOK_TYPE = "codex-type";
export enum CellTypes {
    CHAPTER_HEADING = "chapter-heading",
}

export interface CodexCell extends vscode.NotebookCellData {
    metadata?: {
        type: CellTypes;
        data: {
            chapter: string;
        };
    };
}

export const createCodexNotebook = async (
    cells: vscode.NotebookCellData[] = [],
) => {
    /**
     * Generic function to create a Codex notebook
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

export async function createProjectNotebooks(
    {
        shouldOverWrite = false,
        books = undefined
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
        const chapterHeadingText = `# Chapter`;

        // Iterate over all chapters in the current book
        for (const chapter of getAllBookChapterRefs(book)) {
            // Generate a markdown cell with the chapter number
            const cell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Markup,
                `${chapterHeadingText} ${chapter}`,
                "markdown",
            );
            cell.metadata = {
                type: CellTypes.CHAPTER_HEADING,
                data: {
                    chapter: chapter,
                },
            };
            cells.push(cell);

            // Generate a code cell for the chapter
            const numberOfVrefsForChapter = vrefData[book].chapterVerseCountPairings[chapter];
            const vrefsString = getAllVrefs(book, chapter, numberOfVrefsForChapter);

            cells.push(
                new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Code,
                    vrefsString,
                    "scripture",
                ),
            );

            // Generate a markdown cell for notes for the chapter
            cells.push(
                new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Markup,
                    `### Notes for Chapter ${chapter}`,
                    "markdown",
                ),
            );
        }
        // Create a notebook for the current book
        const serializer = new CodexContentSerializer();
        const notebookData = new vscode.NotebookData(cells);

        const project = await getProjectMetadata();
        const notebookCreationPromise = serializer
            .serializeNotebook(
                notebookData,
                new vscode.CancellationTokenSource().token,
            )
            .then((notebookFile) => {
                // Save the notebook using generateFiles
                const sourceLanguageTag = project.languages.filter(
                    language => language.projectStatus === LanguageProjectStatus.TARGET
                )[0].tag;
                const filePath = `drafts/${sourceLanguageTag}/${book}.codex`;
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
