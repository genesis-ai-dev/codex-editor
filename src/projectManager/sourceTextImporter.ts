import { getWorkSpaceUri } from "./../utils/index";
import * as vscode from "vscode";
import { CustomNotebookMetadata, FileType, SupportedFileExtension } from "../../types";
import { fileTypeMap } from "./fileTypeMap_deprecated";
import { importLocalUsfmSourceBible, splitSourceFileByBook } from "../utils/codexNotebookUtils";
import {
    NotebookMetadataManager,
    getNotebookMetadataManager,
} from "../utils/notebookMetadataManager";
import { CodexContentSerializer } from "../serializer";
import * as path from "path";
import { formatJsonForNotebookFile } from "../utils/notebookFileFormattingUtils";

// Add this new function at the top level
export async function validateSourceFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(fileUri);
        return stat.type === vscode.FileType.File;
    } catch (error) {
        console.error("Error validating source file:", error);
        return false;
    }
}

function getFileNameFromUri(fileUri: vscode.Uri): string {
    const fileNameWithExtension = path.basename(fileUri.fsPath);
    const fileName = path.parse(fileNameWithExtension).name || fileNameWithExtension;
    return fileName;
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
            new TextEncoder().encode(formatJsonForNotebookFile(sourceData, 2))
        );
    } catch (error) {
        console.error("Error adding metadata to source file:", error);
        throw error;
    }
}

export async function createEmptyCodexNotebooks(sourceFileName: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error("No workspace folder found");
    }

    const sourceFolder = vscode.Uri.joinPath(workspaceFolder.uri, ".project", "sourceTexts");

    // Find all .source files
    const allSourceFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(sourceFolder, `*.source`)
    );

    // Filter for the specific source file we're interested in
    const sourceFiles = allSourceFiles.filter(
        (file) => path.basename(file.fsPath, ".source") === sourceFileName
    );

    if (sourceFiles.length === 0) {
        throw new Error(`No source file found for ${sourceFileName} in ${sourceFolder.fsPath}`);
    }

    const serializer = new CodexContentSerializer();

    for (const sourceFile of sourceFiles) {
        const sourceContent = await vscode.workspace.fs.readFile(sourceFile);
        const sourceData = await serializer.deserializeNotebook(
            sourceContent,
            new vscode.CancellationTokenSource().token
        );

        const bookName = path.basename(sourceFile.path, path.extname(sourceFile.path));
        const codexUri = vscode.Uri.joinPath(
            workspaceFolder.uri,
            "files",
            "target",
            `${bookName}.codex`
        );

        // Create empty notebook data
        const emptyNotebookData = new vscode.NotebookData(
            sourceData.cells.map((cell) => ({
                ...cell,
                value: "", // Empty content for target cells
            }))
        );
        emptyNotebookData.metadata = {
            ...sourceData.metadata,
            codexUri: codexUri,
        };

        const notebookContent = await serializer.serializeNotebook(
            emptyNotebookData,
            new vscode.CancellationTokenSource().token
        );
        await vscode.workspace.fs.writeFile(codexUri, notebookContent);

        console.log(`Created empty Codex notebook: ${codexUri.fsPath}`);
    }
}

export async function processDownloadedBible(downloadedBibleFile: vscode.Uri): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error("No workspace folder found");
    }

    // Split the downloaded Bible file into individual book files
    const createdSourceFiles = await splitSourceFileByBook(
        downloadedBibleFile,
        workspaceFolder.uri.fsPath,
        "source"
    );

    // Wait for all source files to be created
    await Promise.all(createdSourceFiles);

    // Create empty Codex notebooks for each newly created book file
    for (const sourceFile of createdSourceFiles) {
        const fileName = path.basename(sourceFile.path).split(".")[0] || "";

        try {
            await createEmptyCodexNotebooks(fileName);
        } catch (error) {
            console.error(`Error creating Codex notebook for ${fileName}: ${error}`);
        }
    }

    vscode.window.showInformationMessage(
        "Bible processed and empty Codex notebooks created successfully."
    );
}
