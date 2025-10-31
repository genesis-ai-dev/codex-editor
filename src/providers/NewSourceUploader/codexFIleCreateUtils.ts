import * as vscode from "vscode";
import { NotebookPreview } from "@types";
import { CodexCellTypes } from "../../../types/enums";
import { createStandardizedFilename, isBiblicalImporterType } from "../../utils/bookNameUtils";

export function checkCancellation(token?: vscode.CancellationToken): void {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
}

export async function writeNotebook(uri: vscode.Uri, notebook: NotebookPreview): Promise<void> {
    // Don't use createCodexNotebook since it opens the document
    // Instead, directly serialize the notebook data
    const cells = notebook.cells.map((cell) => ({
        // need to ensure we spread in incoming metadata while also ensuring critical metadata is otherwise included
        metadata: {
            type: cell.metadata?.type || CodexCellTypes.TEXT,
            id: cell.metadata?.id,
            data: cell.metadata?.data || {},
            edits: cell.metadata?.edits || [],
            ...cell.metadata,
        },
        ...cell,
    }));

    const serializedData = JSON.stringify(
        {
            cells,
            metadata: {
                textDirection: notebook.metadata.textDirection || "ltr",
                videoUrl: notebook.metadata.videoUrl || "",
                lineNumbersEnabled: notebook.metadata.lineNumbersEnabled ?? true,
                lineNumbersEnabledSource: notebook.metadata.lineNumbersEnabledSource || "global",
                ...notebook.metadata,
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

        // Determine if this is biblical content based on the importer type
        const importerType = sourceNotebook.metadata?.importerType || '';
        const isBiblical = isBiblicalImporterType(importerType);

        console.log(`[CODEX FILE CREATE] Importer type: "${importerType}", Biblical: ${isBiblical}`);

        // Create standardized filenames - only use USFM codes for biblical content
        const sourceFilename = await createStandardizedFilename(sourceNotebook.name, ".source", isBiblical);
        const codexFilename = await createStandardizedFilename(codexNotebook.name, ".codex", isBiblical);

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

        console.log(`[CODEX FILE CREATE] Writing notebooks for "${sourceNotebook.name}"`);
        console.log(`[CODEX FILE CREATE] - Source: ${sourceUri.fsPath}`);
        console.log(`[CODEX FILE CREATE] - Codex: ${codexUri.fsPath}`);

        await writeNotebook(sourceUri, sourceNotebook);
        await writeNotebook(codexUri, codexNotebook);

        console.log(`[CODEX FILE CREATE] Successfully wrote notebook pair for "${sourceNotebook.name}"`);

        notebookResults.push({ sourceUri, codexUri, notebook: sourceNotebook });
    }

    return notebookResults;
}
