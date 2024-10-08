import * as vscode from "vscode";
import { FileType, SupportedFileExtension } from "../../types";
import { fileTypeMap } from "./translationImporter";
import {
    importLocalUsfmSourceBible,
    createCodexNotebookFromWebVTT,
} from "../utils/codexNotebookUtils";

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
        switch (fileType) {
            case "subtitles":
                await importSubtitles(fileUri);
                break;
            case "plaintext":
                await importPlaintext(fileUri);
                break;
            case "usfm":
                await importUSFM(fileUri);
                break;
            default:
                throw new Error("Unsupported file type for source text.");
        }
        vscode.window.showInformationMessage("Source text imported successfully.");
    } catch (error) {
        vscode.window.showErrorMessage(`Error importing source text: ${error}`);
    }
}

async function importSubtitles(fileUri: vscode.Uri): Promise<void> {
    const notebookName = fileUri.path.split("/").pop()?.split(".")[0] || `new_source_${Date.now()}`;
    const fileContent = await vscode.workspace.fs.readFile(fileUri);
    const fileContentString = new TextDecoder().decode(fileContent);
    await createCodexNotebookFromWebVTT(fileContentString, notebookName);
}

async function importPlaintext(fileUri: vscode.Uri): Promise<void> {
    // TODO: Implement plaintext import logic
    // This might involve reading the file and creating a new Codex notebook
    // with appropriate cell structure
    throw new Error("Plaintext import not yet implemented");
}

async function importUSFM(fileUri: vscode.Uri): Promise<void> {
    await importLocalUsfmSourceBible(fileUri);
}
