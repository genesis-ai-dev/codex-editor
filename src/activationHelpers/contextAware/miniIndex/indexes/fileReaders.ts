import * as vscode from "vscode";
import { getWorkSpaceUri } from "../../../../utils";
import { NotebookMetadataManager } from "../../../../utils/notebookMetadataManager";

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

    console.log(
        "Target File URIs:",
        targetUris.map((uri) => uri.fsPath)
    );

    const metadataManager = NotebookMetadataManager.getInstance();
    await metadataManager.loadMetadata();

    const sourceFiles = await Promise.all(sourceUris.map((uri) => readFile(uri, metadataManager)));
    const targetFiles = await Promise.all(targetUris.map((uri) => readFile(uri, metadataManager)));

    return { sourceFiles, targetFiles };
}

async function readFile(
    uri: vscode.Uri,
    metadataManager: NotebookMetadataManager
): Promise<FileData> {
    const content = await vscode.workspace.fs.readFile(uri);
    const data = JSON.parse(content.toString());
    const metadata = metadataManager.getMetadataByUri(uri);

    if (!metadata || !metadata.id) {
        throw new Error(`No metadata found for file: ${uri.toString()}`);
    }

    // Add null check for data.cells
    if (!data || !data.cells) {
        throw new Error(`Invalid file format - missing cells array in: ${uri.toString()}`);
    }

    const fileData: FileData = {
        uri,
        id: metadata.id,
        cells: data.cells.map((cell: any) => ({
            metadata: {
                type: cell?.metadata?.type,
                id: cell?.metadata?.id,
            },
            value: cell?.value ?? "",
        })),
    };
    console.log(`File ${uri.toString()} has ${fileData.cells.length} cells`);
    return fileData;
}
