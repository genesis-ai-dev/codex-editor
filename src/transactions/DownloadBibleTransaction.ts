import * as vscode from "vscode";
import { BaseTransaction } from "./BaseTransaction";
import { ProgressManager, ProgressStep } from "../utils/progressManager";
import { downloadBible } from "../projectManager/projectInitializers";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";
import { CodexContentSerializer } from "../serializer";
import { splitSourceFileByBook } from "../utils/codexNotebookUtils";
import { CustomNotebookMetadata } from "../../types";
import { BibleContentValidator } from "../validators/BibleContentValidator";
import { BibleContentAnalyzer } from "../analyzers/BibleContentAnalyzer";
import { BibleContentTransformer } from "../transformers/BibleContentTransformer";
import * as path from "path";
import { vrefData } from "../utils/verseRefUtils/verseData";
import { ExtendedMetadata } from "../utils/ebible/ebibleCorpusUtils";

export interface DownloadBibleTransactionOptions {
    sourceLanguage: string;
    workspaceRoot?: vscode.Uri;
    translationId?: string; // The specific Bible translation ID to download
}

export class DownloadBibleTransaction extends BaseTransaction {
    private readonly ebibleMetadata: ExtendedMetadata | undefined;
    private readonly sourceLanguage: string;
    private readonly translationId?: string;
    private readonly workspaceRoot: vscode.Uri | undefined;
    private metadataManager: NotebookMetadataManager;
    private downloadedSourceUri?: vscode.Uri;
    private validator: BibleContentValidator;
    private analyzer: BibleContentAnalyzer;
    private transformer: BibleContentTransformer;
    private tempDirectory?: vscode.Uri;
    private readonly importSteps: ProgressStep[] = [
        { name: "validation", message: "Validating Bible content...", weight: 1 },
        { name: "preview", message: "Generating preview...", weight: 1 },
        { name: "download", message: "Downloading Bible text...", weight: 2 },
        { name: "transform", message: "Transforming content...", weight: 2 },
        { name: "splitting", message: "Splitting into sections...", weight: 2 },
        { name: "notebooks", message: "Creating notebooks...", weight: 2 },
        { name: "metadata", message: "Updating metadata...", weight: 1 },
        { name: "commit", message: "Committing changes...", weight: 1 },
    ];
    constructor(options: { ebibleMetadata?: ExtendedMetadata }) {
        super();
        this.ebibleMetadata = options.ebibleMetadata;
        this.sourceLanguage = options.ebibleMetadata?.languageCode || "";
        this.translationId = options.ebibleMetadata?.translationId || undefined;
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        this.metadataManager = new NotebookMetadataManager();
        this.validator = new BibleContentValidator();
        this.analyzer = new BibleContentAnalyzer();
        this.transformer = new BibleContentTransformer();
        this.tempDirectory = this.workspaceRoot
            ? vscode.Uri.joinPath(this.workspaceRoot, ".codex_temp")
            : undefined;
    }

    async prepare(): Promise<void> {
        try {
            await this.metadataManager.initialize();
            await this.createTempDirectory();
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    async execute(
        progress?: { report: (update: { message?: string; increment?: number }) => void },
        token?: vscode.CancellationToken
    ): Promise<void> {
        try {
            const progressManager = progress
                ? new ProgressManager(progress, this.importSteps)
                : undefined;

            // Download step
            await progressManager?.nextStep(token);
            if (!this.ebibleMetadata) {
                throw new Error("No Bible metadata was selected for download");
            }
            this.downloadedSourceUri = await downloadBible(this.ebibleMetadata);
            if (!this.downloadedSourceUri) {
                throw new Error("No Bible text was selected for download");
            }

            // Validation step
            await progressManager?.nextStep(token);
            const validationResult = await this.validator.validateContent(this.downloadedSourceUri);
            if (!validationResult.isValid) {
                throw new Error(
                    `Invalid Bible content: ${validationResult.errors
                        .map((e) => e.message)
                        .join(", ")}`
                );
            }

            // Preview step
            await progressManager?.nextStep(token);
            const preview = await this.analyzer.generatePreview(
                this.downloadedSourceUri,
                this.sourceLanguage
            );
            const shouldProceed = await this.analyzer.showPreviewDialog(preview);
            if (!shouldProceed) {
                throw new Error("Operation cancelled by user");
            }

            // Transform step
            await progressManager?.nextStep(token);
            const transformedContentUri = vscode.Uri.joinPath(
                this.tempDirectory!,
                new Date().toISOString(),
                "transformed-bible.txt"
            );
            const transformResult = await this.transformer.transformContent(
                this.downloadedSourceUri!
            );
            await this.transformer.writeTransformedContent(transformResult, transformedContentUri);

            // Update downloadedSourceUri to use the transformed content
            this.downloadedSourceUri = transformedContentUri;
            this.state.tempFiles.push(transformedContentUri);

            // Splitting step (now uses transformed content)
            await progressManager?.nextStep(token);
            const workspaceFolder = await this.getWorkspaceFolder();
            await splitSourceFileByBook(
                this.downloadedSourceUri,
                workspaceFolder.uri.fsPath,
                this.sourceLanguage
            );

            // Create notebooks step
            await progressManager?.nextStep(token);
            await this.createEmptyNotebooks();

            // Metadata step
            await progressManager?.nextStep(token);
            await this.updateMetadata();

            // Commit step
            await progressManager?.nextStep(token);
            await this.commitChanges();

            this.state.status = "committed";

            vscode.window.showInformationMessage(
                `Successfully downloaded and processed Bible text for ${this.sourceLanguage} language`
            );
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    private async createEmptyNotebooks(): Promise<void> {
        const serializer = new CodexContentSerializer();
        const workspaceFolder = await this.getWorkspaceFolder();

        // Find all .source files created by splitSourceFileByBook
        const sourceFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(
                workspaceFolder,
                `files/source/${this.sourceLanguage}Texts/**/*.source`
            )
        );

        // Create target directory if it doesn't exist
        const targetDir = this.workspaceRoot
            ? vscode.Uri.joinPath(
                  this.workspaceRoot,
                  "files",
                  "target",
                  `${this.sourceLanguage}Texts`
              )
            : undefined;

        if (!targetDir) {
            throw new Error("No workspace folder found");
        }

        try {
            await vscode.workspace.fs.createDirectory(targetDir);
        } catch (error) {
            // Directory might already exist
        }

        for (const sourceFile of sourceFiles) {
            // Create matching .codex file path in target directory
            const fileName = path.basename(sourceFile.fsPath).replace(/\.source$/, ".codex");
            const codexUri = vscode.Uri.joinPath(targetDir, fileName);

            try {
                // Read the source file
                const sourceContent = await vscode.workspace.fs.readFile(sourceFile);
                const notebook = await serializer.deserializeNotebook(
                    sourceContent,
                    new vscode.CancellationTokenSource().token
                );

                // Create empty notebook with same structure
                const emptyNotebook = {
                    ...notebook,
                    cells: notebook.cells.map((cell) => ({
                        ...cell,
                        value: "", // Empty the content
                    })),
                };

                // Serialize and save the empty notebook
                const serializedContent = await serializer.serializeNotebook(
                    emptyNotebook,
                    new vscode.CancellationTokenSource().token
                );

                await vscode.workspace.fs.writeFile(codexUri, serializedContent);
                this.state.tempFiles.push(codexUri);
            } catch (error) {
                console.error(`Error creating notebook for ${sourceFile.fsPath}:`, error);
                throw error;
            }
        }
    }

    private async updateMetadata(): Promise<void> {
        const workspaceFolder = await this.getWorkspaceFolder();

        // Find all source files
        const sourceFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(
                workspaceFolder,
                `files/source/${this.sourceLanguage}Texts/**/*.source`
            )
        );

        for (const sourceFile of sourceFiles) {
            const bookName = path.basename(sourceFile.fsPath, ".source");
            const codexPath = this.workspaceRoot
                ? vscode.Uri.joinPath(
                      this.workspaceRoot,
                      "files",
                      "target",
                      `${this.sourceLanguage}Texts`,
                      `${bookName}.codex`
                  )
                : undefined;

            if (!codexPath) {
                throw new Error("No workspace folder found");
            }

            // Get testament information for corpus marker
            const canonicalOrder = Object.keys(vrefData);
            const corpora = {
                "Old Testament": canonicalOrder.slice(0, 39),
                "New Testament": canonicalOrder.slice(39),
            };

            let corpusMarker = "Other";
            if (corpora["Old Testament"].includes(bookName)) {
                corpusMarker = "Old Testament";
            } else if (corpora["New Testament"].includes(bookName)) {
                corpusMarker = "New Testament";
            }

            const metadata: CustomNotebookMetadata = {
                id: bookName,
                originalName: vscode.workspace.asRelativePath(sourceFile),
                sourceFsPath: sourceFile.fsPath,
                codexFsPath: codexPath.fsPath,
                navigation: [], // Navigation will be populated when notebooks are created
                sourceCreatedAt: new Date().toISOString(),
                gitStatus: "uninitialized",
                corpusMarker,
                textDirection: "ltr", // Default to left-to-right
            };

            await this.metadataManager.addOrUpdateMetadata(metadata);
        }
    }

    protected async commitChanges(): Promise<void> {
        try {
            // Move files from temp to permanent locations if needed
            const workspaceFolder = await this.getWorkspaceFolder();

            // Ensure source and target directories exist
            const sourceDir = this.workspaceRoot
                ? vscode.Uri.joinPath(
                      this.workspaceRoot,
                      "files",
                      "source",
                      `${this.sourceLanguage}Texts`
                  )
                : undefined;

            const targetDir = this.workspaceRoot
                ? vscode.Uri.joinPath(
                      this.workspaceRoot,
                      "files",
                      "target",
                      `${this.sourceLanguage}Texts`
                  )
                : undefined;

            if (!sourceDir || !targetDir) {
                throw new Error("No workspace folder found");
            }

            try {
                await vscode.workspace.fs.createDirectory(sourceDir);
                await vscode.workspace.fs.createDirectory(targetDir);
            } catch (error) {
                // Directories might already exist
            }

            // Move any remaining temp files to their final locations
            for (const tempFile of this.state.tempFiles) {
                const fileName = path.basename(tempFile.fsPath);
                const isSource = fileName.endsWith(".source");
                const destDir = isSource ? sourceDir : targetDir;
                const destUri = vscode.Uri.joinPath(destDir, fileName);

                try {
                    await vscode.workspace.fs.rename(tempFile, destUri, { overwrite: true });
                } catch (error) {
                    console.error(`Error moving file ${fileName}:`, error);
                    throw error;
                }
            }

            // Clear the temp files array since we've moved them
            this.state.tempFiles = [];

            // Update transaction state
            this.state.status = "committed";

            // Cleanup any remaining temporary resources
            await this.cleanupTempFiles();
            if (this.tempDirectory) {
                try {
                    await vscode.workspace.fs.delete(this.tempDirectory, { recursive: true });
                    this.tempDirectory = undefined;
                } catch (error) {
                    console.warn("Error cleaning up temp directory:", error);
                }
            }

            // Refresh the VS Code explorer
            await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer");
        } catch (error) {
            console.error("Error during commit:", error);
            await this.rollback();
            throw new Error(
                `Failed to commit changes: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    private async getWorkspaceFolder(): Promise<vscode.WorkspaceFolder> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }
        return workspaceFolder;
    }
}
