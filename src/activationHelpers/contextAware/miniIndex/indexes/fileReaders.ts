import * as vscode from "vscode";
import { getWorkSpaceUri } from "../../../../utils";

export interface FileData {
    uri: vscode.Uri;
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

    const sourceFiles = await Promise.all(sourceUris.map(readFile));
    const targetFiles = await Promise.all(targetUris.map(readFile));

    return { sourceFiles, targetFiles };
}

async function readFile(uri: vscode.Uri): Promise<FileData> {
    const content = await vscode.workspace.fs.readFile(uri);
    const data = JSON.parse(content.toString());
    const fileData: FileData = {
        uri,
        cells: data.cells.map((cell: any) => {
            const cellData = {
                ...cell,
                metadata: {
                    ...cell.metadata,
                },
            };

            return cellData;
        }),
    };
    console.log(`File ${uri.toString()} has ${fileData.cells.length} cells`);
    return fileData;
}
