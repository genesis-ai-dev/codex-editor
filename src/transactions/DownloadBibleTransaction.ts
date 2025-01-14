import * as vscode from "vscode";
import { BaseTransaction, TransactionState } from "./BaseTransaction";
import { CodexContentSerializer } from "../serializer";
import {
    CodexNotebookAsJSONData,
    CustomNotebookCellData,
    ValidationError,
    ValidationResult,
} from "../../types";
import { CodexCellTypes } from "../../types/enums";
import { allORGBibleVerseRefs } from "../utils/verseRefUtils/verseData";
import { getTestamentForBook } from "../utils/verseRefUtils/verseData";
import {
    NotebookMetadataManager,
    getNotebookMetadataManager,
} from "../utils/notebookMetadataManager";
import { getWorkSpaceUri } from "../utils";

export interface DownloadBibleTransactionState extends TransactionState {
    metadata: {
        languageCode: string;
        translationId: string;
    };
    verses: {
        vref: string;
        text: string;
    }[];
    notebooks: {
        sourceNotebook: CodexNotebookAsJSONData;
        codexNotebook: CodexNotebookAsJSONData;
    }[];
    preview: CodexNotebookAsJSONData | null;
    progress: {
        message: string;
        increment: number;
        status: Record<string, string>;
        token?: vscode.CancellationToken;
        report: (update: {
            message?: string;
            increment?: number;
            status?: Record<string, string>;
        }) => void;
    } | null;
    tempDir: vscode.Uri | null;
    asTranslationOnly: boolean;
}

export class DownloadBibleTransaction extends BaseTransaction {
    protected state: DownloadBibleTransactionState;
    protected tempDir: vscode.Uri | null = null;

    constructor(asTranslationOnly: boolean = false) {
        super();
        this.state = {
            metadata: {
                languageCode: "",
                translationId: "",
            },
            tempFiles: [],
            status: "pending",
            verses: [],
            notebooks: [],
            preview: null,
            progress: null,
            tempDir: null,
            asTranslationOnly,
        };
    }

    setMetadata(metadata: { languageCode: string; translationId: string }) {
        this.state.metadata = metadata;
    }

    private getEbibleFileName(): string {
        const { languageCode, translationId } = this.state.metadata;
        if (!languageCode || !translationId) {
            throw new Error("Missing language code or translation ID");
        }
        return `${languageCode}-${translationId}.txt`;
    }

    async getPreview(): Promise<CodexNotebookAsJSONData | null> {
        return this.state.preview;
    }

    private async validateBibleContent(): Promise<ValidationResult> {
        // Basic validation of Bible content
        const errors = [];

        if (!this.state.metadata.languageCode) {
            errors.push({
                code: "INVALID_LANGUAGE_CODE",
                message: "No language code provided",
            });
        }

        if (!this.state.metadata.translationId) {
            errors.push({
                code: "INVALID_TRANSLATION_ID",
                message: "No translation ID provided",
            });
        }

        if (this.state.verses.length === 0) {
            errors.push({
                code: "NO_CONTENT",
                message: "No Bible verses found",
            });
        }

        // Check for malformed verse references
        // const malformedRefs = this.state.verses.filter(
        //     (verse) => !verse.vref.match(/^[A-Za-z0-9]+ \d+:\d+$/)
        // );
        // if (malformedRefs.length > 0) {
        //     errors.push({
        //         code: "MALFORMED_REFS",
        //         message: `Found ${malformedRefs.length} malformed verse references`,
        //         details: { examples: malformedRefs.slice(0, 3) },
        //     });
        // }

        return {
            isValid: errors.length === 0,
            errors: errors as ValidationError[],
        };
    }

    async prepare(): Promise<void> {
        try {
            this.state.status = "executing";

            // Report progress
            this.state.progress?.report({
                message: "Validating Bible content",
                increment: 10,
                status: { validation: "active" },
            });

            // Download and validate content
            const [vrefs, verses] = await Promise.all([
                Promise.resolve(allORGBibleVerseRefs),
                this.downloadVerseContent(),
            ]);

            // Trim verses array to match allORGBibleVerseRefs length
            const trimmedVerses = verses.slice(0, vrefs.length);

            this.state.verses = trimmedVerses.map((text, i) => ({
                vref: vrefs[i],
                text,
            }));

            // Validate content
            const validationResult = await this.validateBibleContent();
            if (!validationResult.isValid) {
                throw new Error(
                    `Bible content validation failed: ${validationResult.errors
                        .map((e) => e.message)
                        .join(", ")}`
                );
            }

            // Transform content into notebooks
            this.state.progress?.report({
                message: "Transforming Bible content",
                increment: 40,
                status: { notebooks: "active" },
            });
            await this.transformToNotebooks();

            this.state.progress?.report({
                message: "Creating preview",
                increment: 20,
                status: { validation: "complete", transform: "active" },
            });

            // Create preview notebook
            await this.createPreviewNotebook();

            this.state.status = "prepared";

            this.state.progress?.report({
                message: "Preview ready",
                increment: 30,
                status: { transform: "complete" },
            });
        } catch (error) {
            await this.rollback();
            this.state.status = "rolledback";
            throw error;
        }
    }

    async execute(
        progress?: {
            report: (update: {
                message?: string;
                increment?: number;
                status?: Record<string, string>;
            }) => void;
        },
        token?: vscode.CancellationToken
    ): Promise<void> {
        this.state.progress = progress
            ? { ...progress, message: "", increment: 0, status: {} }
            : null;
        try {
            this.state.status = "executing";

            // Save notebooks
            progress?.report({
                message: "Saving notebooks",
                increment: 80,
                status: { metadata: "complete", commit: "active" },
            });
            await this.saveNotebooks();

            // Create metadata
            progress?.report({
                message: "Setting up metadata",
                increment: 60,
                status: { notebooks: "complete", metadata: "active" },
            });
            await this.setupMetadata();

            // Complete
            progress?.report({
                message: "Bible import complete",
                increment: 100,
                status: { commit: "complete" },
            });
            this.state.status = "committed";
        } catch (error) {
            await this.rollback();
            this.state.status = "rolledback";
            throw error;
        }
    }

    private async setupMetadata(): Promise<void> {
        const metadataManager = getNotebookMetadataManager();
        for (const notebookPair of this.state.notebooks) {
            await metadataManager.addOrUpdateMetadata(notebookPair.sourceNotebook.metadata);
            await metadataManager.addOrUpdateMetadata(notebookPair.codexNotebook.metadata);
        }
    }

    private async saveNotebooks(): Promise<void> {
        const serializer = new CodexContentSerializer();

        const workspaceUri = getWorkSpaceUri();
        if (!workspaceUri) {
            throw new Error("No workspace found in DownloadBibleTransaction.saveNotebooks()");
        }
        const sourceDestinationDirectory = vscode.Uri.joinPath(
            workspaceUri,
            ".project",
            "sourceTexts"
        );
        const codexDestinationDirectory = vscode.Uri.joinPath(workspaceUri, "files", "target");

        // FIXME: this is a hack to get the token to work, but we really should be passing one around in the process
        const currentToken =
            this.state.progress?.token || new vscode.CancellationTokenSource().token;

        // serialize and save each notebook pair
        for (const notebookPair of this.state.notebooks) {
            const bookName = notebookPair.sourceNotebook.metadata.id;
            const sourceUri = vscode.Uri.joinPath(sourceDestinationDirectory, `${bookName}.source`);
            const codexUri = vscode.Uri.joinPath(codexDestinationDirectory, `${bookName}.codex`);

            // Update source notebook metadata
            notebookPair.sourceNotebook.metadata = {
                ...notebookPair.sourceNotebook.metadata,
                sourceFsPath: sourceUri.fsPath,
                codexFsPath: undefined,
            };

            // Update codex notebook metadata
            notebookPair.codexNotebook.metadata = {
                ...notebookPair.codexNotebook.metadata,
                sourceFsPath: sourceUri.fsPath,
                codexFsPath: codexUri.fsPath,
            };

            const serializedSourceNotebook = await serializer.serializeNotebook(
                notebookPair.sourceNotebook,
                currentToken
            );
            const serializedCodexNotebook = await serializer.serializeNotebook(
                notebookPair.codexNotebook,
                currentToken
            );

            await vscode.workspace.fs.writeFile(sourceUri, serializedSourceNotebook);
            await vscode.workspace.fs.writeFile(codexUri, serializedCodexNotebook);
        }
    }

    // FIXME: add an endpoint for our blank slate bibles
    private async downloadVerseContent(): Promise<string[]> {
        const ebibleUrl = `https://raw.githubusercontent.com/BibleNLP/ebible/0eed6f47ff555201874d5416bbfebba4ed743d4f/corpus/${this.getEbibleFileName()}`;
        let response;
        try {
            response = await fetch(ebibleUrl);
        } catch (error) {
            throw new Error(
                `Failed to fetch Bible text from ${ebibleUrl}. This could be due to network issues or the server being unavailable. Error: ${
                    (error as any).message
                }`
            );
        }
        if (!response.ok) {
            throw new Error(
                `Failed to download Bible text: ${response.status} ${response.statusText}. It could be that this file no longer exists on the remote server. Try navigating to ${ebibleUrl}`
            );
        }
        const text = await response.text().then((text) => {
            if (!text) {
                throw new Error("Received empty response from the server.");
            }
            return text;
        });
        return text.trim().split("\n");
    }

    async transformToNotebooks(): Promise<void> {
        if (this.state.asTranslationOnly) {
            await this.transformToTranslation();
        } else {
            // each notebook needs notebook metadata, and cells with content
            const notebooks: {
                sourceNotebook: CodexNotebookAsJSONData;
                codexNotebook: CodexNotebookAsJSONData;
            }[] = [];
            // we need to create a notebook for each [book] in the ebible file
            const bookNames = new Set(this.state.verses.map((verse) => verse.vref.split(" ")[0]));

            for (const bookName of bookNames) {
                // Filter verses for this book
                const bookVerses = this.state.verses.filter(
                    (verse) => verse.vref.split(" ")[0] === bookName
                );

                // Create source notebook
                const sourceNotebook: CodexNotebookAsJSONData = {
                    cells: bookVerses.map((verse) => ({
                        kind: vscode.NotebookCellKind.Code,
                        languageId: "html",
                        value: verse.text,
                        metadata: {
                            type: CodexCellTypes.TEXT,
                            id: verse.vref,
                            data: {},
                        },
                    })),
                    // @ts-expect-error - will be populated shortly
                    metadata: {},
                };

                // Create matching codex notebook with empty cells
                const codexNotebook: CodexNotebookAsJSONData = {
                    ...sourceNotebook,
                    cells: bookVerses.map((verse) => ({
                        kind: vscode.NotebookCellKind.Code,
                        languageId: "html",
                        value: "", // Empty value for codex cells
                        metadata: {
                            type: CodexCellTypes.TEXT,
                            id: verse.vref,
                            data: {},
                        },
                    })),
                    // @ts-expect-error - will be populated shortly
                    metadata: {},
                };

                const commonMetadata = {
                    id: bookName,
                    originalName: bookName,
                    sourceFsPath: "", // Will be set when saving
                    codexFsPath: "", // Will be set when saving
                    navigation: [],
                    sourceCreatedAt: new Date().toISOString(),
                    codexLastModified: new Date().toISOString(),
                    gitStatus: "untracked" as const,
                    corpusMarker: getTestamentForBook(bookName) || "Deuterocanonical",
                };

                sourceNotebook.metadata = commonMetadata;
                codexNotebook.metadata = commonMetadata;

                notebooks.push({ sourceNotebook, codexNotebook });
            }

            // Store the notebooks in the state for later use
            this.state.notebooks = notebooks;
        }
    }

    private async transformToTranslation(): Promise<void> {
        const workspaceUri = getWorkSpaceUri();
        if (!workspaceUri) {
            throw new Error("No workspace found");
        }

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Import Translation",
                cancellable: true,
            },
            async (progress, token) => {
                try {
                    // Create verse lookup map once
                    const verseMap = new Map(
                        this.state.verses.map((verse) => [verse.vref, verse.text])
                    );

                    // Get all codex files in parallel
                    const codexFiles = await vscode.workspace.findFiles("**/files/target/*.codex");
                    const totalFiles = codexFiles.length;

                    // Process notebooks in batches to avoid memory issues
                    const BATCH_SIZE = 10;
                    const notebooks: {
                        sourceNotebook: CodexNotebookAsJSONData;
                        codexNotebook: CodexNotebookAsJSONData;
                    }[] = [];

                    for (let i = 0; i < codexFiles.length; i += BATCH_SIZE) {
                        if (token.isCancellationRequested) {
                            throw new Error("Operation cancelled by user");
                        }

                        const batch = codexFiles.slice(i, i + BATCH_SIZE);
                        const batchResults = await Promise.all(
                            batch.map(async (codexUri) => {
                                try {
                                    // Get corresponding source file path
                                    const sourceUri = vscode.Uri.joinPath(
                                        workspaceUri,
                                        ".project",
                                        "sourceTexts",
                                        `${codexUri.path
                                            .split("/")
                                            .pop()
                                            ?.replace(".codex", ".source")}`
                                    );

                                    // Read both files in parallel
                                    const [codexContent, sourceContent] = await Promise.all([
                                        vscode.workspace.fs.readFile(codexUri),
                                        vscode.workspace.fs.readFile(sourceUri),
                                    ]);

                                    const codexNotebook = JSON.parse(codexContent.toString());
                                    const sourceNotebook = JSON.parse(sourceContent.toString());

                                    // Only update cells that need updating
                                    codexNotebook.cells = codexNotebook.cells.map(
                                        (cell: CustomNotebookCellData) => {
                                            const newValue = verseMap.get(cell.metadata?.id);
                                            if (!newValue) return cell; // No change needed

                                            return {
                                                ...cell,
                                                value: newValue,
                                            };
                                        }
                                    );

                                    // Update last modified timestamp
                                    codexNotebook.metadata.codexLastModified =
                                        new Date().toISOString();

                                    return {
                                        sourceNotebook,
                                        codexNotebook,
                                    };
                                } catch (error) {
                                    console.error(`Error processing ${codexUri.fsPath}:`, error);
                                    return null;
                                }
                            })
                        );

                        // Filter out any failed notebooks and add successful ones
                        notebooks.push(
                            ...batchResults.filter(
                                (result): result is NonNullable<typeof result> => result !== null
                            )
                        );

                        // Update progress
                        const processedCount = Math.min(i + BATCH_SIZE, totalFiles);
                        progress.report({
                            message: `Processing notebooks (${processedCount}/${totalFiles})`,
                            increment: (BATCH_SIZE / totalFiles) * 100,
                        });
                    }

                    this.state.notebooks = notebooks;
                } catch (error) {
                    if ((error as any).message === "Operation cancelled by user") {
                        throw error;
                    }
                    throw new Error(`Failed to transform Bible content to translation: ${error}`);
                }
            }
        );
    }

    async createPreviewNotebook(): Promise<void> {
        if (this.state.notebooks.length === 0) {
            throw new Error("No notebooks available for preview");
        }

        const firstNotebook = this.state.notebooks[0];
        const previewCells = firstNotebook[
            this.state.asTranslationOnly ? "codexNotebook" : "sourceNotebook"
        ].cells.slice(0, 10);

        this.state.preview = {
            cells: previewCells,
            metadata:
                firstNotebook[this.state.asTranslationOnly ? "codexNotebook" : "sourceNotebook"]
                    .metadata,
        };
    }

    async commit(): Promise<void> {
        await this.moveNotebooksToWorkspace();
        await this.cleanupTempFiles();
        this.state.status = "committed";
    }

    async rollback(): Promise<void> {
        this.state = {
            metadata: {
                languageCode: "",
                translationId: "",
            },
            verses: [],
            notebooks: [],
            preview: null,
            progress: null,
            tempDir: null,
            tempFiles: [],
            asTranslationOnly: false,
            status: "rolledback",
        };
    }

    async moveNotebooksToWorkspace(): Promise<void> {}

    // async awaitConfirmation(): Promise<void> {
    //     // FIXME: we need to make this work with the implementing context - e.g., SourceUploadProvider.ts
    //     const confirmation = await vscode.window.showInformationMessage(
    //         "Would you like to import these Bible notebooks into your workspace?",
    //         { modal: true },
    //         "Yes",
    //         "No"
    //     );

    //     if (confirmation !== "Yes") {
    //         await this.rollback();
    //         throw new Error("User cancelled the import");
    //     }

    //     this.state.status = "awaiting_confirmation";
    // }
}
