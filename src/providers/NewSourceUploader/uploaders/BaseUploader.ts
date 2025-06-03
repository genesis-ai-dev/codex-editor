import * as vscode from "vscode";
import { SourcePreview } from "../../../../types/index.d";

export interface FileUploadResult {
    fileName: string;
    fileSize: number;
    preview: SourcePreview;
}

export abstract class BaseUploader {
    constructor(protected readonly context: vscode.ExtensionContext) {}

    abstract processFile(
        file: { content: string; name: string },
        token: vscode.CancellationToken
    ): Promise<FileUploadResult>;

    protected async saveUploadedFile(content: string, fileName: string): Promise<vscode.Uri> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        const tempDir = vscode.Uri.joinPath(workspaceFolder.uri, ".temp");
        await vscode.workspace.fs.createDirectory(tempDir);

        const fileUri = vscode.Uri.joinPath(tempDir, fileName);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));

        return fileUri;
    }

    protected getFileSize(content: string): number {
        return Buffer.byteLength(content, "utf8");
    }
}
