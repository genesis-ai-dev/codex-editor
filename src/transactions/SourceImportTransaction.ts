import * as vscode from "vscode";
import { ImportTransaction } from "./ImportTransaction";
import { CustomNotebookMetadata, NotebookPreview, SourcePreview } from "../../types";
import { SourceAnalyzer } from "../validation/sourceAnalyzer";
import { SourceFileValidator } from "../validation/sourceFileValidator";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";
import path from "path";
import { ProgressManager, ProgressStep } from "../utils/progressManager";
import { CodexCell, createCodexNotebook } from "../utils/codexNotebookUtils";
import { CodexCellTypes } from "../../types/enums";

export class SourceImportTransaction extends ImportTransaction {
    private preview: SourcePreview | null = null;
    private analyzer: SourceAnalyzer;
    private metadataManager: NotebookMetadataManager;
    private readonly context: vscode.ExtensionContext;

    private readonly importSteps: ProgressStep[] = [
        { name: "validation", message: "Validating source file...", weight: 1 },
        { name: "preparation", message: "Preparing preview...", weight: 2 },
        { name: "transformation", message: "Transforming content...", weight: 3 },
        { name: "processing", message: "Processing notebooks...", weight: 3 },
        { name: "metadata", message: "Updating metadata...", weight: 1 },
        { name: "commit", message: "Committing changes...", weight: 1 },
    ];

    constructor(sourceFile: vscode.Uri, context: vscode.ExtensionContext) {
        super(sourceFile);
        this.context = context;
        this.analyzer = new SourceAnalyzer(new SourceFileValidator());
        this.metadataManager = new NotebookMetadataManager();
    }

    async prepare(): Promise<SourcePreview> {
        try {
            await this.metadataManager.initialize();

            // Create temp directory
            await this.createTempDirectory();

            // Copy original file to temp directory
            const tempSourceFile = vscode.Uri.joinPath(
                this.getTempDir(),
                path.basename(this.state.sourceFile.fsPath)
            );
            await vscode.workspace.fs.copy(this.state.sourceFile, tempSourceFile);
            this.state.tempFiles.push(tempSourceFile);

            // Generate preview using analyzer
            this.preview = await this.analyzer.generatePreview(tempSourceFile);

            return this.preview;
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    async execute(
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
        token?: vscode.CancellationToken
    ): Promise<void> {
        if (!this.preview) {
            throw new Error("Transaction not prepared");
        }

        try {
            const progressManager = progress
                ? new ProgressManager(progress, this.importSteps)
                : undefined;

            // Validation step
            await progressManager?.nextStep(token);
            if (!this.preview.originalContent.validationResults.every((r) => r.isValid)) {
                throw new Error("Source file validation failed");
            }

            // Preparation step
            await progressManager?.nextStep(token);
            const tempTransformedFile = await this.createTransformedFile();

            // Transformation step
            await progressManager?.nextStep(token);

            // Processing step - Create notebooks
            await progressManager?.nextStep(token);
            const notebookResults = await this.processNotebooks(token);

            // Metadata step
            await progressManager?.nextStep(token);
            // Update metadata with the newly created notebooks
            for (const { sourceUri, codexUri, notebook } of notebookResults) {
                const metadata: CustomNotebookMetadata = {
                    id: notebook.name,
                    originalName: notebook.name,
                    sourceFsPath: sourceUri.fsPath,
                    codexFsPath: codexUri.fsPath,
                    navigation: [],
                    sourceCreatedAt: new Date().toISOString(),
                    codexLastModified: new Date().toISOString(),
                    gitStatus: "untracked" as const,
                    corpusMarker: notebook.metadata?.corpusMarker || "",
                };
                await this.metadataManager.addOrUpdateMetadata(metadata);
            }

            // Commit step
            await progressManager?.nextStep(token);
            await this.commitChanges();

            this.state.status = "committed";
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    private async createTransformedFile(): Promise<vscode.Uri> {
        const transformedFile = vscode.Uri.joinPath(
            this.getTempDir(),
            `transformed_${this.preview!.fileName}`
        );

        await vscode.workspace.fs.writeFile(
            transformedFile,
            Buffer.from(JSON.stringify(this.preview!.transformedContent, null, 2))
        );

        this.state.tempFiles.push(transformedFile);
        return transformedFile;
    }

    private async processNotebooks(
        token?: vscode.CancellationToken
    ): Promise<Array<{ sourceUri: vscode.Uri; codexUri: vscode.Uri; notebook: NotebookPreview }>> {
        const { sourceNotebooks, codexNotebooks } = this.preview!.transformedContent;
        const notebookResults: Array<{
            sourceUri: vscode.Uri;
            codexUri: vscode.Uri;
            notebook: NotebookPreview;
        }> = [];

        for (let i = 0; i < sourceNotebooks.length; i++) {
            this.checkCancellation(token);

            const sourceNotebook = sourceNotebooks[i];
            const codexNotebook = codexNotebooks[i];

            // Ensure notebook has a name
            if (!sourceNotebook.name || !codexNotebook.name) {
                throw new Error("Notebook name is required");
            }

            // Create source notebook
            const sourceUri = vscode.Uri.joinPath(
                this.getTempDir(),
                `${sourceNotebook.name}.source`
            );

            // Create codex notebook
            const codexUri = vscode.Uri.joinPath(this.getTempDir(), `${codexNotebook.name}.codex`);

            // Update paths in metadata before writing
            sourceNotebook.metadata.sourceFsPath = sourceUri.fsPath;
            codexNotebook.metadata.codexFsPath = codexUri.fsPath;
            codexNotebook.metadata.sourceFsPath = sourceUri.fsPath;

            await this.writeNotebook(sourceUri, sourceNotebook);
            await this.writeNotebook(codexUri, codexNotebook);

            this.state.tempFiles.push(sourceUri, codexUri);
            notebookResults.push({ sourceUri, codexUri, notebook: sourceNotebook });
        }

        return notebookResults;
    }

    private async writeNotebook(uri: vscode.Uri, notebook: NotebookPreview): Promise<void> {
        // Map the cells to preserve all metadata
        const cells = notebook.cells.map((cell: CodexCell, index: number) => ({
            kind: cell.kind,
            value: cell.value,
            languageId: cell.languageId || "html", // Ensure we use the correct languageId
            metadata: {
                type: cell.metadata?.type || CodexCellTypes.TEXT,
                id: cell.metadata?.id,
                data: cell.metadata?.data || {},
                edits: cell.metadata?.edits || [], // Preserve edit history if it exists
            },
        }));

        const serializedData = JSON.stringify(
            {
                cells,
                metadata: {
                    ...notebook.metadata,
                    textDirection: notebook.metadata.textDirection || "ltr",
                    navigation: notebook.metadata.navigation || [],
                    videoUrl: notebook.metadata.videoUrl || "",
                },
            },
            null,
            2
        );

        await vscode.workspace.fs.writeFile(uri, Buffer.from(serializedData));
    }

    protected async updateMetadata(): Promise<void> {
        for (const notebook of this.preview!.transformedContent.sourceNotebooks) {
            await this.metadataManager.addOrUpdateMetadata(notebook.metadata);
        }
    }

    protected async commitChanges(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        // Move files from temp to their proper locations
        for (const tempFile of this.state.tempFiles) {
            const fileName = path.basename(tempFile.fsPath);
            let targetLocation: vscode.Uri;

            if (fileName.endsWith(".source")) {
                targetLocation = vscode.Uri.joinPath(
                    workspaceFolder.uri,
                    ".project",
                    "sourceTexts",
                    fileName
                );
            } else if (fileName.endsWith(".codex")) {
                targetLocation = vscode.Uri.joinPath(
                    workspaceFolder.uri,
                    "files",
                    "target",
                    fileName
                );
            } else {
                continue;
            }

            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(targetLocation, ".."));
            await vscode.workspace.fs.copy(tempFile, targetLocation, { overwrite: true });
        }

        await this.cleanupTempFiles();
    }

    private async cleanupTempFiles(): Promise<void> {
        try {
            for (const tempFile of this.state.tempFiles) {
                try {
                    await vscode.workspace.fs.delete(tempFile);
                } catch (error) {
                    console.warn(`Failed to delete temp file ${tempFile.fsPath}:`, error);
                }
            }
        } catch (error) {
            console.warn("Error cleaning up temp files:", error);
        }
    }

    // Add this to implement the abstract method
    protected async processFiles(): Promise<void> {
        if (!this.preview) {
            throw new Error("Transaction not prepared");
        }
        await this.processNotebooks();
    }
}
