import * as vscode from "vscode";
import { BaseUploader, FileUploadResult } from "./BaseUploader";
import {
    SourcePreview,
    NotebookPreview,
    ValidationResult,
    CustomNotebookMetadata,
} from "../../../../types/index.d";
import { CodexCellTypes } from "../../../../types/enums";

export class PlaintextUploader extends BaseUploader {
    async processFile(
        file: { content: string; name: string },
        token: vscode.CancellationToken
    ): Promise<FileUploadResult> {
        const fileSize = this.getFileSize(file.content);

        // Split content into lines/paragraphs
        const lines = this.parseContent(file.content);

        // Validate content
        const validationResults = this.validateContent(lines);

        // Create notebooks
        const { sourceNotebook, codexNotebook } = await this.createNotebooks(
            lines,
            file.name,
            token
        );

        const preview: SourcePreview = {
            type: "source",
            fileName: file.name,
            fileSize,
            fileType: "plaintext",
            original: {
                preview: this.generatePreviewText(lines),
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

    private parseContent(content: string): string[] {
        // Split by double newlines (paragraphs) or single newlines if no paragraphs
        const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim());

        if (paragraphs.length > 1) {
            return paragraphs.map((p) => p.trim());
        }

        // Fall back to lines
        return content.split(/\n/).filter((line) => line.trim());
    }

    private validateContent(lines: string[]): ValidationResult[] {
        const errors: any[] = [];

        if (lines.length === 0) {
            errors.push({
                code: "INVALID_CONTENT",
                message: "File contains no content",
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
        lines: string[],
        fileName: string,
        token: vscode.CancellationToken
    ): Promise<{ sourceNotebook: NotebookPreview; codexNotebook: NotebookPreview }> {
        const baseName = fileName.replace(/\.txt$/i, "");
        const sourceFileName = `${baseName}.source`;
        const codexFileName = `${baseName}.codex`;

        // Create source cells
        const sourceCells = lines.map((line, index) => {
            const cellId = `plaintext-${index + 1}`;

            return {
                kind: vscode.NotebookCellKind.Code,
                value: line,
                languageId: "html",
                metadata: {
                    id: cellId,
                    type: CodexCellTypes.TEXT,
                    data: {},
                },
            };
        });

        // Create empty codex cells for translation
        const codexCells = lines.map((line, index) => {
            const cellId = `plaintext-${index + 1}`;

            return {
                kind: vscode.NotebookCellKind.Code,
                value: "", // Empty for translation
                languageId: "html",
                metadata: {
                    id: cellId,
                    type: CodexCellTypes.TEXT,
                    data: {},
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
            corpusMarker: "plaintext-import",
        };

        const codexMetadata: CustomNotebookMetadata = {
            id: `codex-${Date.now()}`,
            originalName: codexFileName,
            sourceFsPath: undefined,
            codexFsPath: undefined,
            navigation: [],
            sourceCreatedAt: new Date().toISOString(),
            corpusMarker: "plaintext-import",
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

    private generatePreviewText(lines: string[]): string {
        if (lines.length === 0) {
            return "No content found in file";
        }

        const maxLines = Math.min(5, lines.length);
        let preview = `Content will be split into ${lines.length} cells:\n\n`;

        for (let i = 0; i < maxLines; i++) {
            const line = lines[i];
            const truncatedLine = line.length > 100 ? line.substring(0, 100) + "..." : line;
            preview += `Cell ${i + 1}: ${truncatedLine}\n`;
        }

        if (lines.length > maxLines) {
            preview += `\n... and ${lines.length - maxLines} more cells`;
        }

        return preview;
    }
}
