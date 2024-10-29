import * as vscode from "vscode";
import { BaseTransaction, TransactionState } from "./BaseTransaction";
import { ProgressManager, ProgressStep } from "../utils/progressManager";
import { ExtendedMetadata, EbibleCorpusMetadata } from "../utils/ebible/ebibleCorpusUtils";
import {
    downloadEBibleText,
    ensureVrefList,
    zipBibleFiles,
} from "../utils/ebible/ebibleClientOnlyUtils";
import { BibleContentValidator } from "../validators/BibleContentValidator";
import { BibleContentTransformer } from "../transformers/BibleContentTransformer";
import {
    BiblePreviewData,
    NotebookPreview,
    CustomNotebookPreviewWithMetadata,
    CustomNotebookMetadata,
} from "../../types";
import { CodexNotebookAsJSONData, CustomNotebookCellData } from "../../types";
import { CodexCellTypes } from "../../types/enums";
import { CodexContentSerializer } from "../serializer";
import { splitSourceFileByBook } from "../utils/codexNotebookUtils";
import { NotebookMetadataManager } from "../utils/notebookMetadataManager";
import { vrefData } from "../utils/verseRefUtils/verseData";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

interface DownloadBibleTransactionState extends TransactionState {
    tempDirectory?: vscode.Uri;
    downloadedFile?: vscode.Uri;
    validatedContent?: {
        validLines: string[];
        validLineIndices: number[];
    };
    vrefPath?: vscode.Uri;
    zippedFile?: vscode.Uri;
    preview?: BiblePreviewData;
    isPreviewConfirmed?: boolean;
    transformedContent?: {
        verses: Array<{
            book: string;
            chapter: number;
            verse: number;
            text: string;
        }>;
        statistics: {
            totalVerses: number;
            processedBooks: string[];
        };
    };
    notebookUri?: vscode.Uri;
}

export class DownloadBibleTransaction extends BaseTransaction {
    private readonly ebibleMetadata: ExtendedMetadata;
    protected state: DownloadBibleTransactionState = {
        status: "prepared",
        tempFiles: [],
    };
    private validator: BibleContentValidator;
    private transformer: BibleContentTransformer;

    private readonly importSteps: ProgressStep[] = [
        { name: "download", message: "Downloading Bible text...", weight: 2 },
        { name: "validation", message: "Validating content...", weight: 1 },
        { name: "preview", message: "Generating preview...", weight: 1 },
        { name: "transform", message: "Transforming content...", weight: 2 },
        { name: "notebooks", message: "Creating notebooks...", weight: 2 },
        { name: "metadata", message: "Updating metadata...", weight: 1 },
        { name: "commit", message: "Committing changes...", weight: 1 },
    ];

    constructor(options: { ebibleMetadata: ExtendedMetadata }) {
        super();
        this.ebibleMetadata = options.ebibleMetadata;
        this.validator = new BibleContentValidator();
        this.transformer = new BibleContentTransformer();
    }

    async prepare(): Promise<void> {
        try {
            // Create temp directory with timestamp
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (!workspaceRoot) {
                throw new Error("No workspace folder found");
            }

            // Create base temp directory if it doesn't exist
            const baseTempDir = vscode.Uri.joinPath(workspaceRoot, ".codex-temp");
            await vscode.workspace.fs.createDirectory(baseTempDir);

            // Create timestamped subdirectory
            const timestamp = new Date();
            this.state.tempDirectory = vscode.Uri.joinPath(baseTempDir, timestamp.toISOString());
            await vscode.workspace.fs.createDirectory(this.state.tempDirectory);

            // Ensure vref.txt exists in the temp directory
            const vrefUri = await ensureVrefList(this.state.tempDirectory);
            this.state.vrefPath = vrefUri;
            this.state.tempFiles.push(vrefUri);

            this.state.status = "prepared";
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    async execute(
        progress?: { report: (update: { message?: string; increment?: number }) => void },
        token?: vscode.CancellationToken
    ): Promise<void> {
        if (this.state.status !== "prepared") {
            throw new Error("Transaction not prepared");
        }

        const progressManager = progress
            ? new ProgressManager(progress, this.importSteps)
            : undefined;

        try {
            // Step 1: Download
            await progressManager?.nextStep(token);
            await this.downloadBibleText();

            // Step 2: Validate
            await progressManager?.nextStep(token);
            await this.validateContent();

            // Step 3: Generate Preview
            await progressManager?.nextStep(token);
            await this.generatePreview();

            // Wait for preview confirmation
            if (!this.state.isPreviewConfirmed) {
                this.state.status = "awaiting_confirmation";
                return;
            }

            // Continue with remaining steps only after confirmation
            await this.continueExecution(progressManager, token);
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    private async generatePreview(): Promise<BiblePreviewData> {
        if (!this.state.zippedFile || !this.state.validatedContent) {
            throw new Error("Cannot generate preview: missing required data");
        }

        // Generate preview of first few verses with their verse references
        const previewLines = this.state.validatedContent.validLines.slice(0, 10);
        const preview = previewLines.join("\n");

        const notebookPreviewMetadata: CustomNotebookMetadata = {
            id: `${this.ebibleMetadata.languageCode}-${this.ebibleMetadata.translationId}`,
            originalName: `${this.ebibleMetadata.languageCode}-${this.ebibleMetadata.translationId}`,
            sourceFsPath: this.state.zippedFile?.fsPath || "",
            codexFsPath: "",
            navigation: [],
            sourceCreatedAt: new Date().toISOString(),
            gitStatus: "uninitialized",
            corpusMarker: "",
            textDirection: "ltr",
        };

        // Create a sample notebook preview
        const notebookPreview: NotebookPreview = {
            name: `${this.ebibleMetadata.languageCode}-${this.ebibleMetadata.translationId}`,
            cells: previewLines.map((line, index) => ({
                kind: 2,
                languageId: "html",
                value: line,
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: `preview-${index}`,
                    data: {},
                },
            })),
            metadata: notebookPreviewMetadata,
        };

        // Create preview data
        // Log validation info
        console.log("Valid lines:", this.state.validatedContent.validLines);

        const previewData: BiblePreviewData = {
            original: {
                preview,
                validationResults: [
                    {
                        isValid: true,
                        errors: [],
                    },
                ],
            },
            transformed: {
                sourceNotebooks: [
                    {
                        ...notebookPreview,
                        metadata: notebookPreviewMetadata,
                    },
                ],
                validationResults: [
                    {
                        isValid: true,
                        errors: [],
                    },
                ],
            },
        };

        this.state.preview = previewData;
        return previewData;
    }

    async confirmPreview(): Promise<void> {
        if (this.state.status !== "awaiting_confirmation") {
            throw new Error("Transaction is not awaiting preview confirmation");
        }
        this.state.isPreviewConfirmed = true;
        this.state.status = "prepared";
    }

    async continueExecution(
        progressManager?: ProgressManager,
        token?: vscode.CancellationToken
    ): Promise<void> {
        if (!this.state.isPreviewConfirmed) {
            throw new Error("Preview must be confirmed before continuing");
        }

        try {
            // Step 4: Transform
            await progressManager?.nextStep(token);
            await this.transformContent();

            // Step 5: Create notebooks
            await progressManager?.nextStep(token);
            await this.createNotebooks();

            // Step 6: Update metadata
            await progressManager?.nextStep(token);
            await this.updateMetadata();

            // Step 7: Commit changes
            await progressManager?.nextStep(token);
            await this.commitChanges();

            this.state.status = "committed";
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }

    private async transformContent(): Promise<void> {
        if (!this.state.zippedFile || !this.state.validatedContent) {
            throw new Error("Missing required data for transformation");
        }

        const result = await this.transformer.transformContent(this.state.zippedFile);
        this.state.transformedContent = result;
    }

    private async createNotebooks(): Promise<void> {
        if (!this.state.transformedContent || !this.state.tempDirectory) {
            throw new Error("Missing transformed content or temp directory");
        }

        const notebookData: CodexNotebookAsJSONData = {
            cells: [],
            metadata: {
                id: `${this.ebibleMetadata.languageCode}-${this.ebibleMetadata.translationId}`,
                originalName: `${this.ebibleMetadata.languageCode}-${this.ebibleMetadata.translationId}`,
                sourceFsPath: this.state.downloadedFile?.fsPath || "",
                codexFsPath: "",
                corpusMarker: "",
                navigation: [],
                sourceCreatedAt: new Date().toISOString(),
                gitStatus: "uninitialized",
            },
        };

        let currentChapter = "";
        let chapterCellId = "";
        let testament: "OT" | "NT" | undefined;

        // Create cells from transformed verses
        this.state.transformedContent.verses.forEach((verse) => {
            if (!testament && vrefData[verse.book]) {
                testament = vrefData[verse.book].testament as "OT" | "NT";
            }

            if (`${verse.chapter}` !== currentChapter) {
                currentChapter = `${verse.chapter}`;
                chapterCellId = `${verse.book} ${verse.chapter}:1:${Math.random()
                    .toString(36)
                    .substr(2, 11)}`;

                // Add chapter header cell
                notebookData.cells.push({
                    kind: 2,
                    languageId: "html",
                    value: `<h1>Chapter ${verse.chapter}</h1>`,
                    metadata: {
                        type: CodexCellTypes.PARATEXT,
                        id: chapterCellId,
                    },
                });
            }

            // Add verse cell
            notebookData.cells.push({
                kind: 2,
                languageId: "html",
                value: verse.text,
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: `${verse.book} ${verse.chapter}:${verse.verse}`,
                    data: {},
                },
            });
        });

        // Update notebook metadata
        notebookData.metadata.corpusMarker = testament || "";

        // Serialize notebook
        const serializer = new CodexContentSerializer();
        const notebookContent = await serializer.serializeNotebook(
            new vscode.NotebookData(
                notebookData.cells.map((cell) => new vscode.NotebookCellData(2, cell.value, "html"))
            ),
            new vscode.CancellationTokenSource().token
        );

        // Write to temp location
        const notebookUri = vscode.Uri.joinPath(
            this.state.tempDirectory,
            `${this.ebibleMetadata.languageCode}-${this.ebibleMetadata.translationId}.source`
        );
        await vscode.workspace.fs.writeFile(notebookUri, notebookContent);

        this.state.notebookUri = notebookUri;
        this.state.tempFiles.push(notebookUri);
    }

    private async updateMetadata(): Promise<void> {
        if (!this.state.notebookUri) {
            throw new Error("No notebook URI available");
        }

        const metadataManager = new NotebookMetadataManager();
        await metadataManager.initialize();

        const metadata = {
            id: `${this.ebibleMetadata.languageCode}-${this.ebibleMetadata.translationId}`,
            originalName: `${this.ebibleMetadata.languageCode}-${this.ebibleMetadata.translationId}`,
            sourceFsPath: this.state.notebookUri.fsPath,
            codexFsPath: this.state.notebookUri.fsPath,
            sourceCreatedAt: new Date().toISOString(),
            gitStatus: "uninitialized",
            corpusMarker: this.state.transformedContent?.verses[0]
                ? vrefData[this.state.transformedContent.verses[0].book]?.testament || ""
                : "",
        };

        // @ts-expect-error - Not sure how to define optional types now
        await metadataManager.addOrUpdateMetadata(metadata);
    }

    private async commitChanges(): Promise<void> {
        if (!this.state.notebookUri) {
            throw new Error("No notebook to commit");
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceRoot) {
            throw new Error("No workspace folder found");
        }

        // Move notebook to final location
        const finalPath = vscode.Uri.joinPath(
            workspaceRoot,
            "files",
            "source",
            `${this.ebibleMetadata.languageCode}Texts`,
            path.basename(this.state.notebookUri.fsPath)
        );

        // Ensure directory exists
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(finalPath, ".."));

        // Move file
        await vscode.workspace.fs.rename(this.state.notebookUri, finalPath, { overwrite: true });

        // Split the source file by book
        await splitSourceFileByBook(finalPath, workspaceRoot.fsPath, "source");

        // Clean up temp directory
        if (this.state.tempDirectory) {
            try {
                await vscode.workspace.fs.delete(this.state.tempDirectory, { recursive: true });
            } catch (error) {
                console.warn("Failed to delete temp directory:", error);
            }
        }

        this.state.tempFiles = [];
    }

    getPreview(): BiblePreviewData | undefined {
        return this.state.preview;
    }

    private async downloadBibleText(): Promise<void> {
        if (!this.state.tempDirectory) {
            throw new Error("Temp directory not initialized");
        }

        const simpleMetadata: EbibleCorpusMetadata = {
            code: this.ebibleMetadata.languageCode,
            file: `${this.ebibleMetadata.languageCode}-${this.ebibleMetadata.translationId}`,
            lang: this.ebibleMetadata.languageName || "",
            family: "",
            country: "",
            Total: 0,
            Books: 0,
            OT: 0,
            NT: 0,
            DT: 0,
        };

        // Download to temp directory
        this.state.downloadedFile = await downloadEBibleText(
            simpleMetadata,
            this.state.tempDirectory
        );
        this.state.tempFiles.push(this.state.downloadedFile);

        // Also ensure vref.txt is in temp directory
        const vrefUri = await ensureVrefList(this.state.tempDirectory);
        this.state.vrefPath = vrefUri;
        this.state.tempFiles.push(vrefUri);

        const zippedFile = await zipBibleFiles(
            this.state.vrefPath,
            this.state.downloadedFile,
            this.state.tempDirectory
        );
        this.state.tempFiles.push(zippedFile);
        this.state.zippedFile = zippedFile;
    }

    private async validateContent(): Promise<void> {
        if (!this.state.zippedFile) {
            throw new Error("No zipped file to validate");
        }

        const validationResult = await this.validator.validateContent(this.state.zippedFile);
        if (!validationResult.isValid) {
            throw new Error(
                `Bible content validation failed: ${validationResult.errors
                    .map((e) => e.message)
                    .join(", ")}`
            );
        }

        this.state.validatedContent = {
            validLines: validationResult.validLines,
            validLineIndices: validationResult.validLineIndices,
        };
    }

    async rollback(): Promise<void> {
        try {
            // Clean up temp files
            for (const tempFile of this.state.tempFiles) {
                try {
                    await vscode.workspace.fs.delete(tempFile);
                } catch (error) {
                    console.warn(`Failed to delete temp file ${tempFile.fsPath}:`, error);
                }
            }

            // Clean up temp directory if it exists
            if (this.state.tempDirectory) {
                try {
                    await vscode.workspace.fs.delete(this.state.tempDirectory, { recursive: true });
                } catch (error) {
                    console.warn(
                        `Failed to delete temp directory ${this.state.tempDirectory.fsPath}:`,
                        error
                    );
                }
            }

            this.state = {
                status: "rolledback",
                tempFiles: [],
            };
        } catch (error) {
            console.error("Error during rollback:", error);
        }
    }
}
