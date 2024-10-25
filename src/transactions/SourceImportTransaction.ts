import * as vscode from 'vscode';
import { ImportTransaction } from './ImportTransaction';
import { CustomNotebookMetadata, SourcePreview } from '../../types';
import { SourceAnalyzer } from '../utils/sourceAnalyzer';
import { SourceFileValidator } from '../validation/sourceFileValidator';
import { NotebookMetadataManager } from '../utils/notebookMetadataManager';
import path from 'path';
import { ProgressManager, ProgressStep } from '../utils/progressManager';

export class SourceImportTransaction extends ImportTransaction {
    private preview: SourcePreview | null = null;
    private analyzer: SourceAnalyzer;
    private metadataManager: NotebookMetadataManager;
    private readonly importSteps: ProgressStep[] = [
        { name: 'validation', message: 'Validating source file...', weight: 1 },
        { name: 'preparation', message: 'Preparing file structure...', weight: 1 },
        { name: 'processing', message: 'Processing source content...', weight: 3 },
        { name: 'metadata', message: 'Updating metadata...', weight: 1 },
        { name: 'commit', message: 'Committing changes...', weight: 1 }
    ];

    constructor(sourceFile: vscode.Uri) {
        super(sourceFile);
        this.analyzer = new SourceAnalyzer(new SourceFileValidator());
        this.metadataManager = new NotebookMetadataManager();
    }

    async prepare(): Promise<SourcePreview> {
        try {
            // Initialize metadata manager
            await this.metadataManager.initialize();
            
            // Generate preview
            this.preview = await this.analyzer.generatePreview(this.state.sourceFile);
            
            // Create temp directory
            await this.createTempDirectory();
            
            // Copy source file to temp directory
            const tempSourceFile = vscode.Uri.joinPath(
                this.getTempDir(),
                path.basename(this.state.sourceFile.fsPath)
            );
            await vscode.workspace.fs.copy(this.state.sourceFile, tempSourceFile);
            this.state.tempFiles.push(tempSourceFile);
            
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
            const progressManager = progress ? new ProgressManager(progress, this.importSteps) : undefined;
            
            await progressManager?.nextStep(token);
            this.checkCancellation(token);
            
            await progressManager?.nextStep(token);
            await this.processFiles(token);
            
            await progressManager?.nextStep(token);
            await this.updateMetadata();
            
            await progressManager?.nextStep(token);
            await this.commitChanges();
            
            this.state.status = "committed";
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    protected async processFiles(token?: vscode.CancellationToken): Promise<void> {
        this.checkCancellation(token);
        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        // Create source and target directories if they don't exist
        const sourceDir = vscode.Uri.joinPath(workspaceFolder.uri, '.project', 'sourceTexts');
        const targetDir = vscode.Uri.joinPath(workspaceFolder.uri, 'files', 'target');
        
        await vscode.workspace.fs.createDirectory(sourceDir);
        await vscode.workspace.fs.createDirectory(targetDir);

        // Process each book from the preview
        for (const book of this.preview!.expectedBooks) {
            this.checkCancellation(token);
            
            // Create source file
            const sourceFileName = `${book.name.toLowerCase()}.source`;
            const sourceFileUri = vscode.Uri.joinPath(sourceDir, sourceFileName);
            
            // Create target file
            const targetFileName = `${book.name.toLowerCase()}.codex`;
            const targetFileUri = vscode.Uri.joinPath(targetDir, targetFileName);
            
            // Add to temp files for rollback if needed
            this.state.tempFiles.push(sourceFileUri, targetFileUri);
            
            // Create initial file content
            const initialContent = {
                cells: [],
                metadata: {
                    id: book.name,
                    originalName: book.name,
                    sourceFsPath: sourceFileUri.fsPath,
                    codexFsPath: targetFileUri.fsPath,
                    navigation: [],
                    sourceCreatedAt: new Date().toISOString(),
                    gitStatus: "untracked",
                    corpusMarker: ""
                }
            };

            // Write files
            await vscode.workspace.fs.writeFile(
                sourceFileUri,
                Buffer.from(JSON.stringify(initialContent, null, 2))
            );
            await vscode.workspace.fs.writeFile(
                targetFileUri,
                Buffer.from(JSON.stringify(initialContent, null, 2))
            );
        }
    }

    protected async updateMetadata(): Promise<void> {
        // Update metadata for each book
        for (const book of this.preview!.expectedBooks) {
            const metadata: CustomNotebookMetadata = {
                id: book.name,
                originalName: book.name,
                sourceFsPath: vscode.Uri.joinPath(
                    this.getTempDir(),
                    `${book.name.toLowerCase()}.source`
                ).fsPath,
                codexFsPath: vscode.Uri.joinPath(
                    this.getTempDir(),
                    `${book.name.toLowerCase()}.codex`
                ).fsPath,
                navigation: [],
                sourceCreatedAt: new Date().toISOString(),
                gitStatus: "untracked" as const, // Fix the type error by using a const assertion
                corpusMarker: ""
            };
            
            await this.metadataManager.addOrUpdateMetadata(metadata);
        }
    }

    protected async commitChanges(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        // Move files from temp to final location
        for (const tempFile of this.state.tempFiles) {
            const fileName = path.basename(tempFile.fsPath);
            const targetLocation = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
            
            await vscode.workspace.fs.copy(tempFile, targetLocation, { overwrite: true });
        }
    }
}
