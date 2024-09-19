import * as vscode from "vscode";
import { CodexContentSerializer } from "../serializer";
import { nonCanonicalBookRefs, vrefData } from "./verseRefUtils/verseData";
import { Project } from "codex-types";

export const getWorkSpaceFolder = (): string | undefined => {
    /**
     * Generic function to get the workspace folder
     * NOTE: this util assumes we want to return only the first workspace folder
     */
    const workspaceFolder = vscode.workspace.workspaceFolders
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : null;
    if (!workspaceFolder) {
        console.error("No workspace found");
        return;
    }
    return workspaceFolder;
};

export const getWorkSpaceUri = (): vscode.Uri | undefined => {
    const workspaceFolder = getWorkSpaceFolder();
    if (!workspaceFolder) {
        return;
    }
    return vscode.Uri.file(workspaceFolder);
};

export async function getProjectMetadata(): Promise<Project> {
    /**
     * Generic function to get the project metadata
     */
    const workspaceFolder = getWorkSpaceFolder();

    if (!workspaceFolder) {
        return Promise.reject("No workspace found");
    }

    const projectMetadataPath = vscode.Uri.file(
        `${workspaceFolder}/metadata.json`,
    );

    const projectMetadata = await vscode.workspace.fs
        .readFile(projectMetadataPath)
        .then(
            (projectMetadata) => {
                try {
                    return JSON.parse(
                        Buffer.from(projectMetadata).toString(),
                    ) as Project;
                } catch (error: any) {
                    vscode.window.showErrorMessage(
                        `Failed to parse project metadata: ${error.message}`,
                    );
                }
            },
            (err) => {
                vscode.window.showErrorMessage(
                    `Failed to read project metadata: ${err.message}`,
                );
            },
        );

    if (!projectMetadata) {
        return Promise.reject("No project metadata found");
    }
    return projectMetadata;
}

export async function jumpToCellInNotebook(
    notebookPath: string,
    cellSectionMarker: string,
) {
    const notebookUri = vscode.Uri.file(notebookPath);

    try {
        const document = await vscode.workspace.openTextDocument(notebookUri);
        const notebookEditor = await vscode.window.showTextDocument(document);
        // FIXME: rather than opening a document and revealing a range, we need to just update the global state of the custom editor extension here.
        if (!cellSectionMarker) {
            console.error(
                `No section marker provided in jumpToCellInNotebook().`,
            );
            return;
        }

        const cellIndex = document.getCells().findIndex(
            (cell) => cell.metadata?.data?.sectionMarker === cellSectionMarker,
        );

        if (cellIndex === -1) {
            console.error(
                `No cell found with the provided section marker: ${cellSectionMarker}`,
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
    return Object.keys(vrefData).filter(
        (ref) => !nonCanonicalBookRefs.includes(ref),
    );
}

export function getAllBookChapterRefs(book: string): string[] {
    return Object.keys(vrefData[book].chapterVerseCountPairings);
}

export function getAllVrefs(
    book: string,
    chapter: string,
    numberOfVrefsForChapter: number,
): string {
    return Array.from(Array(numberOfVrefsForChapter).keys())
        .map((_, i) => `${book} ${chapter}:${i + 1}`)
        .join("\n");
}

export const getFullListOfOrgVerseRefs = (): string[] => {
    const allBookRefs = getAllBookRefs();
    const orgVerseRefs: string[] = [];

    allBookRefs.forEach((book) => {
        const chapters = Object.keys(vrefData[book].chapterVerseCountPairings);
        chapters.forEach((chapter) => {
            const numberOfVerses =
                vrefData[book].chapterVerseCountPairings[chapter];
            for (let verse = 1; verse <= numberOfVerses; verse++) {
                orgVerseRefs.push(`${book} ${chapter}:${verse}`);
            }
        });
    });

    return orgVerseRefs;
};
