import * as vscode from "vscode";
import { ImportTransaction, ImportTransactionState } from "./ImportTransaction";
import { parse } from "csv-parse/sync";

const DEBUG = true;
const debug = function (...args: any[]) {
    if (DEBUG) {
        console.log("[TranslationPairsImportTransaction]", ...args);
    }
};
interface ColumnMapping {
    sourceColumn: string;
    targetColumn: string;
    idColumn?: string;
    metadataColumns: string[];
    hasHeaders: boolean;
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

    getId(): string {
        return this.state.sourceFile.toString();
    }

    async prepare(): Promise<{ headers: string[]; headersIndexKey: Record<string, number> }> {
        const fileContent = await vscode.workspace.fs.readFile(this.state.sourceFile);
        const content = Buffer.from(fileContent).toString("utf-8");

        // Parse just the first line to get headers/columns
        const firstLine = content.split("\n")[0];
        const parsedHeaders = parse(firstLine, {
            delimiter: this.delimiter,
            skip_empty_lines: true,
            columns: false,
            to: 1, // Only parse first line
        }) as string[][];
        debug("parsedHeaders", parsedHeaders);
        // If no headers, generate column numbers
        const headers = parsedHeaders[0]; /* .map((_, i) => `Column ${i + 1}`); */
        debug("headers", headers);
        this.state.headers = headers;
        debug("state.headers", this.state.headers);
        return {
            headers,
            headersIndexKey: Object.fromEntries(headers.map((header, index) => [header, index])),
        };
    }

    public async processFiles(): Promise<void> {
        if (!this.state.columnMapping) {
            throw new Error("Column mapping must be set before processing");
        }

        // Create temp directory if it doesn't exist
        if (!this.tempDir) {
            await this.createTempDirectory();
        }

        const fileContent = await vscode.workspace.fs.readFile(this.state.sourceFile);
        const content = Buffer.from(fileContent).toString("utf-8");

        // Parse the file based on whether it has headers
        const parsedRecords = parse(content, {
            delimiter: this.delimiter,
            columns: this.state.columnMapping.hasHeaders,
            skip_empty_lines: true,
            cast: true,
            from_line: this.state.columnMapping.hasHeaders ? 1 : 0,
        }) as Record<string, string>[];

        this.state.records = parsedRecords;

        // Get temp directory (will throw if not created)
        const tempDir = this.getTempDir();
        const baseName = this.state.sourceFile.path.split("/").pop()?.split(".")[0] || "untitled";

        const sourceUri = vscode.Uri.joinPath(tempDir, `${baseName}.source`);
        const codexUri = vscode.Uri.joinPath(tempDir, `${baseName}.codex`);

        const { sourceColumn, targetColumn, idColumn, metadataColumns } = this.state.columnMapping;

        // Transform records into source and codex format
        const cells = parsedRecords.map((record: Record<string, string>, index: number) => {
            // If no headers, use column indices
            const sourceContent = this.state.columnMapping?.hasHeaders
                ? record[sourceColumn]
                : record[`Column ${parseInt(sourceColumn.replace("Column ", ""))}`];

            const id =
                idColumn && this.state.columnMapping?.hasHeaders
                    ? record[idColumn]
                    : idColumn
                      ? record[`Column ${parseInt(idColumn.replace("Column ", ""))}`]
                      : `cell-${index}`;

            const metadata = Object.fromEntries(
                metadataColumns.map((col) => [
                    col,
                    this.state.columnMapping?.hasHeaders
                        ? record[col]
                        : record[`Column ${parseInt(col.replace("Column ", ""))}`],
                ])
            );

            return {
                id: id || `cell-${index}`,
                content: sourceContent,
                metadata,
            };
        });

        const translations = parsedRecords.map((record: Record<string, string>, index: number) => {
            // If no headers, use column indices
            const targetContent = this.state.columnMapping?.hasHeaders
                ? record[targetColumn]
                : record[`Column ${parseInt(targetColumn.replace("Column ", ""))}`];

            const id =
                idColumn && this.state.columnMapping?.hasHeaders
                    ? record[idColumn]
                    : idColumn
                      ? record[`Column ${parseInt(idColumn.replace("Column ", ""))}`]
                      : `cell-${index}`;

            return {
                id: id || `cell-${index}`,
                content: targetContent,
                metadata: {},
            };
        });

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
            hasHeaders: this.state.columnMapping.hasHeaders,
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
