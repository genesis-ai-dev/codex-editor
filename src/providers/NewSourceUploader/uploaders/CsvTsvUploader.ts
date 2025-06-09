// DELETEME?: Seems like this file is unused

import * as vscode from "vscode";
import * as xlsx from "xlsx";
import { BaseUploader, FileUploadResult } from "./BaseUploader";
import {
    SourcePreview,
    NotebookPreview,
    ValidationResult,
    CustomNotebookMetadata,
} from "../../../../types/index.d";
import { CodexCellTypes } from "../../../../types/enums";
import { CodexContentSerializer } from "../../../serializer";

interface CsvTsvRow {
    [key: string]: string;
}

export class CsvTsvUploader extends BaseUploader {
    async processFile(
        file: { content: string; name: string },
        token: vscode.CancellationToken
    ): Promise<FileUploadResult> {
        const fileSize = this.getFileSize(file.content);

        // Parse CSV/TSV content
        const rows = this.parseContent(file.content, file.name);

        // Validate content
        const validationResults = this.validateContent(rows);

        // Create notebooks
        const { sourceNotebook, codexNotebook } = await this.createNotebooks(
            rows,
            file.name,
            token
        );

        const preview: SourcePreview = {
            type: "source",
            fileName: file.name,
            fileSize,
            fileType: file.name.endsWith(".csv") ? "csv" : "tsv",
            original: {
                preview: this.generatePreviewText(rows),
                validationResults,
            },
            transformed: {
                sourceNotebooks: [sourceNotebook],
                codexNotebooks: [codexNotebook],
                validationResults,
            },
        };

        return {
            fileName: file.name,
            fileSize,
            preview,
        };
    }

    private parseContent(content: string, fileName: string): CsvTsvRow[] {
        const isTabDelimited = fileName.toLowerCase().endsWith(".tsv");
        const delimiter = isTabDelimited ? "\t" : ",";

        try {
            const workbook = xlsx.read(content, {
                type: "string",
                raw: true,
                FS: delimiter,
            });

            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            const rows: CsvTsvRow[] = xlsx.utils.sheet_to_json(worksheet, {
                raw: false,
                defval: "", // Default value for empty cells
            });

            return rows;
        } catch (error) {
            throw new Error(
                `Failed to parse ${isTabDelimited ? "TSV" : "CSV"} file: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    }

    private validateContent(rows: CsvTsvRow[]): ValidationResult[] {
        const errors: any[] = [];

        if (rows.length === 0) {
            errors.push({
                code: "INVALID_CONTENT",
                message: "File contains no data rows",
            });
        }

        // Check for required columns (flexible approach)
        const firstRow = rows[0];
        if (firstRow && Object.keys(firstRow).length === 0) {
            errors.push({
                code: "INVALID_CONTENT",
                message: "File contains no columns",
            });
        }

        return [
            {
                isValid: errors.length === 0,
                errors,
            },
        ];
    }

    private async createNotebooks(
        rows: CsvTsvRow[],
        fileName: string,
        token: vscode.CancellationToken
    ): Promise<{ sourceNotebook: NotebookPreview; codexNotebook: NotebookPreview }> {
        const baseName = fileName.replace(/\.(csv|tsv)$/i, "");
        const sourceFileName = `${baseName}.source`;
        const codexFileName = `${baseName}.codex`;

        // Determine the content strategy based on available columns
        const columns = Object.keys(rows[0] || {});
        const contentStrategy = this.determineContentStrategy(columns);

        // Create source cells
        const sourceCells = rows.map((row, index) => {
            const cellId = this.generateCellId(row, index);
            const content = this.extractSourceContent(row, contentStrategy);

            return {
                kind: vscode.NotebookCellKind.Code,
                value: content,
                languageId: "html",
                metadata: {
                    id: cellId,
                    type: CodexCellTypes.TEXT,
                    data: {
                        originalRowData: row,
                    },
                },
            };
        });

        // Create codex cells (initially empty for translation)
        const codexCells = rows.map((row, index) => {
            const cellId = this.generateCellId(row, index);
            const targetContent = this.extractTargetContent(row, contentStrategy);

            return {
                kind: vscode.NotebookCellKind.Code,
                value: targetContent || "", // Empty if no target content
                languageId: "html",
                metadata: {
                    id: cellId,
                    type: CodexCellTypes.TEXT,
                    data: {
                        originalRowData: row,
                    },
                },
            };
        });

        // Create metadata
        const sourceMetadata: CustomNotebookMetadata = {
            id: `source-${Date.now()}`,
            originalName: sourceFileName,
            sourceFsPath: undefined,
            codexFsPath: undefined,
            navigation: [],
            sourceCreatedAt: new Date().toISOString(),
            corpusMarker: "csv-tsv-import",
        };

        const codexMetadata: CustomNotebookMetadata = {
            id: `codex-${Date.now()}`,
            originalName: codexFileName,
            sourceFsPath: undefined,
            codexFsPath: undefined,
            navigation: [],
            sourceCreatedAt: new Date().toISOString(),
            corpusMarker: "csv-tsv-import",
        };

        return {
            sourceNotebook: {
                name: sourceFileName,
                cells: sourceCells,
                metadata: sourceMetadata,
            },
            codexNotebook: {
                name: codexFileName,
                cells: codexCells,
                metadata: codexMetadata,
            },
        };
    }

    private determineContentStrategy(columns: string[]): {
        sourceColumn: string;
        targetColumn?: string;
        idColumn?: string;
    } {
        const lowerColumns = columns.map((c) => c.toLowerCase());

        // Look for common source column names
        const sourceColumn =
            columns.find((_, i) =>
                ["source", "original", "text", "content", "english"].includes(lowerColumns[i])
            ) || columns[0]; // Default to first column

        // Look for common target column names
        const targetColumn = columns.find((_, i) =>
            ["target", "translation", "translated", "output"].includes(lowerColumns[i])
        );

        // Look for ID column
        const idColumn = columns.find((_, i) =>
            ["id", "identifier", "key", "ref", "reference"].includes(lowerColumns[i])
        );

        return { sourceColumn, targetColumn, idColumn };
    }

    private extractSourceContent(row: CsvTsvRow, strategy: any): string {
        return row[strategy.sourceColumn] || "";
    }

    private extractTargetContent(row: CsvTsvRow, strategy: any): string | undefined {
        return strategy.targetColumn ? row[strategy.targetColumn] : undefined;
    }

    private generateCellId(row: CsvTsvRow, index: number): string {
        // Try to use an ID column if available, otherwise use index
        const columns = Object.keys(row);
        const idColumn = columns.find((col) =>
            ["id", "identifier", "key", "ref", "reference"].includes(col.toLowerCase())
        );

        if (idColumn && row[idColumn]) {
            return `csv-tsv-${row[idColumn]}`;
        }

        return `csv-tsv-row-${index + 1}`;
    }

    private generatePreviewText(rows: CsvTsvRow[]): string {
        if (rows.length === 0) {
            return "No data found in file";
        }

        const columns = Object.keys(rows[0]);
        const maxRows = Math.min(5, rows.length);

        let preview = `Columns: ${columns.join(", ")}\n\n`;
        preview += `Sample data (showing ${maxRows} of ${rows.length} rows):\n\n`;

        for (let i = 0; i < maxRows; i++) {
            const row = rows[i];
            preview += `Row ${i + 1}:\n`;
            for (const column of columns) {
                const value = row[column] || "";
                const truncatedValue = value.length > 50 ? value.substring(0, 50) + "..." : value;
                preview += `  ${column}: ${truncatedValue}\n`;
            }
            preview += "\n";
        }

        return preview;
    }
}
