import * as vscode from "vscode";
import { FileType, SupportedFileExtension } from "../../types";
import { fileTypeMap } from "./translationImporter";
import {
    importLocalUsfmSourceBible,
    createCodexNotebookFromWebVTT,
    NotebookMetadata,
    splitSourceFileByBook,
} from "../utils/codexNotebookUtils";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";
import { CodexContentSerializer } from "../serializer";

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

async function importSourceFile(
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

        let importedNotebookIds: string[];

        switch (fileType) {
            case "subtitles":
                importedNotebookIds = [await importSubtitles(fileUri, baseName)];
                break;
            case "plaintext":
                importedNotebookIds = [await importPlaintext(fileUri, baseName)];
                break;
            case "usfm":
                importedNotebookIds = await importUSFM(fileUri, baseName);
                break;
            default:
                throw new Error("Unsupported file type for source text.");
        }

        const workspaceFolder = vscode.workspace.workspaceFolders![0];

        for (const importedNotebookId of importedNotebookIds) {
            const sourceUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "sourceTexts",
                `${importedNotebookId}.source`
            );
            const codexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                "files",
                "target",
                `${importedNotebookId}.codex`
            );

            const metadata: NotebookMetadata = {
                id: importedNotebookId,
                sourceUri: sourceUri,
                sourceFile: fileUri.fsPath,
                codexUri: codexUri,
                originalName: importedNotebookId,
                data: {},
                navigation: [],
                sourceCreatedAt: "",
                codexLastModified: "",
                gitStatus: "uninitialized",
            };

            // Add metadata to the original source file
            await waitForFile(sourceUri, 5000); // Wait up to 5 seconds
            await addMetadataToSourceFile(sourceUri, metadata);

            metadataManager.addOrUpdateMetadata(metadata);

            // Split the source file if it contains multiple books
            await splitSourceFileByBook(sourceUri, workspaceFolder.uri.fsPath, "source");

            // Create empty Codex notebooks for each book
            await createEmptyCodexNotebooks(importedNotebookId);
        }

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
    const targetFolder = vscode.Uri.joinPath(workspaceFolder.uri, "files", "target");

    const sourceFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(sourceFolder, `${sourceFileName}*.source`)
    );

    if (sourceFiles.length === 0) {
        throw new Error(`No source file found for ${sourceFileName}`);
    }

    const metadataManager = NotebookMetadataManager.getInstance();
    await metadataManager.loadMetadata();

    for (const sourceFile of sourceFiles) {
        const sourceContent = await vscode.workspace.fs.readFile(sourceFile);
        const sourceData = JSON.parse(new TextDecoder().decode(sourceContent));

        const bookName = sourceFile.path.split("/").pop()?.split(".")[0] || "";
        const codexUri = vscode.Uri.joinPath(targetFolder, `${bookName}.codex`);

        // Create an empty Codex notebook with the same structure as the source
        const emptyCodexData = {
            cells: sourceData.cells.map((cell: any) => ({
                ...cell,
                value: "", // Empty content for target cells
            })),
            metadata: {
                ...sourceData.metadata,
                codexUri: codexUri.toString(),
            },
        };

        await vscode.workspace.fs.writeFile(
            codexUri,
            new TextEncoder().encode(JSON.stringify(emptyCodexData, null, 2))
        );

        // Update metadata
        const metadata = metadataManager.getMetadataById(sourceData.metadata.id);
        if (metadata) {
            metadata.codexUri = codexUri;
            metadataManager.addOrUpdateMetadata(metadata);
        }

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
        const fileName = sourceFile.path.split("/").pop()?.split(".")[0] || "";

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
