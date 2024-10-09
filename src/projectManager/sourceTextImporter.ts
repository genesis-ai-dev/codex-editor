import * as vscode from "vscode";
import { FileType, SupportedFileExtension } from "../../types";
import { fileTypeMap } from "./translationImporter";
import {
    importLocalUsfmSourceBible,
    createCodexNotebookFromWebVTT,
    NotebookMetadata,
} from "../utils/codexNotebookUtils";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";
import { CodexContentSerializer } from "../serializer";

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
                importedNotebookId = await importSubtitles(fileUri, baseName);
                break;
            case "plaintext":
                importedNotebookId = await importPlaintext(fileUri, baseName);
                break;
            case "usfm":
                importedNotebookId = await importUSFM(fileUri, baseName);
                break;
            default:
                throw new Error("Unsupported file type for source text.");
        }

        // Update metadata for both .source and .codex files
        const sourceUri = vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders![0].uri,
            ".project",
            "sourceTexts",
            `${baseName}.source`
        );
        const codexUri = vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders![0].uri,
            "files",
            "target",
            `${baseName}.codex`
        );

        const metadata: NotebookMetadata = {
            id: importedNotebookId,
            sourceUri: sourceUri,
            sourceFile: fileUri.fsPath,
            codexUri: codexUri,
            originalName: baseName,
            data: {},
            navigation: [],
        };

        // Add metadata to the original source file, but first wait until the file is created
        await waitForFile(sourceUri, 5000); // Wait up to 5 seconds
        await addMetadataToSourceFile(sourceUri, metadata);

        metadataManager.addOrUpdateMetadata(metadata);

        vscode.window.showInformationMessage("Source text imported successfully.");
    } catch (error) {
        vscode.window.showErrorMessage(`Error importing source text: ${error}`);
    }
}

// Helper function to wait for a file to exist
async function waitForFile(uri: vscode.Uri, timeout: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            await vscode.workspace.fs.stat(uri);
            return; // File exists, exit the loop
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms before trying again
        }
    }
    throw new Error(`Timeout waiting for file: ${uri.fsPath}`);
}

async function addMetadataToSourceFile(sourceUri: vscode.Uri, metadata: any): Promise<void> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(sourceUri);
        const sourceData = JSON.parse(new TextDecoder().decode(fileContent));

        // Add metadata to the source data
        sourceData.metadata = metadata;

        // Write the updated content back to the file
        await vscode.workspace.fs.writeFile(
            sourceUri,
            new TextEncoder().encode(JSON.stringify(sourceData, null, 2))
        );
    } catch (error) {
        console.error("Error adding metadata to source file:", error);
        throw error;
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
