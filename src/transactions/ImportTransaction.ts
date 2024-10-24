import * as vscode from "vscode";
import { CustomNotebookMetadata } from "../../types";

export interface ImportTransactionState {
    sourceFile: vscode.Uri;
    tempFiles: vscode.Uri[];
    metadata: CustomNotebookMetadata | null;
    status: "pending" | "processing" | "committed" | "rolledback";
}

export class ImportTransaction {
    private state: ImportTransactionState;
    private tempDir: vscode.Uri | null = null;

    constructor(
        sourceFile: vscode.Uri,
        private progress?: vscode.Progress<{ message: string }>,
        private token?: vscode.CancellationToken
    ) {
        this.state = {
            sourceFile,
            tempFiles: [],
            metadata: null,
            status: "pending",
        };
    }

    async createTempDirectory(): Promise<void> {
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

    getTempDir(): vscode.Uri {
        if (!this.tempDir) {
            throw new Error("Temp directory not created");
        }
        return this.tempDir;
    }

    async execute(): Promise<void> {
        try {
            this.checkCancellation();
            await this.createTempDirectory();
            this.reportProgress("Creating temporary files...");
            await this.createTempFiles();
            this.reportProgress("Processing files...");
            await this.processFiles();
            this.reportProgress("Updating metadata...");
            await this.updateMetadata();
            await this.commitChanges();
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    private checkCancellation(): void {
        if (this.token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
    }

    private async createTempFiles(): Promise<void> {
        this.checkCancellation();
        // Simulate creating temporary files
        const tempFile = vscode.Uri.joinPath(this.getTempDir(), "tempFile.tmp");
        await vscode.workspace.fs.writeFile(tempFile, Buffer.from("Temporary content"));
        this.state.tempFiles.push(tempFile);
    }

    private async processFiles(): Promise<void> {
        this.checkCancellation();
        // Simulate file processing
        for (const tempFile of this.state.tempFiles) {
            const content = await vscode.workspace.fs.readFile(tempFile);
            // Process content (e.g., parse, transform)
            console.log("Processing file:", tempFile.fsPath, "Content:", content.toString());
        }
    }

    private async updateMetadata(): Promise<void> {
        this.checkCancellation();
        // Simulate metadata update
        this.state.metadata = {
            id: "example-id",
            originalName: "Example",
            sourceFsPath: this.state.sourceFile.fsPath,
            codexFsPath: this.getTempDir().fsPath,
            navigation: [],
            sourceCreatedAt: new Date().toISOString(),
            corpusMarker: "example-corpus",
            gitStatus: "untracked",
        };
    }

    private async commitChanges(): Promise<void> {
        this.checkCancellation();
        // Simulate committing changes
        const targetDir = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "source");
        await vscode.workspace.fs.createDirectory(targetDir);
        for (const tempFile of this.state.tempFiles) {
            const targetFile = vscode.Uri.joinPath(targetDir, tempFile.path.split("/").pop()!);
            await vscode.workspace.fs.copy(tempFile, targetFile);
        }
        this.state.status = "committed";
    }

    private async rollback(): Promise<void> {
        if (this.tempDir) {
            try {
                await vscode.workspace.fs.delete(this.tempDir, { recursive: true });
            } catch (error) {
                console.error("Failed to cleanup temp directory:", error);
            }
        }
        this.state.status = "rolledback";
    }

    private reportProgress(message: string): void {
        this.progress?.report({ message });
    }
}
