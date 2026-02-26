import * as vscode from "vscode";
import { nonCanonicalBookRefs, vrefData } from "./verseRefUtils/verseData";
import { Project } from "codex-types";
import { updateWorkspaceState } from "./workspaceEventListener";
import { ProjectOverview } from "../../types";
import { MetadataManager } from "./metadataManager";

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

export async function getProjectMetadata(): Promise<ProjectOverview> {
    /**
     * Generic function to get the project metadata
     */
    const workspaceFolder = getWorkSpaceFolder();

    if (!workspaceFolder) {
        return Promise.reject("No workspace found");
    }

    const workspaceUri = vscode.Uri.file(workspaceFolder);
    const result = await MetadataManager.safeReadMetadata<ProjectOverview>(workspaceUri);

    if (!result.success) {
        if (result.error?.includes('FileNotFound')) {
            return Promise.reject("Project metadata file does not exist");
        } else {
            vscode.window.showErrorMessage(`Failed to read project metadata: ${result.error}`);
            return Promise.reject("Failed to read project metadata");
        }
    }

    if (!result.metadata) {
        return Promise.reject("No project metadata found");
    }

    return result.metadata;
}

export async function jumpToCellInNotebook(
    context: vscode.ExtensionContext,
    notebookPath: string,
    cellIdToJumpTo: string
) {
    try {
        updateWorkspaceState(context, {
            key: "cellToJumpTo",
            value: cellIdToJumpTo,
        });
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to open notebook: ${error.message}`);
    }
}

// Abstracted functions to get all book references, chapter references, and complete vrefs
export function getAllBookRefs(): string[] {
    return Object.keys(vrefData).filter((ref) => !nonCanonicalBookRefs.includes(ref));
}

export function getAllBookChapterRefs(book: string): string[] {
    return Object.keys(vrefData[book].chapterVerseCountPairings);
}

export function getAllVrefs(
    book: string,
    chapter: string,
    numberOfVrefsForChapter: number
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
            const numberOfVerses = vrefData[book].chapterVerseCountPairings[chapter];
            for (let verse = 1; verse <= numberOfVerses; verse++) {
                orgVerseRefs.push(`${book} ${chapter}:${verse}`);
            }
        });
    });

    return orgVerseRefs;
};

// Re-export utilities
export * from "./fileTypeUtils";
