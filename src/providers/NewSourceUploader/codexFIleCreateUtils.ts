import * as vscode from "vscode";
import { NotebookPreview } from "@types";
import { CodexCellTypes } from "../../../types/enums";
import { createStandardizedFilename } from "../../utils/bookNameUtils";

export function checkCancellation(token?: vscode.CancellationToken): void {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
}

export async function writeNotebook(uri: vscode.Uri, notebook: NotebookPreview): Promise<void> {
    // Don't use createCodexNotebook since it opens the document
    // Instead, directly serialize the notebook data
    const cells = notebook.cells.map((cell) => ({
        kind: cell.kind,
        value: cell.value,
        languageId: cell.languageId || "scripture",
        metadata: {
            type: cell.metadata?.type || CodexCellTypes.TEXT,
            id: cell.metadata?.id,
            data: cell.metadata?.data || {},
            edits: cell.metadata?.edits || [],
        },
    }));

    const serializedData = JSON.stringify(
        {
            cells,
            metadata: {
                ...notebook.metadata,
                textDirection: notebook.metadata.textDirection || "ltr",
                navigation: notebook.metadata.navigation || [],
                videoUrl: notebook.metadata.videoUrl || "",
            },
        },
        null,
        2
    );

    // Write the file directly without opening it
    await vscode.workspace.fs.writeFile(uri, Buffer.from(serializedData));
}

export async function createNoteBookPair({
    token,
    sourceNotebooks,
    codexNotebooks,
}: {
    token?: vscode.CancellationToken;
    sourceNotebooks: NotebookPreview[];
    codexNotebooks: NotebookPreview[];
}): Promise<Array<{ sourceUri: vscode.Uri; codexUri: vscode.Uri; notebook: NotebookPreview; }>> {
    const notebookResults: Array<{
        sourceUri: vscode.Uri;
        codexUri: vscode.Uri;
        notebook: NotebookPreview;
    }> = [];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
        throw new Error("No workspace folder found");
    }

    for (let i = 0; i < sourceNotebooks.length; i++) {
        checkCancellation(token);

        const sourceNotebook = sourceNotebooks[i];
        const codexNotebook = codexNotebooks[i];

        if (!sourceNotebook.name || !codexNotebook.name) {
            throw new Error("Notebook name is required");
        }

        // Create standardized filenames using USFM codes
        const sourceFilename = await createStandardizedFilename(sourceNotebook.name, ".source");
        const codexFilename = await createStandardizedFilename(codexNotebook.name, ".codex");

        // Create final URIs with standardized filenames
        const sourceUri = vscode.Uri.joinPath(
            workspaceFolder.uri,
            ".project",
            "sourceTexts",
            sourceFilename
        );
        const codexUri = vscode.Uri.joinPath(
            workspaceFolder.uri,
            "files",
            "target",
            codexFilename
        );

        // Update metadata with final paths
        sourceNotebook.metadata.sourceFsPath = sourceUri.fsPath;
        sourceNotebook.metadata.codexFsPath = codexUri.fsPath;
        codexNotebook.metadata.sourceFsPath = sourceUri.fsPath;
        codexNotebook.metadata.codexFsPath = codexUri.fsPath;

        // Ensure directories exist
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(workspaceFolder.uri, ".project", "sourceTexts")
        );
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(workspaceFolder.uri, "files", "target")
        );

        await writeNotebook(sourceUri, sourceNotebook);
        await writeNotebook(codexUri, codexNotebook);

        notebookResults.push({ sourceUri, codexUri, notebook: sourceNotebook });
    }

    return notebookResults;
}
