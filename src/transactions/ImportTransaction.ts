import * as vscode from "vscode";
export interface ImportTransactionState {
    sourceFile: vscode.Uri;
    tempFiles: vscode.Uri[];
    metadata: any | null;
    status: "pending" | "processing" | "committed" | "rolledback";
}

export abstract class ImportTransaction {
    protected state: ImportTransactionState;
    protected tempDir: vscode.Uri | null = null;

    constructor(sourceFile: vscode.Uri) {
        this.state = {
            sourceFile,
            tempFiles: [],
            metadata: null,
            status: "pending",
        };
    }

    protected async createTempDirectory(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        this.tempDir = vscode.Uri.joinPath(
            workspaceFolder.uri,
            ".codex-temp",
            Date.now().toString()
        );
        await vscode.workspace.fs.createDirectory(this.tempDir);
    }

    protected getTempDir(): vscode.Uri {
        if (!this.tempDir) {
            throw new Error("Temp directory not created");
        }
        return this.tempDir;
    }

    protected checkCancellation(token?: vscode.CancellationToken): void {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
    }

    async rollback(): Promise<void> {
        if (this.tempDir) {
            try {
                await vscode.workspace.fs.delete(this.tempDir, { recursive: true });
            } catch (error) {
                console.error("Failed to cleanup temp directory:", error);
            }
        }
        this.state.status = "rolledback";
    }

    abstract prepare(): Promise<any>;

    async execute(
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
        token?: vscode.CancellationToken
    ): Promise<void> {
        try {
            this.checkCancellation(token);
            await this.processFiles();
            await this.updateMetadata();
            await this.commitChanges();
            this.state.status = "committed";
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    protected abstract processFiles(): Promise<void>;
    protected abstract updateMetadata(): Promise<void>;
    protected abstract commitChanges(): Promise<void>;
}
