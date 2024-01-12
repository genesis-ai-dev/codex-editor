import * as vscode from "vscode";
import * as fs from "fs";
import { CodexContentSerializer } from "./serializer";
import { vrefData, nonCanonicalBookRefs } from "./assets/vref.js";
import { getWorkSpaceFolder } from "./utils";
import { generateFiles as generateFile } from "./fileUtils";

export const NOTEBOOK_TYPE = "codex-type";
export const CHAPTER_HEADING_CELL_TYPE = "chapter-heading";

export interface CodexCell extends vscode.NotebookCellData {
    metadata?: { type: string };
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

export async function createProjectNotebooks(shouldOverWrite = false) {
    // Loop over all books (top-level keys in vrefData), and createCodexNotebook for each
    for (const book of Object.keys(vrefData).filter(
        (ref) => !nonCanonicalBookRefs.includes(ref),
    )) {
        /**
         * One notebook for each book of the Bible. Each notebook has a code cell for each chapter.
         * Each chapter cell has a preceding markdown cell with the chapter number, and a following
         * markdown cell that says '### Notes for Chapter {chapter number}'
         */
        const cells: vscode.NotebookCellData[] = [];
        const bookData = vrefData[book];
        const chapterHeadingText = `# Chapter`;
        // Iterate over all chapters in the current book
        for (const chapter of Object.keys(bookData.chapterVerseCountPairings)) {
            // Generate a markdown cell with the chapter number
            cells.push(
                new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Markup,
                    `${chapterHeadingText} ${chapter}`,
                    "markdown",
                ),
            );

            // Generate a code cell for the chapter
            const numberOfVrefsForChapter =
                bookData.chapterVerseCountPairings[chapter];
            const vrefsString = Array.from(
                Array(numberOfVrefsForChapter).keys(),
            )
                .map((_, i) => `${book} ${chapter}:${i + 1}`)
                .join("\n");

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
        const cellsWithMetaData = cells.map((cell) => {
            if (cell.value.includes(chapterHeadingText)) {
                cell.metadata = { type: CHAPTER_HEADING_CELL_TYPE };
            }
            return cell;
        });
        // Create a notebook for the current book
        const serializer = new CodexContentSerializer();
        const notebookData = new vscode.NotebookData(cellsWithMetaData);
        const notebookFile = await serializer.serializeNotebook(
            notebookData,
            new vscode.CancellationTokenSource().token,
        );

        // Save the notebook using generateFiles
        const filePath = `drafts/Bible/${book}.codex`;
        await generateFile({
            filepath: filePath,
            fileContent: notebookFile,
            shouldOverWrite,
        });
    }
}
