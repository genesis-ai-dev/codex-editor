import * as vscode from "vscode";
import { CodexContentSerializer } from "./serializer";
import { nonCanonicalBookRefs, vrefData } from "./assets/vref";

export const getWorkSpaceFolder = (): string | undefined => {
    /**
     * Generic function to get the workspace folder
     * NOTE: this util assumes we want to return only the first workspace folder
     */
    const workspaceFolder = vscode.workspace.workspaceFolders
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : null;
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace found");
        return;
    }
    return workspaceFolder;
};

export async function jumpToCellInNotebook(
    notebookPath: string,
    cellIndex: number,
) {
    const notebookUri = vscode.Uri.file(notebookPath);

    try {
        const document =
            await vscode.workspace.openNotebookDocument(notebookUri);
        const notebookEditor =
            await vscode.window.showNotebookDocument(document);

        if (cellIndex < 0 || cellIndex >= document.cellCount) {
            vscode.window.showInformationMessage(
                `Cell at index ${cellIndex} not found.`,
            );
            return;
        }

        // Reveal the cell in the notebook editor
        notebookEditor.revealRange(
            new vscode.NotebookRange(cellIndex, cellIndex + 1),
            vscode.NotebookEditorRevealType.AtTop,
        );
    } catch (error: any) {
        vscode.window.showErrorMessage(
            `Failed to open notebook: ${error.message}`,
        );
    }
}

// Abstracted functions to get all book references, chapter references, and complete vrefs
export function getAllBookRefs(): string[] {
    return Object.keys(vrefData).filter((ref) => !nonCanonicalBookRefs.includes(ref));
}

export function getAllBookChapterRefs(book: string): string[] {
    return Object.keys(vrefData[book].chapterVerseCountPairings);
}

export function getAllVrefs(book: string, chapter: string, numberOfVrefsForChapter: number): string {
    return Array.from(
        Array(numberOfVrefsForChapter).keys(),
    ).map((_, i) => `${book} ${chapter}:${i + 1}`).join("\n");
}