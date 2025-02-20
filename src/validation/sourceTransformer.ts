import * as vscode from "vscode";
import { NotebookPreview, ValidationResult, FileType } from "../../types";
import { WebVTTParser } from "webvtt-parser";
import { ParsedUSFM, USFMParser } from "usfm-grammar";
import { getFileType } from "../utils/fileTypeUtils";
import { extractVerseRefFromLine, verseRefRegex } from "../utils/verseRefUtils";
import { CodexCellTypes } from "../../types/enums";
import * as path from "path";

export class SourceTransformer {
    async transformToNotebooks(fileUri: vscode.Uri): Promise<{
        sourceNotebooks: NotebookPreview[];
        codexNotebooks: NotebookPreview[];
        validationResults: ValidationResult[];
    }> {
        const fileType = getFileType(fileUri);
        const content = await vscode.workspace.fs.readFile(fileUri);
        const textContent = new TextDecoder().decode(content);

        // Get base name without extension for notebook name
        const fileName = path.parse(fileUri.fsPath).name;

        switch (fileType) {
            case "subtitles":
                return this.transformWebVTT(textContent, fileName);
            case "usfm":
                return this.transformUSFM(textContent, fileName);
            case "plaintext":
                return this.transformPlainText(textContent, fileName);
            default:
                throw new Error(`Unsupported file type: ${fileType}`);
        }
    }

    private async transformWebVTT(content: string, unprocessedBaseName: string) {
        const baseNameAsId = unprocessedBaseName.replace(/[^a-zA-Z0-9]/g, "-");
        const parser = new WebVTTParser();
        const parsed = parser.parse(content);

        const sourceNotebook = this.createNotebookPreview("source", unprocessedBaseName);
        const codexNotebook = this.createNotebookPreview("codex", unprocessedBaseName);

        for (const cue of parsed.cues) {
            // Generate a unique identifier for the cue that matches the expected format
            const cueId = `${baseNameAsId} 1:cue-${cue.startTime}-${cue.endTime}`;

            // Add cell to source notebook
            const sourceCell = {
                value: cue.text,
                kind: vscode.NotebookCellKind.Code,
                languageId: "scripture", // Changed to match expected format
                metadata: {
                    type: CodexCellTypes.TEXT,
                    id: cueId,
                    data: {
                        startTime: cue.startTime,
                        endTime: cue.endTime,
                        timeStamp: `${cue.startTime} --> ${cue.endTime}`,
                    },
                    edits: [], // Initialize empty edits array
                },
            };
            sourceNotebook.cells.push(sourceCell);

            // Add empty cell to codex notebook with same metadata structure
            const codexCell = {
                ...sourceCell,
                value: "", // Empty initial value for codex
                metadata: {
                    ...sourceCell.metadata,
                    edits: [], // Initialize empty edits array
                },
            };
            codexNotebook.cells.push(codexCell);
        }

        // Update metadata for both notebooks
        const notebookMetadata = {
            id: baseNameAsId,
            originalName: unprocessedBaseName,
            sourceFsPath: undefined,
            codexFsPath: undefined,
            navigation: [],
            sourceCreatedAt: new Date().toISOString(),
            codexLastModified: new Date().toISOString(),
            gitStatus: "untracked" as const,
            corpusMarker: "",
            textDirection: "ltr" as "ltr" | "rtl",
            data: {},
            videoUrl: "",
        };

        sourceNotebook.metadata = notebookMetadata;
        codexNotebook.metadata = {
            ...notebookMetadata,
            codexLastModified: new Date().toISOString(),
        };

        return {
            sourceNotebooks: [sourceNotebook],
            codexNotebooks: [codexNotebook],
            validationResults: [{ isValid: true, errors: [] }],
        };
    }

    private async transformUSFM(content: string, baseName: string) {
        // Use the grammar import from codexNotebookUtils.ts
        const parser = new USFMParser(content);
        const parsed = parser.toJSON() as unknown as ParsedUSFM;
        // FIXME: verify use of usfm grammar as per codexNotebookUtils.ts

        const notebookName =
            (typeof parsed.book === "string" ? parsed.book : String(parsed.book)) || baseName;

        const sourceNotebook = this.createNotebookPreview("source", notebookName);
        const codexNotebook = this.createNotebookPreview("codex", notebookName);

        // Process each verse
        for (const chapter of parsed.chapters) {
            for (const verse of chapter.contents) {
                const verseRef = `${parsed.book} ${chapter.chapterNumber}:${verse.verseNumber}`;

                // Add to source notebook
                sourceNotebook.cells.push({
                    value: verse.contents?.join("\n") ?? "",
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    metadata: {
                        id: verseRef,
                        type: CodexCellTypes.TEXT,
                        data: {
                            book: parsed.book,
                            chapter: chapter.chapterNumber,
                            verse: verse.verseNumber,
                        },
                    },
                });

                // Add empty cell to codex notebook
                codexNotebook.cells.push({
                    value: "",
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    metadata: {
                        id: verseRef,
                        type: CodexCellTypes.TEXT,
                        data: {
                            book: parsed.book,
                            chapter: chapter.chapterNumber,
                            verse: verse.verseNumber,
                        },
                    },
                });
            }
        }

        return {
            sourceNotebooks: [sourceNotebook],
            codexNotebooks: [codexNotebook],
            validationResults: [{ isValid: true, errors: [] }],
        };
    }

    private async transformPlainText(content: string, baseName: string) {
        const lines = content.split("\n");
        const sourceNotebook = this.createNotebookPreview("source", baseName);
        const codexNotebook = this.createNotebookPreview("codex", baseName);

        for (const line of lines) {
            const verseRef = extractVerseRefFromLine(line);
            if (!verseRef) continue;

            const verseContent = line.replace(verseRefRegex, "").trim();

            // Add to source notebook
            sourceNotebook.cells.push({
                value: verseContent,
                kind: vscode.NotebookCellKind.Code,
                languageId: "html",
                metadata: {
                    id: verseRef,
                    type: CodexCellTypes.TEXT,
                    data: {},
                    cellLabel: verseRef,
                },
            });

            // Add empty cell to codex notebook
            codexNotebook.cells.push({
                value: "",
                kind: vscode.NotebookCellKind.Code,
                languageId: "html",
                metadata: {
                    id: verseRef,
                    type: CodexCellTypes.TEXT,
                    data: {},
                    cellLabel: verseRef,
                },
            });
        }

        return {
            sourceNotebooks: [sourceNotebook],
            codexNotebooks: [codexNotebook],
            validationResults: [{ isValid: true, errors: [] }],
        };
    }

    private createNotebookPreview(type: "source" | "codex", name: string): NotebookPreview {
        return {
            name, // Set the name from the parameter
            cells: [],
            metadata: {
                id: name, // Also use the name as the ID
                originalName: name,
                sourceFsPath: undefined,
                codexFsPath: undefined,
                navigation: [],
                sourceCreatedAt: new Date().toISOString(),
                gitStatus: "untracked",
                corpusMarker: "",
            },
        };
    }
}
