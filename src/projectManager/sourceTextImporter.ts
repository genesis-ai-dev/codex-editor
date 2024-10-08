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

        let notebookId: string;

        switch (fileType) {
            case "subtitles":
                notebookId = await importSubtitles(fileUri);
                break;
            case "plaintext":
                notebookId = await importPlaintext(fileUri);
                break;
            case "usfm":
                notebookId = await importUSFM(fileUri);
                break;
            default:
                throw new Error("Unsupported file type for source text.");
        }

        metadataManager.addOrUpdateMetadata({
            id: notebookId,
            sourceUri: fileUri,
        });

        vscode.window.showInformationMessage("Source text imported successfully.");
    } catch (error) {
        vscode.window.showErrorMessage(`Error importing source text: ${error}`);
    }
}

async function importSubtitles(fileUri: vscode.Uri): Promise<string> {
    const notebookName = fileUri.path.split("/").pop()?.split(".")[0] || `new_source_${Date.now()}`;
    const fileContent = await vscode.workspace.fs.readFile(fileUri);
    const fileContentString = new TextDecoder().decode(fileContent);
    const notebookId = await createCodexNotebookFromWebVTT(fileContentString, notebookName);
    return notebookId;
}

async function importPlaintext(fileUri: vscode.Uri): Promise<string> {
    // TODO: Implement plaintext import logic
    // This might involve reading the file and creating a new Codex notebook
    // with appropriate cell structure
    throw new Error("Plaintext import not yet implemented");
}

async function importUSFM(fileUri: vscode.Uri): Promise<string> {
    // FIXME: there is some inconsistency here because importLocalUsfmSourceBible returns an array of notebook ids, since you usually parse a whole folder of USFM files
    // but the UI for importing a single USFM file translation expects a single notebook id
    // so we're going to need to change the UI to handle an array of notebook ids, or to handle the case where a single notebook id is returned
    const notebookIds = await importLocalUsfmSourceBible(fileUri);
    return notebookIds[0];
}
