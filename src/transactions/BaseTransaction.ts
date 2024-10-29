import * as vscode from "vscode";

export interface TransactionState {
    tempFiles: vscode.Uri[];
    status:
        | "pending"
        | "executing"
        | "prepared"
        | "awaiting_confirmation"
        | "committed"
        | "rolledback";
}

export abstract class BaseTransaction {
    protected state: TransactionState;
    protected tempDir: vscode.Uri | null = null;

    constructor() {
        this.state = {
            tempFiles: [],
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

    protected async cleanupTempFiles(): Promise<void> {
        for (const tempFile of this.state.tempFiles) {
            try {
                await vscode.workspace.fs.delete(tempFile);
            } catch (error) {
                console.warn(`Failed to delete temp file ${tempFile.fsPath}:`, error);
            }
        }
        if (this.tempDir) {
            try {
                await vscode.workspace.fs.delete(this.tempDir, { recursive: true });
            } catch (error) {
                console.warn("Failed to delete temp directory:", error);
            }
        }
    }

    abstract prepare(): Promise<any>;

    abstract execute(
        progress?: { report: (update: { message?: string; increment?: number }) => void },
        token?: vscode.CancellationToken
    ): Promise<void>;
}
