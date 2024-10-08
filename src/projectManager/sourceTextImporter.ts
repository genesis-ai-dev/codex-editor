import * as vscode from "vscode";
import { FileType, SupportedFileExtension } from "../../types";
import { fileTypeMap } from "./translationImporter";
import {
    importLocalUsfmSourceBible,
    createCodexNotebookFromWebVTT,
} from "../utils/codexNotebookUtils";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";

export async function importSourceText(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri
): Promise<void> {
    const fileExtension = vscode.workspace
        .asRelativePath(fileUri)
        .split(".")
        .pop()
        ?.toLowerCase() as SupportedFileExtension;

    const fileType = fileTypeMap[fileExtension] || "plaintext";

    try {
        const metadataManager = NotebookMetadataManager.getInstance();
        await metadataManager.loadMetadata();

        const baseName = fileUri.path.split("/").pop()?.split(".")[0] || `new_source`;
        const notebookId = metadataManager.generateNewId(baseName);

        let importedNotebookId: string;

        switch (fileType) {
            case "subtitles":
                importedNotebookId = await importSubtitles(fileUri, notebookId);
                break;
            case "plaintext":
                importedNotebookId = await importPlaintext(fileUri, notebookId);
                break;
            case "usfm":
                importedNotebookId = await importUSFM(fileUri, notebookId);
                break;
            default:
                throw new Error("Unsupported file type for source text.");
        }

        metadataManager.addOrUpdateMetadata({
            id: importedNotebookId,
            sourceUri: fileUri,
            originalName: baseName,
        });

        vscode.window.showInformationMessage("Source text imported successfully.");
    } catch (error) {
        vscode.window.showErrorMessage(`Error importing source text: ${error}`);
    }
}

async function importSubtitles(fileUri: vscode.Uri, notebookId: string): Promise<string> {
    const fileContent = await vscode.workspace.fs.readFile(fileUri);
    const fileContentString = new TextDecoder().decode(fileContent);
    await createCodexNotebookFromWebVTT(fileContentString, notebookId);
    return notebookId;
}

async function importPlaintext(fileUri: vscode.Uri, notebookId: string): Promise<string> {
    // TODO: Implement plaintext import logic
    // This might involve reading the file and creating a new Codex notebook
    // with appropriate cell structure
    throw new Error("Plaintext import not yet implemented");
}

async function importUSFM(fileUri: vscode.Uri, notebookId: string): Promise<string> {
    const importedNotebookIds = await importLocalUsfmSourceBible(fileUri, notebookId);
    return importedNotebookIds[0] || notebookId;
}
