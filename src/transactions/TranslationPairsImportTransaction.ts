import * as vscode from "vscode";
import { ImportTransaction, ImportTransactionState } from "./ImportTransaction";
import { parse } from "csv-parse/sync";

interface ColumnMapping {
    sourceColumn: string;
    targetColumn: string;
    idColumn?: string;
    metadataColumns: string[];
}

interface TranslationPairsState extends ImportTransactionState {
    columnMapping?: ColumnMapping;
    records?: Record<string, string>[];
    headers?: string[];
}

export class TranslationPairsImportTransaction extends ImportTransaction {
    protected override state: TranslationPairsState;
    private delimiter: string;

    constructor(sourceFile: vscode.Uri) {
        super(sourceFile);
        this.state = {
            sourceFile,
            tempFiles: [],
            metadata: null,
            status: "pending",
        };
        // Determine delimiter based on file extension
        this.delimiter = sourceFile.path.endsWith(".csv") ? "," : "\t";
    }

    private async createTempDir(): Promise<vscode.Uri> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        const tempDir = vscode.Uri.joinPath(workspaceFolder.uri, ".codex-temp");
        try {
            await vscode.workspace.fs.createDirectory(tempDir);
        } catch (error) {
            // Directory might already exist, which is fine
            if (error instanceof vscode.FileSystemError && error.code !== "FileExists") {
                throw error;
            }
        }
        return tempDir;
    }

    private async getTempDir(): Promise<vscode.Uri> {
        return this.createTempDir();
    }

    getId(): string {
        return this.state.sourceFile.toString();
    }

    async prepare(): Promise<{ headers: string[] }> {
        const fileContent = await vscode.workspace.fs.readFile(this.state.sourceFile);
        const content = Buffer.from(fileContent).toString("utf-8");

        // Parse just the first line to get headers
        const firstLine = content.split("\n")[0];
        const parsedHeaders = parse(firstLine, {
            delimiter: this.delimiter,
            skip_empty_lines: true,
            columns: false,
            to: 1, // Only parse first line
        }) as string[][];

        const headers = parsedHeaders[0];
        this.state.headers = headers;
        return { headers };
    }

    async setColumnMapping(mapping: ColumnMapping): Promise<void> {
        if (
            !this.state.headers?.includes(mapping.sourceColumn) ||
            !this.state.headers?.includes(mapping.targetColumn)
        ) {
            throw new Error("Invalid column mapping");
        }

        if (mapping.idColumn && !this.state.headers?.includes(mapping.idColumn)) {
            throw new Error("Invalid ID column specified");
        }

        this.state.columnMapping = mapping;
    }

    public async processFiles(): Promise<void> {
        if (!this.state.columnMapping) {
            throw new Error("Column mapping must be set before processing");
        }

        const fileContent = await vscode.workspace.fs.readFile(this.state.sourceFile);
        const content = Buffer.from(fileContent).toString("utf-8");

        // Parse the entire file
        const parsedRecords = parse(content, {
            delimiter: this.delimiter,
            columns: true,
            skip_empty_lines: true,
            cast: true,
        }) as Record<string, string>[];

        this.state.records = parsedRecords;

        // Create source and codex files in temp directory
        const tempDir = await this.getTempDir();
        const baseName = this.state.sourceFile.path.split("/").pop()?.split(".")[0] || "untitled";

        const sourceUri = vscode.Uri.joinPath(tempDir, `${baseName}.source`);
        const codexUri = vscode.Uri.joinPath(tempDir, `${baseName}.codex`);

        const { sourceColumn, targetColumn, idColumn, metadataColumns } = this.state.columnMapping;

        // Transform records into source and codex format
        const cells = parsedRecords.map((record: Record<string, string>, index: number) => ({
            id: idColumn && record[idColumn] ? record[idColumn] : `cell-${index}`,
            content: record[sourceColumn],
            metadata: Object.fromEntries(metadataColumns.map((col) => [col, record[col]])),
        }));

        const translations = parsedRecords.map((record: Record<string, string>, index: number) => ({
            id: idColumn && record[idColumn] ? record[idColumn] : `cell-${index}`,
            content: record[targetColumn],
            metadata: {},
        }));

        // Write the files
        await vscode.workspace.fs.writeFile(
            sourceUri,
            Buffer.from(JSON.stringify({ cells }, null, 2))
        );
        await vscode.workspace.fs.writeFile(
            codexUri,
            Buffer.from(JSON.stringify({ cells: translations }, null, 2))
        );

        this.state.tempFiles.push(sourceUri, codexUri);
    }

    protected async updateMetadata(): Promise<void> {
        if (!this.state.columnMapping || !this.state.records) {
            throw new Error("Missing required state for metadata update");
        }

        // Add metadata about the original file and column mapping
        this.state.metadata = {
            originalFormat: this.state.sourceFile.path.endsWith(".csv") ? "csv" : "tsv",
            columnMapping: this.state.columnMapping,
            totalPairs: this.state.records.length,
            importDate: new Date().toISOString(),
        };

        // Add metadata to the notebook using addOrUpdateMetadata
        await this.metadataManager.addOrUpdateMetadata({
            id: this.state.sourceFile.toString(),
            originalName: this.state.sourceFile.path.split("/").pop() || "untitled",
            ...this.state.metadata,
        });
    }

    protected async commitChanges(): Promise<void> {
        // Move files from temp to final location
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        for (const tempFile of this.state.tempFiles) {
            const fileName = tempFile.path.split("/").pop()!;
            const targetUri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
            await vscode.workspace.fs.rename(tempFile, targetUri, { overwrite: true });
        }
    }

    getState(): TranslationPairsState {
        return this.state;
    }
}
