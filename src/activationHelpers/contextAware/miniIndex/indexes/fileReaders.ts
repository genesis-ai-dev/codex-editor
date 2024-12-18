import * as vscode from "vscode";
import { getWorkSpaceUri } from "../../../../utils";
import {
    NotebookMetadataManager,
    getNotebookMetadataManager,
} from "../../../../utils/notebookMetadataManager";
import { CodexContentSerializer } from "../../../../serializer";
import { CodexNotebookAsJSONData } from "../../../../../types";

export interface FileData {
    uri: vscode.Uri;
    id: string;
    cells: Array<{
        metadata?: {
            type?: string;
            id?: string;
        };
        value: string;
    }>;
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[FileReaders] ${message}`, ...args);
    }
}

export async function readSourceAndTargetFiles(): Promise<{
    sourceFiles: FileData[];
    targetFiles: FileData[];
}> {
    const workspaceFolder = getWorkSpaceUri();
    if (!workspaceFolder) {
        throw new Error("Workspace folder not found");
    }

    const sourcePattern = new vscode.RelativePattern(
        workspaceFolder,
        ".project/sourceTexts/*.source"
    );
    const targetPattern = new vscode.RelativePattern(workspaceFolder, "files/target/*.codex");

    const sourceUris = await vscode.workspace.findFiles(sourcePattern);
    const targetUris = await vscode.workspace.findFiles(targetPattern);

    debug(
        "Target File URIs:",
        targetUris.map((uri) => uri.fsPath)
    );

    const metadataManager = getNotebookMetadataManager();
    await metadataManager.initialize();
    await metadataManager.loadMetadata();

    const serializer = new CodexContentSerializer();
    const sourceFiles = await Promise.all(
        sourceUris.map((uri) => readFile(uri, metadataManager, serializer))
    );
    const targetFiles = await Promise.all(
        targetUris.map((uri) => readFile(uri, metadataManager, serializer))
    );

    return { sourceFiles, targetFiles };
}

async function readFile(
    uri: vscode.Uri,
    metadataManager: NotebookMetadataManager,
    serializer: CodexContentSerializer
): Promise<FileData> {
    const content = await vscode.workspace.fs.readFile(uri);
    let notebookData: CodexNotebookAsJSONData;

    try {
        // Use the serializer to parse the notebook content
        notebookData = await serializer.deserializeNotebook(
            content,
            new vscode.CancellationTokenSource().token
        );
    } catch (error) {
        console.error(`Failed to parse notebook file: ${uri.toString()}`, error);
        throw new Error(`Invalid notebook format in: ${uri.toString()}`);
    }

    const metadata = metadataManager.getMetadataByUri(uri);

    if (!metadata || !metadata.id) {
        throw new Error(`No metadata found for file: ${uri.toString()}`);
    }

    // Transform notebook cells into our FileData format
    const cells = notebookData.cells.map((cell) => ({
        metadata: {
            type: cell.metadata?.type,
            id: cell.metadata?.id,
        },
        value: cell.value,
    }));

    const fileData: FileData = {
        uri,
        id: metadata.id,
        cells,
    };

    debug(`File ${uri.toString()} has ${fileData.cells.length} cells`);
    return fileData;
}
