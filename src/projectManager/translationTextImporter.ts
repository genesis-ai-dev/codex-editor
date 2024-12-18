import * as vscode from "vscode";
import { NotebookMetadataManager, getNotebookMetadataManager } from "../utils/notebookMetadataManager";
import { CodexContentSerializer } from "../serializer";
import * as path from "path";
import { WebVTTParser } from "webvtt-parser";
import { SupportedFileExtension, FileTypeMap, ImportedContent } from "../../types";
import { fileTypeMap } from "./translationImporter";

export async function importTranslations(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
    sourceNotebookId: string,
    progress?: vscode.Progress<{ message?: string }>,
    token?: vscode.CancellationToken
): Promise<void> {
    try {
        progress?.report({ message: "Reading translation file..." });
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const fileContentString = new TextDecoder().decode(fileContent);

        const metadataManager = getNotebookMetadataManager();
        await metadataManager.initialize();
        await metadataManager.loadMetadata();

        const sourceMetadata = metadataManager.getMetadataById(sourceNotebookId);
        if (!sourceMetadata) {
            throw new Error("Source notebook metadata not found");
        }

        const codexUri = vscode.Uri.file(sourceMetadata.codexFsPath!);
        const serializer = new CodexContentSerializer();

        progress?.report({ message: "Deserializing existing Codex notebook..." });
        if (!token) {
            throw new Error("Cancellation token is required");
        }
        const existingNotebook = await serializer.deserializeNotebook(
            await vscode.workspace.fs.readFile(codexUri),
            token
        );

        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        progress?.report({ message: "Merging translations into Codex notebook..." });
        const updatedNotebook = mergeTranslations(existingNotebook, fileContentString);

        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        progress?.report({ message: "Serializing updated Codex notebook..." });
        const serializedContent = await serializer.serializeNotebook(updatedNotebook, token);

        progress?.report({ message: "Writing updated Codex notebook to disk..." });
        await vscode.workspace.fs.writeFile(codexUri, serializedContent);

        vscode.window.showInformationMessage("Translations imported successfully.");
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            vscode.window.showWarningMessage("Translation import was cancelled.");
        } else {
            vscode.window.showErrorMessage(`Error importing translations: ${error}`);
        }
    }
}

function mergeTranslations(existingNotebook: any, fileContentString: string): any {
    // Implement the logic to merge translations into the existing notebook
    // This is a placeholder for the actual merging logic
    return {
        ...existingNotebook,
        cells: existingNotebook.cells.map((cell: any) => ({
            ...cell,
            value: `${cell.value}\n${fileContentString}`, // Example merge logic
        })),
    };
}

async function parseFileContent(fileUri: vscode.Uri): Promise<ImportedContent[]> {
    const fileExtension = fileUri.fsPath.split(".").pop()?.toLowerCase() as SupportedFileExtension;
    const fileContent = await vscode.workspace.fs.readFile(fileUri);
    const fileContentString = new TextDecoder().decode(fileContent);

    switch (fileTypeMap[fileExtension]) {
        case "subtitles":
            return parseVTT(fileContentString);
        case "plaintext":
            return parsePlaintext(fileContentString);
        case "usfm":
            return parseUSFM(fileContentString);
        default:
            throw new Error("Unsupported file type.");
    }
}

function parseVTT(content: string): ImportedContent[] {
    const parser = new WebVTTParser();
    const vttData = parser.parse(content);
    return vttData.cues.map((cue) => ({
        id: cue.id,
        content: cue.text,
        startTime: cue.startTime,
        endTime: cue.endTime,
    }));
}

function parsePlaintext(content: string): ImportedContent[] {
    // Implement plaintext parsing logic
    return [];
}

function parseUSFM(content: string): ImportedContent[] {
    // Implement USFM parsing logic
    return [];
}
