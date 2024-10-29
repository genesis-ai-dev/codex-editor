import * as vscode from "vscode";
import { BaseTransaction, TransactionState } from "./BaseTransaction";
import { CodexContentSerializer } from "src/serializer";
import { CodexNotebookAsJSONData, CustomNotebookDocument } from "@types";
import { CodexCellTypes } from "@types/enums";

export interface DownloadBibleTransactionState extends TransactionState {
    ebibleFileName: string;
    verses: {
        vref: string;
        text: string;
    }[];
    notebooks: {
        sourceNotebook: CodexNotebookAsJSONData;
        codexNotebook: CodexNotebookAsJSONData;
    }[];
    preview: CodexNotebookAsJSONData | null;
}

export class DownloadBibleTransaction extends BaseTransaction {
    protected state: DownloadBibleTransactionState;
    protected tempDir: vscode.Uri | null = null;

    constructor() {
        super();
        this.state = {
            ebibleFileName: "",
            tempFiles: [],
            status: "pending",
            verses: [],
            notebooks: [],
            preview: null,
        };
    }
    private async downloadVrefList(): Promise<string[]> {
        const vrefUrl = "https://raw.githubusercontent.com/BibleNLP/ebible/main/metadata/vref.txt";
        const response = await fetch(vrefUrl);
        if (!response.ok) {
            throw new Error(
                `Failed to download vref list: ${response.status} ${response.statusText}`
            );
        }
        const text = await response.text();
        return text
            .trim()
            .split("\n")
            .filter((line) => line.trim().length > 0);
    }

    private async downloadVerseContent(): Promise<string[]> {
        const ebibleUrl = `https://raw.githubusercontent.com/BibleNLP/ebible/main/corpus/${this.state.ebibleFileName}`;
        const response = await fetch(ebibleUrl);
        if (!response.ok) {
            throw new Error(
                `Failed to download Bible text: ${response.status} ${response.statusText}`
            );
        }
        const text = await response.text();
        return text
            .trim()
            .split("\n")
            .filter((line) => line.trim().length > 0);
    }

    async prepare(): Promise<any> {
        const [vrefs, verses] = await Promise.all([
            this.downloadVrefList(),
            this.downloadVerseContent(),
        ]);

        if (vrefs.length !== verses.length) {
            throw new Error(
                `Mismatch between vref count (${vrefs.length}) and verse count (${verses.length})`
            );
        }

        this.state.verses = vrefs.map((vref, i) => ({
            vref,
            text: verses[i],
        }));

        this.state.status = "prepared";
    }

    async execute(
        progress?: { report: (update: { message?: string; increment?: number }) => void },
        token?: vscode.CancellationToken
    ): Promise<void> {
        this.state.status = "executing";

        // we have the ebible text, and we have the vrefs

        // transform: we need to create notebooks - one per book
        // save: the notebooks to the temp directory
        await this.transformToNotebooks();

        // create a truncated preview notebook
        await this.createPreviewNotebook();

        // commit: move the notebooks to the user's workspace
        this.state.status = "awaiting_confirmation";
    }

    async transformToNotebooks(): Promise<void> {
        const serializer = new CodexContentSerializer();
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
                corpusMarker: "",
            };

            sourceNotebook.metadata = commonMetadata;
            codexNotebook.metadata = commonMetadata;

            notebooks.push({ sourceNotebook, codexNotebook });
        }

        // Store the notebooks in the state for later use
        this.state.notebooks = notebooks;
    }

    async createPreviewNotebook(): Promise<void> {
        // TODO: Implement createPreviewNotebook by getting the first 10 cells of the first notebook
        const firstNotebook = this.state.notebooks[0];
        const firstTenCells = firstNotebook.sourceNotebook.cells.slice(0, 10);
        const previewNotebook = {
            ...firstNotebook.sourceNotebook,
            cells: firstTenCells,
        };
        this.state.preview = previewNotebook;
    }

    async commit(): Promise<void> {
        await this.cleanupTempFiles();
        this.state.status = "committed";
    }

    async awaitConfirmation(): Promise<void> {
        // FIXME: we need to make this work with the implementing context - e.g., SourceUploadProvider.ts
        const confirmation = await vscode.window.showInformationMessage(
            "Would you like to import these Bible notebooks into your workspace?",
            { modal: true },
            "Yes",
            "No"
        );

        if (confirmation !== "Yes") {
            await this.rollback();
            throw new Error("User cancelled the import");
        }

        this.state.status = "awaiting_confirmation";
    }
}
