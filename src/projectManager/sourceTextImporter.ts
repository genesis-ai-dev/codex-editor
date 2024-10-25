import { getWorkSpaceUri } from "./../utils/index";
import * as vscode from "vscode";
import { CustomNotebookMetadata, FileType, SupportedFileExtension } from "../../types";
import { fileTypeMap } from "./translationImporter";
import {
    importLocalUsfmSourceBible,
    createCodexNotebookFromWebVTT,
    splitSourceFileByBook,
} from "../utils/codexNotebookUtils";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";
import { CodexContentSerializer } from "../serializer";
import * as path from "path";

// Add this new function at the top level
export async function validateSourceFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(fileUri);
        return stat.type === vscode.FileType.File;
    } catch (error) {
        console.error('Error validating source file:', error);
        return false;
    }
}

export async function importSourceText(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri
): Promise<void> {
    const stat = await vscode.workspace.fs.stat(fileUri);
    const isDirectory = stat.type === vscode.FileType.Directory;

    if (isDirectory) {
        await importSourceFolder(context, fileUri);
    } else {
        await importSourceFile(context, fileUri);
    }
}

async function importSourceFolder(
    context: vscode.ExtensionContext,
    folderUri: vscode.Uri
): Promise<void> {
    const files = await vscode.workspace.fs.readDirectory(folderUri);
    const usfmFileExtensions = [".usfm", ".sfm", ".SFM", ".USFM"];

    for (const [fileName, fileType] of files) {
        if (
            fileType === vscode.FileType.File &&
            usfmFileExtensions.some((ext) => fileName.toLowerCase().endsWith(ext))
        ) {
            const fileUri = vscode.Uri.joinPath(folderUri, fileName);
            await importSourceFile(context, fileUri);
        }
    }

    vscode.window.showInformationMessage("Source folder imported successfully.");
}

function getFileNameFromUri(fileUri: vscode.Uri): string {
    const fileNameWithExtension = path.basename(fileUri.fsPath);
    const fileName = path.parse(fileNameWithExtension).name || fileNameWithExtension;
    return fileName;
}

// Update the importSourceFile function to prevent duplicate file creation
async function importSourceFile(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri
): Promise<void> {
    const fileExtension = fileUri.fsPath.split(".").pop()?.toLowerCase() as SupportedFileExtension;
    const fileType = fileTypeMap[fileExtension] || "plaintext";

    try {
        // First validate the source file exists
        const isValid = await validateSourceFile(fileUri);
        if (!isValid) {
            throw new Error(`Source file not found or invalid: ${fileUri.fsPath}`);
        }

        const metadataManager = new NotebookMetadataManager();
        await metadataManager.initialize();
        await metadataManager.loadMetadata();

        const baseName = path.basename(fileUri.fsPath).split(".")[0] || `new_source`;
        const notebookId = baseName; // Remove timestamp from ID generation

        let importedNotebookIds: string[];

        // Import based on file type
        switch (fileType) {
            case "subtitles": {
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                importedNotebookIds = [await createCodexNotebookFromWebVTT(
                    new TextDecoder().decode(fileContent),
                    notebookId
                )];
                break;
            }
            case "plaintext":
                importedNotebookIds = [await importPlaintext(fileUri, notebookId)];
                break;
            case "usfm":
                importedNotebookIds = await importUSFM(fileUri, notebookId);
                break;
            default:
                throw new Error("Unsupported file type for source text.");
        }

        // Only create target notebooks after source is successfully imported
        const workspaceFolderUri = getWorkSpaceUri();
        if (!workspaceFolderUri) {
            throw new Error("No workspace folder found. Cannot import source text.");
        }

        for (const importedNotebookId of importedNotebookIds) {
            const sourceUri = vscode.Uri.joinPath(
                workspaceFolderUri,
                ".project",
                "sourceTexts",
                `${importedNotebookId}.source`
            );

            // Verify source file was created before creating target
            const sourceExists = await validateSourceFile(sourceUri);
            if (!sourceExists) {
                throw new Error(`Source file was not created successfully: ${sourceUri.fsPath}`);
            }

            // Check if target notebook already exists
            const codexUri = vscode.Uri.joinPath(
                workspaceFolderUri,
                "files",
                "target",
                `${importedNotebookId}.codex`
            );
            
            try {
                await vscode.workspace.fs.stat(codexUri);
                console.log(`Target notebook already exists: ${codexUri.fsPath}`);
            } catch {
                // Create target notebook only if it doesn't exist
                await createEmptyCodexNotebooks(importedNotebookId);
            }
        }

        vscode.window.showInformationMessage("Source text imported successfully.");
    } catch (error) {
        console.error("Error importing source text:", error);
        throw error;
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

async function importUSFM(fileUri: vscode.Uri, notebookId: string): Promise<string[]> {
    const importedNotebookIds = await importLocalUsfmSourceBible(fileUri, notebookId);
    return importedNotebookIds;
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
